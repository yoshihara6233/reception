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
 * 照合は「都道府県 2 桁プレフィックス一致」で行う（Pref/City どちらのコードでも成立）。
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

/**
 * 店舗の area_code が発令エリアに一致するか。
 * 完全一致、または「発令コードの先頭2桁（JIS 都道府県）で始まる」場合に一致。
 * 例: 店舗 '43100'(熊本市) × 発令 ['43','741','4310400'] → '43' で一致。
 */
export function matchesStoreArea(storeAreaCode: string | null, alertCodes: string[]): boolean {
  if (!storeAreaCode || alertCodes.length === 0) return false
  return alertCodes.some(
    (alertCode) =>
      storeAreaCode === alertCode ||
      (alertCode.length >= 2 && storeAreaCode.startsWith(alertCode.slice(0, 2))),
  )
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
