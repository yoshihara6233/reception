/**
 * ライブ画像（grid / snapshot）の署名URL — Cloudflare Worker `intereco-edge-images` 用。
 *
 * なぜ S3 presigned ではなくこれか:
 *   PoC Beelink 店の eo光が `*.r2.cloudflarestorage.com` を **SNI 遮断**しており（2026-08-03 実測。
 *   genesis-edge.com / r2.dev は到達可）、S3 API 方式ではその店で一切機能せず、静かに Supabase へ
 *   フォールバックし続ける＝エグレス削減がゼロになる。自社ドメインの Worker 経由にすれば
 *   遮断ホスト名を踏まない。同種フィルタを持つ顧客店舗でも同じ問題が起きうるため恒久対策とする。
 *
 * 正規化文字列は Worker と厳密一致: `${method}\n${key}\n${exp}`。
 * method を署名対象に含めるので **PUT 署名で GET はできない**（逆も同様）。
 *
 * env 未設定なら null を返す＝呼び出し側は従来経路（S3 presigned → Supabase）へフォールバックし、
 * 本実装をデプロイしても Worker と鍵の設定が済むまで挙動は変わらない。
 *
 * env: EDGE_IMAGES_BASE_URL（例 https://img.genesis-edge.com）
 *      EDGE_IMAGES_SIGNING_SECRET（= Worker の同名 secret）
 */
import { createHmac } from 'node:crypto'

/** エッジのアップロード用 TTL。キー固定なのでエッジは URL を使い回す。 */
export const EDGE_IMAGES_PUT_TTL_SEC = 3600
/** ブラウザ配信（302先）用 TTL。短くしてリプレイ窓を絞る。 */
export const EDGE_IMAGES_GET_TTL_SEC = 120

export function edgeImagesWorkerConfigured(): boolean {
  return !!(process.env.EDGE_IMAGES_BASE_URL && process.env.EDGE_IMAGES_SIGNING_SECRET)
}

/** Worker と一致させる正規化文字列。 */
function canonical(method: 'PUT' | 'GET', key: string, exp: number): string {
  return `${method}\n${key}\n${exp}`
}

/**
 * Worker 経由の署名URLを組み立てる。env 未設定なら null。
 * @param method PUT=エッジのアップロード / GET=ブラウザの取得
 * @param key    edges/<edgeId>/grid.jpg 等（Supabase 側と同じ相対パス）
 */
export function signEdgeImageUrl(
  method: 'PUT' | 'GET',
  key: string,
  ttlSec?: number,
): string | null {
  const base   = process.env.EDGE_IMAGES_BASE_URL
  const secret = process.env.EDGE_IMAGES_SIGNING_SECRET
  if (!base || !secret) return null

  const ttl = ttlSec ?? (method === 'PUT' ? EDGE_IMAGES_PUT_TTL_SEC : EDGE_IMAGES_GET_TTL_SEC)
  const exp = Math.floor(Date.now() / 1000) + Math.max(60, ttl)
  const sig = createHmac('sha256', secret).update(canonical(method, key, exp)).digest('hex')

  // キーはパスに載せる（Worker 側で正規表現によりキー形式を限定して検証する）。
  const path = key.split('/').map(encodeURIComponent).join('/')
  return `${base.replace(/\/+$/, '')}/v1/${path}?exp=${exp}&sig=${sig}`
}

/**
 * Worker 側にオブジェクトがあるか（＝このエッジは R2 へ移行済みか）。
 *
 * 無い場合は従来の Supabase 経路へフォールバックさせたいので、302 する前に確認する。
 * 毎フレーム HEAD を打たないようウォームなインスタンス内で 60 秒メモ化する
 * （誤って古い判定を掴んでも、返るのは同じキーの最新フレームか Supabase の最新フレーム）。
 */
const existsMemo = new Map<string, { exists: boolean; at: number }>()
const MEMO_TTL_MS = 60_000

export async function workerImageExists(key: string): Promise<boolean> {
  const hit = existsMemo.get(key)
  const now = Date.now()
  if (hit && now - hit.at < MEMO_TTL_MS) return hit.exists

  let exists = false
  try {
    const url = signEdgeImageUrl('GET', key)
    if (url) {
      const res = await fetch(url, { method: 'HEAD', cache: 'no-store', signal: AbortSignal.timeout(5_000) })
      exists = res.ok
    }
  } catch {
    exists = false
  }
  existsMemo.set(key, { exists, at: now })
  return exists
}
