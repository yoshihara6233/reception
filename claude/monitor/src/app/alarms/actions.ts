'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { notifyAlarm } from '@/lib/alarms/notify'

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

/** 発報の確認ワークフロー: new → ack（対応中）→ closed（完了）。差戻しも可。 */
export async function updateAlarmStatus(
  eventId: string,
  status: 'new' | 'ack' | 'closed',
): Promise<{ ok: boolean; error?: string }> {
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return { ok: false, error: 'unauthorized' }

  const { data: admin } = await supa.from('admin_users').select('id').eq('auth_user_id', user.id).maybeSingle()
  const { error } = await supa
    .from('alarm_events')
    .update({ status, reviewed_by: admin?.id ?? null, reviewed_at: new Date().toISOString() })
    .eq('id', eventId)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/alarms')
  return { ok: true }
}

/** テスト発報: 指定店舗に手動の発報を1件作成し、通知経路も動かす（動作確認用）。 */
export async function createTestAlarm(storeId: string): Promise<{ ok: boolean; id?: string; error?: string }> {
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return { ok: false, error: 'unauthorized' }

  // 認可ゲート: 店舗をセッション RLS 越しに読めれば権限あり。
  const { data: store } = await supa.from('stores').select('id').eq('id', storeId).maybeSingle()
  if (!store) return { ok: false, error: '店舗が見つからないか、権限がありません' }

  const service = createSupabaseService()
  const { data: ev, error } = await service
    .from('alarm_events')
    .insert({ store_id: storeId, source: 'manual', event_type: 'test', status: 'new', occurred_at: new Date().toISOString() })
    .select('id')
    .maybeSingle()
  if (error || !ev) return { ok: false, error: error?.message ?? 'テスト発報の作成に失敗しました' }

  await notifyAlarm(service, ev.id as string).catch(() => {})
  revalidatePath('/alarms')
  return { ok: true, id: ev.id as string }
}

export interface AlarmSettingsInput {
  storeId: string
  enabled: boolean
  notifyEmails: string[]
  quietFrom: string | null
  quietTo: string | null
  notifyWebhookUrl: string | null
}

/** 店舗の発報設定を保存（有効/通知先/静音/Webhook）。 */
export async function upsertAlarmSettings(input: AlarmSettingsInput): Promise<{ ok: boolean; error?: string }> {
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return { ok: false, error: 'unauthorized' }
  const qf = (input.quietFrom ?? '').trim()
  const qt = (input.quietTo ?? '').trim()
  if ((qf && !HHMM.test(qf)) || (qt && !HHMM.test(qt))) {
    return { ok: false, error: '静音時間は HH:MM 形式で入力してください' }
  }

  const { error } = await supa.from('alarm_settings').upsert(
    {
      store_id: input.storeId,
      enabled: input.enabled,
      notify_emails: input.notifyEmails,
      quiet_from: qf || null,
      quiet_to: qt || null,
      notify_webhook_url: (input.notifyWebhookUrl ?? '').trim() || null,
    },
    { onConflict: 'store_id' },
  )
  if (error) return { ok: false, error: error.message }
  revalidatePath('/alarms')
  revalidatePath('/alarms/settings')
  return { ok: true }
}
