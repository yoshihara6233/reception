/**
 * フォルダページ（Phase 1.5 M1）の純ロジック。
 *
 * folder_path を持つカメラが 1 台でもある、またはカメラが 17 台以上のとき、
 * MonitorWorkspace は固定スロット表示をやめて「フォルダ = グループ、
 * 16 台 = 1 ページ」に切り替える。各グループのカメラは channel 昇順、
 * 17 台以上のフォルダは自動でページ分割。未分類（folder_path なし）は末尾。
 */

export const GRID_PAGE_SIZE = 16

export interface GroupableCam {
  channel: number
  folder_path?: string | null
}

export interface GridGroup<T extends GroupableCam> {
  key: string
  label: string
  pages: T[][]
}

export function buildGridGroups<T extends GroupableCam>(
  cameras: readonly T[],
  unclassifiedLabel: string,
): GridGroup<T>[] {
  const byFolder = new Map<string, T[]>()
  for (const c of cameras) {
    const key = c.folder_path?.trim() || ''
    const arr = byFolder.get(key) ?? []
    arr.push(c)
    byFolder.set(key, arr)
  }
  // フォルダ名順（未分類は最後）。NVMS の木順は path 文字列の辞書順でほぼ保たれる。
  const keys = [...byFolder.keys()].sort((a, b) => {
    if (a === '') return 1
    if (b === '') return -1
    return a.localeCompare(b, 'ja')
  })
  return keys.map((key) => {
    const cams = (byFolder.get(key) ?? []).slice().sort((a, b) => a.channel - b.channel)
    const pages: T[][] = []
    for (let i = 0; i < cams.length; i += GRID_PAGE_SIZE) pages.push(cams.slice(i, i + GRID_PAGE_SIZE))
    return { key: key || '__none__', label: key || unclassifiedLabel, pages }
  })
}
