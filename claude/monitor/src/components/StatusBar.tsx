/**
 * Bottom status bar: connection state, store online count, monitoring quota,
 * and (F25) the logged-in user identity (moved from AppHeader top-right).
 *
 * Server component — data is fetched fresh per request. For live updates,
 * wrap a small client component around the daily-minutes value if needed.
 */
import { createSupabaseServer } from '@/lib/supabase/server'

export async function StatusBar() {
  const supa = await createSupabaseServer()

  const [{ count: total }, { count: online }, { data: user }] = await Promise.all([
    supa.from('stores').select('*', { count: 'exact', head: true }),
    supa
      .from('edge_devices')
      .select('*', { count: 'exact', head: true })
      .neq('status', 'offline'),
    supa.auth.getUser(),
  ])

  let dailyMin = 0
  if (user.user) {
    const { data } = await supa.rpc('daily_session_minutes', { p_user_id: user.user.id })
    dailyMin = (data as number) ?? 0
  }

  // F25: derive a display name from user metadata or email
  const userName =
    (user.user?.user_metadata?.name as string | undefined) ??
    user.user?.email ??
    null

  return (
    <footer className="flex h-[22px] items-center gap-3 border-t border-slate-700 bg-slate-800 px-3 text-[11px] text-slate-300">
      <span>● 接続中</span>
      <span className="text-slate-500">|</span>
      <span>{online ?? 0} / {total ?? 0} 店舗オンライン</span>
      <span className="text-slate-500">|</span>
      <span>本日のモニタ時間: {dailyMin} 分 / 120 分</span>

      {/* Right-aligned: user identity + version */}
      <span className="ml-auto flex items-center gap-2">
        {userName && (
          <>
            <span className="block h-3.5 w-3.5 flex-shrink-0 rounded-full bg-gradient-to-br from-amber-400 to-red-500" />
            <span className="truncate max-w-[200px]" title={userName}>{userName}</span>
            <span className="text-slate-500">|</span>
          </>
        )}
        <span className="text-slate-500">v0.1.0</span>
      </span>
    </footer>
  )
}
