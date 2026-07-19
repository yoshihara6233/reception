/**
 * POST /api/baggage/employees/[id]/face — 従業員の顔登録/更新（M4）
 *
 * 撮影/アップロードした顔写真を baggage-photos へ保存し、常設コレクション
 * baggage-emp-<store> に IndexFaces（ExternalImageId = employees.id）。
 * 既存の FaceId があれば差し替え（旧Faceを削除）。管理操作のため
 * キオスクと違いタイムアウトレースはせず、失敗は素直にエラーを返す。
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/admin/guard'
import { requireBaggageAccess } from '@/lib/baggage/kiosk-guard'
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

  // 認証を先に（未認証者への UUID 存在オラクル・認証前の service 読みを作らない）
  const auth = await requireAdmin()
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const svc0 = createSupabaseService()
  const { data: emp } = await svc0
    .from('employees')
    .select('id, store_id, status, rekognition_face_id, face_photo_path')
    .eq('id', id)
    .maybeSingle()
  if (!emp) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (emp.status !== 'active') return NextResponse.json({ error: 'employee_inactive' }, { status: 409 })
  if (parsed.data.onlyIfUnregistered && emp.rekognition_face_id) {
    return NextResponse.json({ error: 'already_registered' }, { status: 409 })
  }

  const guard = await requireBaggageAccess(emp.store_id)
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
  const { svc, store } = guard

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
    return NextResponse.json({ error: noFace ? 'face_not_detected' : 'rekognition_failed', detail: msg },
      { status: noFace ? 422 : 502 })
  }

  // 3) DB 更新（旧写真は削除）
  if (emp.face_photo_path) {
    await svc.storage.from('baggage-photos').remove([emp.face_photo_path])
  }
  const { error } = await svc
    .from('employees')
    .update({ face_photo_path: path, rekognition_face_id: faceId })
    .eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await recordAudit(guard.supa, {
    actorUserId: guard.user.id, action: 'baggage.employee.face_register', targetType: 'employee',
    targetId: id, storeId: store.id,
  })
  return NextResponse.json({ ok: true, faceId })
}
