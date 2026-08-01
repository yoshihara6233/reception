/**
 * F48.A: NVR 設定保存 Server Action
 *
 * /admin/stores/[id]/nvr フォームの送信先。
 * stores テーブルの nvr_* カラムを UPDATE。
 * 認証情報は本番では vault に格納予定 (Phase 2)。Phase 0/1 では
 * nvr_options.credentials_hint に「設定済」のフラグだけ立てる暫定運用。
 */
'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createSupabaseServer } from '@/lib/supabase/server'
import { z } from 'zod'
import { recordAudit } from '@/lib/admin/audit'

const FormSchema = z.object({
  storeId:  z.string().uuid(),
  vendor:   z.enum(['', 'i-pro-nx', 'i-pro-nu', 'i-pro-gxe500', 'frigate']).optional(),
  model:    z.string().optional(),
  endpoint: z.string().optional(),
  options:  z.string().optional(),  // JSON string
})

export interface SaveResult {
  ok:       boolean
  message?: string
  errors?:  Record<string, string>
}

export async function saveNvrConfig(formData: FormData): Promise<SaveResult> {
  const raw = {
    storeId:  formData.get('storeId')?.toString() ?? '',
    vendor:   formData.get('vendor')?.toString() ?? '',
    model:    formData.get('model')?.toString() ?? '',
    endpoint: formData.get('endpoint')?.toString() ?? '',
    options:  formData.get('options')?.toString() ?? '{}',
  }

  // バリデーション
  const parsed = FormSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok:      false,
      message: 'バリデーションエラー',
      errors:  Object.fromEntries(
        parsed.error.issues.map((i) => [i.path.join('.'), i.message]),
      ),
    }
  }

  // options を JSON parse
  let nvr_options: Record<string, unknown> = {}
  if (raw.options.trim()) {
    try {
      nvr_options = JSON.parse(raw.options) as Record<string, unknown>
    } catch (err) {
      return {
        ok:      false,
        message: `追加オプションの JSON が不正です: ${(err as Error).message}`,
      }
    }
  }

  // endpoint URL バリデーション (簡易)
  if (raw.endpoint.trim()) {
    try {
      new URL(raw.endpoint)
    } catch {
      return {
        ok:      false,
        message: `エンドポイント URL が不正です: ${raw.endpoint}`,
      }
    }
  }

  // DB UPDATE
  const supa = await createSupabaseServer()
  const updateData: Record<string, unknown> = {
    nvr_vendor:   raw.vendor || null,
    nvr_model:    raw.model || null,
    nvr_endpoint: raw.endpoint || null,
    nvr_options,
  }

  // central_aggregator モードの自動推論: frigate なら per_store_minipc、それ以外 (i-pro 系) なら central
  // Phase 0 では明示変更しないが、フラグだけ残す
  if (raw.vendor && raw.vendor !== 'frigate') {
    updateData.deployment_mode = 'central_aggregator'
  } else if (raw.vendor === 'frigate') {
    updateData.deployment_mode = 'per_store_minipc'
  }

  const { error } = await supa
    .from('stores')
    .update(updateData)
    .eq('id', raw.storeId)

  if (error) {
    return {
      ok:      false,
      message: `保存失敗: ${error.message}`,
    }
  }

  // 監査: nvr_options には認証情報が入り得るため、値は残さずキー名のみ記録する。
  const { data: { user } } = await supa.auth.getUser()
  if (user) {
    await recordAudit(supa, {
      actorUserId: user.id,
      action:      'store.nvr_update',
      targetType:  'store',
      targetId:    raw.storeId,
      storeId:     raw.storeId,
      changes:     {
        nvr_vendor:   raw.vendor || null,
        nvr_model:    raw.model || null,
        nvr_endpoint: raw.endpoint || null,
        nvr_options_keys: Object.keys(nvr_options),
      },
    })
  }

  // EOL/EOS は nvr_model 変更時のトリガで自動同期される (F46.7)
  // ライフサイクル VIEW も自動で再計算されるので revalidate するだけで OK
  revalidatePath(`/admin/stores/${raw.storeId}/nvr`)
  revalidatePath(`/admin/stores/${raw.storeId}`)
  revalidatePath('/infra')

  return { ok: true, message: '保存しました' }
}

/**
 * 保存後にリダイレクトしたい場合用 (Form action 直結のラッパー)
 */
export async function saveNvrConfigAndRedirect(formData: FormData): Promise<void> {
  const result = await saveNvrConfig(formData)
  if (!result.ok) {
    // エラー時は同じページに留まり、メッセージは client 側で表示
    throw new Error(result.message ?? 'unknown error')
  }
  redirect(`/admin/stores/${formData.get('storeId')}/nvr?saved=1`)
}
