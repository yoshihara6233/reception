/**
 * 要望に添える画像 1 枚と、該当の画面の URL の決まり（GVMS_CLOUD_SPEC §12.2・§12.6）。
 *
 * 現場の受け口（/api/edge/feedback・/api/edge/feedback/attachment）・クラウドの画面
 * （/api/feedback と入力の画面）・ファイル取り込み（/api/admin/feedback/import）が同じ決まりを使う。
 * 画面からも読む（選んだファイルを送る前に確かめる）ので、サーバ専用のものは置かない。
 * SHA-256 は Web Crypto（ブラウザと Node の両方にある）で計算する。
 */
import { z } from 'zod'
import { redactFeedbackText } from './redact'

/** 形式（§12.6）。中身の先頭の印（マジックバイト）と一致しないものは断る */
export const ATTACHMENT_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const
export type AttachmentType = (typeof ATTACHMENT_TYPES)[number]

/** 大きさの上限（3 MiB・§12.6）。Vercel の関数の本文の上限 4.5 MB の内側 */
export const ATTACHMENT_MAX_BYTES = 3 * 1024 * 1024

/** 該当の画面の URL の上限（§12.2） */
export const PAGE_URL_MAX = 500

/** 画像を置く非公開のバケット（マイグレーション 20261006120000_feedback_attachment.sql） */
export const ATTACHMENT_BUCKET = 'feedback-attachments'

/** 受けてから消すまでの日数（§12.6「受けてから 1 年で消す」） */
export const ATTACHMENT_RETENTION_DAYS = 365

export const ATTACHMENT_TYPE_LABEL: Record<AttachmentType, string> = {
  'image/png': 'PNG', 'image/jpeg': 'JPEG', 'image/webp': 'WebP',
}

const SHA256_RE = /^[0-9a-f]{64}$/

/** 本文（§12.2）の `attachment` の宣言 */
export const AttachmentDecl = z.object({
  type: z.enum(ATTACHMENT_TYPES),
  size: z.number().int().min(1).max(ATTACHMENT_MAX_BYTES),
  sha256: z.string().regex(SHA256_RE),
})
export type AttachmentDecl = z.infer<typeof AttachmentDecl>

/**
 * 中身の先頭の印から形式を決める。3 形式のどれでもなければ null。
 *   PNG  : 89 50 4E 47 0D 0A 1A 0A
 *   JPEG : FF D8 FF
 *   WebP : "RIFF" ???? "WEBP"
 */
export function detectImageType(bytes: Uint8Array): AttachmentType | null {
  const at = (sig: number[], off = 0) => bytes.length >= off + sig.length && sig.every((b, i) => bytes[off + i] === b)
  if (at([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (at([0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (at([0x52, 0x49, 0x46, 0x46]) && at([0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp'
  return null
}

/** 中身の SHA-256（小文字 16 進 64 字） */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // Web Crypto は ArrayBuffer を求める（SharedArrayBuffer を含む型を避けるため写す）
  const buf = new Uint8Array(bytes.byteLength)
  buf.set(bytes)
  const digest = await crypto.subtle.digest('SHA-256', buf.buffer)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export type AttachmentMismatch = 'too_large' | 'size_mismatch' | 'magic_mismatch' | 'type_mismatch' | 'sha256_mismatch'

/**
 * 受けた中身が宣言と合うか（§12.6: type・大きさ・sha256・先頭の印）。
 * 合えば null、合わなければ理由。
 */
export async function checkAttachment(bytes: Uint8Array, decl: AttachmentDecl): Promise<AttachmentMismatch | null> {
  if (bytes.length > ATTACHMENT_MAX_BYTES) return 'too_large'
  if (bytes.length !== decl.size) return 'size_mismatch'
  const detected = detectImageType(bytes)
  if (!detected) return 'magic_mismatch'
  if (detected !== decl.type) return 'type_mismatch'
  if ((await sha256Hex(bytes)) !== decl.sha256) return 'sha256_mismatch'
  return null
}

/**
 * base64 の文字列を中身に戻す（ファイル取り込みの data_base64）。
 * base64 として読めない（余計な文字が混ざる・長さが合わない）ときは null。
 * 改行と空白は読み飛ばす（書き出しの道具が折り返すことがあるため）。
 */
export function decodeBase64Strict(s: string): Uint8Array | null {
  const t = s.replace(/\s+/g, '')
  if (t.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(t)) return null
  try {
    const bin = atob(t)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  } catch {
    return null
  }
}

/**
 * 該当の画面の URL を、画面の場所だけにする（§12.2）。
 *   - http(s) の URL が来たら、パスとクエリとハッシュだけにする（scheme とホスト＝拠点の IP や名前を落とす）
 *   - `/` か `#` で始まる形だけ残す。`//host` や `/\host`（ホストとして読まれる形）は捨てる
 *   - 制御文字・空白を含むもの、500 字を超えるものは捨てる
 * 形の違うものは null（呼び出し側は拒否せずに捨てる）。
 */
export function normalizePageUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  let s = raw.trim()
  if (!s) return null
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s)
      s = `${u.pathname}${u.search}${u.hash}`
    } catch {
      return null
    }
  }
  if (!(s.startsWith('/') || s.startsWith('#'))) return null
  if (/^\/[/\\]/.test(s)) return null
  if (/[\u0000- \u007f-\u009f]/.test(s)) return null
  if ([...s].length > PAGE_URL_MAX) return null
  return s
}

/**
 * 保存する形の URL: normalizePageUrl に通したうえで、本文と同じ伏せ字をかける
 * （クエリに IP アドレス・メールアドレス・電話番号・URL が入っていても残さない・§12.5-4）。
 * 伏せ字で 500 字を超えたら捨てる。
 */
export function cleanPageUrl(raw: unknown): string | null {
  const s = normalizePageUrl(raw)
  if (s === null) return null
  const r = redactFeedbackText(s)
  return [...r].length > PAGE_URL_MAX ? null : r
}

/** 受けた時刻から、消す時期を過ぎているか（§12.6「受けてから 1 年で消す」） */
export function isAttachmentExpired(receivedAt: string | null | undefined, now: Date = new Date()): boolean {
  if (!receivedAt) return false
  const t = Date.parse(receivedAt)
  if (!Number.isFinite(t)) return false
  return t < attachmentPurgeCutoff(now).getTime()
}

/** この時刻より前に受けた画像を消す */
export function attachmentPurgeCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - ATTACHMENT_RETENTION_DAYS * 24 * 60 * 60 * 1000)
}

/** 画面の表示（例 1.2 MB・340 KB）。MB は 1,048,576 バイト */
export function fmtBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toLocaleString('ja-JP', { maximumFractionDigits: 1 })} MB`
  return `${Math.max(1, Math.round(n / 1024)).toLocaleString('ja-JP')} KB`
}
