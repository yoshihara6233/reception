'use client'

import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export function LogoutButton() {
  const router = useRouter()

  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/admin/login')
    router.refresh()
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
