/**
 * jalert-poller — Supabase Edge Function (Deno)
 *
 * Polls the JMA (Japan Meteorological Agency) Atom feed every 60 seconds.
 * When a relevant J-Alert entry is found (地震 / 気象特別警報), it:
 *   1. Deduplicates against jalert_receipts.alert_source
 *   2. Fetches the detail XML and extracts area codes + max intensity
 *   3. Records the receipt in jalert_receipts (ALWAYS, store-match independent)
 *      → this is the data source for the "J-Alert 受信履歴" page
 *   4. Matches stores with BCP enabled + per-store trigger condition (震度しきい値 / 特別警報)
 *   5. Inserts bcp_events + bcp_clips、通知メール送信、edge へ start_bcp_capture 発行（自動取得）
 *
 * 自動取得した 8 枚スナップ(軽量JPEG)は edge アップロード後 status='clips_uploaded' となり、
 * bcp_report_sweep が自動で PDF 生成＋完了メール送信まで行う。連続動画(重い)は別途・手動取得
 * （BCP イベント詳細ページの「現地レコーダの録画を取得」ボタン = /api/bcp/<id>/retrieve）。
 *
 * Deploy with:
 *   supabase functions deploy jalert-poller --schedule "* * * * *"
 *
 * Or add to supabase/config.toml:
 *   [functions.jalert-poller]
 *   schedule = "* * * * *"
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  parseAffectedPrefs,
  parseAreaCodes,
  parseEventId,
  parseMaxIntensity,
  parseSpecialWarnings,
  shouldTrigger,
  storeAreaIntensity,
} from './match.ts'
// 「流れ」の純ロジックは flow.ts へ切り出してある（vitest から読めるように）。
// index.ts に残すのは fetch / DB / メールなど外に触る部分だけ。
import {
  buildBcpCaptureCommand,
  classifyAlertType,
  hasNoTargetPref,
  isRelevantEntry,
  isWeatherWarningEntry,
  mergeFeedEntries,
  type FeedEntry,
} from './flow.ts'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/**
 * JMA Atom feeds to poll.
 *
 * 地震は **eqvol.xml**（地震火山）にしか載らず、気象警報（特別警報の入れ物）は
 * **extra.xml** にしか載らない。**2 本とも要る。**
 * 以前は extra.xml だけを見ていたため、タイトル許可リストを整えてもフィードに
 * 地震エントリが無く /bcp/jalerts が空になっていた（根本原因）。
 */
const JMA_FEED_URLS = [
  'https://www.data.jma.go.jp/developer/xml/feed/eqvol.xml', // 地震（VXSE5x）
  'https://www.data.jma.go.jp/developer/xml/feed/extra.xml', // 気象警報・注意報（VPWW53＝特別警報の入れ物）
]

/**
 * 気象警報電文を本文まで見に行ったという印の保持期間。
 *
 * フィードには 19 時間ぶんの電文が載り続けるので、印が無いと同じ電文を毎分
 * 取りに行くことになる（実測 245 通 × 60 回/時）。逆に長く持ちすぎても意味は
 * 無いので、フィードの窓（〜19時間）より十分長く、かつ短い 7 日にする。
 */
const SCAN_MARK_RETENTION_DAYS = 7
const RESEND_API_URL = 'https://api.resend.com/emails'
// from ドメインは Resend で検証済みのものに限る。旧 'bcp@noreply.intareco.jp' は
// 所有していないドメインで Resend が 403 を返し、取得開始メールが全滅していた
// （アプリ側 src/lib/email/send.ts は 2026-06-27 是正済み・こちらだけ残っていた）。
const FROM_ADDRESS = 'bcp@genesis-edge.com'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BcpEvent {
  id: string
  store_id: string
  alert_source: string
  alert_type: string
  alert_issued_at: string
  area_code: string | null
  status: string
  is_test: boolean
}

interface Store {
  id: string
  name: string
  area_code: string | null
}

interface BcpSettings {
  id: string
  store_id: string
  notify_emails: string[] | null
  enabled: boolean
  pre_minutes: number
  post_minutes: number
  quake_min_intensity: string      // この震度以上の地震でのみ録画起動（JMA MaxInt 表記）
  special_warning_enabled: boolean // 気象等の特別警報（レベル5）で録画起動するか
  snapshot_offsets: number[] | null  // レポートで撮影するオフセット(分)。既定 [-5,5]
}

interface EdgeDevice {
  id: string
  store_id: string
  status: string
  recorders: { id: string; recorder_cameras: { id: string; name: string }[] }[]
}


// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

serve(async (req) => {
  // Support both scheduled invocations and manual HTTP triggers
  try {
    await pollJalert()
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('[jalert-poller] Fatal error:', err)
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})

// ---------------------------------------------------------------------------
// Core polling logic
// ---------------------------------------------------------------------------

async function pollJalert(): Promise<void> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supa = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // 1+2. Fetch every JMA feed and merge their entries (dedup by id).
  //      地震は eqvol.xml、気象警報は extra.xml にしか無いので必ず併読する。
  const entries = await fetchAllEntries()
  if (entries.length === 0) {
    console.log('[jalert-poller] No entries in any feed')
    return
  }

  // 3. Filter to relevant types only
  const relevant = entries.filter((e) => isRelevantEntry(e))
  if (relevant.length === 0) {
    console.log('[jalert-poller] No relevant J-Alert entries (地震/気象警報)')
    return
  }

  console.log(`[jalert-poller] ${relevant.length} relevant entries found`)

  for (const entry of relevant) {
    try {
      await processEntry(supa, entry)
    } catch (err) {
      console.error(`[jalert-poller] Error processing entry ${entry.id}:`, err)
    }
  }
}

// ---------------------------------------------------------------------------
// Feed parsing
// ---------------------------------------------------------------------------

/** Fetch one feed's raw XML (null on failure — one bad feed never blocks others). */
async function fetchFeed(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'Accept': 'application/atom+xml, application/xml, text/xml' },
    })
    if (!res.ok) {
      console.error(`[jalert-poller] Feed fetch failed (${url}): HTTP ${res.status}`)
      return null
    }
    return await res.text()
  } catch (err) {
    console.error(`[jalert-poller] Feed fetch error (${url}):`, err)
    return null
  }
}

/** Fetch all configured feeds and merge their entries, deduped by entry id. */
async function fetchAllEntries(): Promise<FeedEntry[]> {
  const xmls = await Promise.all(JMA_FEED_URLS.map((u) => fetchFeed(u)))
  return mergeFeedEntries(xmls)
}

// ---------------------------------------------------------------------------
// Per-entry processing
// ---------------------------------------------------------------------------

async function processEntry(
  // deno-lint-ignore no-explicit-any
  supa: any,
  entry: FeedEntry,
): Promise<void> {
  // 気象警報（VPWW53）は本文を読むまで特別警報の有無が分からない。タイトルは
  // 雷注意報 1 件でも「気象特別警報・警報・注意報」なので、地震とは重複判定の
  // 置き場所が違う（特別警報でない電文は受信履歴に残さない＝jalert_scanned_entries）。
  const isWeather = isWeatherWarningEntry(entry)

  // 4. Dedup
  if (isWeather) {
    if (await alreadyScanned(supa, entry.id)) return
  } else {
    // jalert_receipts には店舗マッチに関係なく全件記録するため、ここを重複判定の
    // 確実なアンカーにする（旧実装は bcp_events を見ていたが、無マッチ時は行が
    // 無く毎分再処理していた）。
    const { data: existing } = await supa
      .from('jalert_receipts')
      .select('id')
      .eq('alert_source', entry.id)
      .limit(1)

    if (existing && existing.length > 0) {
      console.log(`[jalert-poller] Already received ${entry.id}, skipping`)
      return
    }
  }

  console.log(`[jalert-poller] New entry: ${entry.title} (${entry.id})`)

  // 5. Fetch detail XML and extract area codes + max intensity
  const detail = await fetchDetail(entry.linkHref)

  // 本文が取れなかった気象電文に印を付けてはいけない。付けると
  // 「1 回の通信失敗で、その特別警報を二度と見に行かない」形になる。
  if (isWeather && !detail.ok) {
    console.error(`[jalert-poller] 気象電文の本文を取得できませんでした（次回再試行）: ${entry.id}`)
    return
  }

  const alertType = classifyAlertType(entry.title)
  let alertTitle = entry.title
  let affectedPrefs = detail.affectedPrefs
  let areaCodes = detail.areaCodes

  if (isWeather) {
    // 6-W. 現に出ている特別警報だけを拾う（解除・注意報・警報は対象外）。
    const scan = parseSpecialWarnings(detail.xml)

    if (scan.kinds.length === 0) {
      await markScanned(supa, entry.id, false)
      return
    }

    // 受信履歴の見出しは「気象特別警報・警報・注意報」では中身が分からないので、
    // 実際に出ている種別に置き換える（例: 大雨特別警報, 暴風特別警報）。
    alertTitle     = scan.kinds.join('・')
    affectedPrefs  = scan.prefs
    // 気象電文の区域コードは 1 通で 190 件を超える。受信履歴には対象都道府県
    // （JIS 2桁）だけを残す。生コードは detail_url の先に元電文がある。
    areaCodes      = [...scan.prefs.keys()]

    console.log(`[jalert-poller] 特別警報を検知: ${alertTitle} / 対象都道府県 ${areaCodes.join(',') || '(なし)'}`)
  }

  console.log(
    `[jalert-poller] Area codes: ${areaCodes.join(', ') || '(none)'}` +
    (detail.maxIntensity ? `, MaxInt: ${detail.maxIntensity}` : '') +
    `, 対象都道府県: ${
      affectedPrefs.size
        ? [...affectedPrefs].map(([p, i]) => `${p}:${i ?? '-'}`).join(' ')
        : '(特定できず)'
    }`,
  )

  const alertIssuedAt = entry.updated || new Date().toISOString()

  // 6. Find matching stores with BCP enabled（エリア一致＋有効化のみ。発動条件は次段で判定）
  //
  // 都道府県を特定できない電文は「対象なし」。全店フォールバック（旧 areaWide）は
  // 津波・ミサイルの非対応化と一緒に廃止した。1 通の壊れた電文で全店が録画を
  // 始めるほうが危険なため（flow.ts hasNoTargetPref の注記）。
  if (hasNoTargetPref(affectedPrefs)) {
    console.warn(`[jalert-poller] ${alertType} の電文から都道府県を抽出できませんでした（対象なしとして扱います）`)
  }
  const areaStores = await findMatchingStores(supa, affectedPrefs)

  // 6.5. 店舗ごとの発動条件（震度しきい値 / 特別警報 ON-OFF）で絞り込む。
  //      震度は「その店舗の都道府県で観測された値」で判定する。全国最大値を全店に
  //      当てると、震度1の県の店舗が震度4扱いで発動する（2026-08-09 の障害）。
  const triggeredStores = areaStores.filter(({ intensity, settings }) =>
    shouldTrigger(alertType, intensity, settings),
  )

  // 6.6. 受信ログを必ず記録（店舗マッチの有無に関わらず）。これが「J-Alert受信履歴」の
  //      データ源。東北の地震のように該当店舗が無くても、ここには残る。
  //      matched_store_count は「自動取得を起動した店舗数」。
  await recordReceipt(
    supa, entry, alertType, alertTitle, areaCodes, detail.maxIntensity, alertIssuedAt, triggeredStores.length,
  )

  if (triggeredStores.length === 0) {
    console.log(
      `[jalert-poller] 発動条件を満たす店舗なし（エリア一致${areaStores.length}店 / 受信ログには記録済み）`,
    )
    if (isWeather) await markScanned(supa, entry.id, true)
    return
  }

  console.log(`[jalert-poller] ${triggeredStores.length} store(s) meet trigger condition`)

  // 7. 各店舗で自動取得＋通知
  for (const { store, settings, intensity } of triggeredStores) {
    try {
      await processStore(supa, entry, store, settings, alertType, alertIssuedAt, areaCodes, intensity, detail.eventId)
    } catch (err) {
      console.error(
        `[jalert-poller] Error processing store ${store.id} (${store.name}):`,
        err,
      )
    }
  }

  // 印は最後に付ける。途中で落ちたら印が付かず、次回もう一度取りに行く。
  if (isWeather) await markScanned(supa, entry.id, true)
}

// ---------------------------------------------------------------------------
// 気象電文の走査済みマーク
// ---------------------------------------------------------------------------

/** すでに本文まで見た気象電文か。 */
async function alreadyScanned(
  // deno-lint-ignore no-explicit-any
  supa: any,
  entryId: string,
): Promise<boolean> {
  const { data, error } = await supa
    .from('jalert_scanned_entries')
    .select('entry_id')
    .eq('entry_id', entryId)
    .limit(1)

  if (error) {
    // 読めないときは「未走査」に倒す。取りこぼすより、もう一度取りに行くほうが安全。
    console.error('[jalert-poller] jalert_scanned_entries query error:', error)
    return false
  }
  return (data?.length ?? 0) > 0
}

/** 走査済みの印を付ける。ついでに古い印を掃除する。 */
async function markScanned(
  // deno-lint-ignore no-explicit-any
  supa: any,
  entryId: string,
  hadAlert: boolean,
): Promise<void> {
  const { error } = await supa
    .from('jalert_scanned_entries')
    .upsert({ entry_id: entryId, had_alert: hadAlert }, { onConflict: 'entry_id' })

  if (error) {
    console.error(`[jalert-poller] Failed to mark scanned ${entryId}:`, error)
    return
  }

  const cutoff = new Date(Date.now() - SCAN_MARK_RETENTION_DAYS * 86_400_000).toISOString()
  const { error: delError } = await supa
    .from('jalert_scanned_entries')
    .delete()
    .lt('scanned_at', cutoff)
  if (delError) console.error('[jalert-poller] scan mark cleanup error:', delError)
}

// ---------------------------------------------------------------------------
// Detail XML area code extraction
// ---------------------------------------------------------------------------

interface AlertDetail {
  /** 本文を取得できたか。false なら以降のフィールドは既定値（判定に使わない）。 */
  ok: boolean
  /** 取得した生 XML。気象電文の特別警報判定に使う（地震では未使用）。 */
  xml: string
  /** 受信ログ用の生コード一覧（監査目的。照合には使わない）。 */
  areaCodes: string[]
  /** 電文全体の最大震度（表示・ログ用。発動判定には使わない）。 */
  maxIntensity: string | null
  /** JIS 都道府県コード → その県の観測震度。照合と発動判定はこちらを使う。 */
  affectedPrefs: Map<string, string | null>
  /** JMA の地震識別子。同一地震の全電文で共通＝グルーピングと重複判定の鍵。 */
  eventId: string | null
}

const EMPTY_DETAIL: AlertDetail = {
  ok: false, xml: '', areaCodes: [], maxIntensity: null, affectedPrefs: new Map(), eventId: null,
}

async function fetchDetail(linkHref: string): Promise<AlertDetail> {
  if (!linkHref) return EMPTY_DETAIL

  try {
    const res = await fetch(linkHref)
    if (!res.ok) {
      console.error(`[jalert-poller] Detail fetch failed: HTTP ${res.status}`)
      return EMPTY_DETAIL
    }
    const xml = await res.text()
    return {
      ok:            true,
      xml,
      areaCodes:     parseAreaCodes(xml),
      maxIntensity:  parseMaxIntensity(xml),
      affectedPrefs: parseAffectedPrefs(xml),
      eventId:       parseEventId(xml),
    }
  } catch (err) {
    console.error('[jalert-poller] Detail fetch error:', err)
    return EMPTY_DETAIL
  }
}

// ---------------------------------------------------------------------------
// Store matching
// ---------------------------------------------------------------------------

interface StoreWithSettings {
  store: Store
  settings: BcpSettings
  /** その店舗の都道府県で観測された震度（地震以外・不明時は null）。 */
  intensity: string | null
}

async function findMatchingStores(
  // deno-lint-ignore no-explicit-any
  supa: any,
  affectedPrefs: ReadonlyMap<string, string | null>,
): Promise<StoreWithSettings[]> {
  // Fetch all active BCP settings with their store's area_code
  const { data, error } = await supa
    .from('bcp_settings')
    .select('id, store_id, notify_emails, enabled, pre_minutes, post_minutes, quake_min_intensity, special_warning_enabled, snapshot_offsets, stores ( id, name, area_code )')
    .eq('enabled', true)

  if (error) {
    console.error('[jalert-poller] bcp_settings query error:', error)
    return []
  }

  const results: StoreWithSettings[] = []

  for (const row of data ?? []) {
    const store = row.stores as Store | null
    if (!store) continue

    // 照合ルールは match.ts に集約（JIS 都道府県 2 桁の一致）。
    // 地震も特別警報も、都道府県が取れない電文は 1 店も一致しない（対象なし）。
    const hit = storeAreaIntensity(store.area_code, affectedPrefs)

    if (hit.matched) {
      results.push({
        store,
        intensity: hit.intensity,
        settings: {
          id: row.id,
          store_id: row.store_id,
          notify_emails: row.notify_emails,
          enabled: row.enabled,
          pre_minutes: row.pre_minutes ?? 3,
          post_minutes: row.post_minutes ?? 3,
          quake_min_intensity: row.quake_min_intensity ?? '5+',
          special_warning_enabled: row.special_warning_enabled ?? true,
          snapshot_offsets: row.snapshot_offsets ?? [-5, 5],
        },
      })
    }
  }

  return results
}

// ---------------------------------------------------------------------------
// Per-store BCP activation
// ---------------------------------------------------------------------------

async function processStore(
  // deno-lint-ignore no-explicit-any
  supa: any,
  entry: FeedEntry,
  store: Store,
  settings: BcpSettings,
  alertType: string,
  alertIssuedAt: string,
  areaCodes: string[],
  /** この店舗の都道府県で観測された震度。電文全体の最大値ではない。 */
  storeIntensity: string | null,
  /** JMA の地震識別子。同一地震の全電文で共通。JMA 以外の発令は null。 */
  jmaEventId: string | null,
): Promise<void> {
  // 自動取得モデル: 発令を検知したら、現地レコーダから 8 枚スナップ(T-5〜T+30分)を
  // 自動取得 → アップロード → 自動PDF(bcp_report_sweep) → 完了メール、まで全自動。
  // 8 枚は軽量(JPEG)なので災害時でも実用的。連続動画(重い)は別途・手動取得とする。

  // 同一地震の連続電文（震度速報 → 震源に関する情報 → 震源・震度情報 → 続報）で
  // BCP が多重起動しないようにする。entry.id は電文ごとに異なるので alert_source の
  // dedup では防げない。
  //
  // JMA の EventID があればそれで厳密に判定する。無い場合（JMA 以外の発令や
  // EventID を持たない電文）だけ、従来どおり前後 15 分の時間窓へフォールバックする。
  let dupQuery = supa
    .from('bcp_events')
    .select('id')
    .eq('store_id', store.id)
    .eq('alert_type', alertType)
    .eq('is_test', false)

  if (jmaEventId) {
    dupQuery = dupQuery.eq('jma_event_id', jmaEventId)
  } else {
    // 特別警報は EventID を持たず、出ている間ずっと「継続」の電文が流れ続ける
    // （実測: 同じ府県予報区へ 19 時間で 5 通前後）。15 分窓だと同じ災害で
    // 何度も録画が始まるので、特別警報だけ窓を広く取る。
    const DEDUP_WINDOW_MS = alertType === 'special_warning' ? 6 * 3_600_000 : 15 * 60_000
    const issuedMs = new Date(alertIssuedAt).getTime()
    dupQuery = dupQuery
      .gte('alert_issued_at', new Date(issuedMs - DEDUP_WINDOW_MS).toISOString())
      .lte('alert_issued_at', new Date(issuedMs + DEDUP_WINDOW_MS).toISOString())
  }

  const { data: recentEvents } = await dupQuery.limit(1)

  if (recentEvents && recentEvents.length > 0) {
    console.log(
      `[jalert-poller] Store ${store.name}: 同一地震の続報とみなしスキップ`
      + `（既存イベント ${recentEvents[0].id}${jmaEventId ? ` / EventID ${jmaEventId}` : ''}）`,
    )
    return
  }

  // 録画ウィンドウ（プレースホルダclip用。8枚スナップは固定オフセットで撮る）
  const alertTs = new Date(alertIssuedAt)
  const clipFrom = new Date(alertTs.getTime() - settings.pre_minutes * 60_000).toISOString()
  const clipTo   = new Date(alertTs.getTime() + settings.post_minutes * 60_000).toISOString()

  // a. Insert bcp_events row
  const { data: eventRows, error: eventError } = await supa
    .from('bcp_events')
    .insert({
      store_id: store.id,
      alert_source: entry.id,
      alert_type: alertType,
      alert_issued_at: alertIssuedAt,
      area_code: areaCodes[0] ?? null,
      // 店舗ごとの観測震度。レポート/一覧はこの値を「その店舗が受けた揺れ」として表示する。
      max_intensity: storeIntensity,
      // 同一地震の全電文で共通。一覧はこれでグルーピングし、2 行に割れるのを防ぐ。
      jma_event_id: jmaEventId,
      status: 'pending',
      is_test: false,
    })
    .select('id')
    .single()

  if (eventError || !eventRows) {
    // 23505 = unique_violation。上の重複判定をすり抜けた同時実行を、
    // bcp_events_store_alert_event_uniq が最後に止めた形（20260810070000）。
    // **これは異常ではなく、意図どおり二重起動を防いだ結果**なので、
    // error として鳴らさない。障害ログに紛れると本物の失敗が埋もれる。
    if ((eventError as { code?: string } | null)?.code === '23505') {
      console.log(
        `[jalert-poller] Store ${store.name}: 同時実行の重複を DB が抑止`
        + `（EventID ${jmaEventId ?? '-'}）`,
      )
      return
    }
    console.error(
      `[jalert-poller] Failed to insert bcp_events for store ${store.id}:`,
      eventError,
    )
    return
  }

  const eventId = eventRows.id as string

  // b. Fetch active edge devices for this store
  const { data: edges, error: edgesError } = await supa
    .from('edge_devices')
    .select(`
      id, store_id, status,
      recorders ( id, recorder_cameras ( id, name ) )
    `)
    .eq('store_id', store.id)
    .neq('status', 'offline')

  if (edgesError) {
    console.error(`[jalert-poller] Failed to fetch edges for store ${store.id}:`, edgesError)
    await updateEventStatus(supa, eventId, 'failed')
    return
  }

  const activeEdges = (edges ?? []) as EdgeDevice[]

  if (activeEdges.length === 0) {
    console.warn(`[jalert-poller] No active edge devices for store ${store.id} (${store.name})`)
    await updateEventStatus(supa, eventId, 'recording')
    await sendAlertEmail(settings, store, alertType, alertIssuedAt, eventId, false)
    return
  }

  // c. Insert bcp_clips placeholders — one per camera
  const clipInserts: { event_id: string; camera_id: string; clip_from: string; clip_to: string; upload_status: string }[] = []
  for (const edge of activeEdges) {
    for (const recorder of edge.recorders ?? []) {
      for (const camera of recorder.recorder_cameras ?? []) {
        clipInserts.push({ event_id: eventId, camera_id: camera.id, clip_from: clipFrom, clip_to: clipTo, upload_status: 'pending' })
      }
    }
  }

  let insertedClips: { id: string; camera_id: string }[] = []
  if (clipInserts.length > 0) {
    const { data: clipData, error: clipError } = await supa
      .from('bcp_clips')
      .insert(clipInserts)
      .select('id, camera_id')
    if (clipError) console.error(`[jalert-poller] Failed to insert bcp_clips for event ${eventId}:`, clipError)
    else insertedClips = clipData ?? []
  }

  const cameraToClip = new Map<string, string>(insertedClips.map((c) => [c.camera_id, c.id]))

  // d. 取得開始の通知メール
  await sendAlertEmail(settings, store, alertType, alertIssuedAt, eventId, false)

  // e. status='recording'（取得中）
  await updateEventStatus(supa, eventId, 'recording')

  // f. 各エッジへ start_bcp_capture を発行
  for (const edge of activeEdges) {
    const edgeClips: { clipId: string; cameraId: string }[] = []
    for (const recorder of edge.recorders ?? []) {
      for (const camera of recorder.recorder_cameras ?? []) {
        edgeClips.push({ clipId: cameraToClip.get(camera.id) ?? '', cameraId: camera.id })
      }
    }
    // ⚠ clipFrom には **発令時刻そのもの**を渡す（clipFrom 変数＝発令−pre分 ではない）。
    //   エッジはこれを T+0 として各オフセットを計算する。詳細は
    //   buildBcpCaptureCommand の説明を参照（2026-08-13 是正）。
    const command = buildBcpCaptureCommand({
      requestId:     crypto.randomUUID(),
      eventId,
      clips:         edgeClips,
      alertIssuedAt,
      clipTo,
      offsets:       settings.snapshot_offsets,
    })
    const { error: cmdError } = await supa
      .from('edge_devices')
      .update({ pending_command: command, pending_command_at: new Date().toISOString() })
      .eq('id', edge.id)
    if (cmdError) console.error(`[jalert-poller] Failed to write pending_command to edge ${edge.id}:`, cmdError)
    else console.log(`[jalert-poller] Dispatched BCP capture to edge ${edge.id} (${edgeClips.length} camera(s))`)
  }

  console.log(`[jalert-poller] BCP event ${eventId} auto-capturing for store ${store.name}（${insertedClips.length} clip placeholder(s)）`)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function updateEventStatus(
  // deno-lint-ignore no-explicit-any
  supa: any,
  eventId: string,
  status: string,
): Promise<void> {
  const { error } = await supa.from('bcp_events').update({ status }).eq('id', eventId)
  if (error) {
    console.error(`[jalert-poller] Failed to update event ${eventId} status to ${status}:`, error)
  }
}

/** 受信した J-Alert を jalert_receipts へ全件記録（店舗マッチの有無に関わらず）。 */
async function recordReceipt(
  // deno-lint-ignore no-explicit-any
  supa: any,
  entry: FeedEntry,
  alertType: string,
  /** 受信履歴に出す見出し。特別警報では実際の種別名に差し替わる。 */
  alertTitle: string,
  areaCodes: string[],
  maxIntensity: string | null,
  alertIssuedAt: string,
  matchedStoreCount: number,
): Promise<void> {
  // alert_source は UNIQUE。競合（同時実行で二重）時は無視して握りつぶす。
  const { error } = await supa
    .from('jalert_receipts')
    .upsert(
      {
        alert_source:        entry.id,
        alert_type:          alertType,
        title:               alertTitle,
        area_codes:          areaCodes,
        max_intensity:       maxIntensity,
        alert_issued_at:     alertIssuedAt,
        matched_store_count: matchedStoreCount,
        detail_url:          entry.linkHref || null,
      },
      { onConflict: 'alert_source', ignoreDuplicates: true },
    )

  if (error) {
    console.error(`[jalert-poller] Failed to record receipt for ${entry.id}:`, error)
  } else {
    console.log(`[jalert-poller] Receipt recorded: ${alertTitle} (matched ${matchedStoreCount} store(s))`)
  }
}

/** Determine alert type string from JMA title text */

// ---------------------------------------------------------------------------
// Email sending
// ---------------------------------------------------------------------------

async function sendAlertEmail(
  settings: BcpSettings,
  store: Store,
  alertType: string,
  alertIssuedAt: string,
  eventId: string,
  isTest: boolean,
): Promise<void> {
  const recipients = settings.notify_emails ?? []
  if (recipients.length === 0) {
    console.warn(`[jalert-poller] No notify_emails for store ${store.id}, skipping email`)
    return
  }

  const apiKey = Deno.env.get('RESEND_API_KEY')
  if (!apiKey) {
    console.error('[jalert-poller] RESEND_API_KEY not set — skipping email')
    return
  }

  const appUrl = Deno.env.get('NEXT_PUBLIC_APP_URL') ?? 'https://intereco-monitor.vercel.app'
  const eventUrl = `${appUrl}/bcp/${eventId}`
  const alertTime = new Date(alertIssuedAt).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })

  const testLabel = isTest ? ' TEST' : ''
  const alertTypeLabel = alertType === 'earthquake' ? '震度情報'
    : alertType === 'special_warning' ? '特別警報（警戒レベル5）'
    : alertType

  const subject = `[BCP${testLabel}] Jアラート発令 - ${store.name} (${alertTypeLabel})`
  const html = buildAlertEmailHtml({
    storeName: store.name,
    alertType: alertTypeLabel,
    alertTime,
    eventUrl,
    isTest,
  })

  try {
    const res = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: recipients,
        subject,
        html,
      }),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '(no body)')
      console.error(`[jalert-poller] Resend API error ${res.status}: ${body}`)
    } else {
      console.log(`[jalert-poller] Alert email sent to ${recipients.join(', ')}`)
    }
  } catch (err) {
    console.error('[jalert-poller] Email send error:', err)
  }
}

function buildAlertEmailHtml(params: {
  storeName: string
  alertType: string
  alertTime: string
  eventUrl: string
  isTest: boolean
}): string {
  const { storeName, alertType, alertTime, eventUrl, isTest } = params

  const escHtml = (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')

  return `<!DOCTYPE html>
<html lang="ja">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:sans-serif;color:#333;max-width:600px;margin:0 auto;padding:20px">
  ${isTest ? '<p style="background:#fff3cd;border:1px solid #ffc107;padding:10px;border-radius:4px;font-weight:bold">これはテスト通知です</p>' : ''}
  <h2 style="color:#c0392b">Jアラート発令通知</h2>
  <table style="width:100%;border-collapse:collapse;margin:16px 0">
    <tr>
      <td style="padding:8px;background:#f5f5f5;font-weight:bold;width:140px;border:1px solid #ddd">店舗名</td>
      <td style="padding:8px;border:1px solid #ddd">${escHtml(storeName)}</td>
    </tr>
    <tr>
      <td style="padding:8px;background:#f5f5f5;font-weight:bold;border:1px solid #ddd">アラート種別</td>
      <td style="padding:8px;border:1px solid #ddd">${escHtml(alertType)}</td>
    </tr>
    <tr>
      <td style="padding:8px;background:#f5f5f5;font-weight:bold;border:1px solid #ddd">発令日時</td>
      <td style="padding:8px;border:1px solid #ddd">${escHtml(alertTime)}</td>
    </tr>
  </table>
  <p>J-Alert の発令を検知し、現地レコーダから映像（8枚スナップショット）の自動取得を開始しました。取得が完了しましたら、証拠PDFを添えて改めてご連絡します。</p>
  <p>
    <a href="${eventUrl}"
       style="display:inline-block;background:#c0392b;color:#fff;padding:10px 20px;border-radius:4px;text-decoration:none;font-weight:bold">
      BCPイベントを確認する
    </a>
  </p>
  <hr style="margin:24px 0;border:none;border-top:1px solid #eee">
  <p style="font-size:12px;color:#999">
    このメールはIntarecoモニタリングシステムから自動送信されています。<br>
    心当たりのない場合は、このメールを無視してください。
  </p>
</body>
</html>`
}
