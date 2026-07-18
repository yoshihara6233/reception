'use client'

/**
 * 従業員マスタ（T6・管理UI）
 * 店舗毎の従業員登録・一覧。顔登録は撮影導線とあわせて別段（本画面は名簿）。
 * 空状態は「最初の従業員を登録」CTA（D7②）。
 */
import { useCallback, useEffect, useState } from 'react'

type Emp = { id: string; store_id: string; employee_code: string; name: string; active: boolean; rekognition_face_id: string | null }

export default function EmployeesPage() {
  const [rows, setRows] = useState<Emp[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({ storeId: '', employeeCode: '', name: '' })
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch('/api/v1/baggage/employees')
      if (!res.ok) { setError(res.status === 401 ? '認証が必要です' : '読み込みに失敗しました'); setRows([]); return }
      const json = await res.json(); setRows(json.employees ?? [])
    } catch { setError('読み込みに失敗しました'); setRows([]) }
  }, [])
  useEffect(() => { load() }, [load])

  const submit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault(); setMsg(null)
    const res = await fetch('/api/v1/baggage/employees', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(form),
    })
    if (res.ok) { setForm({ storeId: form.storeId, employeeCode: '', name: '' }); load() }
    else { const j = await res.json().catch(() => ({})); setMsg(j.error ?? '登録に失敗しました') }
  }, [form, load])

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '24px 20px' }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>従業員マスタ</h1>

      <form onSubmit={submit} style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap', alignItems: 'end' }}>
        <Field label="店舗ID" value={form.storeId} onChange={(v) => setForm({ ...form, storeId: v })} w={280} />
        <Field label="社員コード" value={form.employeeCode} onChange={(v) => setForm({ ...form, employeeCode: v })} w={140} />
        <Field label="氏名" value={form.name} onChange={(v) => setForm({ ...form, name: v })} w={180} />
        <button type="submit" style={{ height: 38, padding: '0 18px', background: 'var(--ge-accent)', color: '#fff',
          border: 'none', borderRadius: 4, fontFamily: 'inherit', fontWeight: 700, cursor: 'pointer' }}>登録</button>
        {msg && <span style={{ color: 'var(--ge-danger)', fontSize: 13 }}>{msg}</span>}
      </form>

      {rows === null && <p style={{ color: 'var(--ge-ink-3)' }}>読み込み中…</p>}
      {rows && rows.length === 0 && (
        <div style={{ border: '1px dashed var(--ge-line-2)', borderRadius: 8, padding: '36px 24px', textAlign: 'center',
          color: 'var(--ge-ink-3)', background: '#fff' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ge-ink-2)', marginBottom: 6 }}>
            {error ?? '従業員がまだ登録されていません'}
          </div>
          {!error && <p style={{ fontSize: 13 }}>上のフォームから最初の従業員を登録してください。<br />社員コードはシフトCSVの突合キーになります。</p>}
        </div>
      )}
      {rows && rows.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5, background: '#fff' }}>
          <thead><tr>{['社員コード', '氏名', '顔登録', '状態'].map((h) => (
            <th key={h} style={{ textAlign: 'left', padding: '8px 12px', borderBottom: '1px solid var(--ge-line-2)',
              fontSize: 12, color: 'var(--ge-ink-3)', fontWeight: 700 }}>{h}</th>))}</tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}>
              <td style={td}><span style={{ fontFamily: 'IBM Plex Mono, monospace' }}>{r.employee_code}</span></td>
              <td style={td}>{r.name}</td>
              <td style={td}>{r.rekognition_face_id ? '登録済み' : '未登録'}</td>
              <td style={td}>{r.active ? '有効' : '抹消'}</td>
            </tr>))}</tbody>
        </table>
      )}
    </div>
  )
}

function Field({ label, value, onChange, w }: { label: string; value: string; onChange: (v: string) => void; w: number }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--ge-ink-3)' }}>
      {label}
      <input value={value} onChange={(e) => onChange(e.target.value)} style={{ width: w, height: 38, padding: '0 10px',
        border: '1px solid var(--ge-line)', borderRadius: 4, fontFamily: 'inherit', fontSize: 14, background: '#fff' }} />
    </label>
  )
}
const td: React.CSSProperties = { padding: '10px 12px', borderBottom: '1px solid var(--ge-line)' }
