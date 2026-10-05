/**
 * 要望ボード（運営管理・super_admin）の絞り込みと CSV。
 *
 * 画面（/admin/feedback）と CSV の書き出し（/api/admin/feedback?format=csv）が
 * 同じ絞り込みを使う（画面で見えているものと CSV の中身をずらさない）。
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  FEEDBACK_KINDS, FEEDBACK_SOURCES, FEEDBACK_STATUSES,
  KIND_LABEL, SOURCE_LABEL, STATUS_LABEL, URGENCY_LABEL,
  type FeedbackContext, type FeedbackKind, type FeedbackSource, type FeedbackStatus, type FeedbackUrgency,
} from './schema'

export const BOARD_VIEWS = ['new', 'unsorted', 'topics', 'all'] as const
export type BoardView = (typeof BOARD_VIEWS)[number]

export interface BoardFilters {
  view: BoardView
  tenant: string | null
  store: string | null
  kind: FeedbackKind | null
  status: FeedbackStatus | null
  source: FeedbackSource | null
  topic: string | null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const pick = <T extends string>(v: string | null | undefined, list: readonly T[]): T | null =>
  v && (list as readonly string[]).includes(v) ? (v as T) : null
const uuid = (v: string | null | undefined) => (v && UUID_RE.test(v) ? v : null)

/** URL の検索条件から絞り込みを読む（知らない値は無視する）。 */
export function parseBoardFilters(get: (k: string) => string | null | undefined): BoardFilters {
  return {
    view: pick(get('view'), BOARD_VIEWS) ?? 'new',
    tenant: uuid(get('tenant')),
    store: uuid(get('store')),
    kind: pick(get('kind'), FEEDBACK_KINDS),
    status: pick(get('status'), FEEDBACK_STATUSES),
    source: pick(get('source'), FEEDBACK_SOURCES),
    topic: uuid(get('topic')),
  }
}

export interface BoardItem {
  id: string
  tenant_id: string
  store_id: string | null
  edge_id: string | null
  source: FeedbackSource
  local_id: string | null
  kind: FeedbackKind
  urgency: FeedbackUrgency
  body: string
  contact_ok: boolean
  role: string | null
  context: FeedbackContext | null
  topic_id: string | null
  status: FeedbackStatus
  reply: string | null
  fixed_version: string | null
  submitted_at: string | null
  created_at: string
  updated_at: string
  /** 該当の画面の場所（§12.2） */
  page_url: string | null
  /** 画像の宣言（§12.6）。中身を受けたかは attachment_path で見る */
  attachment_type: string | null
  attachment_size: number | null
  attachment_path: string | null
  attachment_received_at: string | null
  attachment_purged_at: string | null
}

export const BOARD_ITEM_COLUMNS =
  'id, tenant_id, store_id, edge_id, source, local_id, kind, urgency, body, contact_ok, role, context, topic_id, status, reply, fixed_version, submitted_at, created_at, updated_at, page_url, attachment_type, attachment_size, attachment_path, attachment_received_at, attachment_purged_at'

export type AttachmentState = 'none' | 'stored' | 'pending' | 'purged'

/** 画像の状態: なし・あり・宣言だけ（拠点からまだ届いていない）・保存期間を過ぎて消した */
export function attachmentState(it: Pick<BoardItem, 'attachment_type' | 'attachment_path' | 'attachment_purged_at'>): AttachmentState {
  if (it.attachment_path) return 'stored'
  if (it.attachment_purged_at) return 'purged'
  if (it.attachment_type) return 'pending'
  return 'none'
}

export const ATTACHMENT_STATE_LABEL: Record<AttachmentState, string> = {
  none: 'なし', stored: 'あり', pending: '未着', purged: '消去済み（保存期間 1 年）',
}

export const BOARD_LIMIT = 1000

/**
 * 絞り込んだ要望（新しい順）。
 *   new      = 受け付けたまま（received）
 *   unsorted = 話題に束ねていない
 *   topics   = 話題ごとの見方（要望は話題に束ねたものすべて。topic を指定すればその話題だけ）
 *   all      = 全部
 */
export async function loadBoardItems(svc: SupabaseClient, f: BoardFilters, limit = BOARD_LIMIT): Promise<{ items: BoardItem[]; error: boolean }> {
  let q = svc.from('feedback_items').select(BOARD_ITEM_COLUMNS)
  if (f.view === 'new') q = q.eq('status', 'received')
  if (f.view === 'unsorted') q = q.is('topic_id', null)
  if (f.view === 'topics') q = q.not('topic_id', 'is', null)
  if (f.topic) q = q.eq('topic_id', f.topic)
  if (f.tenant) q = q.eq('tenant_id', f.tenant)
  if (f.store) q = q.eq('store_id', f.store)
  if (f.kind) q = q.eq('kind', f.kind)
  if (f.status) q = q.eq('status', f.status)
  if (f.source) q = q.eq('source', f.source)
  const { data, error } = await q.order('created_at', { ascending: false }).limit(limit)
  return { items: (data ?? []) as BoardItem[], error: !!error }
}

// ── CSV ────────────────────────────────────────────────────────────────

/**
 * 表計算ソフトで開いたときに式として解釈されないよう、先頭が = + - @ のセルは ' を前置する
 * （CSV インジェクション対策。本文は現場の管理者が書いた自由文）。
 */
function cell(v: unknown): string {
  let s = v == null ? '' : String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function fmtJst(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

export interface CsvNames {
  tenant: (id: string) => string
  store: (id: string | null) => string
  topic: (id: string | null) => string
}

const CSV_HEADER = [
  '受付日時', '種類', '困っている度合い', '状態', '出どころ', 'テナント', '拠点', '本文', '返事', '対応した版',
  '話題', '連絡してよいか', '画面', '版', 'ブラウザ', 'OS', '画面の幅', 'エラー', 'カメラ', 'ID',
  '該当の画面の URL', '画像あり',
]

/** 要望を CSV（UTF-8・BOM 付き・Excel で文字化けしない形）にする。 */
export function boardCsv(items: BoardItem[], names: CsvNames): string {
  const lines = [CSV_HEADER.map(cell).join(',')]
  for (const it of items) {
    const c = it.context ?? {}
    const cam = c.camera ? [c.camera.vendor, c.camera.model, c.camera.firmware].filter(Boolean).join(' ') : ''
    lines.push([
      fmtJst(it.created_at), KIND_LABEL[it.kind] ?? it.kind, URGENCY_LABEL[it.urgency] ?? it.urgency,
      STATUS_LABEL[it.status] ?? it.status, SOURCE_LABEL[it.source] ?? it.source,
      names.tenant(it.tenant_id), names.store(it.store_id), it.body, it.reply ?? '', it.fixed_version ?? '',
      names.topic(it.topic_id), it.contact_ok ? 'はい' : 'いいえ',
      c.screen ?? '', c.agent_version ?? '', c.browser ?? '', c.os ?? '', c.viewport ?? '', c.error_code ?? '', cam, it.id,
      it.page_url ?? '', ATTACHMENT_STATE_LABEL[attachmentState(it)],
    ].map(cell).join(','))
  }
  return '﻿' + lines.join('\r\n') + '\r\n'
}
