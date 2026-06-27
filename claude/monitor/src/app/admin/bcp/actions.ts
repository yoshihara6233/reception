'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServer } from '@/lib/supabase/server'

const ALLOWED_INTENSITY = ['1', '2', '3', '4', '5-', '5+', '6-', '6+', '7']

/**
 * 店舗の BCP 発動条件を upsert（有効化・震度しきい値・津波/ミサイルON-OFF・通知先）。
 * 書込みは bcp_settings_modify RLS（admin role）で許可。
 */
export async function upsertBcpSettings(input: {
  storeId: string
  enabled: boolean
  quakeMinIntensity: string
  tsunamiEnabled: boolean
  missileEnabled: boolean
  notifyEmails: string[]
}): Promise<{ ok: boolean; error?: string }> {
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return { ok: false, error: 'unauthorized' }

  if (!ALLOWED_INTENSITY.includes(input.quakeMinIntensity)) {
    return { ok: false, error: '震度しきい値が不正です' }
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
        notify_emails:       input.notifyEmails,
      },
      { onConflict: 'store_id' },
    )

  if (error) return { ok: false, error: error.message }
  revalidatePath('/admin/bcp')
  return { ok: true }
}
