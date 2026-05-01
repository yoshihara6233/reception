/**
 * POST /api/v1/visitors/face-register
 *
 * チェックイン完了後に呼び出し、顔写真を AWS Rekognition に登録する。
 *
 * body: {
 *   visitId:          string   — チェックイン済みの visit ID
 *   facePhotoDataUrl: string   — base64 data URL (image/jpeg or image/png)
 * }
 *
 * response: {
 *   ok:         true
 *   faceId:     string
 *   confidence: number
 * }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { indexFace } from '@/lib/aws/rekognition'

// data URL → Buffer
function dataUrlToBuffer(dataUrl: string): Buffer {
  const base64 = dataUrl.split(',')[1]
  if (!base64) throw new Error('Invalid data URL')
  return Buffer.from(base64, 'base64')
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { visitId, visitorId: directVisitorId, facePhotoDataUrl } = body as {
      visitId?:         string
      visitorId?:       string   // 直接 visitorId を渡す場合 (来店者管理から顔登録)
      facePhotoDataUrl: string
    }

    if ((!visitId && !directVisitorId) || !facePhotoDataUrl) {
      return NextResponse.json({ error: 'visitId or visitorId and facePhotoDataUrl are required' }, { status: 400 })
    }

    const supabase = createAdminClient()

    let visitorId: string
    let tenantId: string

    if (directVisitorId) {
      // visitorId 直接指定 (来店者管理 → キオスク顔登録フロー)
      const { data: visitor, error: visitorErr } = await supabase
        .from('visitors')
        .select('id, tenant_id')
        .eq('id', directVisitorId)
        .single()

      if (visitorErr || !visitor) {
        return NextResponse.json({ error: '来訪者が見つかりません' }, { status: 404 })
      }

      visitorId = visitor.id
      tenantId  = visitor.tenant_id
    } else {
      // visit 経由 (通常チェックイン後フロー)
      const { data: visit, error: visitErr } = await supabase
        .from('visits')
        .select('visitor_id, tenant_id')
        .eq('id', visitId!)
        .single()

      if (visitErr || !visit) {
        return NextResponse.json({ error: '来訪が見つかりません' }, { status: 404 })
      }

      visitorId = visit.visitor_id
      tenantId  = visit.tenant_id
    }

    // 既に顔登録済みなら更新なし (重複防止)
    const { data: visitor } = await supabase
      .from('visitors')
      .select('face_id')
      .eq('id', visitorId)
      .single()

    if (visitor?.face_id) {
      // 既に登録済み: そのまま OK を返す
      return NextResponse.json({ ok: true, faceId: visitor.face_id, confidence: 100, skipped: true })
    }

    // AWS 認証情報が未設定の場合は顔認証機能が無効
    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
      return NextResponse.json({ error: 'Face auth is not configured on this server' }, { status: 503 })
    }

    // Rekognition にインデックス登録
    const imageBuffer = dataUrlToBuffer(facePhotoDataUrl)
    const { faceId, confidence } = await indexFace(tenantId, visitorId, imageBuffer)

    // 顔写真を Supabase Storage にも保存
    let facePhotoPath: string | null = null
    try {
      const storagePath = `${tenantId}/${visitorId}/face_${Date.now()}.jpg`
      const { error: uploadErr } = await supabase.storage
        .from('visit-photos')
        .upload(storagePath, imageBuffer, { contentType: 'image/jpeg', upsert: true })
      if (!uploadErr) facePhotoPath = storagePath
    } catch {
      // 写真保存失敗は非致命的
    }

    // DB 更新
    const { error: updateErr } = await supabase
      .from('visitors')
      .update({
        face_id:              faceId,
        face_registered_at:   new Date().toISOString(),
        face_auth_consent:    true,
        ...(facePhotoPath ? { face_photo_path: facePhotoPath } : {}),
      })
      .eq('id', visitorId)
      .eq('tenant_id', tenantId)

    if (updateErr) {
      // DB 更新失敗でも Rekognition 側は登録済みなのでログのみ
      console.error('[face-register] DB update failed:', updateErr.message)
    }

    return NextResponse.json({ ok: true, faceId, confidence })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'サーバーエラー'

    // 顔が検出されなかった場合は 422 (非致命的)
    if (message === 'Face not detected in image') {
      return NextResponse.json({ error: '顔が検出されませんでした' }, { status: 422 })
    }

    console.error('[face-register] error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
