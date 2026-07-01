'use client'

/**
 * 発報タイムライン（Phase B / PB4）。時系列の発報一覧・スナップ・確認(ack/close)。
 * 上部から店舗を選んで「テスト発報」も可能（通知経路の動作確認用）。
 */
import { useState, useMemo, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Bell, Camera, Play, Settings } from 'lucide-react'
import { updateAlarmStatus, createTestAlarm } from './actions'

export interface AlarmEventVM {
  id: string
  storeName: string
  cameraName: string | null
  source: string
  eventType: string | null
  occurredAt: string
  snapshotUrl: string | null
  status: 'new' | 'ack' | 'closed'
  notified: boolean
}
export interface AlarmStoreOption { id: string; name: string }

function fmtJst(iso: string) {
  return new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}
const STATUS = {
  new:    { label: '未対応', cls: 'bg-red-100 text-red-700 dark:bg-[#A3332B]/25 dark:text-[#E87D74]' },
  ack:    { label: '対応中', cls: 'bg-amber-100 text-amber-700 dark:bg-[#B5761A]/20 dark:text-[#E2A55A]' },
  closed: { label: '完了',   cls: 'bg-slate-100 text-slate-500 dark:bg-gedbg3 dark:text-gedink3' },
}

export function AlarmTimeline({ events, stores }: { events: AlarmEventVM[]; stores: AlarmStoreOption[] }) {
  const router = useRouter()
  const [rows, setRows] = useState(events)
  const [store, setStore] = useState('')
  const [status, setStatus] = useState<'all' | 'new' | 'ack' | 'closed'>('all')
  const [testStore, setTestStore] = useState(stores[0]?.id ?? '')
  const [pending, startTransition] = useTransition()
  const [msg, setMsg] = useState('')

  const storeNames = useMemo(() => [...new Set(rows.map((r) => r.storeName))].sort(), [rows])
  const filtered = useMemo(() => rows.filter((r) =>
    (!store || r.storeName === store) && (status === 'all' || r.status === status)
  ), [rows, store, status])

  function setStatusOf(id: string, s: 'new' | 'ack' | 'closed') {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status: s } : r)))
    startTransition(async () => { await updateAlarmStatus(id, s) })
  }
  function test() {
    if (!testStore) return
    setMsg('')
    startTransition(async () => {
      const res = await createTestAlarm(testStore)
      if (res.ok) { setMsg('テスト発報を作成しました'); setTimeout(() => router.refresh(), 1200) }
      else setMsg(res.error ?? 'テスト発報に失敗しました')
    })
  }

  const ctrl = 'rounded border border-slate-200 px-2 py-1 text-xs dark:border-gedline dark:bg-gedbg3 dark:text-gedink'

  return (
    <div className="space-y-4">
      {/* テスト発報 + 設定リンク */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 dark:border-gedline dark:bg-gedbg2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-gedink3">テスト発報</span>
        <select value={testStore} onChange={(e) => setTestStore(e.target.value)} className={ctrl}>
          {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button onClick={test} disabled={pending || !testStore}
          className="inline-flex items-center gap-1 rounded bg-slate-900 px-3 py-1 text-xs font-medium text-white disabled:opacity-50 dark:bg-gedaccent dark:text-gedbg">
          <Play size={13} strokeWidth={2} aria-hidden /> 発報を作成
        </button>
        {msg && <span className="text-[12px] text-emerald-600 dark:text-[#5CC98B]">{msg}</span>}
        <Link href="/alarms/settings" className="ml-auto inline-flex items-center gap-1 text-xs text-blue-600 hover:underline dark:text-gedaccent">
          <Settings size={13} strokeWidth={1.75} aria-hidden /> 発報設定
        </Link>
      </div>

      {/* フィルタ */}
      <div className="flex flex-wrap items-center gap-2">
        <select value={store} onChange={(e) => setStore(e.target.value)} className={ctrl}>
          <option value="">全店舗</option>
          {storeNames.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value as 'all' | 'new' | 'ack' | 'closed')} className={ctrl}>
          <option value="all">すべて</option>
          <option value="new">未対応</option>
          <option value="ack">対応中</option>
          <option value="closed">完了</option>
        </select>
        <span className="text-[11px] text-slate-400">{filtered.length} / {rows.length} 件</span>
      </div>

      {/* タイムライン */}
      {filtered.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center dark:border-gedline dark:bg-gedbg2">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-400 dark:bg-gedbg3 dark:text-gedink3"><Bell size={20} strokeWidth={1.5} aria-hidden /></div>
          <p className="mt-2 text-sm text-slate-600 dark:text-gedink2">発報はありません</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((r) => {
            const st = STATUS[r.status]
            return (
              <li key={r.id} className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-gedline dark:bg-gedbg2">
                <div className="flex h-12 w-16 flex-none items-center justify-center overflow-hidden rounded bg-slate-100 text-slate-400 dark:bg-gedbg3 dark:text-gedink3">
                  {r.snapshotUrl
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={r.snapshotUrl} alt="" className="h-full w-full object-cover" />
                    : <Camera size={18} strokeWidth={1.5} aria-hidden />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-[13px] font-semibold text-slate-800 dark:text-gedink">
                    <span className="truncate">{r.storeName}{r.cameraName ? ` ／ ${r.cameraName}` : ''}</span>
                    <span className="rounded bg-slate-100 px-1.5 py-px text-[10px] font-bold text-slate-500 dark:bg-gedbg3 dark:text-gedink3">{r.eventType || r.source}</span>
                    <span className={'rounded-full px-2 py-px text-[10px] font-bold ' + st.cls}>{st.label}</span>
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-gedink3">
                    {fmtJst(r.occurredAt)} ・ 源: {r.source}{r.notified ? ' ・ 通知済' : ''}
                  </div>
                </div>
                <div className="flex flex-none gap-1">
                  {r.status !== 'closed' ? (
                    <>
                      {r.status === 'new' && (
                        <button disabled={pending} onClick={() => setStatusOf(r.id, 'ack')}
                          className="whitespace-nowrap rounded border border-slate-300 px-2 py-0.5 text-[11px] font-medium text-slate-700 disabled:opacity-50 dark:border-gedline dark:text-gedink">対応中</button>
                      )}
                      <button disabled={pending} onClick={() => setStatusOf(r.id, 'closed')}
                        className="whitespace-nowrap rounded bg-slate-900 px-2 py-0.5 text-[11px] font-medium text-white disabled:opacity-50 dark:bg-gedaccent dark:text-gedbg">完了</button>
                    </>
                  ) : (
                    <button disabled={pending} onClick={() => setStatusOf(r.id, 'ack')}
                      className="whitespace-nowrap rounded border border-slate-300 px-2 py-0.5 text-[11px] font-medium text-slate-600 disabled:opacity-50 dark:border-gedline dark:text-gedink2">再開</button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
