'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { QRCodeSVG } from 'qrcode.react'

interface Store { id: string; name: string; area_code: string | null }
export interface ProvRow {
  id: string
  name: string
  storeName: string
  stage: number
  stages: number
  used: boolean
  expiresAt: string
  edgeId: string | null
  runningVersion: string | null
  cameras: number
  nodesOk: number | null
  nodesTotal: number | null
  errors24h: number | null
  healthFresh: boolean
}

type Issued = { id: string; token: string; short_code: string | null; expires_at: string; origin: string }

const STAGE_LABELS = ['', 'コード発行', '現地でclaim', '初回heartbeat', 'カメラ同期', '死活OK', '立ち上げ完了']

function fmtExpiry(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now()
  if (ms <= 0) return '期限切れ'
  const h = Math.floor(ms / 3600_000)
  if (h >= 1) return `あと ${h} 時間`
  return `あと ${Math.max(1, Math.round(ms / 60_000))} 分`
}

export function ProvisioningClient({ stores, rows, canIssue = true }: { stores: Store[]; rows: ProvRow[]; canIssue?: boolean }) {
  const router = useRouter()
  const [storeId, setStoreId] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [issued, setIssued] = useState<Issued | null>(null)

  async function issue() {
    if (!storeId || !name.trim()) return
    setBusy(true); setErr(null); setIssued(null)
    try {
      const res = await fetch('/api/admin/enrollments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ store_id: storeId, name: name.trim(), kind: 'nvms' }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error ?? `発行失敗: ${res.status}`)
      setIssued({ id: j.id, token: j.token, short_code: j.short_code ?? null, expires_at: j.expires_at, origin: window.location.origin })
      setName('')
      router.refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function reissue(id: string) {
    if (!confirm('コードを再発行しますか？（古いコードは無効になります）')) return
    const res = await fetch(`/api/admin/enrollments/${id}/reissue`, { method: 'POST' })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) { alert(j.error === 'already_enrolled' ? '既に claim 済みのため再発行できません' : (j.error ?? `再発行失敗: ${res.status}`)); return }
    setIssued({ id: j.id, token: j.token, short_code: j.short_code ?? null, expires_at: j.expires_at, origin: window.location.origin })
    router.refresh()
  }

  const qrPayload = issued ? JSON.stringify({ v: 1, url: issued.origin, token: issued.token }) : ''

  return (
    <div className="space-y-5">
      {/* 発行 */}
      <section className="rounded-lg border border-slate-200 bg-white p-5 text-sm">
        <h2 className="mb-1 font-bold text-slate-900">エンロールコードを発行</h2>
        <p className="mb-3 text-xs text-slate-500">
          対象店舗を選んで発行すると、現地入力用の <b>QR と短縮コード</b>が 1 度だけ表示されます。
          コードは 24 時間・1 回限り。現地ではクラウド URL とこのコードだけで立ち上がります。
        </p>
        {!canIssue && (
          <p className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
            操作中テナントを選択すると発行できます（上部の「切替」から）。誤って別テナントへ発行しないための制限です。
          </p>
        )}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="block text-xs">
            <span className="mb-1 block font-medium text-slate-600">店舗</span>
            <select value={storeId} onChange={(e) => setStoreId(e.target.value)}
                    className="w-full rounded border border-slate-300 px-2 py-1 text-xs">
              <option value="">— 選択 —</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>{s.area_code ? `[${s.area_code}] ` : ''}{s.name}</option>
              ))}
            </select>
          </label>
          <label className="block text-xs">
            <span className="mb-1 block font-medium text-slate-600">名称（拠点/機器の呼び名）</span>
            <input value={name} onChange={(e) => setName(e.target.value)}
                   className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
                   placeholder="例: 梅田店 録画機" />
          </label>
        </div>
        <div className="mt-3 flex items-center justify-end gap-3">
          {err && <span className="mr-auto text-xs text-red-700">{err}</span>}
          <button onClick={issue} disabled={busy || !canIssue || !storeId || !name.trim()}
                  className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
            {busy ? '発行中…' : 'コードを発行'}
          </button>
        </div>

        {issued && (
          <div className="mt-4 rounded border border-emerald-200 bg-emerald-50 p-4">
            <p className="mb-3 text-xs font-semibold text-emerald-800">
              発行しました（この表示は1度きり・{fmtExpiry(issued.expires_at)}で失効）
            </p>
            <div className="flex flex-wrap items-center gap-5">
              <div className="rounded bg-white p-2">
                <QRCodeSVG value={qrPayload} size={168} level="M" />
              </div>
              <div className="text-xs">
                <div className="mb-1 font-medium text-slate-600">短縮コード（手入力用）</div>
                <code className="block rounded bg-slate-900 px-3 py-2 font-mono text-base tracking-widest text-emerald-200">
                  {issued.short_code ?? '—'}
                </code>
                <button onClick={() => { if (issued.short_code) void navigator.clipboard.writeText(issued.short_code) }}
                        className="mt-2 rounded border border-slate-300 bg-white px-2 py-1 text-[11px]">
                  短縮コードをコピー
                </button>
                <p className="mt-2 max-w-xs text-[11px] text-slate-500">
                  QR を nvmsd の初回セットアップで読み取り（または短縮コードを入力）。
                  URL は <code className="font-mono">{issued.origin}</code>。
                </p>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* 立ち上げ状況 */}
      <section className="rounded-lg border border-slate-200 bg-white text-sm">
        <div className="flex items-baseline gap-2 border-b border-slate-100 px-5 py-3">
          <h2 className="font-bold text-slate-900">立ち上げ状況</h2>
          <span className="text-[11px] text-slate-400">直近のエンロール（自分に見える店舗のみ）</span>
        </div>
        {rows.length === 0 ? (
          <p className="px-5 py-6 text-center text-xs text-slate-400">まだありません。上でコードを発行してください。</p>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-2 text-left">拠点 / 名称</th>
                <th className="px-4 py-2 text-left">進捗</th>
                <th className="px-4 py-2 text-left">状態</th>
                <th className="px-4 py-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const done = r.stage >= r.stages
                return (
                  <tr key={r.id} className="border-t border-slate-100 align-top">
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-slate-900">{r.storeName}</div>
                      <div className="text-slate-400">{r.name}</div>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5">
                        {Array.from({ length: r.stages }, (_, i) => (
                          <span key={i}
                                className={'h-2 w-6 rounded-full ' + (
                                  i < r.stage ? (done ? 'bg-emerald-500' : 'bg-blue-500') : 'bg-slate-200')} />
                        ))}
                      </div>
                      <div className={'mt-1 text-[11px] ' + (done ? 'text-emerald-700' : 'text-blue-700')}>
                        {r.stage}/{r.stages}・{STAGE_LABELS[r.stage] ?? ''}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">
                      {!r.used ? (
                        <span className={new Date(r.expiresAt).getTime() < Date.now() ? 'text-red-700' : ''}>
                          未claim（{fmtExpiry(r.expiresAt)}）
                        </span>
                      ) : (
                        <div className="space-y-0.5">
                          {r.runningVersion && <div>版 <span className="font-mono">{r.runningVersion}</span></div>}
                          <div>カメラ <span className="font-mono tabular-nums">{r.cameras.toLocaleString()}</span> 台
                            {r.nodesTotal != null && <> ・ノード <span className="font-mono">{r.nodesOk ?? '—'}/{r.nodesTotal}</span></>}</div>
                          {r.errors24h != null && r.errors24h > 0 && (
                            <div className="text-amber-700">エラー24h {r.errors24h} 件</div>
                          )}
                          {r.used && !r.healthFresh && r.stage >= 3 && (
                            <div className="text-slate-400">死活報告 待ち</div>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex flex-col items-end gap-1">
                        {!r.used && (
                          <button onClick={() => void reissue(r.id)}
                                  className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] hover:bg-slate-50">
                            再発行
                          </button>
                        )}
                        {r.edgeId && (
                          <a href={`/admin/edges/${r.edgeId}`} className="text-[11px] text-blue-600 hover:underline">
                            エッジ詳細 / 診断
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
