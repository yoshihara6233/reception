/**
 * クライアント計測 ingest（C3）。ライブの初フレーム遅延(ttff_ms)等をブラウザから受ける。
 * 認証必須・kind は許可リストのみ・user_id はサーバ側で確定（詐称防止）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import { recordMetric, CLIENT_METRIC_KINDS, type ClientMetricKind } from '@/lib/metrics'

interface Body {
  kind:      string
  storeId?:  string | null
  cameraId?: string | null
  value?:    number | null
  meta?:     Record<string, unknown> | null
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let body: Body
  try { body = (await req.json()) as Body } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }) }

  if (!CLIENT_METRIC_KINDS.includes(body.kind as ClientMetricKind)) {
    return NextResponse.json({ error: 'invalid_kind' }, { status: 400 })
  }
  const value = typeof body.value === 'number' && Number.isFinite(body.value) ? body.value : null

  await recordMetric({
    kind:     body.kind,
    storeId:  body.storeId ?? null,
    cameraId: body.cameraId ?? null,
    userId:   user.id,
    value,
    meta:     body.meta ?? null,
  })
  return NextResponse.json({ ok: true })
}
