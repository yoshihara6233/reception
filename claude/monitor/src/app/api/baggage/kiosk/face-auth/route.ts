/**
 * POST /api/baggage/kiosk/face-auth — キオスクの顔照合（M3）
 *
 * 撮影 JPEG（dataURL）を受け、
 *   1) baggage-photos へ保存（facePath は以降のセッション記録に添付）
 *   2) Rekognition 照合を FACE_AUTH_TIMEOUT_SEC でレース
 *      - staff: 常設 baggage-emp-<store> を検索 → employees を解決（姓のみ返す・OV#13）
 *      - visitor（entry 以外）: 当日 baggage-<store>-<ymd> を検索 → 入室セッションIDを解決
 *      - visitor entry: 照合なし（登録は sessions POST がセッションID確定後に行う）
 *   3) 超過・障害・不一致は matched:false（キオスクは止めない — 可用性優先）
 *
 * AWS 未設定でも 500 にしない（authSkipped でフロー継続）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireKioskStore } from '@/lib/baggage/kiosk-guard'
import { withTimeout, lastNameOf, jstYmd } from '@/lib/baggage/face-auth'
import { FACE_AUTH_TIMEOUT_SEC } from '@/lib/baggage/inspection-flow'
import {
  employeeCollectionId,
  visitorDailyCollectionId,
  searchFaceInCollection,
} from '@/lib/aws/rekognition'

const Body = z.object({
  storeId: z.string().uuid(),
  personKind: z.enum(['staff', 'visitor']),
  action: z.enum(['entry', 'temp_exit', 'temp_return', 'exit']),
  image: z.string().min(32),   // JPEG dataURL（data:image/jpeg;base64,...）
})

function dataUrlToBuffer(dataUrl: string): Buffer | null {
  const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(dataUrl)
  if (!m) return null
  try { return Buffer.from(m[2], 'base64') } catch { return null }
}

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  const body = parsed.data

  const guard = await requireKioskStore(body.storeId)
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
  const { svc, store } = guard

  const buf = dataUrlToBuffer(body.image)
  if (!buf) return NextResponse.json({ error: 'invalid_image' }, { status: 400 })

  // 1) 顔写真を保存（照合の成否に関わらず記録として添付する）
  const now = new Date()
  const facePath = `${store.id}/${jstYmd(now)}/${crypto.randomUUID()}.jpg`
  const { error: upErr } = await svc.storage
    .from('baggage-photos')
    .upload(facePath, buf, { contentType: 'image/jpeg', upsert: false })
  if (upErr) return NextResponse.json({ error: 'photo_upload_failed' }, { status: 500 })

  // 2) 照合（visitor entry は登録のみなので照合スキップ）
  if (body.personKind === 'visitor' && body.action === 'entry') {
    return NextResponse.json({ matched: false, authSkipped: false, facePath })
  }

  const collectionId = body.personKind === 'staff'
    ? employeeCollectionId(store.id)
    : visitorDailyCollectionId(store.id, jstYmd(now))

  const race = await withTimeout(
    searchFaceInCollection(collectionId, buf),
    FACE_AUTH_TIMEOUT_SEC * 1000,
  )

  if (!race.ok) {
    // 3秒超過 / AWS 障害・未設定 → 認証省略でフロー継続
    return NextResponse.json({ matched: false, authSkipped: true, facePath })
  }
  if (!race.value.matched || !race.value.externalId) {
    return NextResponse.json({ matched: false, authSkipped: false, facePath })
  }

  if (body.personKind === 'staff') {
    // externalId = employees.id
    const { data: emp } = await svc
      .from('employees')
      .select('id, name')
      .eq('id', race.value.externalId)
      .eq('store_id', store.id)
      .eq('status', 'active')   // 登録抹消済みの従業員は認証させない
      .maybeSingle()
    if (!emp) return NextResponse.json({ matched: false, authSkipped: false, facePath })
    return NextResponse.json({
      matched: true,
      authSkipped: false,
      facePath,
      employeeId: emp.id,
      lastName: lastNameOf(emp.name),
    })
  }

  // visitor: externalId = 入室時に登録した inspection_sessions.id
  return NextResponse.json({
    matched: true,
    authSkipped: false,
    facePath,
    entrySessionId: race.value.externalId,
  })
}
