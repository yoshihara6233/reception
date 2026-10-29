'use client'

/**
 * 利用の状態 — 利用を止める／戻す・セッションを切る (2026-10-30・自主診断 ASVS 7.4.2・7.4.5)。
 * 利用者の編集画面 (テナントの利用者・運営の利用者) に置く。受け口は /api/admin/users/[id]/access。
 */
import { useEffect, useState } from 'react'

type State = { suspended: boolean; sessions: number }

const ERRORS: Record<string, string> = {
  cannot_target_self: 'ご自身は対象にできません。',
  cross_tenant_forbidden: 'この利用者は操作できません。',
  not_linked: 'ログインの紐付けが無い利用者です。',
  ban_failed: '利用の状態を変えられませんでした。時間をおいてお試しください。',
  revoke_failed: 'セッションを切れませんでした。時間をおいてお試しください。',
}

export function UserAccessSection({ id, name, self }: { id: string; name: string; self: boolean }) {
  const [state, setState] = useState<State | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    if (self) return
    fetch(`/api/admin/users/${id}/access`).then((r) => r.ok ? r.json() : null)
      .then((j) => { setState(j); setLoaded(true) })
      .catch(() => { setState(null); setLoaded(true) })
  }, [id, self])

  async function run(action: 'suspend' | 'resume' | 'revoke_sessions', question: string, done: string) {
    if (!confirm(question)) return
    setBusy(true)
    setMsg(null)
    const res = await fetch(`/api/admin/users/${id}/access`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    setBusy(false)
    const j = await res.json().catch(() => ({}))
    if (!res.ok) { setMsg(ERRORS[j.error] ?? `操作できませんでした（${j.error ?? res.status}）`); return }
    if (typeof j.suspended === 'boolean') setState({ suspended: j.suspended, sessions: j.sessions ?? 0 })
    setMsg(done)
  }

  const status = self
    ? 'ご自身の利用は、この画面では止められません。'
    : !loaded ? '確かめています…'
    : state === null ? '状態を読み込めませんでした。'
    : state.suspended ? '停止中（ログインできません）'
    : `利用中（ログイン中のセッション ${state.sessions.toLocaleString('ja-JP')} 件）`

  const btn = 'rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50'
  const danger = 'rounded border border-red-200 bg-white px-2 py-1 text-[11px] font-medium text-red-600 hover:bg-red-50 disabled:opacity-50'

  return (
    <section className="space-y-2 rounded-md border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-bold text-slate-900">利用の状態</h2>
      <p className="text-xs text-slate-600">{status}</p>
      {!self && state !== null && (
        <div className="flex flex-wrap gap-2">
          {state.suspended ? (
            <button type="button" className={btn} disabled={busy}
                    onClick={() => run('resume',
                      `「${name}」の利用を戻します。次のログインから使えます。戻しますか？`,
                      '利用を戻しました。次のログインから使えます。')}>
              利用を戻す
            </button>
          ) : (
            <>
              <button type="button" className={danger} disabled={busy}
                      onClick={() => run('suspend',
                        `「${name}」の利用を止めます。ログイン中の端末もすぐに使えなくなり、戻すまでログインできません（拠点の G・VMS へのサインインも含みます）。止めますか？`,
                        '利用を止めました。ログイン中の端末も使えなくなりました。')}>
                利用を止める
              </button>
              <button type="button" className={btn} disabled={busy || state.sessions === 0}
                      onClick={() => run('revoke_sessions',
                        `「${name}」のログイン中のセッションをすべて切ります。利用は止めないので、もう一度ログインすれば使えます。切りますか？`,
                        'セッションを切りました。次に使うときはログインし直しになります。')}>
                セッションを切る
              </button>
            </>
          )}
        </div>
      )}
      <p className="text-[11px] text-slate-500">操作はアクセスログに残ります。</p>
      {msg && <p className="text-xs text-slate-700">{msg}</p>}
    </section>
  )
}
