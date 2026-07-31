/**
 * 手荷物検査 日次バッチ（M6）— 毎朝 05:00 JST（Vercel Cron・vercel.json）
 *
 * inspection_settings.enabled の各店舗について:
 *   1. アンマッチ確定 — 前日までに入室したまま退出が無い entered を unmatched_exit へ
 *      （M2 computeUnmatchedExits と同条件。日跨ぎ勤務なし前提・M1）
 *   2. 店長メール（D8）— 前日のアンマッチ（unmatched_entry / unmatched_exit）一覧を
 *      店舗担当の admin_users（store_ids に当該店舗）へ送信。0件時は送らない
 *   3. 来訪者の当日コレクション削除 — 前日の baggage-<store>-<ymd> を Rekognition から
 *      削除（掲示「来訪者=当日中に自動削除」の実装。AWS 未設定・不存在は握って続行）
 *   4. 保持期間 purge — retention_days 超過セッションのクリップ/顔・名刺写真を Storage
 *      から削除し、セッション行を削除（clips/events/jobs は ON DELETE CASCADE）。
 *      従業員マスタの顔（employees.face_photo_path）は登録抹消まで保持＝purge 対象外
 *
 * 店舗単位で try/catch — 1店舗の失敗（AWSダウン等）で他店舗を巻き込まない。
 * 認証: Vercel Cron の Bearer CRON_SECRET / x-cron-secret（edge-health と同形）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseService } from '@/lib/supabase/server'
import { sendEmail } from '@/lib/email/send'
import {
  jstDateStr, computeUnmatchedExits, retentionCutoffIso, buildUnmatchEmail,
  type SessionLite, type UnmatchItem,
} from '@/lib/baggage/unmatch'
import { deleteCollectionById, visitorDailyCollectionId } from '@/lib/aws/rekognition'
import { loadTenantSettings } from '@/lib/baggage/tenant-settings'
import { isR2Path, r2Key, r2Configured, deleteClipObjects } from '@/lib/baggage/r2'

export const maxDuration = 300   // 店舗数×Storage削除で伸びるため上限を確保

interface StoreResult {
  storeId: string
  unmatchedMarked: number
  mailSent: boolean
  mailRecipients: number
  visitorCollectionDeleted: boolean
  purgedSessions: number
  errors: string[]
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 })
  const authed = req.headers.get('authorization') === `Bearer ${secret}`
    || req.headers.get('x-cron-secret') === secret
  if (!authed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const svc = createSupabaseService()
  const now = new Date()
  const today = jstDateStr(now)
  const yesterday = jstDateStr(now, -1)

  // Phase2: 店舗別オプション（検査）ゲート。opt_baggage=true の店舗のみ日次処理。
  // stores を inner join し opt_baggage で絞る（OFF 店舗はバッチ対象外）。
  const { data: settingsRows, error: sErr } = await svc
    .from('inspection_settings')
    .select('store_id, tenant_id, notify_emails, stores!inner ( name, opt_baggage )')
    .eq('enabled', true)
    .eq('stores.opt_baggage', true)
  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 })

  // 保持日数はテナント共通設定（baggage_tenant_settings）から。テナント毎に一度だけ読む。
  const tenantRetention = new Map<string, number>()
  const getRetentionDays = async (tenantId: string): Promise<number> => {
    if (tenantRetention.has(tenantId)) return tenantRetention.get(tenantId)!
    const t = await loadTenantSettings(svc, tenantId)
    tenantRetention.set(tenantId, t.retentionDays)
    return t.retentionDays
  }

  const results: StoreResult[] = []

  for (const row of (settingsRows ?? []) as { store_id: string; tenant_id: string; notify_emails: string[] | null; stores: unknown }[]) {
    const storeId = row.store_id
    const storeRel = Array.isArray(row.stores) ? row.stores[0] : row.stores
    const storeName = (storeRel as { name?: string } | null)?.name ?? storeId.slice(0, 8)
    const retentionDays = await getRetentionDays(row.tenant_id)
    const r: StoreResult = {
      storeId, unmatchedMarked: 0, mailSent: false, mailRecipients: 0,
      visitorCollectionDeleted: false, purgedSessions: 0, errors: [],
    }
    results.push(r)

    // ── 1. アンマッチ確定（前日までの entered × 退出なし） ──────────────────
    try {
      const { data: open } = await svc
        .from('inspection_sessions')
        .select('id, entry_at, exit_at, status')
        .eq('store_id', storeId)
        .eq('status', 'entered')
        .lt('inspection_date', today)
      const ids = computeUnmatchedExits((open ?? []) as SessionLite[])
      if (ids.length > 0) {
        const { error } = await svc
          .from('inspection_sessions')
          .update({ status: 'unmatched_exit', updated_at: now.toISOString() })
          .in('id', ids)
        if (error) throw new Error(`unmatched update: ${error.message}`)
        r.unmatchedMarked = ids.length
      }
    } catch (e) {
      r.errors.push(String((e as Error).message ?? e))
    }

    // ── 2. 店長メール（前日のアンマッチ一覧・0件時は送らない） ─────────────
    try {
      const { data: unmatched } = await svc
        .from('inspection_sessions')
        .select('status, entry_at, exit_at, visitor_name, person_kind, employees ( name )')
        .eq('store_id', storeId)
        .eq('inspection_date', yesterday)
        .in('status', ['unmatched_entry', 'unmatched_exit'])
      const items: UnmatchItem[] = ((unmatched ?? []) as {
        status: string; entry_at: string | null; exit_at: string | null
        visitor_name: string | null; person_kind: string; employees: unknown
      }[]).map((s) => {
        const emp = Array.isArray(s.employees) ? s.employees[0] : s.employees
        const empName = (emp as { name?: string } | null)?.name
        const at = s.exit_at ?? s.entry_at
        return {
          kind: s.status,
          personLabel: s.person_kind === 'staff' ? (empName ?? '（未特定）') : (s.visitor_name ?? '（未特定）'),
          at: at ? new Date(at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : null,
        }
      })
      if (items.length > 0) {
        // 宛先: 店舗別 inspection_settings.notify_emails（/admin/baggage で設定。
        // BCP・巡回と同方式）。未設定時は従来どおり店舗担当の admin_users へフォールバック。
        let to = (row.notify_emails ?? []).filter(Boolean)
        if (to.length === 0) {
          const { data: managers } = await svc
            .from('admin_users')
            .select('email')
            .contains('store_ids', [storeId])
            .not('email', 'is', null)
          to = ((managers ?? []) as { email: string | null }[])
            .map((m) => m.email).filter(Boolean) as string[]
        }
        r.mailRecipients = to.length
        if (to.length > 0) {
          const { subject, html } = buildUnmatchEmail(storeName, yesterday, items)
          const sent = await sendEmail(to, subject, html)
          r.mailSent = sent.ok
        } else {
          r.errors.push('no recipient (notify_emails / store_ids)')
        }
      }
    } catch (e) {
      r.errors.push(String((e as Error).message ?? e))
    }

    // ── 3. 来訪者コレクション削除（直近7日分を掃引 — cron が1日落ちても翌日
    //       追いつく。不存在は deleteCollectionById 内で無視・AWS障害は握って続行） ─
    try {
      for (let d = 1; d <= 7; d++) {
        const ymd = jstDateStr(now, -d).replaceAll('-', '')
        await deleteCollectionById(visitorDailyCollectionId(storeId, ymd))
      }
      r.visitorCollectionDeleted = true
    } catch (e) {
      r.errors.push(`rekognition: ${String((e as Error).message ?? e)}`)
    }

    // ── 4. 保持期間 purge ────────────────────────────────────────────────────
    //   4a. クリップ: 対象セッションの storage_path を削除 → 行を CASCADE 削除
    //   4b. 写真: キオスク撮影分は <store>/<ymd>/ 配下に集約されているため、
    //       カットオフより古い日付フォルダごと削除（セッションに紐付かなかった
    //       照合リトライ・タイムアウト時の孤児写真、途中入退イベントの顔も漏れなく消える。
    //       従業員マスタの顔は employees/ 配下＝対象外）
    try {
      const cutoff = retentionCutoffIso(retentionDays, now)
      const { data: old } = await svc
        .from('inspection_sessions')
        .select('id')
        .eq('store_id', storeId)
        .lt('created_at', cutoff)
        .limit(500)   // 1回の cron で最大500件（残りは翌日以降に自然消化）
      const ids = ((old ?? []) as { id: string }[]).map((s) => s.id)
      if (ids.length > 0) {
        const { data: clips } = await svc
          .from('inspection_clips')
          .select('storage_path')
          .in('session_id', ids)
        const clipPaths = ((clips ?? []) as { storage_path: string }[])
          .map((c) => c.storage_path).filter((p) => !p.startsWith('failed/'))
        // R2 分（r2: プレフィックス）と Supabase 分を分けて削除。
        const r2Keys = clipPaths.filter(isR2Path).map(r2Key)
        const supaPaths = clipPaths.filter((p) => !isR2Path(p))
        if (r2Keys.length > 0) {
          if (r2Configured()) {
            try { await deleteClipObjects(r2Keys) }
            catch (e) { r.errors.push(`clip purge (r2): ${String((e as Error).message ?? e)}`) }
          } else {
            // env が外れた状態で行だけ消すと R2 に孤児が残るため明示エラー。
            r.errors.push(`clip purge (r2): R2 not configured (${r2Keys.length} keys skipped)`)
          }
        }
        if (supaPaths.length > 0) {
          const { error } = await svc.storage.from('baggage-clips').remove(supaPaths)
          if (error) r.errors.push(`clip purge: ${error.message}`)
        }
        const { error: delErr } = await svc.from('inspection_sessions').delete().in('id', ids)
        if (delErr) throw new Error(`session delete: ${delErr.message}`)
        r.purgedSessions = ids.length
      }

      // 4b. 日付フォルダ単位の写真 purge（孤児含む全消し）
      const cutoffYmd = jstDateStr(now, -(retentionDays)).replaceAll('-', '')
      const { data: dayFolders } = await svc.storage.from('baggage-photos').list(storeId, { limit: 1000 })
      for (const folder of dayFolders ?? []) {
        if (!/^\d{8}$/.test(folder.name) || folder.name >= cutoffYmd) continue
        const { data: files } = await svc.storage.from('baggage-photos').list(`${storeId}/${folder.name}`, { limit: 1000 })
        const paths = (files ?? []).map((f) => `${storeId}/${folder.name}/${f.name}`)
        if (paths.length > 0) {
          const { error } = await svc.storage.from('baggage-photos').remove(paths)
          if (error) r.errors.push(`photo folder purge ${folder.name}: ${error.message}`)
        }
      }

      // 4c. セッションに紐付かなかった孤児イベント行（紐付き分は CASCADE 済み）
      await svc.from('inspection_session_events')
        .delete()
        .eq('store_id', storeId)
        .is('session_id', null)
        .lt('created_at', cutoff)
    } catch (e) {
      r.errors.push(String((e as Error).message ?? e))
    }
  }

  // ── 5. クリップジョブの後始末（全店舗横断・エッジが二度と拾わないジョブの確定） ──
  //   - pending のまま deadline_at 超過（エッジ停止・カメラ削除・非対応vendor）→ failed
  //   - running のまま30分更新なし（エッジがクレーム後にクラッシュ）→ pending へ戻す
  //     （deadline 超過分は failed）。管理画面が「処理中」のまま固まるのを防ぐ。
  const jobSweep = { failed: 0, requeued: 0 }
  try {
    const nowIso2 = new Date().toISOString()
    const { data: expired } = await svc
      .from('inspection_clip_jobs')
      .update({ status: 'failed', updated_at: nowIso2 })
      .in('status', ['pending', 'running'])
      .lt('deadline_at', nowIso2)
      .select('id, tenant_id, store_id, session_id, camera_id')
    jobSweep.failed = expired?.length ?? 0
    for (const j of (expired ?? []) as { tenant_id: string; store_id: string; session_id: string; camera_id: string | null }[]) {
      // 詳細画面が「取得失敗」を表示できるようクリップ行も failed で残す（done は上書きしない）
      const { data: existing } = await svc
        .from('inspection_clips')
        .select('upload_status')
        .eq('session_id', j.session_id)
        .eq('camera_id', j.camera_id)
        .maybeSingle()
      if (existing?.upload_status === 'done') continue
      await svc.from('inspection_clips').upsert(
        {
          tenant_id: j.tenant_id, store_id: j.store_id, session_id: j.session_id, camera_id: j.camera_id,
          storage_path: `failed/${j.session_id}/${j.camera_id}`, upload_status: 'failed',
        },
        { onConflict: 'session_id,camera_id' },
      )
    }
    const staleIso = new Date(Date.now() - 30 * 60 * 1000).toISOString()
    const { data: requeued } = await svc
      .from('inspection_clip_jobs')
      .update({ status: 'pending', updated_at: nowIso2 })
      .eq('status', 'running')
      .lt('updated_at', staleIso)
      .select('id')
    jobSweep.requeued = requeued?.length ?? 0
  } catch (e) {
    results.push({
      storeId: '(job-sweep)', unmatchedMarked: 0, mailSent: false, mailRecipients: 0,
      visitorCollectionDeleted: false, purgedSessions: 0,
      errors: [String((e as Error).message ?? e)],
    })
  }

  const summary = {
    date: today,
    stores: results.length,
    unmatchedMarked: results.reduce((a, r) => a + r.unmatchedMarked, 0),
    mailsSent: results.filter((r) => r.mailSent).length,
    purgedSessions: results.reduce((a, r) => a + r.purgedSessions, 0),
    jobSweep,
    errors: results.flatMap((r) => r.errors.map((e) => `${r.storeId.slice(0, 8)}: ${e}`)),
  }
  console.log('[baggage-daily]', JSON.stringify(summary))
  // ok はエラー0の時のみ true（監視がボディで異常検知できるように。HTTP は 200 のまま
  // — Vercel Cron はリトライしないため 5xx にする利点がない）
  return NextResponse.json({ ok: summary.errors.length === 0, ...summary, results })
}
