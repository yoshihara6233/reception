'use server'

/**
 * R1: セッション上限（視聴時間上限 max_session_min ＋ 同時視聴上限 max_concurrent）を
 * テナント毎に保存する。認可: super_admin のみ（②運営管理プレーン）。
 * 書き込みは service client（session_limits の RLS は modify=admin ロール）。
 */
import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/admin/guard'
import { createSupabaseService } from '@/lib/supabase/server'

export interface SessionLimitInput {
  tenantId:      string
  maxSessionMin: number
  maxConcurrent: number
}

export async function upsertSessionLimit(
  input: SessionLimitInput,
): Promise<{ ok: boolean; error?: string }> {
  // ②運営管理＝super_admin 専用（視聴上限は運営/契約側の制御）。
  const guard = await requireAdmin()
  if (!guard.ok || guard.profile.role !== 'super_admin') {
    return { ok: false, error: '権限がありません' }
  }

  const sessionMin = Math.round(Number(input.maxSessionMin))
  const concurrent = Math.round(Number(input.maxConcurrent))
  if (!Number.isFinite(sessionMin) || sessionMin < 1 || sessionMin > 1440) {
    return { ok: false, error: '視聴時間上限は 1〜1440 分で入力してください' }
  }
  if (!Number.isFinite(concurrent) || concurrent < 1 || concurrent > 1000) {
    return { ok: false, error: '同時視聴上限は 1〜1000 で入力してください' }
  }

  const svc = createSupabaseService()
  const { error } = await svc.from('session_limits').upsert(
    {
      tenant_id:       input.tenantId,
      max_session_min: sessionMin,
      max_concurrent:  concurrent,
      updated_at:      new Date().toISOString(),
    },
    { onConflict: 'tenant_id' },
  )
  if (error) return { ok: false, error: error.message }
  revalidatePath('/admin/limits')
  return { ok: true }
}
