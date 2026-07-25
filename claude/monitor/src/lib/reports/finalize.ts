import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { monthBounds } from './usage'
import { buildMonthlyReportPdf } from './monthly-pdf'
import type { MonthlyTotals, MonthlyStoreRow, MonthlyContract, MonthlyRegistration } from './monthly-types'

/**
 * 月次確定（C）: 指定テナント・年月の利用状況を usage_daily から集計してスナップショット化し、
 * PDF を生成して reports バケットに保存、monthly_reports に upsert する。
 * 手動確定API・report_day cron の両方から呼ぶ。必ず service client で。
 */
const BUCKET = 'reports'

function num(v: unknown): number { return typeof v === 'number' ? v : Number(v ?? 0) }

export interface FinalizeResult {
  ok: boolean
  error?: string
  ym: string
  pdfUrl?: string
  tenantName?: string
  storeCount?: number
  totals?: MonthlyTotals
}

export async function finalizeMonthlyReport(
  svc: SupabaseClient,
  tenantId: string,
  ym: string,               // 'YYYY-MM'
  generatedBy: string | null,
): Promise<FinalizeResult> {
  if (!/^\d{4}-\d{2}$/.test(ym)) return { ok: false, error: 'invalid_ym', ym }
  const [y, m] = ym.split('-').map(Number)
  const { from, to } = monthBounds(y, m)

  // 集計（テナント全体・店舗別）。
  const { data: sumData, error: sumErr } = await svc.rpc('usage_summary', {
    p_from: from, p_to: to, p_tenant: tenantId, p_store_ids: null,
  })
  if (sumErr) return { ok: false, error: sumErr.message, ym }

  const stores: MonthlyStoreRow[] = ((sumData ?? []) as Record<string, unknown>[]).map((r) => ({
    store_id: String(r.store_id), store_name: String(r.store_name ?? ''),
    patrol: num(r.patrol_count), alarm: num(r.alarm_count), inspection: num(r.inspection_count),
    baggage_exit: num(r.baggage_exit_count), baggage_confirmed: num(r.baggage_confirmed_count),
    face_attempts: num(r.face_auth_attempts), face_matched: num(r.face_auth_matched), face_unmatched: num(r.face_auth_unmatched),
  }))
  const totals: MonthlyTotals = stores.reduce((a, s) => ({
    patrol: a.patrol + s.patrol, alarm: a.alarm + s.alarm, inspection: a.inspection + s.inspection,
    baggage_exit: a.baggage_exit + s.baggage_exit, baggage_confirmed: a.baggage_confirmed + s.baggage_confirmed,
    face_matched: a.face_matched + s.face_matched, face_unmatched: a.face_unmatched + s.face_unmatched,
    face_attempts: a.face_attempts + s.face_attempts, video_live: 0, footage_access: 0,
  }), { patrol: 0, alarm: 0, inspection: 0, baggage_exit: 0, baggage_confirmed: 0, face_matched: 0, face_unmatched: 0, face_attempts: 0, video_live: 0, footage_access: 0 })

  // 契約 vs 登録（確定時点のスナップショット）。
  const { data: tn } = await svc.from('tenants')
    .select('name, max_stores, max_patrol, max_alarm, max_baggage').eq('id', tenantId).maybeSingle()
  const tenantName = (tn?.name as string) ?? '(不明テナント)'
  const contract: MonthlyContract = {
    max_stores: (tn?.max_stores ?? null) as number | null,
    max_patrol: (tn?.max_patrol ?? null) as number | null,
    max_alarm: (tn?.max_alarm ?? null) as number | null,
    max_baggage: (tn?.max_baggage ?? null) as number | null,
  }
  const countOn = async (col?: 'opt_patrol' | 'opt_alarm' | 'opt_baggage') => {
    let q = svc.from('stores').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId)
    if (col) q = q.eq(col, true)
    const { count } = await q
    return count ?? 0
  }
  const [sc, pc, ac, bc] = await Promise.all([countOn(), countOn('opt_patrol'), countOn('opt_alarm'), countOn('opt_baggage')])
  const reg: MonthlyRegistration = { stores: sc, patrol: pc, alarm: ac, baggage: bc }

  const generatedAt = new Date().toISOString()

  // PDF 生成 → 保存（reports/monthly/<tenant>/<ym>.pdf・上書き）。
  // 例外（フォント/pdfkit 未同梱の ENOENT 等）を握って原因を返す。
  let pdf: Buffer
  try {
    pdf = await buildMonthlyReportPdf({ tenantName, ym, generatedAt, totals, stores, contract, reg })
  } catch (e) {
    return { ok: false, error: `pdf build: ${String((e as Error)?.message ?? e)}`, ym }
  }
  const key = `monthly/${tenantId}/${ym}.pdf`
  const { error: upErr } = await svc.storage.from(BUCKET).upload(key, pdf, { contentType: 'application/pdf', upsert: true })
  if (upErr) return { ok: false, error: `pdf upload: ${upErr.message}`, ym }
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const pdfUrl = `${base}/storage/v1/object/public/${BUCKET}/${key}`

  const { error: insErr } = await svc.from('monthly_reports').upsert({
    tenant_id: tenantId, ym, totals, stores, contract: { ...contract, reg },
    pdf_url: pdfUrl, generated_at: generatedAt, generated_by: generatedBy,
  }, { onConflict: 'tenant_id,ym' })
  if (insErr) return { ok: false, error: insErr.message, ym }

  return { ok: true, ym, pdfUrl, tenantName, storeCount: stores.length, totals }
}
