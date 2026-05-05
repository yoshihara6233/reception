'use client'

import { Suspense, useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useLocale } from '@/lib/i18n/useLocale'
import { VisitsNavBar } from '@/app/admin/_components/VisitsNavBar'
import { InlineRecordingViewer, BaggageReviewControls } from '@/app/admin/_components/baggage-viewer'

// ── 型 ────────────────────────────────────────────────────────────────────────

interface BaggageDecl {
  id: string
  status: string
  context: 'checkin' | 'checkout'
  inspection_mode: 'photo' | 'video' | null
}

interface Visit {
  id: string
  purpose: string
  status: string
  check_in_at: string
  check_out_at: string | null
  visitors: { company: string; name: string; department?: string } | null
  stores: { id: string; name: string } | null
  baggage_declarations: BaggageDecl[] | null
}

interface Store { id: string; name: string }

type SortCol = 'check_in_at' | 'check_out_at' | 'status' | 'purpose'
type SortDir = 'asc' | 'desc'

interface Filters {
  q: string
  company: string
  purpose: string
  storeId: string
  dateFrom: string
  dateTo: string
  status: string
}

const EMPTY_FILTERS: Filters = {
  q: '', company: '', purpose: '', storeId: '',
  dateFrom: '', dateTo: '', status: '',
}

// ── 詳細パネル型 ──────────────────────────────────────────────────────────────

interface VisitDetail {
  id: string
  purpose: string
  status: string
  check_in_at: string
  check_out_at: string | null
  visitor: {
    id: string
    name: string
    company: string
    department?: string
    phone?: string
    email?: string
  } | null
  store_name: string | null
  area_name: string | null
  photos: Array<{ id: string; type: string; signedUrl: string | null; ocrResult: unknown }>
  baggage: Array<{
    id: string
    context: string
    inspection_mode: string | null
    declaration_text: string | null
    status: string
    staff_notes: string | null
    reviewed_at: string | null
    vms_inspection_id: string | null
    vms_hls_url: string | null
    inspection_started_at: string | null
    inspection_ended_at: string | null
    photoContentsUrl: string | null
    photoEmptyUrl: string | null
  }>
}

// ── サブコンポーネント ─────────────────────────────────────────────────────────

function StatusBadge({ status, t }: { status: string; t: (k: string) => string }) {
  const styles: Record<string, React.CSSProperties> = {
    checked_in:  { background: 'var(--ge-success-soft)', color: 'var(--ge-success)' },
    checked_out: { background: 'var(--ge-paper-2)',      color: 'var(--ge-ink-3)' },
    auto_closed: { background: 'var(--ge-warning-soft)', color: 'var(--ge-warning)' },
  }
  const labelKeys: Record<string, string> = {
    checked_in:  'admin.statusCheckedIn',
    checked_out: 'admin.statusCheckedOut',
    auto_closed: 'admin.statusAutoClosed',
  }
  return (
    <span style={{
      ...(styles[status] ?? {}),
      padding: '2px 8px', borderRadius: 999,
      font: '500 11px/1.4 var(--font-sans)',
      whiteSpace: 'nowrap',
    }}>
      {labelKeys[status] ? t(labelKeys[status]) : status}
    </span>
  )
}

function BaggageBadge({ decls }: { decls: BaggageDecl[] | null }) {
  if (!decls || decls.length === 0) return null
  const hasFlagged = decls.some(d => d.status === 'flagged')
  const hasPending = decls.some(d => d.status === 'pending' || d.status === '')
  const allCleared = decls.every(d => d.status === 'cleared')
  if (hasFlagged) return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      padding: '2px 6px', borderRadius: 999,
      font: '500 10px/1 var(--font-sans)',
      background: '#fef2f2', color: '#b91c1c',
      border: '1px solid #fecaca', whiteSpace: 'nowrap',
    }}>🚩 フラグ</span>
  )
  if (hasPending) return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      padding: '2px 6px', borderRadius: 999,
      font: '500 10px/1 var(--font-sans)',
      background: '#fefce8', color: '#a16207',
      border: '1px solid #fde68a', whiteSpace: 'nowrap',
    }}>⚠️ 未審査</span>
  )
  if (allCleared) return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      padding: '2px 6px', borderRadius: 999,
      font: '500 10px/1 var(--font-sans)',
      background: '#f0fdf4', color: '#15803d',
      border: '1px solid #bbf7d0', whiteSpace: 'nowrap',
    }}>✓ 済</span>
  )
  return null
}

function BaggageModeCell({ decls }: { decls: BaggageDecl[] | null }) {
  if (!decls || decls.length === 0) return <span style={{ color: 'var(--ge-line-2)' }}>—</span>
  const hasVideo = decls.some(d => d.inspection_mode === 'video')
  return (
    <span style={{
      font: '400 11px/1 var(--font-sans)',
      color: 'var(--ge-ink-4)',
      whiteSpace: 'nowrap',
    }}>
      {hasVideo ? '🎥 動画' : '📷 写真'}
    </span>
  )
}

function SortTh({
  col, label, sortCol, sortDir, onSort,
}: {
  col: SortCol | null
  label: string
  sortCol: SortCol
  sortDir: SortDir
  onSort: (c: SortCol) => void
}) {
  const active = col === sortCol
  const cellStyle: React.CSSProperties = {
    padding: '8px 12px', textAlign: 'left',
    font: '500 11px/1 var(--font-sans)',
    color: active ? 'var(--ge-accent)' : 'var(--ge-ink-4)',
    whiteSpace: 'nowrap',
    cursor: col ? 'pointer' : 'default',
    userSelect: 'none',
  }
  return (
    <th style={cellStyle} onClick={() => col && onSort(col)}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        {label}
        {col && (
          <span style={{ display: 'inline-flex', flexDirection: 'column', lineHeight: 1, opacity: active ? 1 : 0.3 }}>
            <svg width="7" height="4" viewBox="0 0 8 5" fill="currentColor" style={{ opacity: sortDir === 'asc' && active ? 1 : 0.4 }}>
              <path d="M4 0L8 5H0L4 0Z"/>
            </svg>
            <svg width="7" height="4" viewBox="0 0 8 5" fill="currentColor" style={{ marginTop: 2, opacity: sortDir === 'desc' && active ? 1 : 0.4 }}>
              <path d="M4 5L0 0H8L4 5Z"/>
            </svg>
          </span>
        )}
      </span>
    </th>
  )
}

function FilterInput({ value, onChange, placeholder, type = 'text' }: {
  value: string; onChange: (v: string) => void
  placeholder?: string; type?: string
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        width: '100%', padding: '4px 8px',
        font: '400 11px/1.4 var(--font-sans)',
        color: 'var(--ge-ink)', background: '#fff',
        border: '1px solid var(--ge-line)', borderRadius: 4,
        outline: 'none',
      }}
    />
  )
}

// ── 来訪詳細パネル ─────────────────────────────────────────────────────────────

function VisitDetailPanel({
  visitId, dateLocale, t,
}: {
  visitId: string
  dateLocale: string
  t: (k: string) => string
}) {
  const [detail, setDetail]           = useState<VisitDetail | null>(null)
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState(false)
  const [checkingOut, setCheckingOut] = useState(false)
  const [baggage, setBaggage]         = useState<VisitDetail['baggage']>([])

  useEffect(() => {
    setLoading(true)
    setError(false)
    setDetail(null)
    setBaggage([])
    fetch(`/api/v1/admin/visits/${visitId}`)
      .then(r => {
        if (!r.ok) throw new Error('not found')
        return r.json()
      })
      .then((d: VisitDetail) => {
        setDetail(d)
        setBaggage(d.baggage)
        setLoading(false)
      })
      .catch(() => { setError(true); setLoading(false) })
  }, [visitId])

  const handleCheckout = async () => {
    if (!detail || detail.status !== 'checked_in') return
    setCheckingOut(true)
    try {
      const res = await fetch(`/api/v1/admin/visits/${visitId}/checkout`, { method: 'POST' })
      if (res.ok) {
        const updated = await res.json()
        setDetail(prev => prev ? { ...prev, status: updated.status, check_out_at: updated.check_out_at } : prev)
      }
    } finally {
      setCheckingOut(false)
    }
  }

  const handleBaggageUpdated = (bdId: string, status: string, notes: string) => {
    setBaggage(prev => prev.map(bd =>
      bd.id === bdId
        ? { ...bd, status, staff_notes: notes, reviewed_at: new Date().toISOString() }
        : bd
    ))
  }

  if (loading) return (
    <div style={{ padding: 24 }}>
      {[180, 120, 100, 140, 80].map((w, i) => (
        <div key={i} style={{
          height: 14, borderRadius: 4, marginBottom: 14,
          background: 'var(--ge-paper-2)', width: w,
          animation: 'pulse 1.5s ease-in-out infinite',
        }} />
      ))}
    </div>
  )

  if (error || !detail) return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      height: '100%', gap: 8,
    }}>
      <span style={{ font: '400 13px/1 var(--font-sans)', color: 'var(--ge-ink-4)' }}>
        読み込みに失敗しました
      </span>
    </div>
  )

  const visitorPhotos = detail.photos.filter(p => p.type === 'face' || p.type === 'card')
  const ocrPhoto      = detail.photos.find(p => p.ocrResult)

  const infoLabelStyle: React.CSSProperties = {
    font: '400 11px/1 var(--font-sans)', color: '#9ca3af',
  }
  const infoValueStyle: React.CSSProperties = {
    font: '500 12px/1.4 var(--font-sans)', color: '#1e3a5f',
  }

  const statusStyles: Record<string, React.CSSProperties> = {
    checked_in:  { background: '#dcfce7', color: '#15803d' },
    checked_out: { background: '#f1f5f9', color: '#64748b' },
    auto_closed: { background: '#fef9c3', color: '#a16207' },
  }
  const statusLabels: Record<string, string> = {
    checked_in:  t('admin.statusCheckedIn'),
    checked_out: t('admin.statusCheckedOut'),
    auto_closed: t('admin.statusAutoClosed'),
  }

  return (
    <div style={{ padding: '20px 24px 32px' }}>

      {/* ── ヘッダー ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <h2 style={{ font: '700 20px/1.2 var(--font-sans)', color: '#1e3a5f', margin: 0 }}>
            {detail.visitor?.name ?? '—'}
          </h2>
          <p style={{ font: '400 12px/1.5 var(--font-sans)', color: '#6b7280', margin: '3px 0 0' }}>
            {detail.visitor?.company ?? '—'}
            {detail.visitor?.department && ` · ${detail.visitor.department}`}
          </p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
          <span style={{
            padding: '3px 10px', borderRadius: 999,
            font: '500 11px/1.4 var(--font-sans)',
            ...(statusStyles[detail.status] ?? {}),
          }}>
            {statusLabels[detail.status] ?? detail.status}
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            <a
              href={`/admin/visits/${visitId}/evidence`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                padding: '4px 10px', borderRadius: 5,
                font: '500 11px/1 var(--font-sans)', color: '#fff',
                background: '#0f1a2e', textDecoration: 'none',
                whiteSpace: 'nowrap',
              }}
            >
              🔒 PDF出力
            </a>
            <Link
              href={`/admin/visits/${visitId}`}
              style={{
                padding: '4px 10px', borderRadius: 5,
                font: '500 11px/1 var(--font-sans)', color: '#1e3a5f',
                background: '#eff6ff', border: '1px solid #bfdbfe',
                textDecoration: 'none', whiteSpace: 'nowrap',
              }}
            >
              全詳細 →
            </Link>
          </div>
        </div>
      </div>

      {/* ── 来訪情報 ── */}
      <div className="bg-white rounded-2xl shadow-sm px-5 py-3 mb-4">
        <div style={{ display: 'flex', alignItems: 'center', gap: 0, flexWrap: 'wrap' }}>
          {[
            { label: '目的', value: detail.purpose },
            { label: '店舗', value: detail.store_name ?? '—' },
            ...(detail.area_name ? [{ label: 'エリア', value: detail.area_name }] : []),
            { label: '入室', value: new Date(detail.check_in_at).toLocaleString(dateLocale) },
            { label: '退室', value: detail.check_out_at ? new Date(detail.check_out_at).toLocaleString(dateLocale) : null },
            ...(detail.visitor?.phone ? [{ label: '電話番号', value: detail.visitor.phone }] : []),
            ...(detail.visitor?.email ? [{ label: 'メール', value: detail.visitor.email }] : []),
          ].map((item, i, arr) => (
            <div key={item.label} style={{ display: 'flex', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, padding: '0 12px' }}>
                <span style={{ font: '400 11px/1 var(--font-sans)', color: '#9ca3af', whiteSpace: 'nowrap' }}>
                  {item.label}
                </span>
                <span style={{ font: '500 12px/1 var(--font-sans)', color: 'var(--ge-ink)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                  {item.value ?? <span style={{ color: '#d1d5db' }}>未退室</span>}
                </span>
              </div>
              {i < arr.length - 1 && (
                <span style={{ width: 1, height: 14, background: '#e2e8f0', flexShrink: 0 }} />
              )}
            </div>
          ))}
        </div>

        {/* 退室処理ボタン */}
        {detail.status === 'checked_in' && (
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid #f1f5f9' }}>
            <button
              onClick={handleCheckout}
              disabled={checkingOut}
              style={{
                padding: '7px 18px', borderRadius: 6,
                font: '600 12px/1 var(--font-sans)', color: '#fff',
                background: checkingOut ? '#94a3b8' : '#1e3a5f',
                border: 'none', cursor: checkingOut ? 'default' : 'pointer',
                opacity: checkingOut ? 0.7 : 1,
              }}
            >
              {checkingOut ? '処理中...' : '退室処理'}
            </button>
          </div>
        )}
      </div>

      {/* ── 来訪者写真 ── */}
      {visitorPhotos.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm p-5 mb-4">
          <p style={{ font: '600 11px/1 var(--font-sans)', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 12 }}>
            来訪者写真
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
            {visitorPhotos.map(photo => {
              const label = photo.type === 'card' ? t('admin.businessCard') : t('admin.facePhoto')
              return (
                <div key={photo.id} style={{ position: 'relative' }}>
                  <div style={{
                    borderRadius: 12, overflow: 'hidden',
                    background: '#f0f2f5', aspectRatio: '4/3',
                    position: 'relative',
                  }}>
                    {photo.signedUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={photo.signedUrl} alt={label} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', font: '400 11px/1 var(--font-sans)' }}>
                        {label}
                      </div>
                    )}
                    <span style={{
                      position: 'absolute', bottom: 6, left: 6,
                      background: 'rgba(0,0,0,0.5)', color: '#fff',
                      font: '500 10px/1 var(--font-sans)', padding: '2px 6px', borderRadius: 4,
                    }}>
                      {label}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
          {ocrPhoto && (
            <div style={{ marginTop: 10, padding: 12, background: '#f0f2f5', borderRadius: 10 }}>
              <p style={{ font: '500 10px/1 var(--font-sans)', color: '#6b7280', marginBottom: 6 }}>
                {t('admin.ocrResult')}
              </p>
              <pre style={{ font: '400 10px/1.5 var(--font-mono)', color: '#374151', margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {JSON.stringify(ocrPhoto.ocrResult, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* ── 手荷物検査 ── */}
      {baggage.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {baggage.map(bd => (
            <div key={bd.id} className="bg-white rounded-2xl shadow-sm overflow-hidden">
              {/* ヘッダー */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '12px 16px', background: '#f8fafc',
                borderBottom: '1px solid #f1f5f9',
              }}>
                <span>🧳</span>
                <span style={{ font: '600 13px/1 var(--font-sans)', color: '#1e3a5f' }}>
                  手荷物検査 — {bd.context === 'checkin' ? '入室時' : '退室時'}
                </span>
                <span style={{
                  padding: '2px 8px', borderRadius: 999,
                  font: '500 10px/1.4 var(--font-sans)',
                  ...(bd.inspection_mode === 'video'
                    ? { background: '#ede9fe', color: '#7c3aed' }
                    : { background: '#dbeafe', color: '#1d4ed8' }),
                }}>
                  {bd.inspection_mode === 'video' ? '🎥 動画' : '📷 写真'}
                </span>
              </div>

              <div style={{ padding: '16px' }}>
                {/* 動画モード */}
                {bd.inspection_mode === 'video' ? (
                  <InlineRecordingViewer baggageId={bd.id} visitId={visitId} />
                ) : (
                  /* 写真モード */
                  <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
                    {[
                      { label: '荷物の内容', url: bd.photoContentsUrl },
                      { label: 'バッグ外観（空）', url: bd.photoEmptyUrl },
                    ].map(({ label, url }) => (
                      <div key={label} style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ font: '400 10px/1 var(--font-sans)', color: '#9ca3af', marginBottom: 6 }}>{label}</p>
                        <div style={{ borderRadius: 10, overflow: 'hidden', background: '#f3f4f6', aspectRatio: '4/3', position: 'relative' }}>
                          {url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={url} alt={label} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          ) : (
                            <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                              <span style={{ fontSize: 24, opacity: 0.3 }}>📦</span>
                              <span style={{ font: '400 10px/1 var(--font-sans)', color: '#9ca3af' }}>写真なし</span>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* 申告内容 */}
                {bd.declaration_text && (
                  <div style={{ padding: '10px 12px', background: '#f0f4f8', borderRadius: 10, marginBottom: 12 }}>
                    <p style={{ font: '500 10px/1 var(--font-sans)', color: '#6b7280', marginBottom: 4 }}>申告内容</p>
                    <p style={{ font: '400 12px/1.5 var(--font-sans)', color: '#374151', margin: 0 }}>{bd.declaration_text}</p>
                  </div>
                )}

                {/* 審査コントロール */}
                <BaggageReviewControls
                  baggageId={bd.id}
                  currentStatus={bd.status}
                  staffNotes={bd.staff_notes}
                  reviewedAt={bd.reviewed_at}
                  onUpdated={(status, notes) => handleBaggageUpdated(bd.id, status, notes)}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── タイムラインイベント ────────────────────────────────────────────────────────

type TimelineEvent = {
  key: string
  type: 'checkin' | 'checkout'
  time: string
  visit: Visit
}

function buildTimeline(visits: Visit[], sortDir: SortDir = 'desc'): TimelineEvent[] {
  const events: TimelineEvent[] = []
  for (const v of visits) {
    events.push({ key: `${v.id}-in`, type: 'checkin', time: v.check_in_at, visit: v })
    if (v.check_out_at) {
      events.push({ key: `${v.id}-out`, type: 'checkout', time: v.check_out_at, visit: v })
    }
  }
  return events.sort((a, b) => {
    const diff = new Date(a.time).getTime() - new Date(b.time).getTime()
    return sortDir === 'asc' ? diff : -diff
  })
}

// ── メインページ ──────────────────────────────────────────────────────────────

function VisitsPageInner() {
  const { t, locale } = useLocale()
  const dateLocale = locale === 'zh' ? 'zh-CN' : locale === 'ko' ? 'ko-KR' : locale === 'en' ? 'en-US' : 'ja-JP'
  const searchParams = useSearchParams()
  const viewMode = searchParams.get('view') === 'timeline' ? 'timeline' : 'table'

  const [visits,    setVisits]    = useState<Visit[]>([])
  const [total,     setTotal]     = useState(0)
  const [loading,   setLoading]   = useState(true)
  const [page,      setPage]      = useState(1)
  const [exporting, setExporting] = useState(false)
  const [stores,    setStores]    = useState<Store[]>([])
  const [purposes,  setPurposes]  = useState<string[]>([])

  // 選択状態（スプリットペインでは詳細表示に使う）
  const [selectedVisitId, setSelectedVisitId] = useState<string | null>(null)

  // 一括選択（CSV出力用）
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // 手荷物フィルター（クライアントサイド）
  const [baggageFilter, setBaggageFilter] = useState<'' | 'flagged' | 'pending' | 'cleared' | 'none'>('')

  // タイムライン種別フィルター（クライアントサイド）
  const [timelineTypeFilter, setTimelineTypeFilter] = useState<'' | 'checkin' | 'checkout'>('')

  const [filters,  setFilters]  = useState<Filters>(EMPTY_FILTERS)
  const [sortCol,  setSortCol]  = useState<SortCol>('check_in_at')
  const [sortDir,  setSortDir]  = useState<SortDir>('desc')

  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const perPage = 20
  const totalPages = Math.ceil(total / perPage)
  const hasFilters = Object.values(filters).some(v => v !== '') || !!baggageFilter || !!timelineTypeFilter

  // ── 店舗一覧・目的一覧 ────────────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/v1/admin/stores')
      .then(r => r.ok ? r.json() : { stores: [] })
      .then(d => setStores(d.stores ?? []))
      .catch(() => {})
    fetch('/api/v1/admin/settings')
      .then(r => r.ok ? r.json() : {})
      .then(d => {
        const p = (d as Record<string, unknown> & { settings?: { visit_purposes?: unknown } })?.settings?.visit_purposes
        if (Array.isArray(p) && p.length > 0) setPurposes(p)
        else setPurposes(['定期配送', 'メンテナンス', '商談', '監査', 'その他'])
      })
      .catch(() => setPurposes(['定期配送', 'メンテナンス', '商談', '監査', 'その他']))
  }, [])

  // ── データ取得 ────────────────────────────────────────────────────────────────
  const fetchVisits = useCallback(async (pg = 1, f = filters, sc = sortCol, sd = sortDir) => {
    setLoading(true)
    setSelected(new Set()) // ページ切替時に選択リセット
    const p = new URLSearchParams()
    if (f.q)        p.set('q',        f.q)
    if (f.company)  p.set('company',  f.company)
    if (f.purpose)  p.set('purpose',  f.purpose)
    if (f.storeId)  p.set('storeId',  f.storeId)
    if (f.dateFrom) p.set('dateFrom', f.dateFrom)
    if (f.dateTo)   p.set('dateTo',   f.dateTo)
    if (f.status)   p.set('status',   f.status)
    p.set('sortBy',  sc)
    p.set('sortDir', sd)
    p.set('page',    String(pg))
    try {
      const res = await fetch(`/api/v1/admin/visits-list?${p}`)
      const data = await res.json()
      setVisits(data.visits || [])
      setTotal(data.total || 0)
      setPage(pg)
    } catch {}
    setLoading(false)
  }, [filters, sortCol, sortDir])

  const applyFilters = useCallback((f: Filters, sc: SortCol, sd: SortDir) => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => fetchVisits(1, f, sc, sd), 280)
  }, [fetchVisits])

  useEffect(() => { fetchVisits(1) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── フィルター ────────────────────────────────────────────────────────────────
  const updateFilter = (key: keyof Filters, val: string) => {
    const next = { ...filters, [key]: val }
    setFilters(next)
    applyFilters(next, sortCol, sortDir)
  }
  const clearFilters = () => {
    setFilters(EMPTY_FILTERS)
    setBaggageFilter('')
    setTimelineTypeFilter('')
    applyFilters(EMPTY_FILTERS, sortCol, sortDir)
  }

  // ── ソート ────────────────────────────────────────────────────────────────────
  const handleSort = (col: SortCol) => {
    const nextDir: SortDir = sortCol === col && sortDir === 'desc' ? 'asc' : 'desc'
    setSortCol(col); setSortDir(nextDir)
    fetchVisits(1, filters, col, nextDir)
  }

  // ── 選択（CSV用） ─────────────────────────────────────────────────────────────
  const allIds = visits.map(v => v.id)
  const allSelected = allIds.length > 0 && allIds.every(id => selected.has(id))
  const someSelected = allIds.some(id => selected.has(id)) && !allSelected

  const toggleAll = () => {
    if (allSelected) {
      setSelected(prev => { const s = new Set(prev); allIds.forEach(id => s.delete(id)); return s })
    } else {
      setSelected(prev => new Set([...prev, ...allIds]))
    }
  }
  const toggleOne = (id: string) => {
    setSelected(prev => {
      const s = new Set(prev)
      s.has(id) ? s.delete(id) : s.add(id)
      return s
    })
  }

  // ── CSV エクスポート ──────────────────────────────────────────────────────────
  const handleExport = async (selectedOnly = false) => {
    setExporting(true)
    const p = new URLSearchParams()
    if (!selectedOnly) {
      if (filters.q)        p.set('q',        filters.q)
      if (filters.company)  p.set('company',  filters.company)
      if (filters.purpose)  p.set('purpose',  filters.purpose)
      if (filters.storeId)  p.set('storeId',  filters.storeId)
      if (filters.dateFrom) p.set('dateFrom', filters.dateFrom)
      if (filters.dateTo)   p.set('dateTo',   filters.dateTo)
      if (filters.status)   p.set('status',   filters.status)
    } else {
      p.set('ids', [...selected].join(','))
    }
    const res = await fetch(`/api/v1/admin/visits-export?${p}`)
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `visits_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    setExporting(false)
  }

  // 手荷物フィルター適用（表示用）
  const getBaggageSummary = (decls: BaggageDecl[] | null): 'flagged' | 'pending' | 'cleared' | 'none' => {
    if (!decls || decls.length === 0) return 'none'
    if (decls.some(d => d.status === 'flagged')) return 'flagged'
    if (decls.some(d => d.status === 'pending' || d.status === '')) return 'pending'
    return 'cleared'
  }
  const displayedVisits = baggageFilter
    ? visits.filter(v => getBaggageSummary(v.baggage_declarations) === baggageFilter)
    : visits

  const sortProps = { sortCol, sortDir, onSort: handleSort }
  const selectedCount = selected.size

  const btnBase: React.CSSProperties = {
    padding: '4px 10px', borderRadius: 4, cursor: 'pointer',
    font: '500 11px/1 var(--font-sans)', color: 'var(--ge-ink-3)',
    background: '#fff', border: '1px solid var(--ge-line)',
  }

  return (
    <div>
      {/* ── ヘッダー ────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <h1 style={{ font: '700 24px/1.2 var(--font-sans)', color: '#1e3a5f', margin: 0 }}>
            {t('admin.visits')}
          </h1>
          <span style={{ font: '400 12px/1 var(--font-sans)', color: 'var(--ge-ink-4)' }}>
            {total.toLocaleString()}{t('admin.total')}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {hasFilters && (
            <button
              onClick={clearFilters}
              style={{
                padding: '5px 10px', borderRadius: 4, cursor: 'pointer',
                font: '500 11px/1 var(--font-sans)', color: 'var(--ge-ink-3)',
                background: 'var(--ge-paper-2)', border: '1px solid var(--ge-line)',
                display: 'flex', alignItems: 'center', gap: 4,
              }}
            >
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
              絞り込みクリア
            </button>
          )}
          <VisitsNavBar />
          <button
            onClick={() => handleExport(false)}
            disabled={exporting}
            style={{
              padding: '5px 12px', borderRadius: 4, cursor: 'pointer',
              font: '500 11px/1 var(--font-sans)', color: 'var(--ge-accent)',
              background: '#fff', border: '1px solid var(--ge-accent-line)',
              opacity: exporting ? 0.4 : 1,
            }}
          >
            {exporting ? t('admin.exporting') : 'CSV エクスポート'}
          </button>
        </div>
      </div>

      {/* ── 選択バー ─────────────────────────────────────────────────── */}
      {selectedCount > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 14px', marginBottom: 8,
          background: 'var(--ge-accent-soft)', border: '1px solid var(--ge-accent-line)',
          borderRadius: 6,
        }}>
          <span style={{ font: '500 12px/1 var(--font-sans)', color: 'var(--ge-accent-ink)' }}>
            {selectedCount}件を選択中
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => handleExport(true)}
              disabled={exporting}
              style={{
                padding: '4px 12px', borderRadius: 4, cursor: 'pointer',
                font: '500 11px/1 var(--font-sans)', color: '#fff',
                background: 'var(--ge-accent)', border: 'none',
                opacity: exporting ? 0.5 : 1,
              }}
            >
              選択分をCSV出力
            </button>
            <button
              onClick={() => setSelected(new Set())}
              style={{
                padding: '4px 10px', borderRadius: 4, cursor: 'pointer',
                font: '500 11px/1 var(--font-sans)', color: 'var(--ge-accent-ink)',
                background: '#fff', border: '1px solid var(--ge-accent-line)',
              }}
            >
              選択解除
            </button>
          </div>
        </div>
      )}

      {/* ── タイムライン ─────────────────────────────────────────────── */}
      {viewMode === 'timeline' && (() => {
        const tlEvents = buildTimeline(displayedVisits, sortDir).filter(ev =>
          !timelineTypeFilter || ev.type === timelineTypeFilter
        )
        const selectStyle: React.CSSProperties = {
          width: '100%', padding: '4px 8px',
          font: '400 11px/1.4 var(--font-sans)', color: 'var(--ge-ink-3)',
          background: '#fff', border: '1px solid var(--ge-line)', borderRadius: 4, outline: 'none',
        }
        return (
          <div style={{ background: '#fff', borderRadius: 6, border: '1px solid var(--ge-line)', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: 'var(--ge-paper)', borderBottom: '1px solid var(--ge-line)' }}>
                  <SortTh col="check_in_at" label="時刻" {...sortProps} />
                  <th style={{ padding: '8px 12px', textAlign: 'left', font: '500 11px/1 var(--font-sans)', color: 'var(--ge-ink-4)', whiteSpace: 'nowrap' }}>種別</th>
                  <SortTh col={null} label={t('admin.visitor')} {...sortProps} />
                  <SortTh col={null} label={t('admin.company')} {...sortProps} />
                  <SortTh col="purpose" label={t('admin.purpose')} {...sortProps} />
                  <SortTh col={null} label={t('admin.store')} {...sortProps} />
                  <th style={{ width: 80 }} />
                </tr>
                <tr style={{ background: '#fff', borderBottom: '1px solid var(--ge-line)' }}>
                  <td style={{ padding: '4px 6px', minWidth: 160 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <FilterInput value={filters.dateFrom} onChange={v => updateFilter('dateFrom', v)} type="date" />
                      <FilterInput value={filters.dateTo}   onChange={v => updateFilter('dateTo',   v)} type="date" />
                    </div>
                  </td>
                  <td style={{ padding: '4px 6px', minWidth: 100 }}>
                    <select
                      value={timelineTypeFilter}
                      onChange={e => setTimelineTypeFilter(e.target.value as typeof timelineTypeFilter)}
                      style={{ ...selectStyle, color: timelineTypeFilter ? 'var(--ge-ink)' : 'var(--ge-ink-4)' }}
                    >
                      <option value="">すべて</option>
                      <option value="checkin">↓ 入室</option>
                      <option value="checkout">↑ 退室</option>
                    </select>
                  </td>
                  <td style={{ padding: '4px 6px' }}>
                    <FilterInput value={filters.q} onChange={v => updateFilter('q', v)} placeholder="氏名で絞込" />
                  </td>
                  <td style={{ padding: '4px 6px' }}>
                    <FilterInput value={filters.company} onChange={v => updateFilter('company', v)} placeholder="会社名で絞込" />
                  </td>
                  <td style={{ padding: '4px 6px' }}>
                    <select
                      value={filters.purpose}
                      onChange={e => updateFilter('purpose', e.target.value)}
                      style={{ ...selectStyle, color: filters.purpose ? 'var(--ge-ink)' : 'var(--ge-ink-4)' }}
                    >
                      <option value="">すべて</option>
                      {purposes.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: '4px 6px' }}>
                    <select
                      value={filters.storeId}
                      onChange={e => updateFilter('storeId', e.target.value)}
                      style={selectStyle}
                    >
                      <option value="">すべて</option>
                      {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </td>
                  <td />
                </tr>
              </thead>

              <tbody>
                {loading ? (
                  [...Array(6)].map((_, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--ge-paper-2)' }}>
                      {[...Array(7)].map((_, j) => (
                        <td key={j} style={{ padding: '10px 12px' }}>
                          <div style={{
                            height: 12, borderRadius: 3, background: 'var(--ge-paper-2)',
                            width: `${50 + (i * j + 13) % 40}%`,
                            animation: 'pulse 1.5s ease-in-out infinite',
                          }} />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : tlEvents.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: '48px 0', color: 'var(--ge-ink-4)', font: '400 13px/1 var(--font-sans)' }}>
                      {hasFilters || timelineTypeFilter ? (
                        <div>
                          <p style={{ marginBottom: 8 }}>条件に一致するイベントがありません</p>
                          <button
                            onClick={clearFilters}
                            style={{ font: '500 11px/1 var(--font-sans)', color: 'var(--ge-accent)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
                          >
                            絞り込みをクリア
                          </button>
                        </div>
                      ) : t('admin.noVisits')}
                    </td>
                  </tr>
                ) : tlEvents.map(ev => {
                  const isCheckout    = ev.type === 'checkout'
                  const isCheckoutOnly = ev.visit.purpose === '__checkout_only__'
                  return (
                    <tr
                      key={ev.key}
                      style={{
                        borderBottom: '1px solid var(--ge-paper-2)',
                        background: isCheckout ? '#f0fdf4' : '#eff6ff',
                      }}
                    >
                      <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', color: 'var(--ge-ink-3)', font: '500 11px/1.3 var(--font-mono)' }}>
                        {new Date(ev.time).toLocaleString(dateLocale, {
                          month: 'short', day: 'numeric',
                          hour: '2-digit', minute: '2-digit', second: '2-digit',
                        })}
                      </td>
                      <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          padding: '2px 8px', borderRadius: 999,
                          font: '600 11px/1.4 var(--font-sans)',
                          background: isCheckout ? '#dcfce7' : '#dbeafe',
                          color: isCheckout ? '#15803d' : '#1d4ed8',
                        }}>
                          {isCheckout ? '↑ 退室' : '↓ 入室'}
                          {isCheckoutOnly && (
                            <span style={{ font: '500 10px/1 var(--font-sans)', color: '#9a3412', marginLeft: 2 }}>※</span>
                          )}
                        </span>
                      </td>
                      <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>
                        <Link
                          href={`/admin/visits/${ev.visit.id}`}
                          style={{ font: '500 12px/1.3 var(--font-sans)', color: 'var(--ge-accent)', textDecoration: 'none' }}
                        >
                          {ev.visit.visitors?.name ?? '—'}
                        </Link>
                      </td>
                      <td style={{ padding: '8px 12px', color: 'var(--ge-ink-2)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {ev.visit.visitors?.company ?? '—'}
                      </td>
                      <td style={{ padding: '8px 12px', color: isCheckoutOnly ? '#9a3412' : 'var(--ge-ink-2)', whiteSpace: 'nowrap' }}>
                        {isCheckoutOnly ? '退室のみ ※' : ev.visit.purpose}
                      </td>
                      <td style={{ padding: '8px 12px', color: 'var(--ge-ink-3)', whiteSpace: 'nowrap' }}>
                        {ev.visit.stores?.name ?? '—'}
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                        <Link
                          href={`/admin/visits/${ev.visit.id}`}
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            padding: '3px 8px', borderRadius: 4,
                            font: '500 11px/1 var(--font-sans)',
                            color: 'var(--ge-accent)', background: 'var(--ge-accent-soft)',
                            border: '1px solid var(--ge-accent-line)', textDecoration: 'none',
                          }}
                        >詳細 →</Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            <div style={{ padding: '8px 14px', borderTop: '1px solid var(--ge-line)', font: '400 10px/1 var(--font-sans)', color: 'var(--ge-ink-4)' }}>
              ※ 入室記録なしで退室した来訪者です。
              <Link href="/admin/visits/mismatch" style={{ marginLeft: 8, color: 'var(--ge-accent)', textDecoration: 'none' }}>
                アンマッチ詳細 →
              </Link>
              {tlEvents.length > 0 && (
                <span style={{ marginLeft: 16 }}>
                  {tlEvents.length} イベント表示中
                </span>
              )}
            </div>
          </div>
        )
      })()}

      {/* ── スプリットペイン（テーブルモード） ──────────────────────────── */}
      {viewMode === 'table' && (
        <div style={{
          display: 'flex',
          marginLeft: -32, marginRight: -32, marginBottom: -32,
          height: 'calc(100vh - 112px)',
          borderTop: '1px solid var(--ge-line)',
          overflow: 'hidden',
          background: '#f8fafc',
        }}>
          {/* ── 左パネル: コンパクトリスト ── */}
          <div style={{
            width: 300, flexShrink: 0,
            display: 'flex', flexDirection: 'column',
            borderRight: '1px solid var(--ge-line)',
            background: '#fff',
            overflow: 'hidden',
          }}>
            {/* 検索 + フィルター */}
            <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--ge-line)', background: '#fafafa' }}>
              <FilterInput value={filters.q} onChange={v => updateFilter('q', v)} placeholder="氏名・会社で検索..." />
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <select
                  value={filters.status}
                  onChange={e => updateFilter('status', e.target.value)}
                  style={{
                    flex: 1, padding: '4px 6px',
                    font: '400 11px/1.4 var(--font-sans)', color: filters.status ? 'var(--ge-ink)' : 'var(--ge-ink-4)',
                    background: '#fff', border: '1px solid var(--ge-line)', borderRadius: 4, outline: 'none',
                  }}
                >
                  <option value="">すべての状態</option>
                  <option value="checked_in">{t('admin.statusCheckedIn')}</option>
                  <option value="checked_out">{t('admin.statusCheckedOut')}</option>
                  <option value="auto_closed">{t('admin.statusAutoClosed')}</option>
                </select>
                <select
                  value={filters.storeId}
                  onChange={e => updateFilter('storeId', e.target.value)}
                  style={{
                    flex: 1, padding: '4px 6px',
                    font: '400 11px/1.4 var(--font-sans)', color: 'var(--ge-ink-3)',
                    background: '#fff', border: '1px solid var(--ge-line)', borderRadius: 4, outline: 'none',
                  }}
                >
                  <option value="">すべての店舗</option>
                  {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <input
                  type="date"
                  value={filters.dateFrom}
                  onChange={e => updateFilter('dateFrom', e.target.value)}
                  style={{
                    flex: 1, padding: '4px 6px',
                    font: '400 11px/1.4 var(--font-sans)', color: 'var(--ge-ink)',
                    background: '#fff', border: '1px solid var(--ge-line)', borderRadius: 4, outline: 'none',
                  }}
                />
                <input
                  type="date"
                  value={filters.dateTo}
                  onChange={e => updateFilter('dateTo', e.target.value)}
                  style={{
                    flex: 1, padding: '4px 6px',
                    font: '400 11px/1.4 var(--font-sans)', color: 'var(--ge-ink)',
                    background: '#fff', border: '1px solid var(--ge-line)', borderRadius: 4, outline: 'none',
                  }}
                />
              </div>
            </div>

            {/* リスト */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {loading ? (
                [...Array(8)].map((_, i) => (
                  <div key={i} style={{ padding: '12px 14px', borderBottom: '1px solid var(--ge-paper-2)' }}>
                    <div style={{ height: 12, borderRadius: 3, background: 'var(--ge-paper-2)', width: '70%', marginBottom: 6, animation: 'pulse 1.5s ease-in-out infinite' }} />
                    <div style={{ height: 10, borderRadius: 3, background: 'var(--ge-paper-2)', width: '50%', animation: 'pulse 1.5s ease-in-out infinite' }} />
                  </div>
                ))
              ) : displayedVisits.length === 0 ? (
                <div style={{ padding: '40px 16px', textAlign: 'center' }}>
                  <p style={{ font: '400 12px/1.4 var(--font-sans)', color: 'var(--ge-ink-4)', margin: 0 }}>
                    {hasFilters ? '条件に一致する来訪記録がありません' : t('admin.noVisits')}
                  </p>
                  {hasFilters && (
                    <button
                      onClick={clearFilters}
                      style={{ marginTop: 8, font: '500 11px/1 var(--font-sans)', color: 'var(--ge-accent)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
                    >
                      絞り込みをクリア
                    </button>
                  )}
                </div>
              ) : (
                displayedVisits.map(visit => {
                  const isActive = selectedVisitId === visit.id
                  const statusStripe: Record<string, string> = {
                    checked_in:  '#22c55e',
                    checked_out: '#94a3b8',
                    auto_closed: '#f59e0b',
                  }
                  const stripeColor = statusStripe[visit.status] ?? '#cbd5e1'
                  return (
                    <div
                      key={visit.id}
                      onClick={() => setSelectedVisitId(visit.id)}
                      style={{
                        display: 'flex', gap: 10, padding: '10px 12px 10px 14px',
                        cursor: 'pointer',
                        borderBottom: '1px solid var(--ge-paper-2)',
                        borderLeft: `3px solid ${isActive ? 'var(--ge-accent)' : stripeColor}`,
                        background: isActive ? '#eff6ff' : '#fff',
                        transition: 'background 0.08s',
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          font: '500 12px/1.3 var(--font-sans)',
                          color: isActive ? 'var(--ge-accent)' : 'var(--ge-ink)',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {visit.visitors?.name ?? '—'}
                        </div>
                        <div style={{
                          font: '400 11px/1.3 var(--font-sans)', color: 'var(--ge-ink-3)',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2,
                        }}>
                          {visit.visitors?.company ?? '—'}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                          <span style={{ font: '400 10px/1 var(--font-mono)', color: 'var(--ge-ink-4)', fontVariantNumeric: 'tabular-nums' }}>
                            {new Date(visit.check_in_at).toLocaleString(dateLocale, {
                              month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                            })}
                          </span>
                          {visit.stores?.name && (
                            <span style={{ font: '400 10px/1 var(--font-sans)', color: 'var(--ge-ink-4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 80 }}>
                              {visit.stores.name}
                            </span>
                          )}
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, flexShrink: 0 }}>
                        <StatusBadge status={visit.status} t={t} />
                        <BaggageBadge decls={visit.baggage_declarations} />
                      </div>
                    </div>
                  )
                })
              )}
            </div>

            {/* ページネーション */}
            {totalPages > 1 && (
              <div style={{
                padding: '8px 12px', borderTop: '1px solid var(--ge-line)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                background: '#fafafa', flexShrink: 0,
              }}>
                <button
                  onClick={() => fetchVisits(Math.max(1, page - 1))}
                  disabled={page === 1}
                  style={{ ...btnBase, padding: '3px 10px', opacity: page === 1 ? 0.3 : 1 }}
                >‹</button>
                <span style={{ font: '400 11px/1 var(--font-mono)', color: 'var(--ge-ink-4)' }}>
                  {page} / {totalPages}
                </span>
                <button
                  onClick={() => fetchVisits(Math.min(totalPages, page + 1))}
                  disabled={page === totalPages}
                  style={{ ...btnBase, padding: '3px 10px', opacity: page === totalPages ? 0.3 : 1 }}
                >›</button>
              </div>
            )}
          </div>

          {/* ── 右パネル: 詳細 ── */}
          <div style={{ flex: 1, overflowY: 'auto', background: '#f8fafc', minWidth: 0 }}>
            {selectedVisitId ? (
              <VisitDetailPanel visitId={selectedVisitId} dateLocale={dateLocale} t={t} />
            ) : (
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                height: '100%', gap: 12, color: 'var(--ge-ink-4)',
              }}>
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.3 }}>
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <line x1="16" y1="13" x2="8" y2="13"/>
                  <line x1="16" y1="17" x2="8" y2="17"/>
                  <polyline points="10 9 9 9 8 9"/>
                </svg>
                <p style={{ font: '400 13px/1 var(--font-sans)', margin: 0 }}>
                  左のリストから来訪記録を選択してください
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  )
}

export default function VisitsPage() {
  return (
    <Suspense>
      <VisitsPageInner />
    </Suspense>
  )
}
