'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServer } from '@/lib/supabase/server'
import { recordAudit } from '@/lib/admin/audit'

const ALLOWED_INTENSITY = ['1', '2', '3', '4', '5-', '5+', '6-', '6+', '7']
const ALLOWED_OFFSETS = [-5, 0, 5, 10, 15, 20, 25, 30]

export interface BcpSettingInput {
  storeId: string
  enabled: boolean
  quakeMinIntensity: string
  specialWarningEnabled: boolean
  notifyEmails: string[]
  snapshotOffsets: number[]
}

interface BcpSettingRow {
  store_id: string
  enabled: boolean
  quake_min_intensity: string
  special_warning_enabled: boolean
  notify_emails: string[]
  snapshot_offsets: number[]
}

/** Validate one input and map it to a DB row, or return an error message. */
function toDbRow(input: BcpSettingInput): { row: BcpSettingRow } | { error: string } {
  if (!ALLOWED_INTENSITY.includes(input.quakeMinIntensity)) {
    return { error: '震度しきい値が不正です' }
  }
  // 撮影オフセット: 1件以上、許可値の部分集合のみ。重複除去・昇順整列。
  const offsets = [...new Set(input.snapshotOffsets)]
    .filter((o) => ALLOWED_OFFSETS.includes(o))
    .sort((a, b) => a - b)
  if (offsets.length === 0) {
    return { error: '撮影タイミングを1つ以上選んでください' }
  }
  return {
    row: {
      store_id:            input.storeId,
      enabled:             input.enabled,
      quake_min_intensity:     input.quakeMinIntensity,
      special_warning_enabled: input.specialWarningEnabled,
      notify_emails:       input.notifyEmails,
      snapshot_offsets:    offsets,
    },
  }
}

/**
 * 店舗の BCP 発動条件を upsert（有効化・震度しきい値・特別警報ON-OFF・通知先・撮影オフセット）。
 * 書込みは bcp_settings_modify RLS（admin role）で許可。
 */
export async function upsertBcpSettings(input: BcpSettingInput): Promise<{ ok: boolean; error?: string }> {
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return { ok: false, error: 'unauthorized' }

  const mapped = toDbRow(input)
  if ('error' in mapped) return { ok: false, error: mapped.error }

  const { error } = await supa
    .from('bcp_settings')
    .upsert(mapped.row, { onConflict: 'store_id' })

  if (error) return { ok: false, error: error.message }

  await recordAudit(supa, {
    actorUserId: user.id,
    action:      'bcp_settings.update',
    targetType:  'bcp_settings',
    targetId:    input.storeId,
    storeId:     input.storeId,
    changes:     { ...mapped.row },
  })

  revalidatePath('/admin/bcp')
  return { ok: true }
}

/**
 * 複数店舗の BCP 発動条件をまとめて upsert（/admin/bcp の一括適用）。
 * 各行を検証し、1回の upsert（配列）で書き込む。1件でも不正なら全体を中止。
 */
export async function bulkUpsertBcpSettings(
  inputs: BcpSettingInput[],
): Promise<{ ok: boolean; error?: string; count?: number }> {
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return { ok: false, error: 'unauthorized' }

  if (inputs.length === 0) return { ok: false, error: '対象の店舗がありません' }

  const rows: BcpSettingRow[] = []
  for (const input of inputs) {
    const mapped = toDbRow(input)
    if ('error' in mapped) return { ok: false, error: mapped.error }
    rows.push(mapped.row)
  }

  const { error } = await supa
    .from('bcp_settings')
    .upsert(rows, { onConflict: 'store_id' })

  if (error) return { ok: false, error: error.message }

  // 監査: 一括適用は 1 操作 = 1 行（件数＋共通設定のみ。store 毎の行は出さない）。
  await recordAudit(supa, {
    actorUserId: user.id,
    action:      'bcp_settings.bulk_update',
    targetType:  'bcp_settings',
    targetId:    null,
    storeId:     null,
    changes:     { count: rows.length },
  })

  revalidatePath('/admin/bcp')
  return { ok: true, count: rows.length }
}
