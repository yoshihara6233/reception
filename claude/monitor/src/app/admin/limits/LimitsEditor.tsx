'use client'

/**
 * R1: テナント別の視聴上限エディタ。各行で「視聴時間上限(分)」「同時視聴上限」を編集し
 * 行ごとに保存（server action upsertSessionLimit）。既定値(120分/5)は薄字で明示。
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { upsertSessionLimit } from './actions'

export interface LimitRowVM {
  tenantId:      string
  name:          string
  maxSessionMin: number
  maxConcurrent: number
  hasRow:        boolean   // session_limits に個別行が有るか（無ければ既定を適用中）
}

export function LimitsEditor({ rows }: { rows: LimitRowVM[] }) {
  if (rows.length === 0) {
    return <p className="px-5 py-6 text-sm text-slate-500 dark:text-gedink3">対象テナントがありません。</p>
  }
  return (
    <div className="px-5 py-4">
      <p className="mb-3 text-[11px] text-slate-500 dark:text-gedink3">
        ライブ / 録画再生（VOD）の <b>1回の連続視聴時間</b>と<b>同時視聴数</b>の上限をテナント毎に設定します。
        未設定のテナントは既定（視聴時間 120 分 / 同時 5）で運用されます。16分割グリッドは上限対象外です。
      </p>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500 dark:border-gedline dark:text-gedink3">
            <th className="py-2 pr-3">テナント</th>
            <th className="py-2 pr-3 w-44">視聴時間上限（分）</th>
            <th className="py-2 pr-3 w-40">同時視聴上限</th>
            <th className="py-2 pr-3 w-40"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <LimitRow key={r.tenantId} row={r} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function LimitRow({ row }: { row: LimitRowVM }) {
  const router = useRouter()
  const [sessionMin, setSessionMin] = useState(String(row.maxSessionMin))
  const [concurrent, setConcurrent] = useState(String(row.maxConcurrent))
  const [busy, setBusy] = useState(false)
  const [msg, setMsg]   = useState<{ ok: boolean; text: string } | null>(null)

  const dirty =
    Number(sessionMin) !== row.maxSessionMin || Number(concurrent) !== row.maxConcurrent

  async function save() {
    setBusy(true)
    setMsg(null)
    const res = await upsertSessionLimit({
      tenantId:      row.tenantId,
      maxSessionMin: Number(sessionMin),
      maxConcurrent: Number(concurrent),
    })
    setBusy(false)
    if (res.ok) {
      setMsg({ ok: true, text: '保存しました' })
      router.refresh()
    } else {
      setMsg({ ok: false, text: res.error ?? '保存に失敗しました' })
    }
  }

  return (
    <tr className="border-b border-slate-100 dark:border-gedline/60">
      <td className="py-2 pr-3">
        <div className="font-medium text-slate-800 dark:text-gedink">{row.name}</div>
        {!row.hasRow && (
          <div className="text-[10px] text-slate-400 dark:text-gedink3">既定値を適用中（未設定）</div>
        )}
      </td>
      <td className="py-2 pr-3">
        <input
          type="number"
          min={1}
          max={1440}
          value={sessionMin}
          onChange={(e) => setSessionMin(e.target.value)}
          className="w-28 rounded border border-slate-300 px-2 py-1 text-sm dark:border-gedline dark:bg-gedbg2 dark:text-gedink"
        />
      </td>
      <td className="py-2 pr-3">
        <input
          type="number"
          min={1}
          max={1000}
          value={concurrent}
          onChange={(e) => setConcurrent(e.target.value)}
          className="w-24 rounded border border-slate-300 px-2 py-1 text-sm dark:border-gedline dark:bg-gedbg2 dark:text-gedink"
        />
      </td>
      <td className="py-2 pr-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={save}
            disabled={busy || !dirty}
            className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? '保存中…' : '保存'}
          </button>
          {msg && (
            <span className={msg.ok ? 'text-[11px] text-emerald-600' : 'text-[11px] text-red-600'}>
              {msg.text}
            </span>
          )}
        </div>
      </td>
    </tr>
  )
}
