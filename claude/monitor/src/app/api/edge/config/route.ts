/**
 * GET /api/edge/config — nvmsd への設定配送（CONFIG_PUSH_SPEC §3.1）
 *
 * 204 = 変更なし（未設定 or 適用済みと同一）。200 = { config_version, recorderId, config }。
 * nvmsd は config_version が変わった時だけ適用する（冪等）。判断はサーバ側:
 * その edge の nvms レコーダの config_version と、edge が heartbeat で報告した
 * applied_config_version を突き合わせ、同一なら 204。
 *
 * 配る直前にも許可キー（EdgeConfigSchema）で**キー単位に**ふるう。契約から外したキー
 * （motion_sensitivity 等）が過去の保存に残っていても配らない。nvmsd は 1 つでもキーを
 * 捨てた版の applied を上げない（付録A.1）ので、残骸があると永久に「反映待ち」になるため。
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseService } from '@/lib/supabase/server'
import { authenticateEdge } from '@/lib/edge/device-auth'
import { allowedConfig } from '@/lib/edge/edge-config'
import { oidcConfigFor } from '@/lib/edge/gvms-oidc'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const edge = await authenticateEdge(req)
  if (!edge) return NextResponse.json({ error: 'invalid device token' }, { status: 401 })

  const svc = createSupabaseService()

  // アップリンクは 1 エッジ = 1 nvms レコーダ。desired は そのレコーダに載る。
  const { data: rec } = await svc
    .from('recorders')
    .select('id, desired_config, config_version')
    .eq('edge_id', edge.id)
    .eq('vendor', 'nvms')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  // ログインの一本化（§9）の oidc は、管理画面の設定（desired_config）とは別の表から足す
  // （管理画面の保存で消えないように）。クライアントが変わると heartbeat が版を上げる
  const oidc = await oidcConfigFor(svc, edge.id)
  if (!rec || !rec.config_version || rec.config_version === 0 || (!rec.desired_config && !oidc)) {
    return new NextResponse(null, { status: 204 })
  }

  // 適用済み版と同一なら配らない（無駄な取得を減らす）。
  const { data: dev } = await svc
    .from('edge_devices')
    .select('applied_config_version')
    .eq('id', edge.id)
    .maybeSingle()
  if (dev && dev.applied_config_version === rec.config_version) {
    return new NextResponse(null, { status: 204 })
  }

  return NextResponse.json(
    { config_version: rec.config_version, recorderId: rec.id,
      config: { ...allowedConfig(rec.desired_config), ...(oidc ? { oidc } : {}) } },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
