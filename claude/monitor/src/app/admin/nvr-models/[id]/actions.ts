/**
 * F49.J: NVR 機種マスタ編集 Server Action
 */
'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createSupabaseServer } from '@/lib/supabase/server'

export interface SaveResult {
  ok:       boolean
  message?: string
}

export async function updateNvrModel(formData: FormData): Promise<SaveResult> {
  const id            = formData.get('id')?.toString() ?? ''
  const display_name  = formData.get('display_name')?.toString() ?? ''
  const released_at   = formData.get('released_at')?.toString() || null
  const eol_date      = formData.get('eol_date')?.toString() || null
  const eos_date      = formData.get('eos_date')?.toString() || null
  const max_channels  = formData.get('max_channels')?.toString()
  const max_resolution = formData.get('max_resolution')?.toString() || null
  const notes         = formData.get('notes')?.toString() || null
  const source_url    = formData.get('source_url')?.toString() || null

  if (!id) return { ok: false, message: 'id が不正です' }
  if (!display_name) return { ok: false, message: '表示名は必須です' }

  const supa = await createSupabaseServer()
  const { error } = await supa
    .from('nvr_models')
    .update({
      display_name,
      released_at,
      eol_date,
      eos_date,
      max_channels: max_channels ? parseInt(max_channels, 10) : null,
      max_resolution,
      source_url,
      notes,
    })
    .eq('id', id)

  if (error) return { ok: false, message: error.message }

  // 各店舗の nvr_eol_date / nvr_eos_date を再同期
  // (stores.nvr_model 変更トリガは「nvr_model のカラム更新時」しか発火しないので、
  //  nvr_models 側の EOL/EOS 変更を反映させるには直接 UPDATE が必要)
  if (eol_date !== null || eos_date !== null) {
    // 対象モデルを使っている全店舗を更新
    const { data: model } = await supa.from('nvr_models').select('model_number').eq('id', id).single()
    if (model) {
      await supa
        .from('stores')
        .update({ nvr_eol_date: eol_date, nvr_eos_date: eos_date })
        .eq('nvr_model', (model as { model_number: string }).model_number)
    }
  }

  revalidatePath('/admin/nvr-models')
  revalidatePath('/infra')
  return { ok: true, message: '保存しました' }
}

export async function updateNvrModelAndBack(formData: FormData): Promise<void> {
  const r = await updateNvrModel(formData)
  if (!r.ok) throw new Error(r.message ?? 'failed')
  redirect('/admin/nvr-models')
}
