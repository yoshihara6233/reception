/** nvmsd リリース台帳の共有定義（OTA_SPEC §3）。 */

export const NVMSD_RELEASES_BUCKET = 'nvmsd-releases'
export const NVMSD_RELEASE_MAX_BYTES = 200 * 1024 * 1024

// バージョンはストレージパスに使うので形を縛る（パス区切り・空白の混入防止）。
// 例: 0.1.56-abc1234
export const NVMSD_VERSION_RE = /^[0-9A-Za-z._+-]{1,64}$/

export function nvmsdReleasePath(version: string): string {
  return `releases/nvmsd-${version}`
}
