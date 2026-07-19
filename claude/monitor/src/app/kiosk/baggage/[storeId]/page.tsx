/**
 * /kiosk/baggage/[storeId] — 手荷物検査 iPad キオスク（M3）
 *
 * iPad は admin_users アカウント（store_manager 等）でログインして常設運用する。
 * 設定は inspection_settings（RLS: baggage_store_access で店舗スコープ）。
 * 画面本体は KioskClient（SCREEN A〜F・ワイヤーフレーム v3 準拠）。
 */
import { redirect } from 'next/navigation'
import { createSupabaseServer } from '@/lib/supabase/server'
import { normalizeAnnounceSteps, type TerminalMode } from '@/lib/baggage/inspection-flow'
import { KioskClient } from './KioskClient'

export default async function BaggageKioskPage(
  { params }: { params: Promise<{ storeId: string }> },
) {
  const { storeId } = await params
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: store }, { data: s }] = await Promise.all([
    supa.from('stores').select('id, name').eq('id', storeId).maybeSingle(),
    supa
      .from('inspection_settings')
      .select('enabled, inspection_timeout_sec, terminal_mode, audio_enabled, audio_volume, announce_steps')
      .eq('store_id', storeId)
      .maybeSingle(),
  ])

  if (!store || !s?.enabled) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', gap: 12, background: '#F7F5F1', color: '#0F0F10',
        fontFamily: 'Noto Sans JP, sans-serif' }}>
        <div style={{ fontSize: 24, fontWeight: 700 }}>
          {store ? 'この店舗では手荷物検査オプションが有効になっていません' : '店舗が見つかりません'}
        </div>
        <div style={{ fontSize: 14, color: '#5B5B5F' }}>管理画面の手荷物検査設定をご確認ください。</div>
      </div>
    )
  }

  return (
    <KioskClient
      storeId={store.id}
      storeName={store.name}
      terminalMode={(s.terminal_mode ?? 'both') as TerminalMode}
      timeoutSec={Number(s.inspection_timeout_sec) || 120}
      audioEnabled={s.audio_enabled !== false}
      audioVolume={Number(s.audio_volume ?? 1)}
      steps={normalizeAnnounceSteps(s.announce_steps)}
    />
  )
}
