/**
 * 手荷物検査 日次バッチ（T7）
 *
 * GET /api/v1/cron/baggage-daily   （Vercel Cron・Bearer CRON_SECRET）
 * vercel.json schedule: "0 20 * * *"（05:00 JST）
 *
 * 前日分について店舗毎に:
 *   1. アンマッチ検出: 入室あり×退出なし → status=unmatched_exit
 *   2. 毎朝の店長メール: 前日のアンマッチ（unmatched_exit + unmatched_entry）を送信（D8）
 *   3. 来訪者コレクション削除: baggage-<store>-<yesterday> を Rekognition から削除
 * 全店舗横断:
 *   4. 保持purge: retention_days を超えたクリップを Storage + DB から削除
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { deleteCollectionById, visitorDailyCollectionId } from '@/lib/aws/rekognition'
import { sendEmailNotification } from '@/lib/notifications/email'
import {
  jstDateStr, computeUnmatchedExits, retentionCutoffIso, buildUnmatchEmail,
  type SessionLite, type UnmatchItem,
} from '@/lib/baggage/unmatch'

type StoreRow = { id: string; tenant_id: string; name: string; settings: Record<string, unknown> | null }

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const now = new Date()
  const yesterday = jstDateStr(now, -1)
  const collectionYmd = yesterday.replace(/-/g, '')

  const { data: stores } = await supabase
    .from('stores')
    .select('id, tenant_id, name, settings')
    .returns<StoreRow[]>()

  const enabled = (stores ?? []).filter(
    (s) => ((s.settings?.baggage_option ?? {}) as Record<string, unknown>).enabled === true,
  )

  const summary = { date: yesterday, stores: 0, unmatchedExit: 0, emails: 0, collectionsDeleted: 0, clipsPurged: 0 }

  for (const store of enabled) {
    summary.stores++

    // 1. アンマッチ検出（入室あり×退出なし）
    const { data: sessions } = await supabase
      .from('inspection_sessions')
      .select('id, entry_at, exit_at, status')
      .eq('store_id', store.id)
      .eq('inspection_date', yesterday)
      .returns<SessionLite[]>()

    const unmatchedIds = computeUnmatchedExits(sessions ?? [])
    if (unmatchedIds.length > 0) {
      await supabase
        .from('inspection_sessions')
        .update({ status: 'unmatched_exit', updated_at: now.toISOString() })
        .in('id', unmatchedIds)
      summary.unmatchedExit += unmatchedIds.length
    }

    // 2. 毎朝の店長メール（前日の全アンマッチ）
    const { data: unmatched } = await supabase
      .from('inspection_sessions')
      .select('id, status, person_kind, visitor_name, entry_at, exit_at, employee_id')
      .eq('store_id', store.id)
      .eq('inspection_date', yesterday)
      .in('status', ['unmatched_exit', 'unmatched_entry'])

    const items: UnmatchItem[] = (unmatched ?? []).map((u) => ({
      personLabel: u.visitor_name ?? (u.employee_id ? '従業員' : '（未特定）'),
      kind: u.status,
      at: u.exit_at ?? u.entry_at,
    }))

    // 店舗の管理者（担当店舗 or フルアドミン）にメール
    const { data: admins } = await supabase
      .from('admin_users')
      .select('email, role, store_ids')
      .eq('tenant_id', store.tenant_id)
    const recipients = (admins ?? [])
      .filter((a) => a.role === 'tenant_admin' || a.role === 'super_admin' || (a.store_ids ?? []).includes(store.id))
      .map((a) => a.email)
      .filter(Boolean)

    if (recipients.length > 0) {
      const { subject, html } = buildUnmatchEmail(store.name, yesterday, items)
      await Promise.all(recipients.map((to) => sendEmailNotification(to, subject, html)))
      summary.emails += recipients.length
    }

    // 3. 来訪者コレクション削除（当日限りの顔データ）
    try {
      await deleteCollectionById(visitorDailyCollectionId(store.id, collectionYmd))
      summary.collectionsDeleted++
    } catch (e) {
      console.error('[baggage-daily] collection delete failed', store.id, e)
    }
  }

  // 4. 保持purge（クリップ・全店舗横断・store設定の retention_days）
  for (const store of enabled) {
    const retentionDays = Number(((store.settings?.baggage_option ?? {}) as Record<string, unknown>).retention_days) || 60
    const cutoff = retentionCutoffIso(retentionDays, now)
    const { data: oldClips } = await supabase
      .from('inspection_clips')
      .select('id, storage_path')
      .eq('store_id', store.id)
      .lt('created_at', cutoff)

    if (oldClips && oldClips.length > 0) {
      const paths = oldClips.map((c) => c.storage_path).filter(Boolean)
      if (paths.length > 0) await supabase.storage.from('baggage-clips').remove(paths)
      await supabase.from('inspection_clips').delete().in('id', oldClips.map((c) => c.id))
      summary.clipsPurged += oldClips.length
    }
  }

  return NextResponse.json({ success: true, ...summary, timestamp: now.toISOString() })
}
