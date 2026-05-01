/**
 * POST /api/v1/visitors/face-search
 *
 * 顔写真で訪問者を検索し、マッチした訪問者情報を返す。
 * 顔認証チェックインフローで使用。
 *
 * body: {
 *   token:            string   — QR トークン (テナント特定用)
 *   facePhotoDataUrl: string   — base64 data URL
 * }
 *
 * response (match):
 * {
 *   matched:    true
 *   confidence: number       — 類似度 (0-100)
 *   visitor: {
 *     id, name, company, department, phone, email
 *   }
 * }
 *
 * response (no match):
 * {
 *   matched:    false
 *   confidence: 0
 * }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { searchFacesByImage } from '@/lib/aws/rekognition'

function dataUrlToBuffer(dataUrl: string): Buffer {
  const base64 = dataUrl.split(',')[1]
  if (!base64) throw new Error('Invalid data URL')
  return Buffer.from(base64, 'base64')
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { token, facePhotoDataUrl } = body as {
      token:            string
      facePhotoDataUrl: string
    }

    if (!token || !facePhotoDataUrl) {
      return NextResponse.json({ error: 'token and facePhotoDataUrl are required' }, { status: 400 })
    }

    const supabase = createAdminClient()

    // QR トークンからテナント ID を解決
    const { data: area, error: areaErr } = await supabase
      .from('areas')
      .select('tenant_id, store_id, name, stores(name)')
      .eq('qr_token', token)
      .eq('is_active', true)
      .single()

    if (areaErr || !area) {
      return NextResponse.json({ error: '無効なQRコードです' }, { status: 404 })
    }

    const tenantId = area.tenant_id

    // AWS 認証情報が未設定の場合は顔認証機能が無効
    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
      return NextResponse.json({ matched: false, confidence: 0, disabled: true })
    }

    // Rekognition で顔検索
    const imageBuffer = dataUrlToBuffer(facePhotoDataUrl)
    const result = await searchFacesByImage(tenantId, imageBuffer, 80)

    if (!result.matched || !result.visitorId) {
      return NextResponse.json({ matched: false, confidence: 0 })
    }

    // visitor 情報を取得
    const { data: visitor, error: visitorErr } = await supabase
      .from('visitors')
      .select('id, name, company, department, phone, email, face_auth_consent')
      .eq('id', result.visitorId)
      .eq('tenant_id', tenantId)
      .single()

    if (visitorErr || !visitor) {
      // DB に visitor がいない (データ不整合) → no match 扱い
      return NextResponse.json({ matched: false, confidence: 0 })
    }

    // 同意フラグ確認
    if (!visitor.face_auth_consent) {
      return NextResponse.json({ matched: false, confidence: 0 })
    }

    return NextResponse.json({
      matched:    true,
      confidence: result.confidence,
      visitor: {
        id:         visitor.id,
        name:       visitor.name,
        company:    visitor.company,
        department: visitor.department ?? '',
        phone:      visitor.phone ?? '',
        email:      visitor.email ?? '',
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'サーバーエラー'
    console.error('[face-search] error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
