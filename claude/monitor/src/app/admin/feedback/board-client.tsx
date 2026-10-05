'use client'

/**
 * 要望ボードの操作（super_admin）。読み込みと絞り込みはサーバ（page.tsx）、
 * ここは見方の切り替え・束ねる・状態と返事の変更・話題の編集・ファイルの取り込みを担う。
 * 本文・返事・内部メモはすべて文として出す（HTML として解釈しない）。
 */
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Download, Upload } from 'lucide-react'
import type { BoardFilters, BoardItem, BoardView } from '@/lib/feedback/board'
import { attachmentState, fmtJst } from '@/lib/feedback/board'
import {
  FEEDBACK_KINDS, FEEDBACK_SOURCES, FEEDBACK_STATUSES, KIND_LABEL, REPLY_MAX, SOURCE_LABEL, STATUS_LABEL, URGENCY_LABEL,
  charCount, type FeedbackStatus,
} from '@/lib/feedback/schema'
import { FeedbackStatusBadge } from '@/components/feedback/FeedbackStatusBadge'
import { FeedbackAttachment } from '@/components/feedback/FeedbackAttachment'
import { chunkImportItems } from '@/lib/feedback/import-chunks'

export interface TopicVM {
  id: string
  title: string
  description: string | null
  status: FeedbackStatus
  reply: string | null
  fixed_version: string | null
  wbs_ref: string | null
  issue_url: string | null
  internal_note: string | null
  created_at: string
  updated_at: string
  itemCount: number
  placeCount: number
  blockingCount: number
}

interface Named { id: string; name: string }
interface StoreRow extends Named { tenant_id: string }

const VIEWS: { v: BoardView; label: string }[] = [
  { v: 'new', label: '新着' },
  { v: 'unsorted', label: '未分類' },
  { v: 'topics', label: '話題ごと' },
  { v: 'all', label: 'すべて' },
]

const ERR: Record<string, string> = {
  reply_required: '見送りにするときは返事（理由）を書いてください。',
  topic_not_found: '話題が見つかりません。画面を読み直してください。',
  invalid_body: '入力の形が正しくありません。',
  unknown_format: 'ファイルの形式が違います（gvms-feedback-export/1 の JSON を選んでください）。',
  store_tenant_mismatch: '拠点が選んだテナントに属していません。',
  forbidden: '権限がありません。',
}
/** 取り込みで捨てた画像の理由（/api/admin/feedback/import の attachments.dropped） */
const DROP_REASON: Record<string, string> = {
  attachment_invalid: '画像の宣言の形が違う',
  attachment_base64: 'base64 として読めない',
  attachment_too_large: '3 MB を超えている',
  attachment_size_mismatch: '大きさが宣言と違う',
  attachment_magic_mismatch: 'PNG・JPEG・WebP でない',
  attachment_type_mismatch: '形式が宣言と違う',
  attachment_sha256_mismatch: 'sha256 が宣言と違う',
  attachment_store_failed: '置き場に保存できなかった',
}

const errText = (code: unknown, status: number) =>
  (typeof code === 'string' && ERR[code]) || `処理できませんでした（${status}）。`

const fmtNum = (n: number) => n.toLocaleString('ja-JP')

const input = 'rounded border border-ge-line-2 bg-white px-2 py-1 text-xs text-ge-ink dark:border-gedline dark:bg-gedbg dark:text-gedink'
const btn = 'inline-flex items-center gap-1 rounded px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50'
const btnPrimary = `${btn} bg-ge-accent text-white hover:bg-ge-ink-2 dark:bg-gedaccent dark:text-gedbg`
const btnSecondary = `${btn} border border-ge-line bg-white text-ge-ink-2 hover:bg-ge-paper-2 dark:border-gedline dark:bg-gedbg3 dark:text-gedink`
const card = 'rounded-md border border-ge-line bg-white dark:border-gedline dark:bg-gedbg2'
const muted = 'text-ge-ink-3 dark:text-gedink3'

async function send(url: string, method: string, body: unknown): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  const res = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  return { ok: res.ok, status: res.status, json }
}

export function BoardClient({
  filters, items, loadError, topics, tenants, stores,
}: {
  filters: BoardFilters
  items: BoardItem[]
  loadError: boolean
  topics: TopicVM[]
  tenants: Named[]
  stores: StoreRow[]
}) {
  const router = useRouter()
  const tenantName = useMemo(() => new Map(tenants.map((t) => [t.id, t.name])), [tenants])
  const storeName = useMemo(() => new Map(stores.map((s) => [s.id, s.name])), [stores])
  const topicTitle = useMemo(() => new Map(topics.map((t) => [t.id, t.title])), [topics])

  const query = (patch: Partial<Record<keyof BoardFilters, string | null>>) => {
    const p = new URLSearchParams()
    const merged: Record<string, string | null> = { ...(filters as unknown as Record<string, string | null>), ...patch }
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v)
    return p.toString()
  }
  const csvHref = `/api/admin/feedback?${query({})}&format=csv`

  // ── 選んだ要望を束ねる ─────────────────────────────────────────
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bundleTopic, setBundleTopic] = useState('')
  const [newTitle, setNewTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  async function bundleInto(topicId: string) {
    setBusy(true); setErr(null); setMsg(null)
    let done = 0
    for (const id of selected) {
      const r = await send(`/api/admin/feedback/items/${id}`, 'PATCH', { topic_id: topicId })
      if (!r.ok) { setErr(errText(r.json.error, r.status)); break }
      done += 1
    }
    setBusy(false)
    if (done) { setMsg(`${fmtNum(done)} 件を「${topicTitle.get(topicId) ?? '話題'}」に束ねました。`); setSelected(new Set()); router.refresh() }
  }

  async function createTopic(title: string, itemIds: string[]) {
    setBusy(true); setErr(null); setMsg(null)
    const r = await send('/api/admin/feedback/topics', 'POST', { title, item_ids: itemIds })
    setBusy(false)
    if (!r.ok) { setErr(errText(r.json.error, r.status)); return }
    setMsg(itemIds.length ? `話題「${title}」を作り、${fmtNum(itemIds.length)} 件を束ねました。` : `話題「${title}」を作りました。`)
    setNewTitle(''); setSelected(new Set()); router.refresh()
  }

  const storesOfTenant = filters.tenant ? stores.filter((s) => s.tenant_id === filters.tenant) : stores

  return (
    <div className="space-y-4 text-xs text-ge-ink dark:text-gedink">
      {/* 見方 */}
      <nav aria-label="要望ボードの見方" className="flex flex-wrap gap-1 border-b border-ge-line dark:border-gedline">
        {VIEWS.map(({ v, label }) => {
          const active = filters.view === v
          return (
            <Link
              key={v}
              href={`/admin/feedback?${query({ view: v, topic: null })}`}
              className={
                '-mb-px border-b-2 px-3 py-1.5 ' +
                (active ? 'border-ge-ink font-bold text-ge-ink dark:border-gedink dark:text-gedink' : `border-transparent ${muted} hover:text-ge-ink`)
              }
            >
              {label}
            </Link>
          )
        })}
      </nav>

      {/* 絞り込み（サーバで絞る。CSV も同じ条件） */}
      <form method="get" action="/admin/feedback" className={`${card} flex flex-wrap items-end gap-3 p-3`}>
        <input type="hidden" name="view" value={filters.view} />
        {filters.topic && <input type="hidden" name="topic" value={filters.topic} />}
        <label className="block">
          <span className={`mb-1 block ${muted}`}>テナント</span>
          <select name="tenant" defaultValue={filters.tenant ?? ''} className={input}>
            <option value="">すべて</option>
            {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label className="block">
          <span className={`mb-1 block ${muted}`}>拠点</span>
          <select name="store" defaultValue={filters.store ?? ''} className={`${input} max-w-[14rem]`}>
            <option value="">すべて</option>
            {storesOfTenant.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label className="block">
          <span className={`mb-1 block ${muted}`}>種類</span>
          <select name="kind" defaultValue={filters.kind ?? ''} className={input}>
            <option value="">すべて</option>
            {FEEDBACK_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
        </label>
        <label className="block">
          <span className={`mb-1 block ${muted}`}>状態</span>
          <select name="status" defaultValue={filters.status ?? ''} className={input}>
            <option value="">すべて</option>
            {FEEDBACK_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </label>
        <label className="block">
          <span className={`mb-1 block ${muted}`}>出どころ</span>
          <select name="source" defaultValue={filters.source ?? ''} className={input}>
            <option value="">すべて</option>
            {FEEDBACK_SOURCES.map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}
          </select>
        </label>
        <button type="submit" className={btnSecondary}>絞り込む</button>
        <Link href={`/admin/feedback?view=${filters.view}`} className={`${muted} underline`}>条件を外す</Link>
        <a href={csvHref} className={`${btnSecondary} ml-auto`}>
          <Download size={14} strokeWidth={1.5} aria-hidden /> CSV 書き出し
        </a>
      </form>

      {(msg || err) && (
        <p role="status" className={err ? 'text-ge-danger' : 'text-ge-success'}>{err ?? msg}</p>
      )}

      {filters.view === 'topics' && !filters.topic && (
        <TopicsPanel topics={topics} busy={busy} onCreate={(t) => createTopic(t, [])} />
      )}
      {filters.topic && (
        <div className="flex items-center gap-3">
          <span className="font-bold">話題: {topicTitle.get(filters.topic) ?? '(不明)'}</span>
          <Link href={`/admin/feedback?${query({ topic: null })}`} className={`${muted} underline`}>話題の一覧へ戻る</Link>
        </div>
      )}

      {/* 選んだ要望を束ねる */}
      {selected.size > 0 && (
        <div className={`${card} flex flex-wrap items-center gap-2 p-3`}>
          <span className="font-bold">{fmtNum(selected.size)} 件を選択中</span>
          <select value={bundleTopic} onChange={(e) => setBundleTopic(e.target.value)} className={`${input} max-w-[18rem]`}>
            <option value="">束ねる話題を選ぶ</option>
            {topics.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select>
          <button type="button" className={btnPrimary} disabled={busy || !bundleTopic} onClick={() => bundleInto(bundleTopic)}>
            話題に束ねる
          </button>
          <span className={muted}>または</span>
          <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="新しい話題の題" className={`${input} w-56`} maxLength={200} />
          <button type="button" className={btnSecondary} disabled={busy || !newTitle.trim()} onClick={() => createTopic(newTitle.trim(), [...selected])}>
            話題を作って束ねる
          </button>
          <button type="button" className={`${muted} underline`} onClick={() => setSelected(new Set())}>選択を外す</button>
        </div>
      )}

      {/* 要望の一覧 */}
      {(filters.view !== 'topics' || filters.topic) && (
        loadError ? (
          <p className="text-ge-danger">一覧を読めませんでした。</p>
        ) : items.length === 0 ? (
          <div className={`${card} py-10 text-center text-sm ${muted}`}>該当する要望はありません</div>
        ) : (
          <>
            <p className={muted}>{fmtNum(items.length)} 件（新しい順・最大 1,000 件）</p>
            <ul className="space-y-2">
              {items.map((it) => (
                <ItemRow
                  key={it.id}
                  item={it}
                  checked={selected.has(it.id)}
                  onToggle={() => toggle(it.id)}
                  tenant={tenantName.get(it.tenant_id) ?? '(テナント不明)'}
                  store={it.store_id ? storeName.get(it.store_id) ?? '(拠点不明)' : null}
                  topicTitle={it.topic_id ? topicTitle.get(it.topic_id) ?? '(話題)' : null}
                  topics={topics}
                  onSaved={() => router.refresh()}
                />
              ))}
            </ul>
          </>
        )
      )}

      <ImportPanel tenants={tenants} stores={stores} onImported={() => router.refresh()} />
    </div>
  )
}

// ── 要望 1 件 ─────────────────────────────────────────────────────────

function ItemRow({
  item, checked, onToggle, tenant, store, topicTitle, topics, onSaved,
}: {
  item: BoardItem
  checked: boolean
  onToggle: () => void
  tenant: string
  store: string | null
  topicTitle: string | null
  topics: TopicVM[]
  onSaved: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [status, setStatus] = useState<FeedbackStatus>(item.status)
  const [reply, setReply] = useState(item.reply ?? '')
  const [fixed, setFixed] = useState(item.fixed_version ?? '')
  const [topicId, setTopicId] = useState(item.topic_id ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const ctx = item.context ?? {}

  async function save() {
    if (status === 'declined' && !reply.trim()) { setErr(ERR.reply_required); return }
    setBusy(true); setErr(null)
    const body: Record<string, unknown> = {}
    if (status !== item.status) body.status = status
    if (reply !== (item.reply ?? '')) body.reply = reply
    if (fixed !== (item.fixed_version ?? '')) body.fixed_version = fixed
    if (topicId !== (item.topic_id ?? '')) body.topic_id = topicId || null
    if (Object.keys(body).length === 0) { setBusy(false); setEditing(false); return }
    const r = await send(`/api/admin/feedback/items/${item.id}`, 'PATCH', body)
    setBusy(false)
    if (!r.ok) { setErr(errText(r.json.error, r.status)); return }
    setEditing(false)
    onSaved()
  }

  return (
    <li className={`${card} p-3`}>
      <div className="flex items-start gap-3">
        <input type="checkbox" checked={checked} onChange={onToggle} aria-label="この要望を選ぶ" className="mt-0.5 h-3.5 w-3.5 accent-ge-accent" />
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <FeedbackStatusBadge status={item.status} />
            <span className="font-medium">{KIND_LABEL[item.kind] ?? item.kind}</span>
            <span className={item.urgency === 'blocking' ? 'font-bold text-ge-danger' : muted}>{URGENCY_LABEL[item.urgency] ?? item.urgency}</span>
            <span>{tenant}{store ? ` / ${store}` : ''}</span>
            <span className={muted}>{SOURCE_LABEL[item.source] ?? item.source}{item.contact_ok ? '・連絡可' : ''}</span>
            {topicTitle && <span className={muted}>話題: {topicTitle}</span>}
            <span className={`ml-auto font-ge-mono tabular-nums ${muted}`}>{fmtJst(item.created_at)}</span>
          </div>
          <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed">{item.body}</p>
          <FeedbackAttachment pageUrl={item.page_url} state={attachmentState(item)} imageHref={`/api/admin/feedback/items/${item.id}/attachment`} />
          {(item.reply || item.fixed_version) && !editing && (
            <p className={`mt-1.5 whitespace-pre-wrap break-words ${muted}`}>
              返事: {item.reply ?? '—'}{item.fixed_version ? `（対応した版 ${item.fixed_version}）` : ''}
            </p>
          )}
          {Object.keys(ctx).length > 0 && (
            <details className="mt-1.5">
              <summary className={`cursor-pointer ${muted}`}>自動で添えた項目</summary>
              <dl className="mt-1 grid grid-cols-[7rem_1fr] gap-x-3 gap-y-0.5 font-ge-mono text-[11px]">
                {ctx.screen && <><dt className={muted}>画面</dt><dd className="break-all">{ctx.screen}</dd></>}
                {ctx.agent_version && <><dt className={muted}>版</dt><dd>{ctx.agent_version}</dd></>}
                {ctx.browser && <><dt className={muted}>ブラウザ</dt><dd>{ctx.browser}</dd></>}
                {ctx.os && <><dt className={muted}>OS</dt><dd>{ctx.os}</dd></>}
                {ctx.viewport && <><dt className={muted}>画面の幅</dt><dd>{ctx.viewport}</dd></>}
                {ctx.error_code && <><dt className={muted}>エラー</dt><dd>{ctx.error_code}</dd></>}
                {ctx.camera && <><dt className={muted}>カメラ</dt><dd>{[ctx.camera.vendor, ctx.camera.model, ctx.camera.firmware].filter(Boolean).join(' ')}</dd></>}
              </dl>
            </details>
          )}

          {editing ? (
            <div className="mt-3 space-y-2 border-t border-ge-line pt-3 dark:border-gedline">
              <div className="flex flex-wrap gap-3">
                <label className="block">
                  <span className={`mb-1 block ${muted}`}>状態</span>
                  <select value={status} onChange={(e) => setStatus(e.target.value as FeedbackStatus)} className={input}>
                    {FEEDBACK_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className={`mb-1 block ${muted}`}>対応した版</span>
                  <input value={fixed} onChange={(e) => setFixed(e.target.value)} placeholder="例 0.1.104" maxLength={64} className={`${input} w-32 font-ge-mono`} />
                </label>
                <label className="block">
                  <span className={`mb-1 block ${muted}`}>束ねる話題（変えると話題の状態を受け継ぎます）</span>
                  <select value={topicId} onChange={(e) => setTopicId(e.target.value)} className={`${input} max-w-[18rem]`}>
                    <option value="">（束ねない）</option>
                    {topics.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
                  </select>
                </label>
              </div>
              <label className="block">
                <span className={`mb-1 flex justify-between ${muted}`}>
                  <span>返事（現場とテナントの画面に文として出ます{status === 'declined' ? '・見送りは必須' : ''}）</span>
                  <span className="font-ge-mono tabular-nums">{fmtNum(charCount(reply))} / {fmtNum(REPLY_MAX)} 字</span>
                </span>
                <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={3} className={`${input} w-full`} />
              </label>
              {err && <p className="text-ge-danger">{err}</p>}
              <div className="flex gap-2">
                <button type="button" className={btnSecondary} disabled={busy || charCount(reply) > REPLY_MAX} onClick={save}>{busy ? '保存中…' : '保存'}</button>
                <button type="button" className={`${muted} underline`} onClick={() => { setEditing(false); setErr(null) }}>やめる</button>
              </div>
            </div>
          ) : (
            <button type="button" className={`mt-2 ${muted} underline`} onClick={() => setEditing(true)}>状態と返事を変える</button>
          )}
        </div>
      </div>
    </li>
  )
}

// ── 話題 ─────────────────────────────────────────────────────────────

type TopicSort = 'items' | 'places' | 'blocking' | 'updated'

function TopicsPanel({ topics, busy, onCreate }: { topics: TopicVM[]; busy: boolean; onCreate: (title: string) => void }) {
  const [sort, setSort] = useState<TopicSort>('items')
  const [title, setTitle] = useState('')
  const sorted = useMemo(() => {
    const key: Record<TopicSort, (t: TopicVM) => number> = {
      items: (t) => t.itemCount, places: (t) => t.placeCount, blocking: (t) => t.blockingCount,
      updated: (t) => Date.parse(t.updated_at),
    }
    return [...topics].sort((a, b) => key[sort](b) - key[sort](a))
  }, [topics, sort])

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2">
          <span className={muted}>並べ方</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as TopicSort)} className={input}>
            <option value="items">要望の件数</option>
            <option value="places">困っている拠点の数</option>
            <option value="blocking">業務が止まるの件数</option>
            <option value="updated">更新の新しい順</option>
          </select>
        </label>
        <span className="ml-auto" />
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="新しい話題の題" maxLength={200} className={`${input} w-64`} />
        <button type="button" className={btnSecondary} disabled={busy || !title.trim()} onClick={() => { onCreate(title.trim()); setTitle('') }}>
          話題を作る
        </button>
      </div>
      {sorted.length === 0 ? (
        <div className={`${card} py-10 text-center text-sm ${muted}`}>話題はまだありません。未分類の要望を選んで束ねてください。</div>
      ) : (
        <ul className="space-y-2">{sorted.map((t) => <TopicRow key={t.id} topic={t} />)}</ul>
      )}
    </section>
  )
}

function TopicRow({ topic }: { topic: TopicVM }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [f, setF] = useState({
    title: topic.title, description: topic.description ?? '', status: topic.status, reply: topic.reply ?? '',
    fixed_version: topic.fixed_version ?? '', wbs_ref: topic.wbs_ref ?? '', issue_url: topic.issue_url ?? '',
    internal_note: topic.internal_note ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  async function save() {
    if (f.status === 'declined' && !f.reply.trim()) { setErr(ERR.reply_required); return }
    setBusy(true); setErr(null); setMsg(null)
    const orig: Record<string, string> = {
      title: topic.title, description: topic.description ?? '', status: topic.status, reply: topic.reply ?? '',
      fixed_version: topic.fixed_version ?? '', wbs_ref: topic.wbs_ref ?? '', issue_url: topic.issue_url ?? '',
      internal_note: topic.internal_note ?? '',
    }
    const body = Object.fromEntries(Object.entries(f).filter(([k, v]) => v !== orig[k]))
    if (Object.keys(body).length === 0) { setBusy(false); setEditing(false); return }
    const r = await send(`/api/admin/feedback/topics/${topic.id}`, 'PATCH', body)
    setBusy(false)
    if (!r.ok) { setErr(errText(r.json.error, r.status)); return }
    const n = Number(r.json.cascaded ?? 0)
    setMsg(n ? `束ねた要望 ${fmtNum(n)} 件にも写しました。` : '保存しました。')
    setEditing(false)
    router.refresh()
  }

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })

  return (
    <li className={`${card} p-3`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <FeedbackStatusBadge status={topic.status} />
        <span className="text-[13px] font-bold">{topic.title}</span>
        {topic.wbs_ref && <span className={`font-ge-mono ${muted}`}>{topic.wbs_ref}</span>}
        {topic.fixed_version && <span className={muted}>対応した版 <span className="font-ge-mono">{topic.fixed_version}</span></span>}
        {topic.issue_url && (
          <a href={topic.issue_url} target="_blank" rel="noopener noreferrer" className={`${muted} underline`}>課題</a>
        )}
        <span className={`ml-auto font-ge-mono tabular-nums ${muted}`}>
          要望 {fmtNum(topic.itemCount)} 件・拠点 {fmtNum(topic.placeCount)}・業務が止まる {fmtNum(topic.blockingCount)} 件
        </span>
      </div>
      {topic.description && <p className="mt-1 whitespace-pre-wrap break-words">{topic.description}</p>}
      {topic.reply && !editing && <p className={`mt-1 whitespace-pre-wrap break-words ${muted}`}>返事: {topic.reply}</p>}
      {topic.internal_note && !editing && <p className={`mt-1 whitespace-pre-wrap break-words ${muted}`}>内部メモ: {topic.internal_note}</p>}
      {msg && <p className="mt-1 text-ge-success">{msg}</p>}

      {editing ? (
        <div className="mt-3 space-y-2 border-t border-ge-line pt-3 dark:border-gedline">
          <div className="flex flex-wrap gap-3">
            <label className="block"><span className={`mb-1 block ${muted}`}>題</span>
              <input value={f.title} onChange={set('title')} maxLength={200} className={`${input} w-72`} /></label>
            <label className="block"><span className={`mb-1 block ${muted}`}>状態（束ねた要望にも写ります）</span>
              <select value={f.status} onChange={set('status')} className={input}>
                {FEEDBACK_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </select></label>
            <label className="block"><span className={`mb-1 block ${muted}`}>対応した版</span>
              <input value={f.fixed_version} onChange={set('fixed_version')} maxLength={64} placeholder="例 0.1.104" className={`${input} w-32 font-ge-mono`} /></label>
            <label className="block"><span className={`mb-1 block ${muted}`}>WBS の番号</span>
              <input value={f.wbs_ref} onChange={set('wbs_ref')} maxLength={32} placeholder="例 D-2-21" className={`${input} w-28 font-ge-mono`} /></label>
            <label className="block"><span className={`mb-1 block ${muted}`}>GitHub の課題の URL</span>
              <input value={f.issue_url} onChange={set('issue_url')} maxLength={500} placeholder="https://github.com/…" className={`${input} w-72 font-ge-mono`} /></label>
          </div>
          <label className="block"><span className={`mb-1 block ${muted}`}>説明（運営だけが見ます）</span>
            <textarea value={f.description} onChange={set('description')} rows={2} className={`${input} w-full`} /></label>
          <label className="block">
            <span className={`mb-1 flex justify-between ${muted}`}>
              <span>返事（束ねた要望へ写り、現場とテナントの画面に文として出ます{f.status === 'declined' ? '・見送りは必須' : ''}）</span>
              <span className="font-ge-mono tabular-nums">{fmtNum(charCount(f.reply))} / {fmtNum(REPLY_MAX)} 字</span>
            </span>
            <textarea value={f.reply} onChange={set('reply')} rows={3} className={`${input} w-full`} />
          </label>
          <label className="block"><span className={`mb-1 block ${muted}`}>内部メモ（テナントへは出ません）</span>
            <textarea value={f.internal_note} onChange={set('internal_note')} rows={2} className={`${input} w-full`} /></label>
          {err && <p className="text-ge-danger">{err}</p>}
          <div className="flex gap-2">
            <button type="button" className={btnSecondary} disabled={busy || charCount(f.reply) > REPLY_MAX} onClick={save}>{busy ? '保存中…' : '保存'}</button>
            <button type="button" className={`${muted} underline`} onClick={() => { setEditing(false); setErr(null) }}>やめる</button>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex gap-4">
          <Link href={`/admin/feedback?view=topics&topic=${topic.id}`} className={`${muted} underline`}>この話題の要望を見る</Link>
          <button type="button" className={`${muted} underline`} onClick={() => setEditing(true)}>話題を変える</button>
        </div>
      )}
    </li>
  )
}

// ── ファイルから取り込む ─────────────────────────────────────────────

function ImportPanel({ tenants, stores, onImported }: { tenants: Named[]; stores: StoreRow[]; onImported: () => void }) {
  const [tenantId, setTenantId] = useState('')
  const [storeId, setStoreId] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [dropped, setDropped] = useState<{ index: number; reason: string }[]>([])
  const [err, setErr] = useState<string | null>(null)
  const storeOptions = stores.filter((s) => s.tenant_id === tenantId)

  async function run() {
    if (!file || !tenantId || !storeId) return
    setBusy(true); setErr(null); setResult(null); setDropped([])
    try {
      let parsed: unknown
      try { parsed = JSON.parse(await file.text()) } catch { setErr('JSON として読めないファイルです。'); return }
      const all = (parsed as { items?: unknown })?.items
      // 画像（base64）を含むと 1 回の本文が大きくなるので、Vercel の上限の内側に分けて送る
      const chunks = Array.isArray(all) && all.length > 0 ? chunkImportItems(all) : [{ start: 0, items: Array.isArray(all) ? all : [] }]
      let imported = 0, duplicates = 0, invalid = 0, stored = 0
      const drops: { index: number; reason: string }[] = []
      for (const [n, chunk] of chunks.entries()) {
        const body = { tenant_id: tenantId, store_id: storeId, file: { ...(parsed as Record<string, unknown>), items: Array.isArray(all) ? chunk.items : all } }
        const r = await send('/api/admin/feedback/import', 'POST', body)
        if (!r.ok) {
          setErr(`${errText(r.json.error, r.status)}${n > 0 ? `（ファイルの先頭から ${fmtNum(chunk.start)} 件までは処理済みです。もう一度取り込むと、取り込み済みの要望は飛ばします）` : ''}`)
          if (imported) onImported()
          return
        }
        imported += Number(r.json.imported ?? 0)
        duplicates += Number(r.json.duplicates ?? 0)
        invalid += Array.isArray(r.json.invalid) ? r.json.invalid.length : 0
        const att = (r.json.attachments ?? {}) as { stored?: number; dropped?: { index: number; reason: string }[] }
        stored += Number(att.stored ?? 0)
        for (const d of att.dropped ?? []) drops.push({ index: chunk.start + d.index, reason: d.reason })
      }
      setResult(
        `取り込み ${fmtNum(imported)} 件・取り込み済みで飛ばした ${fmtNum(duplicates)} 件・形の誤りで飛ばした ${fmtNum(invalid)} 件` +
        `・画像 ${fmtNum(stored)} 枚を保存${drops.length ? `・画像だけ捨てた ${fmtNum(drops.length)} 件` : ''}`,
      )
      setDropped(drops)
      setFile(null)
      onImported()
    } finally {
      setBusy(false)
    }
  }

  return (
    <details className={`${card} p-3`}>
      <summary className="cursor-pointer font-bold">ファイルから取り込む（閉域の拠点）</summary>
      <p className={`mt-2 ${muted}`}>
        クラウドにつながっていない拠点が G・VMS の 設定 → 要望 で書き出した JSON（gvms-feedback-export/1）を取り込みます。
        同じ拠点で取り込み済みの要望（同じ手元の id）は飛ばします。本文の電話番号・メールアドレス・URL は伏せ字にして保存します。
        添えた画像は大きさ・形式・sha256 を確かめてから保存し、合わない画像は捨てます（要望は取り込みます）。
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="block"><span className={`mb-1 block ${muted}`}>テナント</span>
          <select value={tenantId} onChange={(e) => { setTenantId(e.target.value); setStoreId('') }} className={input}>
            <option value="">選ぶ</option>
            {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select></label>
        <label className="block"><span className={`mb-1 block ${muted}`}>拠点</span>
          <select value={storeId} onChange={(e) => setStoreId(e.target.value)} disabled={!tenantId} className={`${input} max-w-[16rem]`}>
            <option value="">選ぶ</option>
            {storeOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select></label>
        <label className="block"><span className={`mb-1 block ${muted}`}>ファイル（.json）</span>
          <input
            type="file" accept=".json,application/json" onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block text-xs file:mr-2 file:cursor-pointer file:rounded file:border file:border-ge-line file:bg-white file:px-3 file:py-1 file:text-xs file:text-ge-ink-2"
          /></label>
        <button type="button" className={btnPrimary} disabled={busy || !file || !tenantId || !storeId} onClick={run}>
          <Upload size={14} strokeWidth={1.5} aria-hidden /> {busy ? '取り込み中…' : '取り込む'}
        </button>
      </div>
      {err && <p className="mt-2 text-ge-danger">{err}</p>}
      {result && <p className="mt-2 text-ge-success">{result}</p>}
      {dropped.length > 0 && (
        <ul className={`mt-1 list-inside list-disc ${muted}`}>
          {dropped.map((d) => (
            <li key={d.index}>ファイルの {fmtNum(d.index + 1)} 件目の画像: {DROP_REASON[d.reason] ?? d.reason}</li>
          ))}
        </ul>
      )}
    </details>
  )
}
