'use client'

/**
 * 発報タイムライン（Phase B / PB4・PB7 で /bcp 同形のテーブルUIに刷新）。
 * 上部に統計カード＋テスト発報、下部に発報一覧テーブル（サムネイル画像なし）。
 * 行から確認(ack/close)・詳細へ遷移できる。
 */
import { useState, useMemo, useTransition } from 'react'
import Link from 'next/link'
import { Bell, Copy, Settings } from 'lucide-react'
import { updateAlarmStatus } from './actions'

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

function fmtJst(iso: string) {
  return new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}
const STATUS = {
  new:    { label: '未対応', cls: 'bg-red-100 text-red-700 dark:bg-[#A3332B]/25 dark:text-[#E87D74]' },
  ack:    { label: '対応中', cls: 'bg-amber-100 text-amber-700 dark:bg-[#B5761A]/20 dark:text-[#E2A55A]' },
  closed: { label: '完了',   cls: 'bg-slate-100 text-slate-500 dark:bg-gedbg3 dark:text-gedink3' },
}
/** 発報受け口（現地エッジのローカルHTTP）を直接叩く参考URL。<IP>/<カメラID> は置換して使用。 */
const RECEIVER_URL = 'http://<BeelinkのLAN_IP>:9080/alarm?cam=<カメラID>&src=ipro&type=input'

export function AlarmTimeline({ events }: { events: AlarmEventVM[] }) {
  const [rows, setRows] = useState(events)
  const [store, setStore] = useState('')
  const [status, setStatus] = useState<'all' | 'new' | 'ack' | 'closed'>('all')
  const [pending, startTransition] = useTransition()
  const [copied, setCopied] = useState(false)

  const storeNames = useMemo(() => [...new Set(rows.map((r) => r.storeName))].sort(), [rows])
  const filtered = useMemo(() => rows.filter((r) =>
    (!store || r.storeName === store) && (status === 'all' || r.status === status)
  ), [rows, store, status])

  const stats = useMemo(() => ({
    total:    rows.length,
    open:     rows.filter((r) => r.status !== 'closed').length,
    notified: rows.filter((r) => r.notified).length,
  }), [rows])

  function setStatusOf(id: string, s: 'new' | 'ack' | 'closed') {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status: s } : r)))
    startTransition(async () => { await updateAlarmStatus(id, s) })
  }
  function copyUrl() {
    navigator.clipboard?.writeText(RECEIVER_URL)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })
      .catch(() => {})
  }

  const ctrl = 'rounded border border-slate-200 px-2 py-1 text-xs dark:border-gedline dark:bg-gedbg3 dark:text-gedink'

  return (
    <div className="space-y-4">
      {/* 統計カード（/bcp 同形） */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-gedline dark:bg-gedbg2">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-gedink3">累計発報</div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-slate-900 dark:text-gedink">{stats.total.toLocaleString()}</div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-gedline dark:bg-gedbg2">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-gedink3">未完了</div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-red-700 dark:text-[#E87D74]">{stats.open.toLocaleString()}</div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-gedline dark:bg-gedbg2">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-gedink3">通知済</div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-emerald-700 dark:text-[#5CC98B]">{stats.notified.toLocaleString()}</div>
        </div>
      </div>

      {/* 発報テスト（受け口URLを直接叩く）+ 設定リンク */}
      <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 dark:border-gedline dark:bg-gedbg2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-gedink3">発報テスト（受け口URL）</span>
          <code className="min-w-0 flex-1 truncate rounded border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-[12px] text-slate-700 dark:border-gedline dark:bg-gedbg3 dark:text-gedink2">{RECEIVER_URL}</code>
          <button onClick={copyUrl}
            className="inline-flex items-center gap-1 rounded border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 disabled:opacity-50 dark:border-gedline dark:text-gedink">
            <Copy size={13} strokeWidth={1.75} aria-hidden /> {copied ? 'コピーしました' : 'コピー'}
          </button>
          <Link href="/alarms/settings" className="ml-auto inline-flex items-center gap-1 text-xs text-blue-600 hover:underline dark:text-gedaccent">
            <Settings size={13} strokeWidth={1.75} aria-hidden /> 発報設定
          </Link>
        </div>
        <p className="mt-2 text-[11px] text-slate-400 dark:text-gedink3">
          現地エッジ(Beelink)と同一LAN内のブラウザで上記URLを開くと発報を投入できます（<code className="font-mono">&lt;IP&gt;</code>・<code className="font-mono">&lt;カメラID&gt;</code> は実値に置換）。実運用ではカメラ/NVRの接点通知先も同じURLに向けます。
        </p>
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

      {/* 発報一覧テーブル（/bcp 同形・サムネイルなし） */}
      {filtered.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center dark:border-gedline dark:bg-gedbg2">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-400 dark:bg-gedbg3 dark:text-gedink3"><Bell size={20} strokeWidth={1.5} aria-hidden /></div>
          <p className="mt-2 text-sm text-slate-600 dark:text-gedink2">発報はありません</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-gedline dark:bg-gedbg2">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:bg-gedbg3 dark:text-gedink3">
              <tr>
                <th className="px-3 py-2 text-left">種別</th>
                <th className="px-3 py-2 text-left">発報時刻</th>
                <th className="px-3 py-2 text-left">店舗</th>
                <th className="px-3 py-2 text-left">状態</th>
                <th className="px-3 py-2 text-left">通知</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const st = STATUS[r.status]
                return (
                  <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50 dark:border-gedline dark:hover:bg-gedbg3/40">
                    <td className="px-3 py-2">
                      <span className="rounded bg-slate-100 px-1.5 py-px text-[10px] font-bold text-slate-500 dark:bg-gedbg3 dark:text-gedink3">{r.eventType || r.source}</span>
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] tabular-nums text-slate-600 dark:text-gedink2">{fmtJst(r.occurredAt)}</td>
                    <td className="px-3 py-2 font-medium text-slate-800 dark:text-gedink">{r.storeName}</td>
                    <td className="px-3 py-2">
                      <span className={'inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ' + st.cls}>{st.label}</span>
                    </td>
                    <td className="px-3 py-2 text-slate-500 dark:text-gedink3">{r.notified ? '通知済' : '—'}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-2">
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
                        <Link href={`/alarms/${r.id}`} className="whitespace-nowrap text-blue-600 hover:underline dark:text-gedaccent" onClick={(e) => e.stopPropagation()}>詳細</Link>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
