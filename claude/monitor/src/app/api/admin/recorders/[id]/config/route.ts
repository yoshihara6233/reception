/**
 * PUT /api/admin/recorders/[id]/config — 遠隔投入する設定の保存（CONFIG_PUSH_SPEC §5）
 *
 * 許可キーのみ（EdgeConfigSchema・strict）。保存で config_version を +1 し、
 * nvmsd は版が変わった時だけ取り込む。空オブジェクト（{}）で「設定なし」に戻せる。
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin/guard'
import { createSupabaseService } from '@/lib/supabase/server'
import { recordAudit, storeIdForRecorder } from '@/lib/admin/audit'
import { EdgeConfigSchema } from '@/lib/edge/edge-config'

export const dynamic = 'force-dynamic'

export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdmin()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

  const { id } = await ctx.params
  const parsed = EdgeConfigSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_config' }, { status: 400 })
  const config = parsed.data

  // 認可: そのレコーダが呼び出し管理者から見えるか（RLS セッション）＋現在の版を得る。
  const { data: rec } = await guard.supa
    .from('recorders').select('id, vendor, config_version').eq('id', id).maybeSingle()
  if (!rec) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (rec.vendor !== 'nvms') return NextResponse.json({ error: 'not_nvms' }, { status: 422 })

  const nextVersion = (rec.config_version ?? 0) + 1
  const { error } = await createSupabaseService()
    .from('recorders')
    .update({ desired_config: config, config_version: nextVersion, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await recordAudit(guard.supa, {
    actorUserId: guard.user.id,
    action: 'recorder.config_push',
    targetType: 'recorder',
    targetId: id,
    storeId: await storeIdForRecorder(guard.supa, id),
    changes: { config_version: nextVersion, keys: Object.keys(config) },
  })
  return NextResponse.json({ ok: true, config_version: nextVersion })
}
