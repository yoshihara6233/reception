/**
 * /kiosk/baggage/[storeId] — 手荷物検査 iPad キオスク（M3）
 *
 * iPad は admin_users アカウント（store_manager 等）でログインして常設運用する。
 * 設定は inspection_settings（RLS: baggage_store_access で店舗スコープ）。
 * 画面本体は KioskClient（SCREEN A〜F・ワイヤーフレーム v3 準拠）。
 */
import type { Metadata } from 'next'
import { createSupabaseService } from '@/lib/supabase/server'
import { loadTenantSettings } from '@/lib/baggage/tenant-settings'
import { resolveKioskOrAdmin } from '@/lib/baggage/kiosk-guard'
import { KioskClient } from './KioskClient'
import { KioskPinGate } from './KioskPinGate'

// キオスク画面のみ store 別 manifest を参照させ、「ホーム画面に追加」で
// 作られるアイコンが管理画面(/stores)ではなくこのキオスク画面を開くようにする。
// （アプリ共通 manifest の start_url は /stores のまま本部監視用に残す。）
export async function generateMetadata(
  { params }: { params: Promise<{ storeId: string }> },
): Promise<Metadata> {
  const { storeId } = await params
  return {
    manifest: `/kiosk/baggage/${storeId}/manifest.webmanifest`,
    appleWebApp: { capable: true, title: '手荷物検査', statusBarStyle: 'black-translucent' },
  }
}

function FullScreenMessage({ title, sub }: { title: string; sub?: string }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', gap: 12, background: '#F7F5F1', color: '#0F0F10',
      fontFamily: 'Noto Sans JP, sans-serif' }}>
      <div style={{ fontSize: 24, fontWeight: 700 }}>{title}</div>
      {sub && <div style={{ fontSize: 14, color: '#5B5B5F' }}>{sub}</div>}
    </div>
  )
}

export default async function BaggageKioskPage(
  { params }: { params: Promise<{ storeId: string }> },
) {
  const { storeId } = await params

  // PIN セッション or 手荷物検査ロールのログインで店舗を解決。
  const auth = await resolveKioskOrAdmin(storeId)
  if (!auth.ok) {
    // 未認証（ログインもPINも無い）→ PINパッド。店名だけ表示用に取得。
    if (auth.status === 401) {
      const svc = createSupabaseService()
      const { data: store } = await svc.from('stores').select('name').eq('id', storeId).maybeSingle()
      return <KioskPinGate storeId={storeId} storeName={store?.name ?? null} />
    }
    if (auth.status === 404) return <FullScreenMessage title="店舗が見つかりません" />
    return <FullScreenMessage title="この端末にはアクセス権がありません" sub="店舗のPIN、または担当店舗の権限をご確認ください。" />
  }

  const { svc, store } = auth
  const { data: s } = await svc.from('inspection_settings').select('enabled').eq('store_id', store.id).maybeSingle()
  if (!s?.enabled) {
    return <FullScreenMessage title="この店舗では手荷物検査オプションが有効になっていません" sub="管理画面の手荷物検査設定をご確認ください。" />
  }

  const tenant = await loadTenantSettings(svc, store.tenantId)

  return (
    <KioskClient
      storeId={store.id}
      storeName={store.name}
      terminalMode={tenant.terminalMode}
      timeoutSec={tenant.timeoutSec}
      audioEnabled={tenant.audioEnabled}
      audioVolume={tenant.audioVolume}
      steps={tenant.steps}
      consentText={tenant.consentText}
      consentVersion={tenant.consentVersion}
      entryGreetingText={tenant.entryGreetingText}
      exitMessageText={tenant.exitMessageText}
      buildId={(process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev').slice(0, 7)}
    />
  )
}
