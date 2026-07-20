'use client'

/**
 * iPadキオスクのPINログイン画面（未ログイン時に表示）。
 * 6桁PINをオンスクリーンのテンキーで入力し /api/baggage/kiosk/pin-login へ。
 * 成功でキオスクセッション cookie が発行され、ページを再読込してキオスク本体へ。
 * 端末は据え置き運用のため、常設ログインの代わりに店舗PINで開始できる。
 */
import { useState } from 'react'

export function KioskPinGate({ storeId, storeName }: { storeId: string; storeName: string | null }) {
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (value: string) => {
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/baggage/kiosk/pin-login', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ storeId, pin: value }),
      })
      if (res.ok) { window.location.reload(); return }
      const j = await res.json().catch(() => null) as { error?: string; retryAfterSec?: number } | null
      if (j?.error === 'locked') {
        const min = Math.ceil((j.retryAfterSec ?? 900) / 60)
        setError(`試行が多すぎます。約 ${min} 分後にお試しください。`)
      } else {
        setError('PINが違います。')
      }
      setPin('')
    } catch {
      setError('通信に失敗しました。')
      setPin('')
    } finally {
      setBusy(false)
    }
  }

  const press = (d: string) => {
    if (busy || pin.length >= 6) return
    const next = pin + d
    setPin(next)
    if (next.length === 6) void submit(next)
  }
  const back = () => { if (!busy) setPin((p) => p.slice(0, -1)) }
  const clear = () => { if (!busy) setPin('') }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', gap: 24, background: '#F7F5F1', color: '#0F0F10',
      fontFamily: 'Noto Sans JP, sans-serif' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 14, color: '#5B5B5F' }}>{storeName ?? '手荷物検査'}</div>
        <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>PINを入力してください</div>
      </div>

      {/* 6桁ドット表示 */}
      <div style={{ display: 'flex', gap: 14 }}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} style={{
            width: 18, height: 18, borderRadius: '50%',
            background: i < pin.length ? '#2C4A7E' : 'transparent',
            border: `2px solid ${i < pin.length ? '#2C4A7E' : '#C9C6BF'}`,
          }} />
        ))}
      </div>

      <div style={{ minHeight: 20, color: '#A3332B', fontSize: 14 }}>{error ?? ''}</div>

      {/* テンキー */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 88px)', gap: 12 }}>
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} onClick={() => press(d)} disabled={busy}
            style={{ height: 72, fontSize: 28, borderRadius: 8, border: '1px solid #C9C6BF',
              background: '#FFFFFF', color: '#0F0F10', cursor: 'pointer' }}>
            {d}
          </button>
        ))}
        <button onClick={clear} disabled={busy}
          style={{ height: 72, fontSize: 15, borderRadius: 8, border: '1px solid #C9C6BF',
            background: 'transparent', color: '#5B5B5F', cursor: 'pointer' }}>
          クリア
        </button>
        <button onClick={() => press('0')} disabled={busy}
          style={{ height: 72, fontSize: 28, borderRadius: 8, border: '1px solid #C9C6BF',
            background: '#FFFFFF', color: '#0F0F10', cursor: 'pointer' }}>
          0
        </button>
        <button onClick={back} disabled={busy}
          style={{ height: 72, fontSize: 20, borderRadius: 8, border: '1px solid #C9C6BF',
            background: 'transparent', color: '#5B5B5F', cursor: 'pointer' }}>
          ←
        </button>
      </div>
    </div>
  )
}
