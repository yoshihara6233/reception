/**
 * POST /api/baggage/kiosk/pin-login — iPadキオスクの6桁PINログイン
 *
 * 未ログインでも呼べる（キオスク常用）。店舗ごとの PIN を照合し、一致したら
 * 「キオスク限定・店舗限定」の署名セッション cookie を発行する。
 * オンライン総当り対策として失敗回数を数え、5回でロック（アプリ判定）。
 *
 * このエンドポイントは admin_users セッションを要求しない。付与されるのは
 * キオスクAPI（face-auth・sessions・kiosk/employees・顔セルフ登録）のみで、
 * /baggage 履歴や /admin には一切アクセスできない（cookie はそれらのガードで無視される）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseService } from '@/lib/supabase/server'
import {
  KIOSK_COOKIE, isValidPinFormat, verifyPinHash, isLocked,
  signKioskSession, LOCK_MINUTES,
} from '@/lib/baggage/kiosk-pin'

const Body = z.object({ storeId: z.string().uuid(), pin: z.string() })

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  if (!isValidPinFormat(parsed.data.pin)) return NextResponse.json({ error: 'invalid_pin' }, { status: 401 })

  const svc = createSupabaseService()
  const { data: row } = await svc
    .from('baggage_kiosk_pins')
    .select('store_id, pin_hash, failed_attempts, locked_until')
    .eq('store_id', parsed.data.storeId)
    .maybeSingle()

  // PIN 未設定でも汎用エラー（店舗ごとの設定有無を晒さない）。
  if (!row) return NextResponse.json({ error: 'invalid_pin' }, { status: 401 })

  const now = new Date()
  const lockedUntil = row.locked_until ? new Date(row.locked_until) : null
  if (isLocked(lockedUntil, now)) {
    const retryAfterSec = Math.ceil((lockedUntil!.getTime() - now.getTime()) / 1000)
    return NextResponse.json({ error: 'locked', retryAfterSec }, { status: 429 })
  }

  const success = verifyPinHash(parsed.data.pin, row.pin_hash)
  if (!success) {
    // 失敗の加算＋ロックは原子的な RPC で（並行リクエストのロストアップデート防止）。
    const { data: newLock } = await svc.rpc('baggage_kiosk_pin_fail', { p_store: row.store_id })
    const lu = newLock ? new Date(newLock as string) : null
    if (isLocked(lu, now)) {
      return NextResponse.json({ error: 'locked', retryAfterSec: LOCK_MINUTES * 60 }, { status: 429 })
    }
    return NextResponse.json({ error: 'invalid_pin' }, { status: 401 })
  }

  // 成功: 失敗カウンタ/ロックを解除。
  await svc.from('baggage_kiosk_pins')
    .update({ failed_attempts: 0, locked_until: null })
    .eq('store_id', row.store_id)

  const { token, maxAgeSec } = signKioskSession(row.store_id, now)
  const res = NextResponse.json({ ok: true })
  res.cookies.set(KIOSK_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeSec,
  })
  return res
}
