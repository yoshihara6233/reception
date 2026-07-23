'use client'

/**
 * テナント一覧の「操作」ボタン。押すと操作中テナント cookie を設定し、
 * ①設定プレーン（店舗）へ移動する＝以降の店舗/ユーザ/検査設定はこのテナントに固定。
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function ActAsTenantButton({ tenantId }: { tenantId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function act() {
    setBusy(true)
    const res = await fetch('/api/admin/acting-tenant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenant_id: tenantId }),
    }).catch(() => null)
    setBusy(false)
    if (res?.ok) {
      router.push('/admin/stores')
      router.refresh()
    }
  }

  return (
    <button
      onClick={act}
      disabled={busy}
      className="rounded bg-blue-600 px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-50"
    >
      {busy ? '…' : 'このテナントを操作'}
    </button>
  )
}
