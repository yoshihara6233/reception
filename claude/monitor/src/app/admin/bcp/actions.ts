'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServer } from '@/lib/supabase/server'

const ALLOWED_INTENSITY = ['1', '2', '3', '4', '5-', '5+', '6-', '6+', '7']

/**
 * 店舗の BCP 発動条件を upsert（有効化・震度しきい値・津波/ミサイルON-OFF・録画前後分・通知先）。
 * 書込みは bcp_settings_modify RLS（admin role）で許可。
 */
export async function upsertBcpSettings(input: {
  storeId: string
  enabled: boolean
  quakeMinIntensity: string
  tsunamiEnabled: boolean
  missileEnabled: boolean
  preMinutes: number
  postMinutes: number
  notifyEmails: string[]
}): Promise<{ ok: boolean; error?: string }> {
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return { ok: false, error: 'unauthorized' }

  if (!ALLOWED_INTENSITY.includes(input.quakeMinIntensity)) {
    return { ok: false, error: '震度しきい値が不正です' }
  }
  if (input.preMinutes < 1 || input.preMinutes > 10) {
    return { ok: false, error: '録画前(分)は 1〜10 の範囲で入力してください' }
  }
  if (input.postMinutes < 1 || input.postMinutes > 30) {
    return { ok: false, error: '録画後(分)は 1〜30 の範囲で入力してください' }
  }

  const { error } = await supa
    .from('bcp_settings')
    .upsert(
      {
        store_id:            input.storeId,
        enabled:             input.enabled,
        quake_min_intensity: input.quakeMinIntensity,
        tsunami_enabled:     input.tsunamiEnabled,
        missile_enabled:     input.missileEnabled,
        pre_minutes:         input.preMinutes,
        post_minutes:        input.postMinutes,
        notify_emails:       input.notifyEmails,
      },
      { onConflict: 'store_id' },
    )

  if (error) return { ok: false, error: error.message }
  revalidatePath('/admin/bcp')
  return { ok: true }
}
