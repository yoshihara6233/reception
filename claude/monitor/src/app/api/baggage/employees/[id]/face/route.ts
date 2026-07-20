/**
 * POST /api/baggage/employees/[id]/face — 従業員の顔登録/更新（M4）
 *
 * 撮影/アップロードした顔写真を baggage-photos へ保存し、常設コレクション
 * baggage-emp-<store> に IndexFaces（ExternalImageId = employees.id）。
 * 既存の FaceId があれば差し替え（旧Faceを削除）。管理操作のため
 * キオスクと違いタイムアウトレースはせず、失敗は素直にエラーを返す。
 */
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { z } from 'zod'
import { requireAdmin, requireBaggageRole } from '@/lib/admin/guard'
import { requireBaggageAccess, resolveKioskOrAdmin } from '@/lib/baggage/kiosk-guard'
import { KIOSK_COOKIE, kioskSessionStoreId } from '@/lib/baggage/kiosk-pin'
import { createSupabaseService } from '@/lib/supabase/server'
import { recordAudit } from '@/lib/admin/audit'
import {
  deleteFaceInCollection, employeeCollectionId, indexFaceInCollection,
} from '@/lib/aws/rekognition'

/**
 * DELETE /api/baggage/employees/[id]/face — 顔データのみ削除（再登録用）
 *
 * 登録抹消（従業員ごと inactive）とは別に、顔だけ消して active のまま残す。
 * 消すとキオスクのセルフ顔登録の選択肢に再表示され、本人が撮り直せる。
 * Rekognition 削除失敗時は DB をクリアしない（孤児Face防止・再試行可能に保つ）。
 */
export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params
  const auth = await requireAdmin()
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const svc0 = createSupabaseService()
  const { data: emp } = await svc0
    .from('employees')
    .select('id, store_id, rekognition_face_id, face_photo_path')
    .eq('id', id)
    .maybeSingle()
  if (!emp) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const guard = await requireBaggageAccess(emp.store_id)
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
  const { svc, store } = guard

  if (emp.rekognition_face_id) {
    try {
      await deleteFaceInCollection(employeeCollectionId(store.id), emp.rekognition_face_id)
    } catch (e) {
      return NextResponse.json(
        { error: 'rekognition_delete_failed', detail: (e as Error).message },
        { status: 502 },
      )
    }
  }
  if (emp.face_photo_path) {
    await svc.storage.from('baggage-photos').remove([emp.face_photo_path])
  }
  const { error } = await svc
    .from('employees')
    .update({ face_photo_path: null, rekognition_face_id: null })
    .eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await recordAudit(guard.supa, {
    actorUserId: guard.user.id, action: 'baggage.employee.face_delete', targetType: 'employee',
    targetId: id, storeId: store.id,
  })
  return NextResponse.json({ ok: true })
}

const Body = z.object({
  image: z.string().min(32).max(15_000_000),   // JPEG/PNG/WebP dataURL（~10MB画像まで）
  // キオスクのセルフ登録用: 既に顔が登録済みなら 409（共有端末での上書きなりすまし防止）。
  // 管理画面からの差し替えは false/未指定のまま。
  onlyIfUnregistered: z.boolean().optional(),
  consentVersion: z.number().int().nullish(),   // 顔登録時の同意版（同意画面を通った場合）
})

function dataUrlToBuffer(dataUrl: string): { buf: Buffer; mime: string; ext: string } | null {
  const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(dataUrl)
  if (!m) return null
  try {
    return { buf: Buffer.from(m[2], 'base64'), mime: `image/${m[1]}`, ext: m[1] === 'jpeg' ? 'jpg' : m[1] }
  } catch { return null }
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })

  // 認証プレゲート（未認証者への UUID 存在オラクル・認証前の service 読みを作らない）:
  // 正規のキオスクPINセッション or 手荷物検査ロールのログイン。iPad は PIN 経路で
  // 「はじめての方の顔登録（セルフ登録）」を行えるようにする。
  const pinStore = kioskSessionStoreId((await cookies()).get(KIOSK_COOKIE)?.value, new Date())
  if (!pinStore) {
    const role = await requireBaggageRole()
    if (!role.ok) return NextResponse.json({ error: role.error }, { status: role.status })
  }

  const svc0 = createSupabaseService()
  const { data: emp } = await svc0
    .from('employees')
    .select('id, store_id, status, rekognition_face_id, face_photo_path')
    .eq('id', id)
    .maybeSingle()
  if (!emp) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  // 認可は「存在・状態を漏らす前」に。emp の店舗への権限（PIN一致 or 店舗アクセス）が
  // 無ければ、存在しない場合と同じ 404 を返す（越権の存在オラクルを作らない）。
  const guard = await resolveKioskOrAdmin(emp.store_id)
  if (!guard.ok) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const { svc, store } = guard

  if (emp.status !== 'active') return NextResponse.json({ error: 'employee_inactive' }, { status: 409 })
  if (parsed.data.onlyIfUnregistered && emp.rekognition_face_id) {
    return NextResponse.json({ error: 'already_registered' }, { status: 409 })
  }

  const img = dataUrlToBuffer(parsed.data.image)
  if (!img) return NextResponse.json({ error: 'invalid_image' }, { status: 400 })
  const { buf } = img

  // 1) 写真を保存（差し替えでも履歴を汚さないようタイムスタンプ付きパス・実MIMEで保存）
  const path = `employees/${store.id}/${id}-${Date.now()}.${img.ext}`
  const { error: upErr } = await svc.storage
    .from('baggage-photos')
    .upload(path, buf, { contentType: img.mime, upsert: false })
  if (upErr) return NextResponse.json({ error: 'photo_upload_failed' }, { status: 500 })

  // 2) Rekognition へ登録（顔が検出できない画像はここで 422）
  let faceId: string
  try {
    if (emp.rekognition_face_id) {
      await deleteFaceInCollection(employeeCollectionId(store.id), emp.rekognition_face_id).catch(() => {})
    }
    const r = await indexFaceInCollection(employeeCollectionId(store.id), id, buf)
    faceId = r.faceId
  } catch (e) {
    await svc.storage.from('baggage-photos').remove([path])
    const msg = (e as Error).message
    const noFace = /Face not detected/i.test(msg)
    if (!noFace) console.error('[baggage face-register] rekognition 失敗', { store: store.id, employee: id, err: msg })
    return NextResponse.json({ error: noFace ? 'face_not_detected' : 'rekognition_failed', detail: msg },
      { status: noFace ? 422 : 502 })
  }

  // 3) DB 更新（旧写真は削除）
  if (emp.face_photo_path) {
    await svc.storage.from('baggage-photos').remove([emp.face_photo_path])
  }
  const { error } = await svc
    .from('employees')
    .update({
      face_photo_path: path, rekognition_face_id: faceId,
      // 顔登録時の同意（同意画面を通っていれば版・日時を記録）。
      ...(parsed.data.consentVersion != null
        ? { consent_at: new Date().toISOString(), consent_version: parsed.data.consentVersion }
        : {}),
    })
    .eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // 監査は admin 経路のみ（PIN セルフ登録は auth.uid() が無く RLS INSERT 不可）。
  if (guard.via === 'admin' && guard.supa && guard.actorUserId) {
    await recordAudit(guard.supa, {
      actorUserId: guard.actorUserId, action: 'baggage.employee.face_register', targetType: 'employee',
      targetId: id, storeId: store.id,
    })
  }
  return NextResponse.json({ ok: true, faceId })
}
