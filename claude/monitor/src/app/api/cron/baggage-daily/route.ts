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
  const yesterdayYmd = yesterday.replaceAll('-', '')   // 来訪者コレクション名の日付部

  const { data: settingsRows, error: sErr } = await svc
    .from('inspection_settings')
    .select('store_id, retention_days, stores ( name )')
    .eq('enabled', true)
  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 })

  const results: StoreResult[] = []

  for (const row of (settingsRows ?? []) as { store_id: string; retention_days: number; stores: unknown }[]) {
    const storeId = row.store_id
    const storeRel = Array.isArray(row.stores) ? row.stores[0] : row.stores
    const storeName = (storeRel as { name?: string } | null)?.name ?? storeId.slice(0, 8)
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
        const { data: managers } = await svc
          .from('admin_users')
          .select('email')
          .contains('store_ids', [storeId])
          .not('email', 'is', null)
        const to = ((managers ?? []) as { email: string | null }[])
          .map((m) => m.email).filter(Boolean) as string[]
        r.mailRecipients = to.length
        if (to.length > 0) {
          const { subject, html } = buildUnmatchEmail(storeName, yesterday, items)
          const sent = await sendEmail(to, subject, html)
          r.mailSent = sent.ok
        } else {
          r.errors.push('no manager email (store_ids)')
        }
      }
    } catch (e) {
      r.errors.push(String((e as Error).message ?? e))
    }

    // ── 3. 来訪者の当日コレクション削除（前日分・不存在/AWS未設定は握る） ───
    try {
      await deleteCollectionById(visitorDailyCollectionId(storeId, yesterdayYmd))
      r.visitorCollectionDeleted = true
    } catch (e) {
      r.errors.push(`rekognition: ${String((e as Error).message ?? e)}`)
    }

    // ── 4. 保持期間 purge（クリップ・顔/名刺写真 → セッション行を CASCADE 削除） ─
    try {
      const cutoff = retentionCutoffIso(row.retention_days || 60, now)
      const { data: old } = await svc
        .from('inspection_sessions')
        .select('id, entry_face_path, exit_face_path, card_photo_path')
        .eq('store_id', storeId)
        .lt('created_at', cutoff)
        .limit(500)   // 1回の cron で最大500件（残りは翌日以降に自然消化）
      const sessions = (old ?? []) as {
        id: string; entry_face_path: string | null; exit_face_path: string | null; card_photo_path: string | null
      }[]
      if (sessions.length > 0) {
        const ids = sessions.map((s) => s.id)
        const { data: clips } = await svc
          .from('inspection_clips')
          .select('storage_path')
          .in('session_id', ids)
        const clipPaths = ((clips ?? []) as { storage_path: string }[])
          .map((c) => c.storage_path).filter((p) => !p.startsWith('failed/'))
        if (clipPaths.length > 0) {
          const { error } = await svc.storage.from('baggage-clips').remove(clipPaths)
          if (error) r.errors.push(`clip purge: ${error.message}`)
        }
        const photoPaths = sessions
          .flatMap((s) => [s.entry_face_path, s.exit_face_path, s.card_photo_path])
          .filter(Boolean) as string[]
        if (photoPaths.length > 0) {
          const { error } = await svc.storage.from('baggage-photos').remove(photoPaths)
          if (error) r.errors.push(`photo purge: ${error.message}`)
        }
        const { error: delErr } = await svc.from('inspection_sessions').delete().in('id', ids)
        if (delErr) throw new Error(`session delete: ${delErr.message}`)
        r.purgedSessions = sessions.length
      }
    } catch (e) {
      r.errors.push(String((e as Error).message ?? e))
    }
  }

  const summary = {
    date: today,
    stores: results.length,
    unmatchedMarked: results.reduce((a, r) => a + r.unmatchedMarked, 0),
    mailsSent: results.filter((r) => r.mailSent).length,
    purgedSessions: results.reduce((a, r) => a + r.purgedSessions, 0),
    errors: results.flatMap((r) => r.errors.map((e) => `${r.storeId.slice(0, 8)}: ${e}`)),
  }
  console.log('[baggage-daily]', JSON.stringify(summary))
  return NextResponse.json({ ok: true, ...summary, results })
}
