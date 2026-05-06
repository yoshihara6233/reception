import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { validateQrToken } from '@/lib/qr/validate'

// VULN-009 FIX: Enforce max upload size server-side (5 MB base64 decoded ≈ 3.75 MB raw)
const MAX_PHOTO_BYTES = 5 * 1024 * 1024

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { visitId, tenantId, type, token } = body
    // photoData は旧キー名 (baggage upload から来る)、dataUrl は新キー名
    const dataUrl: string = body.dataUrl ?? body.photoData

    const ALLOWED_TYPES = ['card', 'face', 'baggage_contents', 'baggage_empty']

    if (!visitId || !tenantId || !type || !dataUrl) {
      return NextResponse.json({ error: '必須パラメータが不足しています' }, { status: 400 })
    }
    if (!ALLOWED_TYPES.includes(type)) {
      return NextResponse.json({ error: '不正なphotoタイプです' }, { status: 400 })
    }

    // VULN-002 FIX: Require QR token and verify the visit belongs to the same tenant/area.
    // Without this check, any caller could inject photos into arbitrary visits.
    if (!token) {
      return NextResponse.json({ error: 'QRトークンが必要です' }, { status: 401 })
    }
    const qr = await validateQrToken(token)
    if (!qr.valid) {
      return NextResponse.json({ error: qr.error }, { status: 403 })
    }
    // The tenantId in the body must match the QR token's tenant
    if (qr.tenantId !== tenantId) {
      return NextResponse.json({ error: '不正なテナントIDです' }, { status: 403 })
    }

    // Convert base64 dataURL → Buffer
    const base64 = dataUrl.split(',')[1]
    if (!base64) {
      return NextResponse.json({ error: '不正な画像データです' }, { status: 400 })
    }
    const buffer = Buffer.from(base64, 'base64')

    // VULN-009 FIX: Reject oversized payloads
    if (buffer.length > MAX_PHOTO_BYTES) {
      return NextResponse.json(
        { error: `写真サイズが上限（${MAX_PHOTO_BYTES / 1024 / 1024}MB）を超えています` },
        { status: 413 }
      )
    }

    const supabase = createAdminClient()

    // Verify the visitId actually belongs to this tenant (prevent cross-tenant injection)
    const { data: visit } = await supabase
      .from('visits')
      .select('id')
      .eq('id', visitId)
      .eq('tenant_id', tenantId)
      .maybeSingle()

    if (!visit) {
      return NextResponse.json({ error: '来訪記録が見つかりません' }, { status: 404 })
    }

    const storagePath = `${tenantId}/${visitId}/${type}_${Date.now()}.jpg`

    // Upload to Supabase Storage (bucket: visit-photos)
    const { error: uploadError } = await supabase.storage
      .from('visit-photos')
      .upload(storagePath, buffer, {
        contentType: 'image/jpeg',
        upsert: false,
      })

    if (uploadError) {
      console.error('Storage upload error:', uploadError)
      return NextResponse.json(
        { error: `写真のアップロードに失敗しました: ${uploadError.message}` },
        { status: 500 }
      )
    }

    // baggage photos: storage only (path saved via baggage_declarations)
    const isBaggageType = type === 'baggage_contents' || type === 'baggage_empty'
    if (!isBaggageType) {
      // Insert visit_photos record for face/card
      const { error: dbError } = await supabase.from('visit_photos').insert({
        visit_id: visitId,
        tenant_id: tenantId,
        type,
        storage_path: storagePath,
      })

      if (dbError) {
        console.error('visit_photos insert error:', dbError)
        await supabase.storage.from('visit-photos').remove([storagePath])
        return NextResponse.json({ error: '写真記録の保存に失敗しました' }, { status: 500 })
      }
    }

    return NextResponse.json({ success: true, storagePath })
  } catch (err) {
    console.error('Photo upload error:', err)
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 })
  }
}
