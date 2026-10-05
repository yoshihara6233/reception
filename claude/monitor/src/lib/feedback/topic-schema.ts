/**
 * 話題（feedback_topics）の項目の検証。作る（POST）と変える（PATCH）で共通。
 */
import { z } from 'zod'
import { FEEDBACK_STATUSES, fixedVersionSchema, replySchema } from './schema'

const optText = (max: number) => z.string()
  .transform((s) => s.trim())
  .refine((s) => s.length <= max, 'too_long')
  .transform((s) => (s.length ? s : null))
  .nullable()
  .optional()

export const TopicFields = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: optText(4000),
  status: z.enum(FEEDBACK_STATUSES).optional(),
  reply: replySchema.optional(),
  fixed_version: fixedVersionSchema.optional(),
  // WBS の番号（例 D-2-21）
  wbs_ref: z.string().trim().max(32).regex(/^[A-Za-z0-9.-]*$/, 'wbs_format')
    .transform((s) => (s.length ? s : null)).nullable().optional(),
  // GitHub の課題の URL。https のものだけ（画面でリンクにするため javascript: 等を入れさせない）
  issue_url: z.string().trim().max(500)
    .refine((s) => s === '' || /^https:\/\/[^\s<>"']+$/.test(s), 'issue_url_format')
    .transform((s) => (s.length ? s : null)).nullable().optional(),
  // 運営の内部メモ（テナントへは出さない）
  internal_note: optText(4000),
})
export type TopicFields = z.infer<typeof TopicFields>
