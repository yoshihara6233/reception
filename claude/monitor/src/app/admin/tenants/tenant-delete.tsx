'use client'

/**
 * テナントの削除（編集画面の下・super_admin）。2026-10-05
 *
 * 配下ごと消えて元に戻せないので、次の順でしか押せないようにしてある:
 *   1. 状態を「停止 (suspended)」にして保存する（いきなり消せない）
 *   2. 消える件数を見る
 *   3. テナント名を正確に打ち込む
 * サーバ側 (DELETE /api/admin/tenants/[id]) も同じ条件を確かめる。画面だけの安全策にしない。
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export interface TenantDeleteCounts {
  stores:  number
  users:   number
  edges:   number
  cameras: number
}

const ERR_LABELS: Record<string, string> = {
  not_suspended:            '先に状態を「停止」にして保存してください',
  name_mismatch:            'テナント名が一致しません',
  cannot_delete_own_tenant: '自分が所属するテナントは削除できません',
  tenant_has_super_admin:   '全体管理者が所属しているテナントは削除できません。先に全体管理者を別のテナントへ移してください',
  super_admin_only:         'テナントの削除は全体管理者のみ可能です',
  not_found:                'テナントが見つかりません（すでに削除された可能性があります）',
}

export function TenantDelete({ id, name, suspended, counts }: {
  id: string
  name: string
  suspended: boolean
  counts: TenantDeleteCounts
}) {
  const router = useRouter()
  const [typed, setTyped] = useState('')
  const [busy,  setBusy]  = useState(false)
  const [err,   setErr]   = useState<string | null>(null)

  const matches = typed.trim() === name.trim()
  const canDelete = suspended && matches && !busy

  async function remove() {
    if (!canDelete) return
    setErr(null); setBusy(true)
    const res = await fetch(`/api/admin/tenants/${id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm_name: typed }),
    })
    setBusy(false)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setErr(ERR_LABELS[j.error] ?? `削除できませんでした: ${j.error ?? res.status}${j.message ? `（${j.message}）` : ''}`)
      return
    }
    router.push('/admin/tenants')
    router.refresh()
  }

  return (
    <section className="space-y-3 rounded-lg border border-red-200 bg-white p-5 text-sm">
      <h2 className="text-sm font-bold text-red-700">テナントの削除</h2>
      <p className="text-xs leading-relaxed text-slate-600">
        このテナントと、配下の拠点・ユーザ・エッジ・レコーダ・カメラ・監視や発報の記録をすべて削除します。
        <b className="text-red-700">元に戻せません。</b>
        ユーザとエッジのログイン用アカウントも削除します。録画の切り出し・画像・報告書などの保存ファイルは削除しません。
      </p>

      <dl className="grid grid-cols-4 gap-2 rounded border border-slate-200 px-3 py-2 text-center">
        <Count label="拠点"   value={counts.stores} />
        <Count label="ユーザ" value={counts.users} />
        <Count label="エッジ" value={counts.edges} />
        <Count label="カメラ" value={counts.cameras} />
      </dl>

      {!suspended ? (
        <p className="rounded bg-amber-50 px-3 py-2 text-xs text-amber-800">
          削除するには、上の「ステータス」を「停止 (suspended)」にして保存してください。
        </p>
      ) : (
        <label className="block">
          <span className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-500">
            確認のため、テナント名「{name}」を入力
          </span>
          <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off"
                 className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm" placeholder={name} />
        </label>
      )}

      {err && <p className="rounded bg-red-50 px-3 py-2 text-xs text-red-700">{err}</p>}

      <div className="flex justify-end border-t border-slate-100 pt-3">
        <button type="button" onClick={remove} disabled={!canDelete}
                className="rounded border border-red-300 bg-white px-4 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40">
          {busy ? '削除中…' : 'このテナントを削除'}
        </button>
      </div>
    </section>
  )
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-[11px] text-slate-500">{label}</dt>
      <dd className="font-mono text-base font-bold tabular-nums">{value.toLocaleString()} 件</dd>
    </div>
  )
}
