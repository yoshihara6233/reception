/**
 * jalert-poller — Supabase Edge Function (Deno)
 *
 * Polls the JMA (Japan Meteorological Agency) Atom feed every 60 seconds.
 * When a relevant J-Alert entry is found (tsunami / earthquake), it:
 *   1. Deduplicates against jalert_receipts.alert_source
 *   2. Fetches the detail XML and extracts area codes + max intensity
 *   3. Records the receipt in jalert_receipts (ALWAYS, store-match independent)
 *      → this is the data source for the "J-Alert 受信履歴" page
 *   4. Matches stores with BCP enabled + per-store trigger condition (震度しきい値/津波/ミサイル)
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

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const JMA_FEED_URL = 'https://www.data.jma.go.jp/developer/xml/feed/extra.xml'
const RESEND_API_URL = 'https://api.resend.com/emails'
const FROM_ADDRESS = 'bcp@noreply.intareco.jp'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FeedEntry {
  id: string
  title: string
  updated: string
  linkHref: string
}

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
  quake_min_intensity: string   // この震度以上の地震でのみ録画起動（JMA MaxInt 表記）
  tsunami_enabled: boolean      // 津波発令で録画起動するか
  missile_enabled: boolean      // 国民保護(弾道ミサイル等)で録画起動するか
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

  // 1. Fetch the Atom feed
  const feedXml = await fetchFeed()
  if (!feedXml) return

  // 2. Parse entries from the Atom feed
  const entries = parseFeedEntries(feedXml)
  if (entries.length === 0) {
    console.log('[jalert-poller] No entries in feed')
    return
  }

  // 3. Filter to relevant types only
  const relevant = entries.filter((e) => isRelevantEntry(e))
  if (relevant.length === 0) {
    console.log('[jalert-poller] No relevant J-Alert entries (地震/津波/ミサイル)')
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

async function fetchFeed(): Promise<string | null> {
  try {
    const res = await fetch(JMA_FEED_URL, {
      headers: { 'Accept': 'application/atom+xml, application/xml, text/xml' },
    })
    if (!res.ok) {
      console.error(`[jalert-poller] Feed fetch failed: HTTP ${res.status}`)
      return null
    }
    return await res.text()
  } catch (err) {
    console.error('[jalert-poller] Feed fetch error:', err)
    return null
  }
}

function parseFeedEntries(xml: string): FeedEntry[] {
  const entries: FeedEntry[] = []

  // Simple regex-based parser for the Atom feed — Deno doesn't include a DOM parser.
  // The JMA Atom feed uses consistent formatting, so this is reliable enough.
  const entryRegex = /<entry[^>]*>([\s\S]*?)<\/entry>/g
  let m: RegExpExecArray | null

  while ((m = entryRegex.exec(xml)) !== null) {
    const block = m[1]

    const id = extractTag(block, 'id') ?? ''
    const title = extractTag(block, 'title') ?? ''
    const updated = extractTag(block, 'updated') ?? ''

    // <link href="..."/> or <link rel="alternate" href="..."/>
    const linkMatch = block.match(/<link[^>]+href="([^"]+)"/)
    const linkHref = linkMatch?.[1] ?? ''

    if (id) {
      entries.push({ id, title, updated, linkHref })
    }
  }

  return entries
}

/** Extract text content of the first matching tag */
function extractTag(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`))
  return m ? m[1].trim() : null
}

/**
 * J-Alert（地震・津波・ミサイル）の発令だけを通すタイトル許可リスト。
 *
 * 旧実装は RELEVANT_TYPES=['VPWW54','VXSE51'] で判定していたが、VPWW54 は「津波」では
 * なく「気象警報・注意報」だったため、平常時の気象警報が大量に混入していた（実データで確認）。
 * JMA の地震・津波・国民保護のタイトルは常に説明的なので、タイトルベースの方が確実。
 */
function isRelevantEntry(entry: FeedEntry): boolean {
  const t = entry.title

  // 津波を最優先で判定（タイトルに「注意報」を含むため、気象の除外判定より先に通す）。
  if (t.includes('津波')) return true

  // 地震（震度速報・緊急地震速報・各種地震情報）。
  if (t.includes('震度') || t.includes('緊急地震速報') || t.includes('地震')) return true

  // 国民保護（弾道ミサイル等）。
  if (t.includes('ミサイル') || t.includes('弾道') || t.includes('国民保護')) return true

  // それ以外（気象警報・注意報、噴火など平常時の気象情報）は J-Alert 受信履歴に含めない。
  return false
}

// ---------------------------------------------------------------------------
// Per-entry processing
// ---------------------------------------------------------------------------

async function processEntry(
  // deno-lint-ignore no-explicit-any
  supa: any,
  entry: FeedEntry,
): Promise<void> {
  // 4. Dedup — skip if already received. jalert_receipts には店舗マッチに関係なく
  //    全件記録するため、ここを重複判定の確実なアンカーにする（旧実装は bcp_events
  //    を見ていたが、無マッチ時は行が無く毎分再処理していた）。
  const { data: existing } = await supa
    .from('jalert_receipts')
    .select('id')
    .eq('alert_source', entry.id)
    .limit(1)

  if (existing && existing.length > 0) {
    console.log(`[jalert-poller] Already received ${entry.id}, skipping`)
    return
  }

  console.log(`[jalert-poller] New entry: ${entry.title} (${entry.id})`)

  // 5. Fetch detail XML and extract area codes + max intensity
  const { areaCodes, maxIntensity } = await fetchDetail(entry.linkHref)
  console.log(
    `[jalert-poller] Area codes: ${areaCodes.join(', ') || '(none)'}` +
    (maxIntensity ? `, MaxInt: ${maxIntensity}` : ''),
  )

  // 6. Find matching stores with BCP enabled（エリア一致＋有効化のみ。発動条件は次段で判定）
  const alertType = classifyAlertType(entry.title)
  const alertIssuedAt = entry.updated || new Date().toISOString()
  const areaStores = await findMatchingStores(supa, areaCodes)

  // 6.5. 店舗ごとの発動条件（震度しきい値 / 津波 ON-OFF / ミサイル ON-OFF）で絞り込む。
  //      条件を満たした店舗だけ自動取得＋イベント化する。
  const triggeredStores = areaStores.filter(({ settings }) =>
    shouldTrigger(alertType, maxIntensity, settings),
  )

  // 6.6. 受信ログを必ず記録（店舗マッチの有無に関わらず）。これが「J-Alert受信履歴」の
  //      データ源。東北の地震のように該当店舗が無くても、ここには残る。
  //      matched_store_count は「自動取得を起動した店舗数」。
  await recordReceipt(
    supa, entry, alertType, areaCodes, maxIntensity, alertIssuedAt, triggeredStores.length,
  )

  if (triggeredStores.length === 0) {
    console.log(
      `[jalert-poller] 発動条件を満たす店舗なし（エリア一致${areaStores.length}店 / 受信ログには記録済み）`,
    )
    return
  }

  console.log(`[jalert-poller] ${triggeredStores.length} store(s) meet trigger condition`)

  // 7. 各店舗で自動取得＋通知
  for (const { store, settings } of triggeredStores) {
    try {
      await processStore(supa, entry, store, settings, alertType, alertIssuedAt, areaCodes)
    } catch (err) {
      console.error(
        `[jalert-poller] Error processing store ${store.id} (${store.name}):`,
        err,
      )
    }
  }
}

// ---------------------------------------------------------------------------
// Detail XML area code extraction
// ---------------------------------------------------------------------------

interface AlertDetail {
  areaCodes: string[]
  maxIntensity: string | null
}

async function fetchDetail(linkHref: string): Promise<AlertDetail> {
  if (!linkHref) return { areaCodes: [], maxIntensity: null }

  try {
    const res = await fetch(linkHref)
    if (!res.ok) {
      console.error(`[jalert-poller] Detail fetch failed: HTTP ${res.status}`)
      return { areaCodes: [], maxIntensity: null }
    }
    const xml = await res.text()
    return { areaCodes: parseAreaCodes(xml), maxIntensity: parseMaxIntensity(xml) }
  } catch (err) {
    console.error('[jalert-poller] Detail fetch error:', err)
    return { areaCodes: [], maxIntensity: null }
  }
}

/** JMA 詳細XMLの最大震度 <MaxInt> を抽出（'6+','5-','4' 等の生値。無ければ null） */
function parseMaxIntensity(xml: string): string | null {
  const m = xml.match(/<(?:\w+:)?MaxInt[^>]*>([^<]+)<\/(?:\w+:)?MaxInt>/)
  return m ? m[1].trim() : null
}

/** Extract JIS X 0402 municipality codes from JMA detail XML */
function parseAreaCodes(xml: string): string[] {
  const codes = new Set<string>()

  // Primary pattern: <Area><Code>XXXXXX</Code></Area>
  const areaRegex = /<Area[^>]*>([\s\S]*?)<\/Area>/g
  let m: RegExpExecArray | null
  while ((m = areaRegex.exec(xml)) !== null) {
    const codeMatch = m[1].match(/<Code[^>]*>(\d+)<\/Code>/)
    if (codeMatch) {
      codes.add(codeMatch[1])
    }
  }

  // Fallback: bare <Code> elements anywhere (some products use this)
  if (codes.size === 0) {
    const codeRegex = /<Code[^>]*>(\d{2,6})<\/Code>/g
    while ((m = codeRegex.exec(xml)) !== null) {
      codes.add(m[1])
    }
  }

  return [...codes]
}

// ---------------------------------------------------------------------------
// Store matching
// ---------------------------------------------------------------------------

interface StoreWithSettings {
  store: Store
  settings: BcpSettings
}

async function findMatchingStores(
  // deno-lint-ignore no-explicit-any
  supa: any,
  areaCodes: string[],
): Promise<StoreWithSettings[]> {
  // Fetch all active BCP settings with their store's area_code
  const { data, error } = await supa
    .from('bcp_settings')
    .select('id, store_id, notify_emails, enabled, pre_minutes, post_minutes, quake_min_intensity, tsunami_enabled, missile_enabled, stores ( id, name, area_code )')
    .eq('enabled', true)

  if (error) {
    console.error('[jalert-poller] bcp_settings query error:', error)
    return []
  }

  const results: StoreWithSettings[] = []

  for (const row of data ?? []) {
    const store = row.stores as Store | null
    if (!store) continue

    const storeAreaCode = store.area_code
    if (!storeAreaCode) continue

    // Match: alert area code prefix (first 2 chars) matches store area code,
    // OR exact match
    const matches = areaCodes.length === 0
      ? false // if no area codes parsed, don't match any store (conservative)
      : areaCodes.some(
        (alertCode) =>
          storeAreaCode.startsWith(alertCode.slice(0, 2)) ||
          storeAreaCode === alertCode,
      )

    if (matches) {
      results.push({
        store,
        settings: {
          id: row.id,
          store_id: row.store_id,
          notify_emails: row.notify_emails,
          enabled: row.enabled,
          pre_minutes: row.pre_minutes ?? 3,
          post_minutes: row.post_minutes ?? 3,
          quake_min_intensity: row.quake_min_intensity ?? '5+',
          tsunami_enabled: row.tsunami_enabled ?? true,
          missile_enabled: row.missile_enabled ?? true,
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
): Promise<void> {
  // 自動取得モデル: 発令を検知したら、現地レコーダから 8 枚スナップ(T-5〜T+30分)を
  // 自動取得 → アップロード → 自動PDF(bcp_report_sweep) → 完了メール、まで全自動。
  // 8 枚は軽量(JPEG)なので災害時でも実用的。連続動画(重い)は別途・手動取得とする。

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
      status: 'pending',
      is_test: false,
    })
    .select('id')
    .single()

  if (eventError || !eventRows) {
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
    const command = { action: 'start_bcp_capture', request_id: crypto.randomUUID(), eventId, clips: edgeClips, clipFrom, clipTo }
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
        title:               entry.title,
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
    console.log(`[jalert-poller] Receipt recorded: ${entry.title} (matched ${matchedStoreCount} store(s))`)
  }
}

/** JMA 震度表記を順序ランクへ。未知/未取得は 0（＝条件未満扱い）。 */
function intensityRank(code: string | null): number {
  switch (code) {
    case '1':  return 1
    case '2':  return 2
    case '3':  return 3
    case '4':  return 4
    case '5-': return 5
    case '5+': return 6
    case '6-': return 7
    case '6+': return 8
    case '7':  return 9
    default:   return 0
  }
}

/**
 * 店舗の発動条件を満たすか（録画を起動すべきか）。
 *   - 地震   : 最大震度がしきい値以上
 *   - 津波   : tsunami_enabled
 *   - ミサイル: missile_enabled
 *   - その他 : 起動しない
 */
function shouldTrigger(
  alertType: string,
  maxIntensity: string | null,
  s: BcpSettings,
): boolean {
  if (alertType === 'earthquake') {
    return intensityRank(maxIntensity) >= intensityRank(s.quake_min_intensity)
  }
  if (alertType === 'tsunami') return s.tsunami_enabled !== false
  if (alertType === 'missile') return s.missile_enabled !== false
  return false
}

/** Determine alert type string from JMA title text */
function classifyAlertType(title: string): string {
  if (title.includes('津波')) return 'tsunami'
  if (title.includes('震度') || title.includes('地震')) return 'earthquake'
  if (title.includes('ミサイル') || title.includes('弾道')) return 'missile'
  return title.slice(0, 50) // fallback: truncated raw title
}

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

  const appUrl = Deno.env.get('NEXT_PUBLIC_APP_URL') ?? 'https://monitor.intareco.jp'
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
  const alertTypeLabel = alertType === 'tsunami' ? '津波情報'
    : alertType === 'earthquake' ? '震度情報'
    : alertType === 'missile' ? 'ミサイル情報'
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
