/**
 * BCP デモデータ投入スクリプト
 *
 * - 複数店舗 × 複数アラート種別 (missile / earthquake / tsunami / test) で
 *   bcp_events を 5 件 +α 作る。
 * - 世田谷店 (= 既存 Frigate カメラあり) には bcp_clips を実カメラ ID で 2 件
 *   付ける。他店舗は clips なし (= 「BCP 設定はあるが対象カメラ未配備」または
 *   「test 発令で映像取得をスキップ」のパターン）。
 * - report_generated / completed 状態の event には bcp_reports を 1 件付ける。
 *   PDF URL は dummy (https://example.com/...) — 映像が無くても UI 確認できる
 *   ようにテキストだけ揃える。
 *
 * 既存データには手を付けない (insert only)。何度実行しても安全 (= 既存 reports
 * を消さない)。完全リセットしたければ bcp_reports / bcp_clips / bcp_events を
 * 手動で truncate してから走らせる。
 *
 * 使い方:  cd claude/monitor && node --env-file=.env.local scripts/seed-bcp-demo.mjs
 */
import { createClient } from '@supabase/supabase-js'

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
)

// ─── 解決: 店舗 ID + 既存カメラ ID ────────────────────────────────────────────
async function resolveRefs() {
  const want = ['世田谷店', '練馬店', 'つくば店', '板橋店', '川越店']
  const { data: stores } = await supa
    .from('stores')
    .select('id, name, area_code')
    .in('name', want)
  const byName = Object.fromEntries(stores.map((s) => [s.name, s]))

  // 世田谷店の実 camera IDs (Frigate, ch01)
  const setagaya = byName['世田谷店']
  let setagayaCameras = []
  if (setagaya) {
    const { data: edge } = await supa
      .from('edge_devices')
      .select('id, recorders(id, recorder_cameras(id, name, channel))')
      .eq('store_id', setagaya.id)
      .limit(1)
      .maybeSingle()
    setagayaCameras = (edge?.recorders ?? [])
      .flatMap((r) => r.recorder_cameras)
      .filter(Boolean)
  }
  return { byName, setagayaCameras }
}

// ─── タイムスタンプ helper ────────────────────────────────────────────────────
const isoDaysAgo = (days, hours = 9, mins = 0) => {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - days)
  d.setUTCHours(hours - 9, mins, 0, 0)  // JST → UTC
  return d.toISOString()
}

// ─── メイン投入 ──────────────────────────────────────────────────────────────
async function main() {
  const { byName, setagayaCameras } = await resolveRefs()
  if (Object.keys(byName).length === 0) {
    console.error('No matching stores found; aborting.')
    process.exit(1)
  }

  console.log('Resolved stores:', Object.entries(byName).map(([n, s]) => `${n}=${s.id.slice(0, 8)}`).join(', '))
  console.log('Setagaya cameras:', setagayaCameras.map((c) => c.id.slice(0, 8)).join(', ') || '(none)')

  // ── 5 events (+ optional clips + optional report) ─────────────────────────
  const events = [
    {
      tag: '世田谷-missile-today',
      store: '世田谷店',
      alert_source: 'jalert',
      alert_type:   'missile',
      alert_issued_at: isoDaysAgo(0, 6, 47),       // 今日 06:47 JST
      area_code:    'TOKYO',
      status:       'completed',
      is_test:      false,
      clipsForStore: '世田谷店',                   // 実カメラに clips を付ける
      report: {
        generated_at:   isoDaysAgo(0, 7, 5),
        sent_to_emails: ['ops@example.com', 'security@example.com'],
      },
    },
    {
      tag: '練馬-eq-2days',
      store: '練馬店',
      alert_source: 'jalert',
      alert_type:   'earthquake',
      alert_issued_at: isoDaysAgo(2, 14, 23),
      area_code:    'TOKYO',
      status:       'completed',
      is_test:      false,
      report: {
        generated_at:   isoDaysAgo(2, 14, 45),
        sent_to_emails: ['ops@example.com'],
      },
    },
    {
      tag: 'つくば-tsunami-5days',
      store: 'つくば店',
      alert_source: 'jalert',
      alert_type:   'tsunami',
      alert_issued_at: isoDaysAgo(5, 3, 12),
      area_code:    'SAITAMA',
      status:       'completed',
      is_test:      false,
      report: {
        generated_at:   isoDaysAgo(5, 3, 38),
        sent_to_emails: ['ops@example.com', 'chiba-mgr@example.com'],
      },
    },
    {
      tag: '板橋-test-10days',
      store: '板橋店',
      alert_source: 'manual_test',
      alert_type:   'test',
      alert_issued_at: isoDaysAgo(10, 10, 0),
      area_code:    'TOKYO',
      status:       'completed',
      is_test:      true,
      report: {
        generated_at:   isoDaysAgo(10, 10, 20),
        sent_to_emails: ['ops@example.com'],
      },
    },
    {
      tag: '川越-eq-15days-failed',
      store: '川越店',
      alert_source: 'jalert',
      alert_type:   'earthquake',
      alert_issued_at: isoDaysAgo(15, 21, 8),
      area_code:    'TOKYO',
      status:       'failed',
      is_test:      false,
      // report なし (failed)
    },
  ]

  for (const e of events) {
    const store = byName[e.store]
    if (!store) { console.warn(`skip ${e.tag}: store not found`); continue }

    const { data: insEv, error: evErr } = await supa
      .from('bcp_events')
      .insert({
        store_id:        store.id,
        alert_source:    e.alert_source,
        alert_type:      e.alert_type,
        alert_issued_at: e.alert_issued_at,
        area_code:       e.area_code,
        status:          e.status,
        is_test:         e.is_test,
      })
      .select('id')
      .single()
    if (evErr) { console.error(`event insert failed for ${e.tag}:`, evErr.message); continue }
    const eventId = insEv.id
    console.log(`  ✓ event ${e.tag} (id=${eventId.slice(0,8)}) status=${e.status}`)

    // F40: Optional 8-snapshot timeline (only for 世田谷店 where real cameras exist).
    // Each (camera × offset) is one bcp_clips row with offset_min populated.
    // Demo URLs use picsum.photos so the UI shows real images (each offset
    // gets a distinct seed = visibly different photos).
    if (e.clipsForStore === '世田谷店' && setagayaCameras.length > 0) {
      const SNAPSHOT_OFFSETS = [-5, 0, 5, 10, 15, 20, 25, 30]
      const alertMs = new Date(e.alert_issued_at).getTime()
      const snapshotRows = []
      for (const cam of setagayaCameras.slice(0, 2)) {
        for (const offset of SNAPSHOT_OFFSETS) {
          const tISO = new Date(alertMs + offset * 60_000).toISOString()
          // picsum.photos: deterministic seed per (event, camera, offset).
          // 800×600 JPEG so the timeline thumbs look natural.
          const seed = `${eventId.slice(0, 8)}-${cam.id.slice(0, 8)}-${offset >= 0 ? 'p' : 'm'}${Math.abs(offset)}`
          const url  = `https://picsum.photos/seed/${seed}/800/600.jpg`
          snapshotRows.push({
            event_id:      eventId,
            camera_id:     cam.id,
            offset_min:    offset,
            clip_from:     tISO,
            clip_to:       tISO,
            clip_url:      url,
            thumbnail_url: url,
            duration_sec:  0,
            upload_status: 'completed',
          })
        }
      }
      const { error: clErr } = await supa.from('bcp_clips').insert(snapshotRows)
      if (clErr) console.warn(`snapshot insert failed:`, clErr.message)
      else console.log(`    + ${snapshotRows.length} snapshots (${setagayaCameras.slice(0, 2).length} cam × 8 offsets)`)
    }

    // Optional report
    if (e.report) {
      const { error: rpErr } = await supa.from('bcp_reports').insert({
        event_id:       eventId,
        pdf_url:        `https://example.com/bcp/${eventId}/report.pdf`,
        generated_at:   e.report.generated_at,
        sent_to_emails: e.report.sent_to_emails,
      })
      if (rpErr) console.warn(`report insert failed:`, rpErr.message)
      else console.log(`    + report (pdf placeholder + ${e.report.sent_to_emails.length} recipients)`)
    }
  }

  // Final summary
  const ev = await supa.from('bcp_events').select('id', { count: 'exact', head: true })
  const cl = await supa.from('bcp_clips').select('id', { count: 'exact', head: true })
  const rp = await supa.from('bcp_reports').select('id', { count: 'exact', head: true })
  console.log(`\nFinal counts — events=${ev.count}, clips=${cl.count}, reports=${rp.count}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
