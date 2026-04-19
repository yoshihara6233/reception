import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(req: NextRequest) {
  try {
    const { visitId, tenantId, type, dataUrl } = await req.json()

    if (!visitId || !tenantId || !type || !dataUrl) {
      return NextResponse.json({ error: '必須パラメータが不足しています' }, { status: 400 })
    }
    if (!['card', 'face'].includes(type)) {
      return NextResponse.json({ error: '不正なphotoタイプです' }, { status: 400 })
    }

    // Convert base64 dataURL → Buffer
    const base64 = dataUrl.split(',')[1]
    if (!base64) {
      return NextResponse.json({ error: '不正な画像データです' }, { status: 400 })
    }
    const buffer = Buffer.from(base64, 'base64')

    const supabase = createAdminClient()

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

    // Insert visit_photos record
    const { error: dbError } = await supabase.from('visit_photos').insert({
      visit_id: visitId,
      tenant_id: tenantId,
      type,
      storage_path: storagePath,
    })

    if (dbError) {
      console.error('visit_photos insert error:', dbError)
      // Try to clean up the uploaded file
      await supabase.storage.from('visit-photos').remove([storagePath])
      return NextResponse.json({ error: '写真記録の保存に失敗しました' }, { status: 500 })
    }

    return NextResponse.json({ success: true, storagePath })
  } catch (err) {
    console.error('Photo upload error:', err)
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 })
  }
}
