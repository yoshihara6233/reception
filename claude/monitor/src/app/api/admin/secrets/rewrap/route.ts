/**
 * 録画機の秘密をエッジごとの鍵 (enc:v2) へ包み直す (2026-10-29・自主診断 ASVS 11.1.1・11.2.2・13.3.2)。
 *
 * POST — recorders の password_enc・vod_password_enc のうち、v2 でないもの・今の鍵 (SECRETS_ENC_KEYS
 *        の先頭) でないものを、そのエッジの鍵で暗号化し直す。何度流しても同じ結果になる。
 *        `?dry_run=1` は数えるだけで書かない。
 *
 * 運営 (super_admin) だけ。全テナントの行を読むためサービスの接続を使う。平文は返さない・記録しない。
 * 包み直したあと、エッジが bootstrap で自分の鍵を受け取っていれば、エッジの SECRETS_ENC_KEY は外せる。
 */
import { NextRequest, NextResponse } from 'next/server'
import { decryptSecret, encryptSecretForEdge, needsRewrap } from '@intereco/shared'
import { requireSuperAdmin } from '@/lib/admin/guard'
import { recordAudit } from '@/lib/admin/audit'
import { createSupabaseService } from '@/lib/supabase/server'
import { dbErrorCode } from '@/lib/api/db-error'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const COLS = ['password_enc', 'vod_password_enc'] as const

export async function POST(req: NextRequest) {
  const guard = await requireSuperAdmin()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

  const dryRun = req.nextUrl.searchParams.get('dry_run') === '1'
  const svc = createSupabaseService()
  const { data, error } = await svc
    .from('recorders')
    .select('id, edge_id, password_enc, vod_password_enc')
    .limit(10000)
  if (error) return NextResponse.json({ error: dbErrorCode(error, '/api/admin/secrets/rewrap') }, { status: 500 })

  let scanned = 0, rewrapped = 0, failed = 0
  for (const r of (data ?? []) as Array<Record<string, string | null>>) {
    scanned++
    const edgeId = r.edge_id
    const patch: Record<string, string> = {}
    for (const col of COLS) {
      const v = r[col]
      if (!v || !edgeId || !needsRewrap(v)) continue
      try {
        patch[col] = encryptSecretForEdge(decryptSecret(v, edgeId), edgeId)
      } catch {
        failed++   // 鍵が合わない行は残す (中身は出さない)
      }
    }
    if (Object.keys(patch).length === 0) continue
    if (!dryRun) {
      const { error: upErr } = await svc.from('recorders').update(patch).eq('id', r.id as string)
      if (upErr) { failed++; continue }
    }
    rewrapped++
  }

  if (!dryRun) {
    await recordAudit(guard.supa, {
      actorUserId: guard.user.id,
      action: 'secrets.rewrap',
      targetType: 'recorder',
      targetId: null,
      storeId: null,
      changes: { scanned, rewrapped, failed },
    })
  }
  return NextResponse.json({ dry_run: dryRun, scanned, rewrapped, failed })
}
