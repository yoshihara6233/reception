'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServer } from '@/lib/supabase/server'

const ALLOWED_INTENSITY = ['1', '2', '3', '4', '5-', '5+', '6-', '6+', '7']
const ALLOWED_OFFSETS = [-5, 0, 5, 10, 15, 20, 25, 30]

/**
 * 店舗の BCP 発動条件を upsert（有効化・震度しきい値・津波/ミサイルON-OFF・通知先・撮影オフセット）。
 * 書込みは bcp_settings_modify RLS（admin role）で許可。
 */
export async function upsertBcpSettings(input: {
  storeId: string
  enabled: boolean
  quakeMinIntensity: string
  tsunamiEnabled: boolean
  missileEnabled: boolean
  notifyEmails: string[]
  snapshotOffsets: number[]
}): Promise<{ ok: boolean; error?: string }> {
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return { ok: false, error: 'unauthorized' }

  if (!ALLOWED_INTENSITY.includes(input.quakeMinIntensity)) {
    return { ok: false, error: '震度しきい値が不正です' }
  }

  // 撮影オフセット: 1件以上、許可値の部分集合のみ。重複除去・昇順整列。
  const offsets = [...new Set(input.snapshotOffsets)]
    .filter((o) => ALLOWED_OFFSETS.includes(o))
    .sort((a, b) => a - b)
  if (offsets.length === 0) {
    return { ok: false, error: '撮影タイミングを1つ以上選んでください' }
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
        snapshot_offsets:    offsets,
      },
      { onConflict: 'store_id' },
    )

  if (error) return { ok: false, error: error.message }
  revalidatePath('/admin/bcp')
  return { ok: true }
}
