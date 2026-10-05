/**
 * 要望の収集（GVMS_CLOUD_SPEC §12・基本設計 §3）の値の決まりと検証。
 *
 * 現場の受け口（/api/edge/feedback）・クラウドの画面（/api/feedback）・
 * ファイル取り込み（/api/admin/feedback/import）が同じ決まりを使う。
 * クライアントからも読む（ラベルと上限）ので、サーバ専用のものは置かない。
 */
import { z } from 'zod'

export const FEEDBACK_KINDS = ['request', 'bug', 'question', 'other'] as const
export const FEEDBACK_URGENCIES = ['blocking', 'inconvenient', 'nice_to_have'] as const
export const FEEDBACK_STATUSES = ['received', 'reviewing', 'planned', 'done', 'declined', 'answered'] as const
export const FEEDBACK_SOURCES = ['gvms', 'cloud', 'import'] as const

export type FeedbackKind = (typeof FEEDBACK_KINDS)[number]
export type FeedbackUrgency = (typeof FEEDBACK_URGENCIES)[number]
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number]
export type FeedbackSource = (typeof FEEDBACK_SOURCES)[number]

export const KIND_LABEL: Record<FeedbackKind, string> = {
  request: '要望', bug: '不具合', question: '質問', other: 'その他',
}
export const URGENCY_LABEL: Record<FeedbackUrgency, string> = {
  blocking: '業務が止まる', inconvenient: '不便', nice_to_have: 'あると良い',
}
/** 現場・テナントの画面に出す状態の表示（基本設計 §3.6） */
export const STATUS_LABEL: Record<FeedbackStatus, string> = {
  received: '受け付けました',
  reviewing: '検討中',
  planned: '対応予定',
  done: '対応しました',
  declined: '今回は見送ります',
  answered: '回答しました',
}
export const SOURCE_LABEL: Record<FeedbackSource, string> = {
  gvms: 'G・VMS', cloud: 'クラウド', import: 'ファイル',
}

/** 本文・返事の上限（字数はコードポイントで数える） */
export const BODY_MAX = 1000
export const REPLY_MAX = 1000
/** context は既知の項目だけ・全体で 4 KB まで（§12.2） */
export const CONTEXT_MAX_BYTES = 4096
/** 1 拠点 1 日の上限（§12.2） */
export const EDGE_DAILY_LIMIT = 50
/** クラウドの画面: 1 利用者 1 日の上限 */
export const USER_DAILY_LIMIT = 20
/** 受け口の本文の大きさの上限（本文 1,000 字 × UTF-8 + context 4 KB に余裕を見た値） */
export const REQUEST_MAX_BYTES = 16 * 1024

/** 字数（サロゲートペアを 1 字と数える）。 */
export function charCount(s: string): number {
  return [...s].length
}

const bodySchema = z.string()
  .refine((s) => s.trim().length > 0, 'body_empty')
  .refine((s) => charCount(s) <= BODY_MAX, 'body_too_long')

/**
 * 現場（G・VMS）から来る 1 件（§12.2）。ファイル取り込みの items[] も同じ形。
 * context は形を問わず受け、sanitizeContext で既知の項目だけに絞る（知らない項目は捨てる・拒否しない）。
 */
export const EdgeFeedbackBody = z.object({
  local_id: z.string().uuid(),
  kind: z.enum(FEEDBACK_KINDS),
  urgency: z.enum(FEEDBACK_URGENCIES),
  body: bodySchema,
  contact_ok: z.boolean().optional().default(false),
  role: z.string().max(32),
  submitted_at: z.string().max(64).optional().nullable(),
  context: z.unknown().optional(),
})
export type EdgeFeedbackBody = z.infer<typeof EdgeFeedbackBody>

/** クラウドの画面（テナント管理者）から来る 1 件 */
export const CloudFeedbackBody = z.object({
  kind: z.enum(FEEDBACK_KINDS),
  urgency: z.enum(FEEDBACK_URGENCIES),
  body: bodySchema,
  contact_ok: z.boolean().optional().default(false),
  context: z.unknown().optional(),
})
export type CloudFeedbackBody = z.infer<typeof CloudFeedbackBody>

/** 自動で添える項目（§12.2 の context）。これ以外は捨てる。 */
export interface FeedbackContext {
  screen?: string
  agent_version?: string
  browser?: string
  os?: string
  viewport?: string
  error_code?: string
  camera?: { vendor?: string; model?: string; firmware?: string }
}

const CONTEXT_STR_KEYS = ['screen', 'agent_version', 'browser', 'os', 'viewport', 'error_code'] as const
const CAMERA_KEYS = ['vendor', 'model', 'firmware'] as const
/** 1 項目の長さの上限（既知の項目はどれも短い。長いものは切る） */
const CONTEXT_STR_MAX = 128

function cleanStr(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  // 制御文字を落とし、長すぎるものは切る。空は持たない。
  const s = v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, CONTEXT_STR_MAX)
  return s.length ? s : undefined
}

/**
 * context を既知の項目だけに絞る（§12.2）。知らない項目は捨て、拒否はしない。
 * 4 KB を超えたら（既知の項目だけでは起きない大きさだが）空にする。
 */
export function sanitizeContext(raw: unknown): FeedbackContext {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const src = raw as Record<string, unknown>
  const out: FeedbackContext = {}
  for (const k of CONTEXT_STR_KEYS) {
    const v = cleanStr(src[k])
    if (v !== undefined) out[k] = v
  }
  const cam = src.camera
  if (cam && typeof cam === 'object' && !Array.isArray(cam)) {
    const c: NonNullable<FeedbackContext['camera']> = {}
    for (const k of CAMERA_KEYS) {
      const v = cleanStr((cam as Record<string, unknown>)[k])
      if (v !== undefined) c[k] = v
    }
    if (Object.keys(c).length) out.camera = c
  }
  if (new TextEncoder().encode(JSON.stringify(out)).length > CONTEXT_MAX_BYTES) return {}
  return out
}

/** RFC3339 の日時として読めれば ISO 文字列、読めなければ null。 */
export function parseTimestamp(s: string | null | undefined): string | null {
  if (!s) return null
  const t = Date.parse(s)
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

/** 日本時間の今日 0:00（UTC の ISO 文字列）。「1 日 N 件」はこの時刻からの件数で数える。 */
export function jstDayStartIso(now: Date = new Date()): string {
  const JST_MS = 9 * 60 * 60 * 1000
  const jst = new Date(now.getTime() + JST_MS)
  const startJst = Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate())
  return new Date(startJst - JST_MS).toISOString()
}

/** 返事・状態の変更の検証（要望 1 件・話題で共通）。declined は返事が必須（§3.6）。 */
export function declinedNeedsReply(status: string | undefined | null, reply: string | null | undefined): boolean {
  return status === 'declined' && !(reply && reply.trim().length > 0)
}

/** 返事（運営が書く）。空文字は「返事なし」（null）にする。 */
export const replySchema = z.string()
  .transform((s) => s.trim())
  .refine((s) => charCount(s) <= REPLY_MAX, 'reply_too_long')
  .transform((s) => (s.length ? s : null))
  .nullable()

/** 対応した版（例 0.1.104・nvmsd/0.1.104）。空文字は null。 */
export const fixedVersionSchema = z.string()
  .transform((s) => s.trim())
  .refine((s) => s.length <= 64 && !/[\s<>"']/.test(s), 'fixed_version_format')
  .transform((s) => (s.length ? s : null))
  .nullable()
