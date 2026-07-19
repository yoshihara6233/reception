'use client'

/**
 * 従業員マスタ（M4・クライアント）— 追加・顔登録・登録抹消。
 * 顔登録は画像ファイル選択 → dataURL → API（Rekognition IndexFaces）。
 */
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

export interface EmployeeRow {
  id: string
  name: string
  employee_code: string | null
  face_photo_path: string | null
  rekognition_face_id: string | null
  created_at: string
}

const ERR_LABEL: Record<string, string> = {
  face_not_detected: '写真から顔を検出できませんでした。正面の顔がはっきり写った写真を使ってください。',
  rekognition_failed: '顔認証サービスへの登録に失敗しました（AWS 設定・接続をご確認ください）。',
  employee_code_duplicate: 'この社員コードは同じ店舗で既に使われています。',
}

export function EmployeesClient(
  { storeOptions, storeId, employees }: {
    storeOptions: { id: string; name: string }[]
    storeId: string
    employees: EmployeeRow[]
  },
) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState<string | null>(null)   // 実行中の操作キー
  const [msg, setMsg] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const faceTargetRef = useRef<string | null>(null)

  const fail = async (res: Response, fallback: string) => {
    const j = await res.json().catch(() => null) as { error?: string } | null
    setMsg(ERR_LABEL[j?.error ?? ''] ?? `${fallback}（${j?.error ?? res.status}）`)
  }

  const addEmployee = async () => {
    if (!name.trim()) return
    setBusy('add'); setMsg(null)
    try {
      const res = await fetch('/api/baggage/employees', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ storeId, name, employeeCode: code || null }),
      })
      if (!res.ok) { await fail(res, '登録に失敗しました'); return }
      setName(''); setCode(''); router.refresh()
    } finally { setBusy(null) }
  }

  const pickFace = (employeeId: string) => {
    faceTargetRef.current = employeeId
    fileRef.current?.click()
  }

  const onFile = async (f: File | null) => {
    const target = faceTargetRef.current
    if (!f || !target) return
    setBusy(`face:${target}`); setMsg(null)
    try {
      const image = await new Promise<string>((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve(String(r.result)); r.onerror = () => reject(r.error)
        r.readAsDataURL(f)
      })
      const res = await fetch(`/api/baggage/employees/${target}/face`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image }),
      })
      if (!res.ok) { await fail(res, '顔登録に失敗しました'); return }
      router.refresh()
    } finally {
      setBusy(null)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const deactivate = async (e: EmployeeRow) => {
    if (!window.confirm(`${e.name} を登録抹消します。顔データもコレクションから削除されます。よろしいですか？`)) return
    setBusy(`del:${e.id}`); setMsg(null)
    try {
      const res = await fetch(`/api/baggage/employees/${e.id}`, { method: 'DELETE' })
      if (!res.ok) { await fail(res, '抹消に失敗しました'); return }
      router.refresh()
    } finally { setBusy(null) }
  }

  // 顔データのみ削除（従業員は active のまま → キオスクのセルフ登録で撮り直せる）
  const deleteFace = async (e: EmployeeRow) => {
    if (!window.confirm(`${e.name} の顔データを削除します。キオスクの「はじめての方の顔登録」から再登録できます。よろしいですか？`)) return
    setBusy(`delface:${e.id}`); setMsg(null)
    try {
      const res = await fetch(`/api/baggage/employees/${e.id}/face`, { method: 'DELETE' })
      if (!res.ok) { await fail(res, '顔データの削除に失敗しました'); return }
      router.refresh()
    } finally { setBusy(null) }
  }

  return (
    <div className="space-y-4">
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
        onChange={(e) => onFile(e.target.files?.[0] ?? null)} />

      {/* 店舗切替 */}
      <form method="get" action="/baggage/employees" className="flex items-center gap-2 text-sm">
        <select name="store" defaultValue={storeId}
          className="rounded border border-slate-300 bg-white px-2 py-1.5 dark:border-gedline dark:bg-gedbg2 dark:text-gedink">
          {storeOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button type="submit"
          className="rounded border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50 dark:border-gedline dark:bg-gedbg2 dark:text-gedink dark:hover:bg-gedbg3">
          表示
        </button>
      </form>

      {msg && (
        <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
          {msg}
        </div>
      )}

      {/* 追加フォーム */}
      <div className="flex flex-wrap items-end gap-2 rounded border border-slate-200 bg-white p-3 text-sm dark:border-gedline dark:bg-gedbg2">
        <span className="w-full text-[12px] font-medium text-slate-700 dark:text-gedink2">
          追加先: {storeOptions.find((s) => s.id === storeId)?.name ?? '—'}
          <span className="ml-2 font-normal text-slate-500 dark:text-gedink3">（上の店舗選択に追加されます）</span>
        </span>
        <label className="flex flex-col gap-1 text-[11px] text-slate-500 dark:text-gedink3">
          氏名（姓 名・スペース区切り）
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="田中 花子"
            className="w-52 rounded border border-slate-300 px-2 py-1.5 text-sm text-slate-900 dark:border-gedline dark:bg-gedbg dark:text-gedink" />
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-slate-500 dark:text-gedink3">
          社員コード（任意・シフトCSV突合）
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="E1234"
            className="w-40 rounded border border-slate-300 px-2 py-1.5 text-sm text-slate-900 dark:border-gedline dark:bg-gedbg dark:text-gedink" />
        </label>
        <button onClick={addEmployee} disabled={busy !== null || !name.trim()}
          className="rounded bg-blue-700 px-3 py-2 text-[13px] font-medium text-white hover:bg-blue-800 disabled:opacity-40">
          {busy === 'add' ? '登録中…' : '従業員を追加'}
        </button>
      </div>

      {/* 一覧 */}
      <div className="overflow-x-auto rounded border border-slate-200 bg-white dark:border-gedline dark:bg-gedbg2">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-[11px] text-slate-500 dark:border-gedline dark:text-gedink3">
              <th className="px-3 py-2 font-medium">氏名</th>
              <th className="px-3 py-2 font-medium">社員コード</th>
              <th className="px-3 py-2 font-medium">顔登録</th>
              <th className="px-3 py-2 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {employees.length === 0 && (
              <tr><td colSpan={4} className="px-3 py-8 text-center text-slate-500 dark:text-gedink3">
                従業員が登録されていません
              </td></tr>
            )}
            {employees.map((e) => (
              <tr key={e.id} className="border-b border-slate-100 last:border-0 dark:border-gedline/50">
                <td className="px-3 py-2">{e.name}</td>
                <td className="px-3 py-2 font-mono tabular-nums">{e.employee_code ?? '—'}</td>
                <td className="px-3 py-2">
                  {e.rekognition_face_id
                    ? <span className="rounded bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">登録済み</span>
                    : <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">未登録</span>}
                </td>
                <td className="px-3 py-2">
                  <div className="flex gap-2">
                    <button onClick={() => pickFace(e.id)} disabled={busy !== null}
                      className="rounded border border-slate-300 px-2.5 py-1 text-[12px] hover:bg-slate-50 disabled:opacity-40 dark:border-gedline dark:text-gedink dark:hover:bg-gedbg3">
                      {busy === `face:${e.id}` ? '登録中…' : e.rekognition_face_id ? '顔を差し替え' : '顔を登録'}
                    </button>
                    {e.rekognition_face_id && (
                      <button onClick={() => deleteFace(e)} disabled={busy !== null}
                        className="rounded border border-slate-300 px-2.5 py-1 text-[12px] text-slate-600 hover:bg-slate-50 disabled:opacity-40 dark:border-gedline dark:text-gedink2 dark:hover:bg-gedbg3">
                        {busy === `delface:${e.id}` ? '削除中…' : '顔を削除'}
                      </button>
                    )}
                    <button onClick={() => deactivate(e)} disabled={busy !== null}
                      className="rounded border border-red-300 px-2.5 py-1 text-[12px] text-red-700 hover:bg-red-50 disabled:opacity-40 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20">
                      {busy === `del:${e.id}` ? '抹消中…' : '登録抹消'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[12px] text-slate-500 dark:text-gedink3">
        顔登録: 正面の顔がはっきり写った JPEG/PNG を選択してください。登録抹消で顔データは常設コレクションから即時削除されます。
      </p>
    </div>
  )
}
