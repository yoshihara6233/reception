/**
 * jalert-poller の「流れ」を決める純ロジック（フィード解析・絞り込み・対象範囲）。
 *
 * ── なぜ index.ts から切り出すのか ──────────────────────────────────────
 * index.ts は Deno の Edge Function で、`https://deno.land/...` や
 * `https://esm.sh/...` を直接 import している。そのため **vitest からは読めず**、
 * 中の関数は 1 つもテストできなかった（約 790 行が丸ごと未検査）。
 *
 * 隣の match.ts は同じ理由で先に切り出してあり、src 側のテストから
 * 相対 import で読めている。同じやり方を「流れ」の側にも適用する。
 *
 * ここに置くのは**外に触らない判断だけ**。fetch・DB・メールは index.ts に残す。
 * 「何を対象とするか」を間違えると誤発報になり、そこが一番テストしたい部分。
 */

export interface FeedEntry {
  id: string
  title: string
  updated: string
  linkHref: string
}

/** 最初に一致したタグの中身。 */
export function extractTag(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`))
  return m ? m[1].trim() : null
}

/**
 * Atom フィードから entry を取り出す。
 *
 * Deno に DOM パーサが無いので正規表現で読む。JMA のフィードは書式が安定して
 * いるので実用上これで足りる。
 *
 * ⚠ **必ず `<entry>` ブロックの中だけを見ること。** フィード先頭には
 * `<title>高頻度（地震火山）</title>` というフィード自体のタイトルがあり、
 * これを拾うと「地震」を含むため関連ありと誤判定される。
 */
export function parseFeedEntries(xml: string): FeedEntry[] {
  const entries: FeedEntry[] = []

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

/**
 * 複数フィードの entry を id で名寄せする。**先に現れたものを優先**。
 * 地震は eqvol.xml、気象警報は extra.xml にしか無いので複数フィードを併読しており、
 * 同じ電文が両方に載ることがある。
 */
export function mergeFeedEntries(feeds: (string | null)[]): FeedEntry[] {
  const byId = new Map<string, FeedEntry>()
  for (const xml of feeds) {
    if (!xml) continue                       // 1 本落ちても他を止めない
    for (const entry of parseFeedEntries(xml)) {
      if (!byId.has(entry.id)) byId.set(entry.id, entry)
    }
  }
  return [...byId.values()]
}

/** 気象警報電文（VPWW53）のフィードタイトル。特別警報はこの中に入る。 */
export const WEATHER_WARNING_TITLE = '気象特別警報・警報・注意報'

/**
 * 地震（震度速報・緊急地震速報・各種地震情報）の電文か。
 *
 * 旧実装は `RELEVANT_TYPES=['VPWW54','VXSE51']` で判定していたが、VPWW54 は
 * 「津波」ではなく**「気象警報・注意報」**だったため、平常時の気象警報が
 * 大量に混入していた（実データで確認）。JMA の地震のタイトルは常に説明的なので、
 * タイトルベースのほうが確実。
 */
export function isEarthquakeEntry(entry: FeedEntry): boolean {
  const t = entry.title
  return t.includes('震度') || t.includes('緊急地震速報') || t.includes('地震')
}

/**
 * 気象警報電文か（＝特別警報が入っているかもしれない電文か）。
 *
 * ⚠ **タイトルだけでは特別警報の有無は分からない。** この製品名は平常時も
 * 同じで、雷注意報 1 件でも「気象特別警報・警報・注意報」として流れてくる
 * （実測: 19 時間で 245 通、うち特別警報 0 件）。中の `<Kind><Name>` を見るまで
 * 判定できないので、ここでは「本文を取りに行く候補」までしか決めない。
 * 実際の判定は match.ts の parseSpecialWarnings。
 */
export function isWeatherWarningEntry(entry: FeedEntry): boolean {
  return entry.title.includes(WEATHER_WARNING_TITLE)
}

/**
 * 本文を取りに行く価値がある電文だけを通すタイトル許可リスト。
 *
 * 平常時のフィードは大半が無関係な情報（降灰予報など）で埋まる。
 * 通す条件ではなく**落とす件数**が効いている点に注意。
 *
 * 津波・ミサイル(国民保護)は 2026-08-21 に非対応とした（match.ts shouldTrigger の注記）。
 */
export function isRelevantEntry(entry: FeedEntry): boolean {
  return isEarthquakeEntry(entry) || isWeatherWarningEntry(entry)
}

/** タイトルから発令種別へ。既知に当てはまらなければ生タイトルを切って返す。 */
export function classifyAlertType(title: string): string {
  if (title.includes(WEATHER_WARNING_TITLE)) return 'special_warning'
  if (title.includes('震度') || title.includes('地震')) return 'earthquake'
  return title.slice(0, 50)
}

/**
 * 都道府県を特定できない電文か。**特定できない＝対象なし**として扱う。
 *
 * 以前は津波・ミサイルだけ「全有効店舗を対象」に倒していた（areaWide）。
 * どちらの電文も JIS 都道府県を導出できるコードを持たないためだったが、
 * 北海道の津波警報で沖縄の店舗が録画を始める形なので、2026-08-21 に
 * 津波・ミサイルごと非対応にして、この全店フォールバックを廃止した。
 *
 * 残った 2 種別（地震・特別警報）はどちらも都道府県を導出できる。
 * 取れないなら電文の異常なので、広げずに止める。1 通の壊れた電文で
 * 全店が録画を始めるほうが危険。
 */
export function hasNoTargetPref(affectedPrefs: ReadonlyMap<string, string | null>): boolean {
  return affectedPrefs.size === 0
}

/** エッジへ送る自動取得コマンド（`start_bcp_capture`）。 */
export interface BcpCaptureCommand {
  action: 'start_bcp_capture'
  request_id: string
  eventId: string
  clips: { clipId: string; cameraId: string }[]
  /** **発令時刻そのもの（T+0）。** 下のコメントを必ず読むこと。 */
  clipFrom: string
  clipTo: string
  offsets: number[]
}

/**
 * 自動取得コマンドを組み立てる。
 *
 * ⚠ **`clipFrom` は「発令時刻そのもの」を渡すこと。**
 *
 * エッジはこの値を T+0 として各オフセットの取得時刻を計算する:
 *
 *     claude/edge-agent/src/modes/bcp.ts
 *     const alertIssuedMs = new Date(clipFrom).getTime()
 *     const targetMs      = alertIssuedMs + offsetMin * 60_000
 *
 * ここに旧 VOD 方式の「発令 − pre分」を渡すと、**全 8 コマが pre 分だけ
 * 過去にずれる**。タイルのラベル（発令時刻から計算）と実画像が一致しなくなり、
 * 「時刻がずれている」という形で表に出る。NTP とは無関係。
 *
 * 2026-07-13 にこの是正を入れたが、**当てたのは /api/bcp/test と
 * /api/bcp/[id]/retrieve の 2 経路だけで、このポーラーが取り残されていた**。
 * テスト発令では正しく見えるので、実発令だけが 3 分ずれ続けた
 * （2026-08-13 の震度情報で再発見。pre_minutes 既定 3 分ぶんちょうど）。
 *
 * `bcp_clips.clip_from` 列は別物で、そちらは「発令 − pre分」が正しい
 * （手動の動画取得に使う録画区間）。**混ぜないこと。**
 */
export function buildBcpCaptureCommand(params: {
  requestId: string
  eventId: string
  clips: { clipId: string; cameraId: string }[]
  /** 発令時刻（ISO）。録画区間の開始ではない。 */
  alertIssuedAt: string
  clipTo: string
  offsets?: number[] | null
}): BcpCaptureCommand {
  return {
    action:     'start_bcp_capture',
    request_id: params.requestId,
    eventId:    params.eventId,
    clips:      params.clips,
    clipFrom:   params.alertIssuedAt,
    clipTo:     params.clipTo,
    offsets:    params.offsets ?? [-5, 5],
  }
}
