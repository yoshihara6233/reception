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
import { lastNameOf, jstYmd } from '@/lib/baggage/face-auth'
import { FACE_SEARCH_TIMEOUT_SEC } from '@/lib/baggage/inspection-flow'
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

// 照合(最大8秒)＋コールドスタートが関数上限で切られないよう余裕を確保。
export const maxDuration = 20

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  const body = parsed.data

  const guard = await requireKioskStore(body.storeId)
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
  const { svc, store } = guard

  const buf = dataUrlToBuffer(body.image)
  if (!buf) return NextResponse.json({ error: 'invalid_image' }, { status: 400 })

  // 1) 顔写真の保存は「並行」で開始（照合と同時に走らせて体感を短縮）。
  const now = new Date()
  const facePath = `${store.id}/${jstYmd(now)}/${crypto.randomUUID()}.jpg`
  const uploadPromise = svc.storage
    .from('baggage-photos')
    .upload(facePath, buf, { contentType: 'image/jpeg', upsert: false })

  // 2) 照合（visitor entry は登録のみなので照合スキップ）— アップロード完了を待って返す。
  if (body.personKind === 'visitor' && body.action === 'entry') {
    const { error: upErr } = await uploadPromise
    if (upErr) return NextResponse.json({ error: 'photo_upload_failed' }, { status: 500 })
    return NextResponse.json({ matched: false, authSkipped: false, facePath })
  }

  const collectionId = body.personKind === 'staff'
    ? employeeCollectionId(store.id)
    : visitorDailyCollectionId(store.id, jstYmd(now))

  // AWS 未設定は即ログ（authSkipped で継続するが原因を残す）
  if (!process.env.AWS_REGION || !process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    console.error('[baggage face-auth] AWS not configured → 認証省略', { store: store.id, kind: body.personKind })
    const { error: upErr } = await uploadPromise
    if (upErr) return NextResponse.json({ error: 'photo_upload_failed' }, { status: 500 })
    return NextResponse.json({ matched: false, authSkipped: true, facePath, reason: 'aws_not_configured' })
  }

  // 照合レース（アップロードと並行）。withTimeout は理由を潰すため実エラーを保持して診断ログに出す。
  let searchResult: Awaited<ReturnType<typeof searchFaceInCollection>> | null = null
  let failReason: string | null = null
  try {
    searchResult = await Promise.race([
      searchFaceInCollection(collectionId, buf),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('__timeout__')), FACE_SEARCH_TIMEOUT_SEC * 1000)),
    ])
  } catch (e) {
    const m = (e as Error).message
    failReason = m === '__timeout__' ? 'timeout' : `error: ${m}`
  }

  // 応答前にアップロード完了を確認（写真は記録として必須）。
  const { error: upErr } = await uploadPromise
  if (upErr) return NextResponse.json({ error: 'photo_upload_failed' }, { status: 500 })

  if (failReason) {
    console.error('[baggage face-auth] 照合失敗 → 認証省略', { store: store.id, kind: body.personKind, collectionId, reason: failReason })
    return NextResponse.json({ matched: false, authSkipped: true, facePath, reason: failReason })
  }
  if (!searchResult!.matched || !searchResult!.externalId) {
    // コレクションに一致なし（＝顔未登録 or 別人）。原因追跡のため件数感を残す。
    console.warn('[baggage face-auth] 一致なし', { store: store.id, kind: body.personKind, collectionId })
    return NextResponse.json({ matched: false, authSkipped: false, facePath, reason: 'no_match' })
  }
  const result = searchResult!

  if (body.personKind === 'staff') {
    // externalId = employees.id
    const { data: emp } = await svc
      .from('employees')
      .select('id, name')
      .eq('id', result.externalId)
      .eq('store_id', store.id)
      .eq('status', 'active')   // 登録抹消済みの従業員は認証させない
      .maybeSingle()
    if (!emp) return NextResponse.json({ matched: false, authSkipped: false, facePath, reason: 'employee_inactive_or_missing' })
    return NextResponse.json({
      matched: true,
      authSkipped: false,
      facePath,
      employeeId: emp.id,
      lastName: lastNameOf(emp.name),
    })
  }

  // visitor: externalId = 入室時に登録した inspection_sessions.id。入室時刻も返す（退室画面に表示）。
  const { data: entrySess } = await svc
    .from('inspection_sessions')
    .select('entry_at')
    .eq('id', result.externalId)
    .maybeSingle()
  return NextResponse.json({
    matched: true,
    authSkipped: false,
    facePath,
    entrySessionId: result.externalId,
    entryAt: entrySess?.entry_at ?? null,
  })
}
