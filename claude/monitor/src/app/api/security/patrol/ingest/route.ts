/**
 * POST /api/security/patrol/ingest
 *
 * エッジが巡回スナップショットを上げる入口。device_token で edge を認証し、
 * 画像を Supabase Storage に保存、patrol_findings を更新する。
 *
 * 認証: Authorization: Bearer <device_token>
 * Body: multipart/form-data
 *   run_id     : string  (patrol_runs.id)
 *   camera_id  : string  (recorder_cameras.id)
 *   diff_score : string? (0..1。エッジが安価な差分を出せる場合。無ければ review 行き)
 *   image      : File    (JPEG/PNG スナップショット)
 *
 * 注: サーバ側のピクセル差分(pixelmatch)と AI 分析は P2/P3。本ルートは取込のみ。
 *     しきい値判定: diff_score >= sensitivity → anomaly、< → normal、無し → review。
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseService } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  // ── 1. Edge authentication via device_token
  const auth = req.headers.get('authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!token) return NextResponse.json({ error: 'missing device token' }, { status: 401 })

  const supa = createSupabaseService()

  const { data: edge } = await supa
    .from('edge_devices')
    .select('id, store_id')
    .eq('device_token', token)
    .maybeSingle()
  if (!edge) return NextResponse.json({ error: 'invalid device token' }, { status: 401 })

  // ── 2. Parse multipart body
  let form: FormData
  try { form = await req.formData() } catch {
    return NextResponse.json({ error: 'expected multipart/form-data' }, { status: 400 })
  }

  const runId    = String(form.get('run_id') ?? '')
  const cameraId = String(form.get('camera_id') ?? '')
  const rawDiff  = form.get('diff_score')
  const image    = form.get('image')

  if (!runId || !cameraId) {
    return NextResponse.json({ error: 'run_id and camera_id are required' }, { status: 400 })
  }
  if (!(image instanceof Blob)) {
    return NextResponse.json({ error: 'image file is required' }, { status: 400 })
  }

  // Validate run belongs to this edge's store (prevents cross-store injection)
  const { data: run } = await supa
    .from('patrol_runs')
    .select('id, store_id')
    .eq('id', runId)
    .maybeSingle()
  if (!run || run.store_id !== edge.store_id) {
    return NextResponse.json({ error: 'run not found for this device' }, { status: 404 })
  }

  // ── 3. Upload snapshot to Storage
  const ext  = (image.type === 'image/png') ? 'png' : 'jpg'
  const path = `${runId}/${cameraId}.${ext}`
  const bytes = Buffer.from(await image.arrayBuffer())

  const { error: upErr } = await supa
    .storage.from('security-snapshots')
    .upload(path, bytes, { contentType: image.type || 'image/jpeg', upsert: true })
  if (upErr) return NextResponse.json({ error: `storage: ${upErr.message}` }, { status: 500 })

  const { data: pub } = supa.storage.from('security-snapshots').getPublicUrl(path)
  const snapshotUrl = pub?.publicUrl ?? null

  // ── 4. Threshold decision (rule-based; server is the policy point)
  const { data: cfg } = await supa
    .from('security_camera_config')
    .select('sensitivity')
    .eq('camera_id', cameraId)
    .maybeSingle()
  const sensitivity = cfg?.sensitivity ?? 0.3

  const diffScore = rawDiff != null && rawDiff !== '' ? Number(rawDiff) : null
  let status: string
  if (diffScore == null || Number.isNaN(diffScore)) {
    status = 'review'                                  // 差分不明 → 人手トリアージ
  } else if (diffScore >= sensitivity) {
    status = 'anomaly'                                 // しきい値超え → 異常候補
  } else {
    status = 'normal'                                  // 正常（キューに出さない）
  }

  // AI: 設定で有効かつ異常候補なら分析待ち（実分析は P3 ワーカー）
  const { data: ss } = await supa
    .from('security_settings')
    .select('ai_enabled')
    .eq('store_id', edge.store_id)
    .maybeSingle()
  const aiStatus = (ss?.ai_enabled && status !== 'normal') ? 'pending' : 'none'

  // ── 5. Upsert finding (one per run+camera)
  const { data: existing } = await supa
    .from('patrol_findings')
    .select('id')
    .eq('run_id', runId)
    .eq('camera_id', cameraId)
    .maybeSingle()

  const fields = {
    run_id:       runId,
    camera_id:    cameraId,
    snapshot_url: snapshotUrl,
    diff_score:   diffScore,
    status,
    ai_status:    aiStatus,
  }

  if (existing) {
    await supa.from('patrol_findings').update(fields).eq('id', existing.id)
  } else {
    await supa.from('patrol_findings').insert(fields)
  }

  return NextResponse.json({ ok: true, status, ai_status: aiStatus, snapshot_url: snapshotUrl })
}
