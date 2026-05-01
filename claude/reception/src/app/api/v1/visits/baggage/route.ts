/**
 * POST /api/v1/visits/baggage
 * 来訪者の手荷物申告を保存する (2枚写真対応)
 * context: 'checkin' | 'checkout'
 *
 * inspectionMode = 'video' のとき、VMS が設定されていれば自動で
 * POST /api/v1/vms/inspect を呼び出し、hls_url と inspection_id を保存する。
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createVmsClient } from '@/lib/vms/client'

export async function POST(req: NextRequest) {
  try {
    const {
      visitId,
      tenantId,
      context,
      declaration,
      photoPathContents, // 中身写真のストレージパス
      photoPathEmpty,    // 空カバン写真のストレージパス
      inspectionMode,    // 'photo' | 'video'
      storeId,           // VMS呼び出しに必要 (任意)
      vmsCameraId,       // VMS camera ID (任意)
    } = await req.json()

    if (!visitId || !tenantId || !context) {
      return NextResponse.json({ error: '必須パラメータが不足しています' }, { status: 400 })
    }
    if (!['checkin', 'checkout'].includes(context)) {
      return NextResponse.json({ error: '不正なcontextです' }, { status: 400 })
    }

    const supabase = createAdminClient()

    // 既存レコードがあれば更新 (同一 visit + context の再送対策)
    const { data: existing } = await supabase
      .from('baggage_declarations')
      .select('id')
      .eq('visit_id', visitId)
      .eq('context', context)
      .maybeSingle()

    const fields = {
      declaration_text: declaration || null,
      photo_path_contents: photoPathContents || null,
      photo_path_empty: photoPathEmpty || null,
      // 後方互換: photo_path にも中身写真を保存
      photo_path: photoPathContents || null,
      inspection_mode: inspectionMode || 'photo',
      status: 'pending',
    }

    let declarationId: string

    if (existing) {
      const { error } = await supabase
        .from('baggage_declarations')
        .update(fields)
        .eq('id', existing.id)
      if (error) throw error
      declarationId = existing.id
    } else {
      const { data, error } = await supabase
        .from('baggage_declarations')
        .insert({ visit_id: visitId, tenant_id: tenantId, context, ...fields })
        .select('id')
        .single()
      if (error) throw error
      declarationId = data.id
    }

    // VMS連携: inspectionMode = 'video' かつ storeId がある場合
    let vmsInspectionId: string | null = null
    let vmsHlsUrl: string | null = null

    if (inspectionMode === 'video' && storeId) {
      try {
        // Fetch store VMS settings directly (no HTTP round-trip)
        const { data: store } = await supabase
          .from('stores')
          .select('settings')
          .eq('id', storeId)
          .single()

        const settings = store?.settings as {
          vms_url?: string
          vms_api_key?: string
          vms_enabled?: boolean
        } | null

        // vmsCameraId が渡されなかった場合は store_cameras から手荷物検査デスク (slot=2) のカメラを取得
        let resolvedCameraId: string | null = vmsCameraId || null
        if (!resolvedCameraId) {
          const { data: cameras } = await supabase
            .from('store_cameras')
            .select('slot, vms_camera_id, ipro_camera_id')
            .eq('store_id', storeId)
            .order('slot', { ascending: false }) // slot 2 (手荷物検査デスク) を優先
            .limit(2)
          // slot 2 (手荷物検査デスク) → slot 1 の順で有効なカメラIDを探す
          for (const cam of (cameras ?? [])) {
            const cid = cam.vms_camera_id || cam.ipro_camera_id
            if (cid) { resolvedCameraId = cid; break }
          }
        }

        if (settings?.vms_enabled && settings.vms_url && settings.vms_api_key && resolvedCameraId) {
          // VMS には inspection エンドポイントがないため、
          // 検査開始時刻のみ DB に記録する。
          // 録画の HLS URL は管理画面の録画ビューアで取得時に VMS から検索する。
          await supabase
            .from('baggage_declarations')
            .update({
              vms_inspection_id:    null,  // VMS は inspection を管理しない
              inspection_started_at: new Date().toISOString(),
            })
            .eq('id', declarationId)
        }
      } catch (vmsErr) {
        // VMS失敗は申告保存自体はブロックしない (ソフト失敗)
        console.warn('[baggage] VMS inspect failed (non-blocking):', vmsErr)
      }
    }

    return NextResponse.json({
      success: true,
      id: declarationId,
      vms_inspection_id: vmsInspectionId,
      vms_hls_url: vmsHlsUrl,
    })
  } catch (err) {
    console.error('[baggage] error:', err)
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 })
  }
}
