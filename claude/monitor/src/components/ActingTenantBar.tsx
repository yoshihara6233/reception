'use client'

/**
 * super_admin 用「操作中テナント」バー。
 * ①設定プレーン（店舗/ユーザ/検査設定 等）が今どのテナントに固定されているかを
 * 常時表示し、切替（テナント一覧へ）と解除を提供する。
 * 未選択時は注意表示＝この状態では店舗・ユーザ等の作成はできない。
 */
import Link from 'next/link'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function ActingTenantBar({ tenantName }: { tenantName: string | null }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function release() {
    setBusy(true)
    await fetch('/api/admin/acting-tenant', { method: 'DELETE' }).catch(() => {})
    setBusy(false)
    router.refresh()
  }

  if (!tenantName) {
    return (
      <div className="flex items-center gap-3 border-b border-amber-200 bg-amber-50 px-5 py-2 text-xs text-amber-800">
        <span className="font-bold">操作中テナント: 未選択</span>
        <span>店舗・ユーザ等を作成するには操作するテナントを選択してください。</span>
        <Link href="/admin/tenants" className="font-medium text-blue-700 underline">テナント一覧から選択</Link>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3 border-b border-blue-200 bg-blue-50 px-5 py-2 text-xs text-blue-900">
      <span className="font-bold">操作中テナント: {tenantName}</span>
      <Link href="/admin/tenants" className="text-blue-700 underline">切替</Link>
      <button onClick={release} disabled={busy} className="text-blue-700 underline disabled:opacity-50">
        解除
      </button>
    </div>
  )
}
