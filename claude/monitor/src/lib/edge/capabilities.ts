/**
 * 拠点の「版と使える機能の名乗り」（NVMS/docs/GVMS_CLOUD_SPEC.md §2）。
 *
 * 拠点は heartbeat で `spec_version` と `capabilities` を名乗り、クラウドは名乗りを見て
 * 画面を出し分ける。**押しても動かないボタンを出さない**ための仕組み。
 *
 * 守ること（仕様 §2 のクラウドへのお願い）:
 *  - **知らない機能名は黙って無視し、heartbeat を拒否しない。** 形の崩れた名乗りも
 *    heartbeat ごと 400 にはしない（拠点が「停止」に見えてしまう）。読めた分だけ使う。
 *  - 名乗りの無い拠点（0.1.67 以前）は既定の一覧を持つものとして扱う。
 *  - 判定はここ 1 か所に置く。画面と API で別々に書くと必ずずれる（isVodVendor の教訓）。
 */

/** 名乗りの無い拠点（nvmsd 0.1.67 以前）が持つものとして扱う機能。 */
export const LEGACY_CAPABILITIES = ['grid', 'live_jpeg', 'clip', 'bcp', 'diag', 'ota'] as const

export const MAX_CAPABILITIES = 32
const CAP_RE = /^[a-z0-9_]{1,32}$/

/** 遠隔視聴の機能名（§5）。 */
export type VideoCapability = 'hls_live' | 'hls_vod' | 'sfu'

/**
 * heartbeat の capabilities を保存できる形に整える。
 * 配列でなければ null（＝名乗り無し）。形の合わない要素は捨て、重複を除き、32 件で切る。
 */
export function sanitizeCapabilities(input: unknown): string[] | null {
  if (!Array.isArray(input)) return null
  const out: string[] = []
  for (const v of input) {
    if (typeof v !== 'string' || !CAP_RE.test(v) || out.includes(v)) continue
    out.push(v)
    if (out.length >= MAX_CAPABILITIES) break
  }
  return out
}

/** spec_version は正の整数だけを受ける（それ以外は名乗り無し扱い）。 */
export function sanitizeSpecVersion(input: unknown): number | null {
  return typeof input === 'number' && Number.isInteger(input) && input > 0 && input < 1000 ? input : null
}

export interface EdgeCapabilitySource {
  agent_version?: string | null
  capabilities?: string[] | null
}

/**
 * その拠点が実際に使える機能の一覧。
 * nvmsd 以外（従来のエッジ端末）は名乗りの仕組みを持たないので空を返す —
 * 従来エッジの画面の出し分けは今までどおりベンダ・構成で行う。
 */
export function effectiveCapabilities(edge: EdgeCapabilitySource | null | undefined): readonly string[] {
  if (!edge || !edge.agent_version?.startsWith('nvmsd/')) return []
  return edge.capabilities ?? LEGACY_CAPABILITIES
}

export function hasCapability(edge: EdgeCapabilitySource | null | undefined, cap: string): boolean {
  return effectiveCapabilities(edge).includes(cap)
}
