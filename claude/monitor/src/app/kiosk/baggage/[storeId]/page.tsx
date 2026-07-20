/**
 * /kiosk/baggage/[storeId] — 手荷物検査 iPad キオスク（M3）
 *
 * iPad は admin_users アカウント（store_manager 等）でログインして常設運用する。
 * 設定は inspection_settings（RLS: baggage_store_access で店舗スコープ）。
 * 画面本体は KioskClient（SCREEN A〜F・ワイヤーフレーム v3 準拠）。
 */
import { redirect } from 'next/navigation'
import { createSupabaseServer } from '@/lib/supabase/server'
import { loadTenantSettings } from '@/lib/baggage/tenant-settings'
import { KioskClient } from './KioskClient'

export default async function BaggageKioskPage(
  { params }: { params: Promise<{ storeId: string }> },
) {
  const { storeId } = await params
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) redirect('/login')

  // 店舗固有（有効化）は inspection_settings、表示設定はテナント共通。
  const [{ data: store }, { data: s }] = await Promise.all([
    supa.from('stores').select('id, name, tenant_id').eq('id', storeId).maybeSingle(),
    supa.from('inspection_settings').select('enabled').eq('store_id', storeId).maybeSingle(),
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

  const tenant = await loadTenantSettings(supa, store.tenant_id)

  return (
    <KioskClient
      storeId={store.id}
      storeName={store.name}
      terminalMode={tenant.terminalMode}
      timeoutSec={tenant.timeoutSec}
      audioEnabled={tenant.audioEnabled}
      audioVolume={tenant.audioVolume}
      steps={tenant.steps}
    />
  )
}
