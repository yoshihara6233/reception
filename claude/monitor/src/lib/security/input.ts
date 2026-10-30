/**
 * 受け口に届いた値を、使う前に確かめる道具（自主診断 ASVS 1.2.4・1.3.3・5.2.2・5.3.2・2.2.1）。
 *
 * どれも「送り手は認証済みだが、値そのものは信じない」ためのもの。送り手（エッジ・キオスク・
 * 管理者の画面）が壊れていても、乗っ取られていても、決めた形の外の値で保存先や絞り込みを
 * 動かせないようにする。
 */
import { detectImageType, type AttachmentType } from '@/lib/feedback/image'

/**
 * PostgREST の `.or()` に入れる検索語から、絞り込みの書式に使われる記号を外す（ASVS 1.2.4）。
 *
 * `.or(\`display_name.ilike.%${q}%\`)` に `,` や `(` を含む語をそのまま入れると、条件を足せる
 * 。テナントの絞り込みは別の引数で AND されるので自テナントの外には
 * 出ないが、意図しない条件で一覧を引ける。書式の記号（`,` `(` `)` `"` `\` `:`）と PostgREST の
 * ワイルドカード `*` を空白に置き換え、長さを 100 字までにする。`%` と `_` は残す
 * （一致が広がるだけで条件は足せない）。空になったら null（検索しない）。
 */
export function postgrestSearchTerm(q: string | null | undefined): string | null {
  if (!q) return null
  const v = q.replace(/[,()"\\:*]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100)
  return v.length > 0 ? v : null
}

/**
 * Storage の経路の 1 区切りに使ってよい値か（英数字・`_`・`-` の 1〜64 字）。
 * `..`・`/`・`\`・制御文字を含む値で保存先を外へ向けられないようにする（ASVS 1.3.3・5.3.2）。
 */
export function isSafePathSegment(s: string | null | undefined): s is string {
  return typeof s === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(s)
}

/**
 * キオスクの写真の経路が、その店舗の face-auth・kiosk/photo が作った形そのものか（ASVS 1.3.3）。
 *   `<storeId>/<YYYYMMDD>/<uuid>.<jpg|png|webp>`（顔）
 *   `<storeId>/<YYYYMMDD>/card-<uuid>.<jpg|png|webp>`（名刺）
 * 以前は先頭が `<storeId>/` かだけを見ていたので、`<storeId>/../<他店舗>/…` を通した。
 */
export function isKioskPhotoPath(path: string | null | undefined, storeId: string): boolean {
  if (!path) return false
  const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
  const re = new RegExp(`^${storeId.replace(/[^0-9a-f-]/gi, '')}/\\d{8}/(?:card-)?${uuid}\\.(?:jpg|png|webp)$`, 'i')
  return re.test(path)
}

/**
 * ZIP の中の名前の 1 区切り。区切り文字と制御文字に加え、`.` だけからなる名前（`..` など）も
 * 置き換える。店舗名やカメラ名が `..` だと、古い展開ツールが展開先の外へ書くおそれがある（ASVS 5.3.2）。
 */
export function safeZipSegment(s: string | null | undefined, fallback: string): string {
  const v = (s ?? fallback).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim()
  if (v.length === 0 || /^\.+$/.test(v)) return fallback
  return v
}

export type DecodedImage = { buf: Buffer; mime: AttachmentType; ext: 'jpg' | 'png' | 'webp' }

/**
 * `data:image/<形式>;base64,<中身>` を読み、**中身の先頭の印が宣言した形式と一致するときだけ**返す
 * （ASVS 5.2.2）。以前は宣言だけを信じていたので、画像でないものを image/jpeg として保存できた。
 * `allowed` で受ける形式を絞る（顔の照合に渡すものは JPEG と PNG だけ）。
 */
export function decodeImageDataUrl(
  dataUrl: string,
  allowed: readonly AttachmentType[] = ['image/jpeg', 'image/png', 'image/webp'],
): DecodedImage | null {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl)
  if (!m) return null
  const declared = m[1] as AttachmentType
  if (!allowed.includes(declared)) return null
  let buf: Buffer
  try { buf = Buffer.from(m[2], 'base64') } catch { return null }
  if (buf.length === 0 || detectImageType(buf) !== declared) return null
  const ext = declared === 'image/jpeg' ? 'jpg' : declared === 'image/png' ? 'png' : 'webp'
  return { buf, mime: declared, ext }
}

/** 中身の先頭の印から画像の形式を決める（宣言は見ない）。3 形式のどれでもなければ null */
export function sniffImage(bytes: Uint8Array): AttachmentType | null {
  return detectImageType(bytes)
}

/**
 * 上流の住所として受けてよい形か（管理の画面で入れるカメラの HLS の URL・レコーダのライブや VOD のホスト・ASVS 2.2.1）。
 *   - `http(s)://ホスト[:番号][/経路]`（利用者名とパスワードを URL に含めない）
 *   - `allowBareHost` のときは `ホスト[:番号]`（LAN の Frigate など・スキームなし）も
 * 300 字まで。空白・制御文字・それ以外のスキーム（javascript: file: など）は断る。
 * 宛先そのものの許可（どのホストへ鍵を送ってよいか）は lib/proxy/upstream.ts が別に見る。
 */
export function isUpstreamAddress(raw: string, opts: { allowBareHost?: boolean } = {}): boolean {
  const s = raw.trim()
  if (s.length === 0 || s.length > 300 || /[\s\x00-\x1F\x7F]/.test(s)) return false
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s)
      return (u.protocol === 'http:' || u.protocol === 'https:') && !!u.hostname && !u.username && !u.password
    } catch {
      return false
    }
  }
  return !!opts.allowBareHost && /^[A-Za-z0-9.-]+(:\d{1,5})?$/.test(s)
}
