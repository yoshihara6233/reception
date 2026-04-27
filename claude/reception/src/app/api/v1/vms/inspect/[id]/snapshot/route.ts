/**
 * GET /api/v1/vms/inspect/[id]/snapshot?storeId=<id>
 *
 * VMS スナップショット画像のプロキシ。
 * VMS がオンプレミスでブラウザから直接アクセスできない場合に使う。
 * Content-Type: image/jpeg をそのまま転送するので <img src="..."> に直接指定可能。
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: inspectionId } = await params
  const storeId = new URL(req.url).searchParams.get('storeId')

  if (!storeId) {
    return NextResponse.json({ error: 'storeId は必須です' }, { status: 400 })
  }

  const admin = createAdminClient()

  const { data: store } = await admin
    .from('stores')
    .select('settings')
    .eq('id', storeId)
    .single()

  const settings = store?.settings as {
    vms_url?: string; vms_api_key?: string; vms_enabled?: boolean
  } | null

  if (!settings?.vms_enabled || !settings.vms_url || !settings.vms_api_key) {
    return new NextResponse('VMS未設定', { status: 400 })
  }

  try {
    const snapshotUrl = `${settings.vms_url}/api/v1/inspections/${inspectionId}/snapshot`
    const res = await fetch(snapshotUrl, {
      headers: { 'Authorization': `Bearer ${settings.vms_api_key}` },
    })

    if (!res.ok) {
      return new NextResponse('スナップショット取得失敗', { status: res.status })
    }

    const contentType = res.headers.get('content-type') || 'image/jpeg'
    const buffer = await res.arrayBuffer()

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=60',
      },
    })
  } catch (err) {
    console.error('[vms/snapshot] error:', err)
    return new NextResponse('VMS接続エラー', { status: 502 })
  }
}
