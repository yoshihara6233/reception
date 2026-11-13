/**
 * クライアント計測 ingest（C3）。ライブの初フレーム遅延(ttff_ms)等をブラウザから受ける。
 * 認証必須・kind は許可リストのみ・user_id はサーバ側で確定（詐称防止）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import { recordMetric, CLIENT_METRIC_KINDS, type ClientMetricKind } from '@/lib/metrics'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const META_MAX_CHARS = 2000

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

  // 拠点とカメラは、この利用者の権限 (RLS) で見えるものだけを受ける (2026-11-13・見直しの続き)。
  // 書き込みは service role なので、確かめないと他テナントの拠点・カメラの ID で行を書けた。
  // 形の違う ID・見えない ID は 404 (存在を教えない)。
  const storeId  = body.storeId  ?? null
  const cameraId = body.cameraId ?? null
  if (storeId != null) {
    if (typeof storeId !== 'string' || !UUID_RE.test(storeId)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    const { data } = await supa.from('stores').select('id').eq('id', storeId).maybeSingle()
    if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  if (cameraId != null) {
    if (typeof cameraId !== 'string' || !UUID_RE.test(cameraId)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    const { data } = await supa.from('recorder_cameras').select('id').eq('id', cameraId).maybeSingle()
    if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  // meta は小さい付け足しだけ (大きいものは捨てる。計測の本体は value)
  let meta = body.meta ?? null
  if (meta != null && (typeof meta !== 'object' || Array.isArray(meta) || JSON.stringify(meta).length > META_MAX_CHARS)) meta = null

  await recordMetric({
    kind:     body.kind,
    storeId,
    cameraId,
    userId:   user.id,
    value,
    meta,
  })
  return NextResponse.json({ ok: true })
}
