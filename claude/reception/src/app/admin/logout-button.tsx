'use client'

import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export function LogoutButton({ compact }: { compact?: boolean } = {}) {
  const router = useRouter()

  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/admin/login')
    router.refresh()
  }

  if (compact) {
    return (
      <button
        onClick={handleLogout}
        style={{
          padding: '4px 10px', borderRadius: 4, cursor: 'pointer',
          font: '500 11px/1 var(--font-mono)', letterSpacing: '0.05em',
          background: 'var(--ge-paper-2)', color: 'var(--ge-ink-3)',
          border: '1px solid var(--ge-line)', flexShrink: 0,
        }}
      >
        ログアウト
      </button>
    )
  }

  return (
    <button
      onClick={handleLogout}
      className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-white/40 rounded-lg hover:bg-white/10 hover:text-white/70 transition-colors"
    >
      ログアウト
    </button>
  )
}
