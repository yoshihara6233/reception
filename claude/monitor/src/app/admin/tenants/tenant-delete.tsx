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
import { sameTenantName } from '@/lib/admin/tenant-name'

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

  const matches = sameTenantName(typed, name)
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

      {/* 押せる条件を手順として見せる (2026-10-05 の利用者の指摘)。以前は条件の説明が無く、
          停止すると何日か後に自動で消えるのか、なぜボタンが押せないのかが分からなかった。
          入力欄の placeholder にテナント名を出していたのも、入力済みに見えて紛らわしかった */}
      <ol className="space-y-1 rounded border border-slate-200 px-3 py-2 text-xs text-slate-600">
        <li>
          <span className={suspended ? 'font-bold text-emerald-700' : 'font-bold text-amber-700'}>
            {suspended ? '済' : '未'}
          </span>
          {' '}① 上の「ステータス」を「停止 (suspended)」にして保存する。
          <span className="text-slate-500">停止しただけでは何も消えず、日数が経っても自動では消えません（拠点からの受信とログインが止まるだけです）。</span>
        </li>
        <li>
          <span className={matches ? 'font-bold text-emerald-700' : 'font-bold text-amber-700'}>
            {matches ? '済' : '未'}
          </span>
          {' '}② 下の欄にテナント名をそのまま入力する（空白の全角・半角は問いません）。
        </li>
        <li>③「このテナントを削除」を押すと、その場で削除します。</li>
      </ol>

      {!suspended ? (
        <p className="rounded bg-amber-50 px-3 py-2 text-xs text-amber-800">
          まだ停止していないので削除できません。上の「ステータス」を「停止 (suspended)」にして保存してください。
        </p>
      ) : (
        <label className="block">
          <span className="mb-1 block text-[11px] font-bold tracking-wider text-slate-500">
            確認のため、テナント名「{name}」を入力
          </span>
          <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off"
                 aria-label="削除するテナントの名前"
                 className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm" placeholder="ここにテナント名を入力" />
        </label>
      )}

      {err && <p className="rounded bg-red-50 px-3 py-2 text-xs text-red-700">{err}</p>}

      <div className="flex items-center justify-end gap-3 border-t border-slate-100 pt-3">
        {!canDelete && !busy && (
          <span className="text-xs text-slate-500">
            {!suspended ? '① の停止が済むと押せます' : '② の名前を入力すると押せます'}
          </span>
        )}
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
