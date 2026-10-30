/**
 * GET /api/admin/stores/[id]/onvif-webhook — その店舗の ONVIF の Webhook の URL と鍵を返す
 * (2026-10-31・自主診断 ASVS 2.2.3)。
 *
 * 鍵は店舗ごと (lib/webhooks/onvif-token.ts)。NVR の設定に入れてもらうため、見える店舗の
 * 管理者にだけ返す (RLS で見えない店舗は 404)。鍵を返したことは監査ログに残す。
 * 鍵そのものは DB に持たないので、元の鍵 (ONVIF_WEBHOOK_SECRET) が無ければ 503。
 */
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin/guard'
import { recordAudit } from '@/lib/admin/audit'
import { appBaseUrl } from '@/lib/app-url'
import { onvifWebhookToken } from '@/lib/webhooks/onvif-token'

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const guard = await requireAdmin()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

  const { data: store } = await guard.supa.from('stores').select('id').eq('id', id).maybeSingle()
  if (!store) return NextResponse.json({ error: 'store_not_visible' }, { status: 404 })

  const token = onvifWebhookToken(store.id)
  if (!token) return NextResponse.json({ error: 'webhook_not_configured' }, { status: 503 })

  await recordAudit(guard.supa, {
    actorUserId: guard.user.id,
    action: 'store.onvif_webhook_token.read',
    targetType: 'store',
    targetId: store.id,
    storeId: store.id,
  })
  return NextResponse.json(
    { url: `${appBaseUrl()}/api/webhooks/onvif/${store.id}`, authorization: `Bearer ${token}` },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
