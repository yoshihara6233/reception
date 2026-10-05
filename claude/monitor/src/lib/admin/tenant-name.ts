/**
 * テナントの削除で打ち込ませる名前の照合（画面と API で同じ決まりにする）。
 *
 * 名前に全角の空白が入っていると（例「某デベロッパー様　デモ」）、半角で打った人は
 * 一致せず、削除のボタンが押せないまま理由も分からなかった（2026-10-05 の利用者の指摘）。
 * **空白の全角・半角・個数と、英数字の全角・半角の違いは見ない**（NFKC で揃える）。
 * 文字そのものの違いは見る — 打ち込ませるのは「どのテナントを消すかを確かめる」ためなので、
 * 別のテナントの名前で通ってはいけない。
 */
export function normalizeTenantName(s: string): string {
  return s.normalize('NFKC').replace(/\s+/g, ' ').trim()
}

export function sameTenantName(typed: string, name: string): boolean {
  const t = normalizeTenantName(typed)
  return t !== '' && t === normalizeTenantName(name)
}
