/** nvmsd リリース台帳の共有定義（OTA_SPEC §3）。 */

export const NVMSD_RELEASES_BUCKET = 'nvmsd-releases'
export const NVMSD_RELEASE_MAX_BYTES = 200 * 1024 * 1024

// バージョンはストレージパスに使うので形を縛る（パス区切り・空白の混入防止）。
// 例: 0.1.56-abc1234
export const NVMSD_VERSION_RE = /^[0-9A-Za-z._+-]{1,64}$/

// 配布物の形式と CPU 種別（キーは 版・形式・arch）。署名が版と arch を縛るため、
// 同じ版でも形式・arch ごとに別の配布物＋署名になる（OTA 形式の配り分け・2026-09-25）。
export const PKG_FORMATS = ['deb', 'rpm'] as const
export const PKG_ARCHES = ['amd64', 'arm64'] as const
export type PkgFormat = (typeof PKG_FORMATS)[number]
export type PkgArch = (typeof PKG_ARCHES)[number]

/** 名乗りの無い拠点（0.1.66 以前・すべて Ubuntu）は deb / amd64 として扱う。 */
export const DEFAULT_PKG_FORMAT: PkgFormat = 'deb'
export const DEFAULT_PKG_ARCH: PkgArch = 'amd64'

export function edgePkg(row: { pkg_format?: string | null; pkg_arch?: string | null }): { format: PkgFormat; arch: PkgArch } {
  const format = (PKG_FORMATS as readonly string[]).includes(row.pkg_format ?? '') ? row.pkg_format as PkgFormat : DEFAULT_PKG_FORMAT
  const arch = (PKG_ARCHES as readonly string[]).includes(row.pkg_arch ?? '') ? row.pkg_arch as PkgArch : DEFAULT_PKG_ARCH
  return { format, arch }
}

/**
 * 実体の置き場。既存の deb/amd64 は台帳の storage_path に旧パスが残るのでそのまま配れる。
 * 新規登録は形式・arch をパスに含め、同じ版の deb と rpm が衝突しないようにする。
 */
export function nvmsdReleasePath(version: string, format: PkgFormat = DEFAULT_PKG_FORMAT, arch: PkgArch = DEFAULT_PKG_ARCH): string {
  return `releases/nvmsd-${version}-${format}-${arch}`
}
