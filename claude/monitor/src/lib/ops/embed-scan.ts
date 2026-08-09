/**
 * PostgREST の埋め込み（embedded resource）をソースから機械抽出する。
 *
 * ── なぜ書き直したか ────────────────────────────────────────────────────
 * 最初の実装は `名前!inner` という表記だけを正規表現で拾っていた。しかし
 * **`!inner` が付かない素の埋め込みも同じく外部キーに依存する**:
 *
 *     .from('bcp_settings').select('id, stores ( id, name, area_code )')
 *
 * 外部キーが無ければ PostgREST は 400 を返し、呼び出し側の書き方次第で
 * 「0 件」として素通りする。**危険度は `!inner` の有無と関係が無い。**
 *
 * 実測すると、`!inner` は 8 箇所・5 組しか無かったのに対し、素の埋め込みまで
 * 含めると **49 箇所・20 組**あった。最初の棚卸しは 4 分の 1 しか見ていなかった。
 * さらに走査範囲が `src/` だけで、`supabase/functions/`（J-Alert ポーラー）が
 * 丸ごと外れていた。
 *
 * ── なぜパーサを分けるか ────────────────────────────────────────────────
 * **抽出そのものが間違いうる。** 正規表現の取りこぼしは「0 件」という
 * 正しく見える結果を返すので、今日 .gitignore で踏んだのと同じ形になる。
 * だから抽出は独立したモジュールにして、パーサ自体にテストを書く。
 */

/** 埋め込み 1 箇所。`parent` の問い合わせに `child` を埋め込んでいる。 */
export interface Embed {
  /** 1 つ外側の表（入れ子でなければ `.from()` の表） */
  parent: string
  /** 埋め込まれる表 */
  child: string
}

/**
 * PostgREST の select 文字列から埋め込みを取り出す。
 *
 * 対応する書き方:
 *   `stores ( name )`                   素の埋め込み
 *   `stores!inner ( name )`             内部結合
 *   `store:stores ( name )`             別名付き
 *   `recorders ( recorder_cameras ( id ) )`  入れ子
 */
export function parseEmbeds(select: string, fromTable: string): Embed[] {
  const out: Embed[] = []
  let i = 0

  function parseList(parent: string): void {
    let token = ''
    while (i < select.length) {
      const c = select[i]
      if (c === '(') {
        i++
        // `alias:table!inner` から table を取り出す。
        const m = /(?:[a-zA-Z_]\w*\s*:\s*)?([a-zA-Z_]\w*)(?:!(?:inner|left))?\s*$/.exec(token.trim())
        const child = m?.[1] ?? ''
        token = ''
        if (child) out.push({ parent, child })
        parseList(child || parent)
      } else if (c === ')') {
        i++
        return
      } else if (c === ',') {
        i++
        token = ''
      } else {
        token += c
        i++
      }
    }
  }

  parseList(fromTable)
  return out
}

/**
 * ソース 1 ファイルから `.from('X') … .select('…')` の組を探し、埋め込みを返す。
 *
 * ⚠ `.from()` と `.select()` の間に別の `.from()` が挟まる場合は捨てる
 *   （別のチェーンを跨いで誤って結び付けないため）。取りこぼしより
 *   **間違った組を報告しない**ことを優先する。
 */
export function scanSource(source: string): Embed[] {
  const out: Embed[] = []

  // `.from()` を全部拾ってから、**各々について**次の `.from()` までの範囲で
  // `.select()` を探す。1 本の正規表現で `.from(...)…\.select(...)` を
  // 繋ぐ書き方だと、間に別チェーンが挟まったときに正規表現の走査位置が
  // その先へ飛んでしまい、**次のチェーンを丸ごと取りこぼす**
  // （取りこぼしは「0 件」という正しく見える結果になるので気づけない）。
  const fromRe = /\.from\(\s*'([a-z_]+)'\s*\)/g
  const froms: { table: string; end: number }[] = []
  let f: RegExpExecArray | null
  while ((f = fromRe.exec(source)) !== null) {
    froms.push({ table: f[1], end: f.index + f[0].length })
  }

  for (let i = 0; i < froms.length; i++) {
    const start = froms[i].end
    // 次の `.from()` の手前まで。同じチェーンの中だけを見る。
    const stop = i + 1 < froms.length ? froms[i + 1].end - 0 : source.length
    const window = source.slice(start, Math.min(stop, start + 400))
    const sel = /\.select\(\s*'([^']*)'/.exec(window)
    if (!sel) continue
    if (!sel[1].includes('(')) continue
    out.push(...parseEmbeds(sel[1], froms[i].table))
  }
  return out
}

/** "parent→child" の一意な組（順序は安定）。 */
export function uniquePairs(embeds: Embed[]): string[] {
  return [...new Set(embeds.map((e) => `${e.parent}→${e.child}`))].sort()
}
