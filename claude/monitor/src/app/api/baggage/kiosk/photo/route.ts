/**
 * POST /api/baggage/kiosk/photo — キオスクの補助写真アップロード（名刺など）
 *
 * 顔照合を伴わない写真（来訪者の名刺）を baggage-photos に保存し、パスを返す。
 * 返したパスは sessions POST に添付して card_photo_path として記録する
 * （パスは自店舗プレフィックスのみ受理される）。認可は requireKioskStore（PIN or ログイン）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { decodeImageDataUrl } from '@/lib/security/input'
import { invalidInput } from '@/lib/api/invalid-input'
import { z } from 'zod'
import { requireKioskStore } from '@/lib/baggage/kiosk-guard'
import { jstYmd } from '@/lib/baggage/face-auth'

const Body = z.object({
  storeId: z.string().uuid(),
  image: z.string().min(32),   // dataURL（data:image/...;base64,...）
})


export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return invalidInput(req, { error: 'invalid_body' })

  const guard = await requireKioskStore(parsed.data.storeId)
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
  const { svc, store } = guard

  // 宣言と中身の先頭の印が一致する画像だけ (ASVS 5.2.2)
  const img = decodeImageDataUrl(parsed.data.image)
  if (!img) return NextResponse.json({ error: 'invalid_image' }, { status: 400 })

  const path = `${store.id}/${jstYmd(new Date())}/card-${crypto.randomUUID()}.${img.ext}`
  const { error } = await svc.storage
    .from('baggage-photos')
    .upload(path, img.buf, { contentType: img.mime, upsert: false })
  if (error) return NextResponse.json({ error: 'upload_failed' }, { status: 500 })

  return NextResponse.json({ path })
}
