/**
 * jalert-poller の純ロジック（JMA XML のコード抽出・エリア照合・震度判定）。
 *
 * Deno(Edge Function: index.ts) と vitest(src/lib/bcp/jalert-match.test.ts) の
 * 両方から import するため、Deno / Node どちらの API にも依存しないこと。
 *
 * JMA 地震 XML のコード体系（CodeDefine 実物より）:
 *   Pref/Code                 = 地震情報／都道府県等（JIS 2桁: 43 = 熊本県）
 *   Pref/Area/Code            = 地震情報／細分区域（3桁: 741 = 熊本県熊本）
 *   Pref/Area/City/Code       = 気象・地震・火山情報／市町村等（7桁: 4310400 = 熊本南区）
 * 店舗側 stores.area_code は JIS 市区町村コード（例: 43100 = 熊本市）を入れる。
 *
 * 照合は「JIS 都道府県 2 桁の一致」で行うが、**その 2 桁を作ってよいのは
 * Pref(2桁) と City(7桁の先頭2桁) だけ**。細分区域(3桁)からは作ってはならない。
 * 細分区域コードは JIS とは別体系で、先頭2桁が無関係な県の JIS コードと衝突する。
 * 詳細は parseAffectedPrefs の注記を参照。
 */

/** JMA 詳細XMLの最大震度 <MaxInt> を抽出（'6+','5-','4' 等の生値。無ければ null） */
export function parseMaxIntensity(xml: string): string | null {
  const m = xml.match(/<(?:\w+:)?MaxInt[^>]*>([^<]+)<\/(?:\w+:)?MaxInt>/)
  return m ? m[1].trim() : null
}

/**
 * 詳細 XML からエリアコード群を抽出する。
 *
 * Pref(都道府県2桁)・Area(細分区域)・City(市町村等) をそれぞれ独立に走査し、
 * 各ブロックの先頭 <Code> を採用する（ブロック内の下位要素は各タグの走査で拾う）。
 *
 * 旧実装は <Area> ブロックだけを見ていたため、震度速報/震源震度情報からは
 * 細分区域コード(741 等)しか取れず、JIS 市区町村コードを持つ店舗と永遠に
 * 一致しなかった（2026-07-31 熊本 震度3 不発動の根本原因）。Pref の 2 桁を
 * 拾うことで、City の無い震度速報(VXSE51)でも都道府県一致が成立する。
 */
export function parseAreaCodes(xml: string): string[] {
  const codes = new Set<string>()

  for (const tag of ['Pref', 'Area', 'City']) {
    const blockRegex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'g')
    let m: RegExpExecArray | null
    while ((m = blockRegex.exec(xml)) !== null) {
      const codeMatch = m[1].match(/<Code[^>]*>(\d+)<\/Code>/)
      if (codeMatch) codes.add(codeMatch[1])
    }
  }

  // Fallback: bare <Code> elements anywhere (some products use this)
  if (codes.size === 0) {
    const codeRegex = /<Code[^>]*>(\d{2,6})<\/Code>/g
    let m: RegExpExecArray | null
    while ((m = codeRegex.exec(xml)) !== null) {
      codes.add(m[1])
    }
  }

  return [...codes]
}

/** JIS 都道府県コードとして妥当な 2 桁（01〜47）か。 */
function isJisPref(code: string): boolean {
  if (!/^\d{2}$/.test(code)) return false
  const n = Number(code)
  return n >= 1 && n <= 47
}

/** 震度の強い方を残す（未取得 null は最弱扱い）。 */
function strongerIntensity(a: string | null, b: string | null): string | null {
  return intensityRank(b) > intensityRank(a) ? b : a
}

/**
 * 発表エリアを「JIS 都道府県コード(2桁) → その県で観測された最大震度」に畳む。
 *
 * 都道府県を導出してよいのは次の 2 種類のコードだけ:
 *   Pref/Code            2桁  JIS 都道府県                （43 = 熊本県）
 *   Pref/Area/City/Code  7桁  市町村等・先頭2桁が JIS 都道府県（4310400 → 43）
 *
 * **細分区域(3桁)と津波予報区(3桁)は使わない。** これらは JIS とは別体系で、
 * 先頭2桁を都道府県として扱うと無関係な県に一致する。実例:
 *   210「岩手県沿岸北部」→ "21" = 岐阜県 / 251「福島県浜通り」→ "25" = 滋賀県
 *   220「宮城県北部」    → "22" = 静岡県 / 146「胆振地方中東部」→ "14" = 神奈川県
 * 2026-08-09 03:02 の岩手県沖・震度4 では、実際に揺れた 7 県に対して 19 県が
 * 一致と判定され 38 店舗が発動した。その根本原因がこの取り違えである。
 *
 * 震度も県単位で返す。全国最大値を全店舗に当てると、震度1の県の店舗が
 * 「震度4」として発動条件を通ってしまうため（同障害のもう一方の原因）。
 *
 * 津波・ミサイルの電文には Pref/City が無く、戻り値は空になる。呼び出し側で
 * 「都道府県を特定できない」ケースとして明示的に扱うこと（index.ts 参照）。
 */
export function parseAffectedPrefs(xml: string): Map<string, string | null> {
  const out = new Map<string, string | null>()

  const put = (pref: string, intensity: string | null) => {
    if (!isJisPref(pref)) return
    out.set(pref, out.has(pref) ? strongerIntensity(out.get(pref) ?? null, intensity) : intensity)
  }

  // ブロック内の先頭 <Code> / <MaxInt> は、そのブロック自身の値（下位要素より前に来る）。
  const scan = (tag: string, toPref: (code: string) => string | null) => {
    const blockRegex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'g')
    let m: RegExpExecArray | null
    while ((m = blockRegex.exec(xml)) !== null) {
      const body = m[1]
      const code = body.match(/<Code[^>]*>(\d+)<\/Code>/)
      if (!code) continue
      const pref = toPref(code[1])
      if (!pref) continue
      const int = body.match(/<MaxInt[^>]*>([^<]+)<\/MaxInt>/)
      put(pref, int ? int[1].trim() : null)
    }
  }

  scan('Pref', (c) => (c.length === 2 ? c : null))
  scan('City', (c) => (c.length >= 5 ? c.slice(0, 2) : null))

  return out
}

/**
 * 店舗が発表エリアに含まれるか、含まれるならその店舗の県で観測された震度。
 * stores.area_code は JIS 市区町村コード（例: 43100 = 熊本市）。先頭2桁で照合する。
 */
export function storeAreaIntensity(
  storeAreaCode: string | null,
  affectedPrefs: ReadonlyMap<string, string | null>,
): { matched: boolean; intensity: string | null } {
  const miss = { matched: false, intensity: null }
  if (!storeAreaCode || affectedPrefs.size === 0) return miss
  const pref = storeAreaCode.slice(0, 2)
  if (!isJisPref(pref) || !affectedPrefs.has(pref)) return miss
  return { matched: true, intensity: affectedPrefs.get(pref) ?? null }
}

/** JMA 震度表記を順序ランクへ。未知/未取得は 0（＝条件未満扱い）。 */
export function intensityRank(code: string | null): number {
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

export interface TriggerSettings {
  quake_min_intensity: string
  tsunami_enabled: boolean
  missile_enabled: boolean
}

/**
 * 店舗の発動条件を満たすか（録画を起動すべきか）。
 *   - 地震   : 最大震度がしきい値以上
 *   - 津波   : tsunami_enabled
 *   - ミサイル: missile_enabled
 *   - その他 : 起動しない
 */
export function shouldTrigger(
  alertType: string,
  maxIntensity: string | null,
  s: TriggerSettings,
): boolean {
  if (alertType === 'earthquake') {
    return intensityRank(maxIntensity) >= intensityRank(s.quake_min_intensity)
  }
  if (alertType === 'tsunami') return s.tsunami_enabled !== false
  if (alertType === 'missile') return s.missile_enabled !== false
  return false
}
