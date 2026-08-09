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
 * 地震・津波は eqvol.xml にしか無いので複数フィードを併読しており、
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

/**
 * J-Alert（地震・津波・ミサイル）の発令だけを通すタイトル許可リスト。
 *
 * 旧実装は `RELEVANT_TYPES=['VPWW54','VXSE51']` で判定していたが、VPWW54 は
 * 「津波」ではなく**「気象警報・注意報」**だったため、平常時の気象警報が
 * 大量に混入していた（実データで確認）。JMA の地震・津波・国民保護の
 * タイトルは常に説明的なので、タイトルベースのほうが確実。
 *
 * 平常時のフィードは大半が無関係な情報（降灰予報など）で埋まる。
 * 通す条件ではなく**落とす件数**が効いている点に注意。
 */
export function isRelevantEntry(entry: FeedEntry): boolean {
  const t = entry.title

  // 津波を最優先で判定（タイトルに「注意報」を含むため、気象の除外より先に通す）。
  if (t.includes('津波')) return true
  // 地震（震度速報・緊急地震速報・各種地震情報）。
  if (t.includes('震度') || t.includes('緊急地震速報') || t.includes('地震')) return true
  // 国民保護（弾道ミサイル等）。
  if (t.includes('ミサイル') || t.includes('弾道') || t.includes('国民保護')) return true

  // それ以外（気象警報・注意報、噴火、降灰予報など）は受信履歴に含めない。
  return false
}

/** タイトルから発令種別へ。既知3種に当てはまらなければ生タイトルを切って返す。 */
export function classifyAlertType(title: string): string {
  if (title.includes('津波')) return 'tsunami'
  if (title.includes('震度') || title.includes('地震')) return 'earthquake'
  if (title.includes('ミサイル') || title.includes('弾道')) return 'missile'
  return title.slice(0, 50)
}

export interface AreaScope {
  /** true = 都道府県を絞れないので全有効店舗を対象にする。 */
  areaWide: boolean
  /** true = 地震なのに都道府県が取れない異常。呼び出し側で警告を出す。 */
  quakeWithoutPref: boolean
}

/**
 * 都道府県が特定できないときに、どこまでを対象にするか。
 *
 * 津波・ミサイルの電文は**津波予報区コード(3桁)しか持たず**、JIS 都道府県を
 * 導出できない。3桁の先頭2桁を取るのは誤りで、無関係な県に一致する
 * （462 → 46 = 鹿児島県。2026-08-09 に 38 店舗へ誤発報した経路）。
 * なので安全側に倒して「全有効店舗を対象」とする——取りこぼすより広く拾う。
 *
 * 一方、地震で都道府県が取れないのは電文の異常なので**対象なし**にする。
 * ここを areaWide にすると、1 通の壊れた電文で全店が録画を始める。
 */
export function resolveAreaScope(
  alertType: string,
  affectedPrefs: ReadonlyMap<string, string | null>,
): AreaScope {
  const prefUnknown = affectedPrefs.size === 0
  return {
    areaWide:         prefUnknown && (alertType === 'tsunami' || alertType === 'missile'),
    quakeWithoutPref: prefUnknown && alertType === 'earthquake',
  }
}
