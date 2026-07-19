/**
 * GET /api/baggage/kiosk/employees?storeId= — キオスクのセルフ顔登録用 従業員一覧
 *
 * 自店舗の active かつ**顔が未登録**の従業員のみ返す。
 * 登録済みを除外するのは、共有端末での「他人の名前を選んで自分の顔で上書き」
 * なりすましを防ぐため（差し替え・抹消は管理画面のみ）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireKioskStore } from '@/lib/baggage/kiosk-guard'

export async function GET(req: NextRequest) {
  const storeId = req.nextUrl.searchParams.get('storeId')
  const guard = await requireKioskStore(storeId)
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

  const { data, error } = await guard.svc
    .from('employees')
    .select('id, name')
    .eq('store_id', guard.store.id)
    .eq('status', 'active')
    .is('rekognition_face_id', null)
    .order('name')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ employees: data ?? [] })
}
