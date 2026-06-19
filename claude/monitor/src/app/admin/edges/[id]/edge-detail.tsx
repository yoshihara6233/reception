'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Camera {
  id?: string                 // undefined until saved
  channel: number
  name: string
  grid_pos: number
  enabled: boolean
  frigate_camera: string | null
  _new?: boolean              // local-only marker
  _del?: boolean
  _dirty?: boolean
}
interface Recorder {
  id: string
  vendor: 'ipro' | 'uniview' | 'frigate' | 'onvif-generic'
  model: string | null
  host: string
  rtsp_port: number
  onvif_port: number | null
  username: string
  notes: string | null
  recorder_cameras: Camera[]
}
interface EdgePayload {
  id: string; name: string; status: string; agent_version: string | null; last_seen_at: string | null;
  store_id: string
  stores: { name: string; area_code: string | null }
  recorders: Recorder[]
}

export function EdgeDetail({ edge }: { edge: EdgePayload }) {
  const router = useRouter()

  async function deleteEdge() {
    if (!confirm(`エッジ "${edge.name}" を削除しますか？\n関連レコーダ・カメラ・セッションも削除されます。`)) return
    const res = await fetch(`/api/admin/edges/${edge.id}`, { method: 'DELETE' })
    if (res.ok) router.push('/admin/edges')
    else alert(`削除失敗: ${res.status}`)
  }

  return (
    <div className="space-y-5">
      {/* Edge summary */}
      <section className="rounded-lg border border-slate-200 bg-white p-5 text-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-bold text-slate-900">エッジサーバ情報</h2>
          <button onClick={deleteEdge} className="rounded border border-red-200 px-3 py-1 text-xs text-red-700 hover:bg-red-50">
            🗑 削除
          </button>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
          <Row k="店舗"        v={`${edge.stores.area_code ? `[${edge.stores.area_code}] ` : ''}${edge.stores.name}`} />
          <Row k="状態"        v={edge.status} />
          <Row k="バージョン"  v={edge.agent_version ?? '—'} />
          <Row k="最終接続"    v={edge.last_seen_at ? new Date(edge.last_seen_at).toLocaleString('ja-JP') : '—'} />
        </dl>
      </section>

      {/* Recorders */}
      <RecorderList edgeId={edge.id} recorders={edge.recorders} />
    </div>
  )
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[100px_1fr]">
      <dt className="text-slate-500">{k}</dt>
      <dd className="text-slate-900">{v}</dd>
    </div>
  )
}

function RecorderList({ edgeId, recorders }: { edgeId: string; recorders: Recorder[] }) {
  const router = useRouter()
  const [adding, setAdding] = useState(false)

  async function addRecorder(form: NewRecorder) {
    const res = await fetch('/api/admin/recorders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ edge_id: edgeId, ...form }),
    })
    if (res.ok) { setAdding(false); router.refresh() }
    else alert(`登録失敗: ${res.status}`)
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 text-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-bold text-slate-900">レコーダ ({recorders.length})</h2>
        <button onClick={() => setAdding(true)}
                className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700">
          ＋ レコーダ追加
        </button>
      </div>

      {adding && <NewRecorderForm onCancel={() => setAdding(false)} onSubmit={addRecorder} />}

      <div className="space-y-3">
        {recorders.map((r) => (
          <RecorderCard key={r.id} recorder={r} />
        ))}
        {recorders.length === 0 && !adding && (
          <p className="rounded border border-dashed border-slate-300 py-6 text-center text-xs text-slate-400">
            レコーダが未登録です。「＋ レコーダ追加」から登録してください。
          </p>
        )}
      </div>
    </section>
  )
}

type NewRecorder = {
  vendor: 'ipro' | 'uniview' | 'frigate' | 'onvif-generic'
  model: string
  host: string
  rtsp_port: number
  onvif_port: number | null
  username: string
  password: string
  notes: string
}

const VENDOR_DEFAULTS: Record<NewRecorder['vendor'], Partial<NewRecorder>> = {
  uniview:          { rtsp_port: 554,  username: 'admin', password: '' },
  ipro:             { rtsp_port: 554,  username: 'admin', password: '' },
  frigate:          { rtsp_port: 8554, username: '',      password: '' },
  // カメラ直 ONVIF: ONVIF は通常 80、RTSP は 554。1行=1カメラ。
  'onvif-generic':  { rtsp_port: 554,  onvif_port: 80, username: 'admin', password: '' },
}

function vendorLabel(v: NewRecorder['vendor']) {
  if (v === 'ipro')           return 'i-PRO'
  if (v === 'frigate')        return 'Frigate (OSS-VMS)'
  if (v === 'onvif-generic')  return 'ONVIFカメラ直'
  return 'Uniview'
}

function NewRecorderForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (r: NewRecorder) => void
  onCancel: () => void
}) {
  const [r, setR] = useState<NewRecorder>({
    vendor: 'uniview', model: '', host: '', rtsp_port: 554, onvif_port: null,
    username: 'admin', password: '', notes: '',
  })

  function changeVendor(v: NewRecorder['vendor']) {
    setR((prev) => ({ ...prev, vendor: v, ...VENDOR_DEFAULTS[v] }))
  }

  const isFrigate = r.vendor === 'frigate'
  const canSubmit = !!r.host && (isFrigate || (!!r.username && !!r.password))

  return (
    <div className="mb-3 rounded border border-blue-200 bg-blue-50 p-3 text-xs">
      <h3 className="mb-2 font-bold text-blue-900">レコーダ新規登録</h3>
      <div className="grid grid-cols-4 gap-2">
        <Field label="ベンダ">
          <select value={r.vendor} onChange={(e) => changeVendor(e.target.value as NewRecorder['vendor'])}
                  className="w-full rounded border border-slate-300 px-2 py-1">
            <option value="uniview">Uniview</option>
            <option value="ipro">i-PRO</option>
            <option value="onvif-generic">ONVIFカメラ直</option>
            <option value="frigate">Frigate (OSS-VMS)</option>
          </select>
        </Field>
        <Field label="機種 / メモ">
          <input value={r.model} onChange={(e) => setR({ ...r, model: e.target.value })}
                 className="w-full rounded border border-slate-300 px-2 py-1"
                 placeholder={isFrigate ? 'Frigate 等' : 'WJ-NX410 等'} />
        </Field>
        <Field label="ホスト (IP)">
          <input required value={r.host} onChange={(e) => setR({ ...r, host: e.target.value })}
                 className="w-full rounded border border-slate-300 px-2 py-1 font-mono"
                 placeholder="192.168.1.10" />
        </Field>
        <Field label={isFrigate ? 'RTSP ポート (mediamtx)' : 'RTSP ポート'}>
          <input type="number" value={r.rtsp_port}
                 onChange={(e) => setR({ ...r, rtsp_port: Number(e.target.value) })}
                 className="w-full rounded border border-slate-300 px-2 py-1 font-mono" />
        </Field>
        {!isFrigate && (
          <Field label="ONVIF ポート (任意)">
            <input type="number" value={r.onvif_port ?? ''}
                   onChange={(e) => setR({ ...r, onvif_port: e.target.value === '' ? null : Number(e.target.value) })}
                   className="w-full rounded border border-slate-300 px-2 py-1 font-mono" />
          </Field>
        )}
        {!isFrigate && (
          <Field label="ユーザ名">
            <input required value={r.username} onChange={(e) => setR({ ...r, username: e.target.value })}
                   className="w-full rounded border border-slate-300 px-2 py-1" />
          </Field>
        )}
        {!isFrigate && (
          <Field label="パスワード">
            <input required type="password" value={r.password}
                   onChange={(e) => setR({ ...r, password: e.target.value })}
                   className="w-full rounded border border-slate-300 px-2 py-1" />
          </Field>
        )}
        {isFrigate && (
          <Field label="備考">
            <input value={r.notes} onChange={(e) => setR({ ...r, notes: e.target.value })}
                   className="w-full rounded border border-slate-300 px-2 py-1"
                   placeholder="Frigate の URL などを記録" />
          </Field>
        )}
        {!isFrigate && (
          <Field label="メモ">
            <input value={r.notes} onChange={(e) => setR({ ...r, notes: e.target.value })}
                   className="w-full rounded border border-slate-300 px-2 py-1" />
          </Field>
        )}
      </div>
      {isFrigate && (
        <p className="mt-2 rounded bg-amber-50 border border-amber-200 px-2 py-1.5 text-[10px] text-amber-800">
          Frigate は認証なしで接続します。カメラごとのストリーム名 (例: <code>camera_01</code>) は、
          下のカメラ一覧の「Frigate カメラ名」列で設定してください。未設定の場合は ch 番号から自動生成されます。
        </p>
      )}
      <div className="mt-3 flex justify-end gap-2">
        <button onClick={onCancel} className="rounded border border-slate-300 bg-white px-3 py-1 text-xs">
          キャンセル
        </button>
        <button onClick={() => onSubmit(r)}
                disabled={!canSubmit}
                className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50">
          登録
        </button>
      </div>
    </div>
  )
}

function RecorderCard({ recorder }: { recorder: Recorder }) {
  const router = useRouter()
  const [cams, setCams]   = useState<Camera[]>(
    [...recorder.recorder_cameras].sort((a, b) => a.channel - b.channel)
  )
  const [busy, setBusy]   = useState(false)
  const [msg,  setMsg]    = useState<string | null>(null)

  function update(idx: number, patch: Partial<Camera>) {
    setCams((cs) => cs.map((c, i) => i === idx ? { ...c, ...patch, _dirty: !c._new } : c))
  }
  function addCam() {
    const maxCh   = Math.max(0, ...cams.map((c) => c.channel))
    const usedPos = new Set(cams.filter((c) => !c._del).map((c) => c.grid_pos))
    const nextPos = [...Array(16).keys()].find((i) => !usedPos.has(i)) ?? 0
    setCams((cs) => [...cs, { channel: maxCh + 1, name: `ch${maxCh + 1}`, grid_pos: nextPos, enabled: true, frigate_camera: null, _new: true }])
  }
  function removeCam(idx: number) {
    setCams((cs) => cs.map((c, i) => i === idx ? { ...c, _del: true } : c))
  }

  async function save() {
    setBusy(true); setMsg(null)
    const payload = {
      upsert: cams.filter((c) => !c._del && (c._new || c._dirty)),
      delete: cams.filter((c) => c._del && c.id).map((c) => c.id!),
    }
    const res = await fetch(`/api/admin/recorders/${recorder.id}/cameras`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    setBusy(false)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setMsg(j.error ?? `保存失敗: ${res.status}`)
      return
    }
    setMsg('保存しました')
    router.refresh()
  }

  async function deleteRec() {
    if (!confirm(`レコーダ ${recorder.host} を削除しますか？`)) return
    const res = await fetch(`/api/admin/recorders/${recorder.id}`, { method: 'DELETE' })
    if (res.ok) router.refresh()
    else alert(`削除失敗: ${res.status}`)
  }

  const visible = cams.filter((c) => !c._del)

  return (
    <div className="rounded border border-slate-200">
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2">
        <div className="text-xs">
          <span className="font-bold">{vendorLabel(recorder.vendor)}</span>
          <span className="ml-2 text-slate-500">{recorder.model ?? '—'}</span>
          <span className="ml-2 font-mono text-slate-700">{recorder.host}:{recorder.rtsp_port}</span>
        </div>
        <div className="flex gap-2">
          <button onClick={addCam} className="rounded bg-white border border-slate-200 px-2 py-0.5 text-xs">＋ カメラ</button>
          <button onClick={deleteRec} className="rounded border border-red-200 px-2 py-0.5 text-xs text-red-700">🗑 削除</button>
        </div>
      </div>
      <table className="w-full text-xs">
        <thead className="bg-slate-50/60 text-[10px] font-bold uppercase tracking-wider text-slate-500">
          <tr>
            <th className="px-2 py-1.5 text-left w-14">ch</th>
            <th className="px-2 py-1.5 text-left">カメラ名</th>
            {recorder.vendor === 'frigate' && (
              <th className="px-2 py-1.5 text-left w-36">Frigate カメラ名</th>
            )}
            <th className="px-2 py-1.5 text-left w-24">grid 位置</th>
            <th className="px-2 py-1.5 text-left w-16">有効</th>
            <th className="px-2 py-1.5 w-10"></th>
          </tr>
        </thead>
        <tbody>
          {visible.map((c, i) => {
            const realIdx = cams.indexOf(c)
            return (
              <tr key={c.id ?? `new-${i}`} className="border-t border-slate-100">
                <td className="px-2 py-1">
                  <input type="number" value={c.channel} min={1} max={64}
                         onChange={(e) => update(realIdx, { channel: Number(e.target.value) })}
                         className="w-12 rounded border border-slate-200 px-1 py-0.5 font-mono" />
                </td>
                <td className="px-2 py-1">
                  <input value={c.name} onChange={(e) => update(realIdx, { name: e.target.value })}
                         className="w-full rounded border border-slate-200 px-1 py-0.5" />
                </td>
                {recorder.vendor === 'frigate' && (
                  <td className="px-2 py-1">
                    <input value={c.frigate_camera ?? ''}
                           onChange={(e) => update(realIdx, { frigate_camera: e.target.value || null })}
                           className="w-full rounded border border-slate-200 px-1 py-0.5 font-mono"
                           placeholder={`camera_${String(c.channel).padStart(2, '0')}`} />
                  </td>
                )}
                <td className="px-2 py-1">
                  <select value={c.grid_pos} onChange={(e) => update(realIdx, { grid_pos: Number(e.target.value) })}
                          className="rounded border border-slate-200 px-1 py-0.5">
                    {[...Array(16).keys()].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </td>
                <td className="px-2 py-1">
                  <input type="checkbox" checked={c.enabled}
                         onChange={(e) => update(realIdx, { enabled: e.target.checked })} />
                </td>
                <td className="px-2 py-1 text-right">
                  <button onClick={() => removeCam(realIdx)} className="text-red-600">×</button>
                </td>
              </tr>
            )
          })}
          {visible.length === 0 && (
            <tr><td colSpan={recorder.vendor === 'frigate' ? 6 : 5} className="px-2 py-3 text-center text-slate-400">カメラ未登録</td></tr>
          )}
        </tbody>
      </table>
      <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-3 py-2 text-xs">
        {msg ? <span className="text-emerald-700">{msg}</span> : <span />}
        <button onClick={save} disabled={busy}
                className="rounded bg-blue-600 px-3 py-1 font-medium text-white disabled:opacity-50">
          {busy ? '保存中…' : 'カメラを保存'}
        </button>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</span>
      {children}
    </label>
  )
}
