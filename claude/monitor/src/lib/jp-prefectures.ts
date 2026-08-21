/**
 * 都道府県コード → 名称。**3 つの書式が混在しているので、そのすべてを受ける。**
 *
 * ── なぜ書式が混ざっているのか ──────────────────────────────────────────
 *   stores.area_code      : JIS 市区町村コード 5 桁（例 43100 = 熊本市）
 *                           J-Alert の照合は先頭 2 桁を都道府県として使う
 *                           （supabase/functions/jalert-poller/match.ts）
 *   bcp_events.area_code  : 都道府県コード 2 桁（例 43）
 *   本ファイルの旧実装     : ISO 3166-2:JP（例 JP-43）
 *
 * 旧 prefLabel() は 'JP-43' の形しか引けず、**実データの 43100 / 43 はどちらも
 * 引けずに生のコードを返していた**。設備・巡回・発報の各設定画面はそれで
 * 「43100」と表示していた（落ちないので気づけない類の不具合）。
 * 正規化を 1 箇所に集め、どの書式でも同じ名前を返す。
 */
export const JP_PREFECTURES: Record<string, string> = {
  'JP-01': '北海道', 'JP-02': '青森県', 'JP-03': '岩手県', 'JP-04': '宮城県',
  'JP-05': '秋田県', 'JP-06': '山形県', 'JP-07': '福島県', 'JP-08': '茨城県',
  'JP-09': '栃木県', 'JP-10': '群馬県', 'JP-11': '埼玉県', 'JP-12': '千葉県',
  'JP-13': '東京都', 'JP-14': '神奈川県', 'JP-15': '新潟県', 'JP-16': '富山県',
  'JP-17': '石川県', 'JP-18': '福井県', 'JP-19': '山梨県', 'JP-20': '長野県',
  'JP-21': '岐阜県', 'JP-22': '静岡県', 'JP-23': '愛知県', 'JP-24': '三重県',
  'JP-25': '滋賀県', 'JP-26': '京都府', 'JP-27': '大阪府', 'JP-28': '兵庫県',
  'JP-29': '奈良県', 'JP-30': '和歌山県', 'JP-31': '鳥取県', 'JP-32': '島根県',
  'JP-33': '岡山県', 'JP-34': '広島県', 'JP-35': '山口県', 'JP-36': '徳島県',
  'JP-37': '香川県', 'JP-38': '愛媛県', 'JP-39': '高知県', 'JP-40': '福岡県',
  'JP-41': '佐賀県', 'JP-42': '長崎県', 'JP-43': '熊本県', 'JP-44': '大分県',
  'JP-45': '宮崎県', 'JP-46': '鹿児島県', 'JP-47': '沖縄県',
}

/**
 * どの書式のコードからでも都道府県名を引く。引けなければ null。
 *
 * 'JP-43' / '43' / '43100'（JIS 市区町村コード）は、いずれも 熊本県。
 * 1 桁は先頭 0 を補う（CSV 取込で '4' になっている行がありうるため。'4' → 宮城県）。
 */
export function prefName(areaCode: string | null | undefined): string | null {
  if (!areaCode) return null
  const raw = String(areaCode).trim()
  if (!raw) return null
  const digits = raw.startsWith('JP-') ? raw.slice(3) : raw
  if (!/^\d{1,5}$/.test(digits)) return null
  // 5 桁は市区町村コード。都道府県は先頭 2 桁。1 桁は 0 埋め。
  const two = digits.length === 1 ? `0${digits}` : digits.slice(0, 2)
  return JP_PREFECTURES[`JP-${two}`] ?? null
}

/**
 * どの書式のコードからでも**都道府県コード 2 桁**を取り出す。
 * グループ化のキーに使う。引けなければ null。
 */
export function prefCode(areaCode: string | null | undefined): string | null {
  if (!areaCode) return null
  const raw = String(areaCode).trim()
  const digits = raw.startsWith('JP-') ? raw.slice(3) : raw
  if (!/^\d{1,5}$/.test(digits)) return null
  const two = digits.length === 1 ? `0${digits}` : digits.slice(0, 2)
  return JP_PREFECTURES[`JP-${two}`] ? two : null
}

/** area_code を「県名（コード）」ラベルに。名前が引けなければコードのまま。 */
export function prefLabel(areaCode: string | null | undefined): string {
  if (!areaCode) return '未設定'
  const name = prefName(areaCode)
  return name ? `${name}（${areaCode}）` : String(areaCode)
}

/**
 * BCP 画面用。「43 熊本県」の形。コードを先に出すのは、
 * 一覧が等幅で桁を揃えており、コードの位置が動くと読みにくくなるため。
 */
export function areaCodeLabel(areaCode: string | null | undefined): string {
  if (!areaCode) return '—'
  const name = prefName(areaCode)
  return name ? `${areaCode} ${name}` : String(areaCode)
}
