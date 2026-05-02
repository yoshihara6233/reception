import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { validateQrToken } from '@/lib/qr/validate'

// 入室記録なしで退室した visit を識別するマーカー
export const CHECKOUT_ONLY_PURPOSE = '__checkout_only__'

/** areas テーブルから store_id を取得 */
async function getStoreId(
  supabase: ReturnType<typeof createAdminClient>,
  areaId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('areas')
    .select('store_id')
    .eq('id', areaId)
    .single()
  return (data as { store_id: string } | null)?.store_id ?? null
}

/** 入室記録なし → 退室専用 visit を作成して ID を返す */
async function createCheckoutOnlyVisit(
  supabase: ReturnType<typeof createAdminClient>,
  opts: {
    tenantId: string
    visitorId: string
    areaId: string
  },
): Promise<string | null> {
  const storeId = await getStoreId(supabase, opts.areaId)
  if (!storeId) return null          // area が見つからない場合はスキップ

  const now = new Date().toISOString()
  const { data } = await supabase
    .from('visits')
    .insert({
      tenant_id:   opts.tenantId,
      visitor_id:  opts.visitorId,
      area_id:     opts.areaId,
      store_id:    storeId,
      purpose:     CHECKOUT_ONLY_PURPOSE,
      status:      'checked_out',
      check_in_at:  now,
      check_out_at: now,
    })
    .select('id')
    .single()
  return (data as { id: string } | null)?.id ?? null
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { token, visitorId, preToken } = body

    if (!token) {
      return NextResponse.json({ error: 'トークンが必要です' }, { status: 400 })
    }

    const qr = await validateQrToken(token)
    if (!qr.valid) {
      return NextResponse.json({ error: qr.error }, { status: 403 })
    }

    const supabase = createAdminClient()
    const deviceToken = req.headers.get('x-device-token')

    let visitToCheckout: { id: string; visitor_id: string } | null = null

    // ── Priority 1: visitorId (顔認証退室) ───────────────────────────────
    if (visitorId) {
      const { data } = await supabase
        .from('visits')
        .select('id, visitor_id')
        .eq('visitor_id', visitorId)
        .eq('tenant_id', qr.tenantId!)
        .eq('status', 'checked_in')
        .order('check_in_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (data) {
        visitToCheckout = data
      } else {
        // 入室記録なし → 退室専用 visit を作成
        const newId = await createCheckoutOnlyVisit(supabase, {
          tenantId:  qr.tenantId!,
          visitorId: visitorId as string,
          areaId:    qr.areaId!,
        })
        return NextResponse.json({ success: true, visitId: newId, tenantId: qr.tenantId })
      }

    // ── Priority 2: preToken (QR スキャン退室) ───────────────────────────
    } else if (preToken) {
      const { data: pre } = await supabase
        .from('pre_registrations')
        .select('visitor_id')
        .eq('pre_token', preToken)
        .eq('tenant_id', qr.tenantId!)
        .maybeSingle()

      if (!pre?.visitor_id) {
        return NextResponse.json({ error: '事前登録が見つかりません' }, { status: 404 })
      }

      const { data } = await supabase
        .from('visits')
        .select('id, visitor_id')
        .eq('visitor_id', pre.visitor_id)
        .eq('tenant_id', qr.tenantId!)
        .eq('status', 'checked_in')
        .order('check_in_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (data) {
        visitToCheckout = data
      } else {
        // 入室記録なし → 退室専用 visit を作成
        const newId = await createCheckoutOnlyVisit(supabase, {
          tenantId:  qr.tenantId!,
          visitorId: pre.visitor_id as string,
          areaId:    qr.areaId!,
        })
        return NextResponse.json({ success: true, visitId: newId, tenantId: qr.tenantId })
      }

    // ── Priority 3: deviceToken / エリア フォールバック ──────────────────
    } else {
      const { data: checkedInVisits } = await supabase
        .from('visits')
        .select('id, visitor_id, visitors(device_token)')
        .eq('area_id', qr.areaId!)
        .eq('tenant_id', qr.tenantId!)
        .eq('status', 'checked_in')
        .order('check_in_at', { ascending: false })

      if (checkedInVisits && checkedInVisits.length > 0) {
        // 入室記録あり → device_token で絞り込み or 最新を使う
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        visitToCheckout = checkedInVisits[0] as any
        if (deviceToken) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const matched = (checkedInVisits as any[]).find((v: any) => {
            const vis = v.visitors
            if (Array.isArray(vis)) return vis[0]?.device_token === deviceToken
            return vis?.device_token === deviceToken
          })
          if (matched) visitToCheckout = matched
        }
      } else {
        // 入室記録なし → device_token から visitor を探して退室専用 visit 作成
        if (deviceToken) {
          const { data: visitor } = await supabase
            .from('visitors')
            .select('id')
            .eq('device_token', deviceToken)
            .eq('tenant_id', qr.tenantId!)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()

          if (visitor) {
            const newId = await createCheckoutOnlyVisit(supabase, {
              tenantId:  qr.tenantId!,
              visitorId: (visitor as { id: string }).id,
              areaId:    qr.areaId!,
            })
            return NextResponse.json({ success: true, visitId: newId, tenantId: qr.tenantId })
          }
        }

        // visitor も特定できない場合でも退室は許可（記録は作成しない）
        return NextResponse.json({ success: true, visitId: null, tenantId: qr.tenantId })
      }
    }

    if (!visitToCheckout) {
      return NextResponse.json({ success: true, visitId: null, tenantId: qr.tenantId })
    }

    // visit を checked_out に更新
    const { error: updateError } = await supabase
      .from('visits')
      .update({
        status:       'checked_out',
        check_out_at: new Date().toISOString(),
      })
      .eq('id', visitToCheckout.id)

    if (updateError) {
      console.error('Checkout error:', updateError)
      return NextResponse.json({ error: '退室処理に失敗しました' }, { status: 500 })
    }

    return NextResponse.json({ success: true, visitId: visitToCheckout.id, tenantId: qr.tenantId })
  } catch (err) {
    console.error('Checkout error:', err)
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 })
  }
}
