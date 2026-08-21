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

/**
 * JMA 地震火山 XML の `<Head><EventID>` を抽出（無ければ null）。
 *
 * 1 つの地震に対し気象庁は複数の電文を出す（震度速報 → 震源に関する情報 →
 * 震源・震度に関する情報 → 続報）。Atom の id と updated は電文ごとに違うが、
 * **EventID は同一地震のすべての電文で共通**（実測: 2026-08-09 岩手県沖の
 * 4 電文すべて 20260809025805）。これを地震の同一性の鍵として使う。
 */
export function parseEventId(xml: string): string | null {
  const m = xml.match(/<(?:\w+:)?EventID>([^<]+)<\/(?:\w+:)?EventID>/)
  const v = m ? m[1].trim() : ''
  return v || null
}

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
  /** 気象等の特別警報（レベル5）で録画を起動するか。 */
  special_warning_enabled: boolean
}

/**
 * 店舗の発動条件を満たすか（録画を起動すべきか）。
 *   - 地震     : その店舗の県で観測された最大震度がしきい値以上
 *   - 特別警報 : special_warning_enabled
 *   - その他   : 起動しない
 *
 * 津波・ミサイル(国民保護)は 2026-08-21 に非対応とした。どちらの電文も
 * 都道府県を導出できるコードを持たず、「全有効店舗を対象」に倒すしかない。
 * 北海道の津波警報で沖縄の店舗が録画を始める形になり、店舗数が増えるほど
 * 誤発報のほうが大きくなるため、扱わないことにした（parseAffectedPrefs の注記）。
 */
export function shouldTrigger(
  alertType: string,
  maxIntensity: string | null,
  s: TriggerSettings,
): boolean {
  if (alertType === 'earthquake') {
    return intensityRank(maxIntensity) >= intensityRank(s.quake_min_intensity)
  }
  if (alertType === 'special_warning') return s.special_warning_enabled !== false
  return false
}

// ---------------------------------------------------------------------------
// 気象特別警報（VPWW53「気象特別警報・警報・注意報」）
// ---------------------------------------------------------------------------

/**
 * 気象警報電文 1 件ぶんの「種別 × 発表状況 × 発表区域」。
 *
 * VPWW53 は 1 通の中に 4 つの区域粒度（府県予報区／一次細分区域／市町村等を
 * まとめた地域／市町村等）が入り、それぞれ `<Item>` に `<Kind>` と `<Area>` を持つ。
 */
export interface WarningItem {
  /** `<Kind><Name>` の生値。例: '大雨特別警報' / '雷注意報' / '解除' */
  kind: string
  /** `<Kind><Status>`。実測値は '発表' / '継続' / '解除' の 3 つ。 */
  status: string
  /** その Item の `<Area><Code>`。6桁=府県予報区・細分区域、7桁=市町村等。 */
  areaCode: string | null
}

/**
 * `<Body>` の `<Warning>` を走査して「種別 × 発表状況 × 区域」を取り出す。
 *
 * ⚠ **XML 全体から「特別警報」を検索してはならない。** VPWW53 の `<Notice>` には
 * 平常時でも必ず「［危険警報・氾濫特別警報の発表状況］なし」という定型文が入る。
 * 素朴に文字列一致を取ると、全国すべての気象電文が特別警報として通る
 * （実測: 取得した 50 通すべてに この文言が入っていた）。
 * 判定してよいのは `<Kind><Name>` の中だけ。
 *
 * ⚠ **`<Head><Headline><Information>` は見ない。** 同じ `<Item>` / `<Kind>` の形を
 * しているが、こちらの Kind には `<Status>` が無い（実測: 岡山の 1 通で 5 件）。
 * 発表なのか解除なのかを区別できないものを混ぜると、解除の電文で録画が始まる。
 * 区域ごとの発表状況は Body の `<Warning>` に必ず入っているので、そちらだけを使う。
 *
 * Body での解除は `<Kind><Name>大雨注意報</Name><Status>解除</Status>` の形。
 * Name は種別のままなので、**Status を見ないと解除を発表と取り違える**。
 * （Head 側にだけ現れる `<Name>解除</Name>` という形もあるが、上記のとおり見ない。）
 */
export function parseWarningItems(xml: string): WarningItem[] {
  const items: WarningItem[] = []

  const warningRegex = /<Warning[^>]*>([\s\S]*?)<\/Warning>/g
  let w: RegExpExecArray | null
  while ((w = warningRegex.exec(xml)) !== null) {
    collectItems(w[1], items)
  }

  return items
}

function collectItems(warningBody: string, items: WarningItem[]): void {
  const itemRegex = /<Item>([\s\S]*?)<\/Item>/g
  let m: RegExpExecArray | null
  while ((m = itemRegex.exec(warningBody)) !== null) {
    const body = m[1]

    // 区域は Body 側が <Area>、Head の Information 側が <Areas><Area>。
    // どちらも最初の <Code> がその Item の区域。
    const area = body.match(/<Area>\s*<Name>[^<]*<\/Name>\s*<Code>(\d+)<\/Code>/)
    const areaCode = area ? area[1] : null

    const kindRegex = /<Kind>([\s\S]*?)<\/Kind>/g
    let k: RegExpExecArray | null
    while ((k = kindRegex.exec(body)) !== null) {
      const name = k[1].match(/<Name>([^<]*)<\/Name>/)
      if (!name) continue
      const status = k[1].match(/<Status>([^<]*)<\/Status>/)
      items.push({ kind: name[1].trim(), status: status ? status[1].trim() : '', areaCode })
    }
  }
}

/**
 * その区域で現に出ている特別警報か。
 *
 * **「解除でない」ではなく「発表または継続」で判定する。** Status の値は実測で
 * 発表 / 継続 / 解除 の 3 つだが、Name も Status も無い `<Kind>`（区域に何も
 * 出ていない印の「発表警報・注意報はなし」）のような形が他にもありうる。
 * 知らない値が増えたときに「発動する側」へ倒れないよう、通す値を並べる。
 */
function isActiveSpecialWarning(item: WarningItem): boolean {
  if (!item.kind.includes('特別警報')) return false
  return item.status === '発表' || item.status === '継続'
}

export interface SpecialWarningScan {
  /** 現に出ている特別警報の種別名（重複除去・出現順）。空なら特別警報は無い。 */
  kinds: string[]
  /** 対象の JIS 都道府県コード(2桁) → null（震度は無いので常に null）。 */
  prefs: Map<string, string | null>
}

/**
 * 気象警報電文から「現に出ている特別警報」と、その対象都道府県を取り出す。
 *
 * 気象警報の区域コードは気象庁独自の 6桁（府県予報区 200000 / 一次細分区域
 * 200010 / 市町村等をまとめた地域 200011）と 7桁（市町村等 2020100）で、
 * **先頭 2 桁が JIS 都道府県コードになるよう採番されている**。
 * 実測で確認済み: 50 府県予報区・4,234 区域コードすべてで先頭2桁が 01〜47 に
 * 収まり、かつ電文の府県予報区と一致した（例外 0 件）。北海道(012000/013000)・
 * 鹿児島(460040)・沖縄(471000〜474000) の分割予報区も先頭2桁は正しい。
 *
 * これは地震電文の細分区域(3桁)とは別物。3桁のほうは先頭2桁を取ると無関係な県に
 * 一致する（210岩手県沿岸北部 → 21岐阜県）。**桁数で体系を見分けること。**
 */
export function parseSpecialWarnings(xml: string): SpecialWarningScan {
  const kinds: string[] = []
  const prefs = new Map<string, string | null>()

  for (const item of parseWarningItems(xml)) {
    if (!isActiveSpecialWarning(item)) continue

    if (!kinds.includes(item.kind)) kinds.push(item.kind)

    const code = item.areaCode
    // 6桁(府県予報区・細分区域) と 7桁(市町村等) だけが JIS 都道府県を導出できる。
    if (!code || code.length < 6 || code.length > 7) continue
    const pref = code.slice(0, 2)
    if (!isJisPref(pref)) continue
    if (!prefs.has(pref)) prefs.set(pref, null)
  }

  return { kinds, prefs }
}
