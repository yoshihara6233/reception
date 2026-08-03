/**
 * エッジ専用 Supabase Auth ユーザの provisioning（手動入口）。
 *
 * 通常は **不要**: Phase B2 以降、bootstrap が未 provisioning のエッジを自動で用意する
 * （`src/lib/edge/auth-provision.ts`）。このスクリプトは
 *   - パスワードを強制ローテしたいとき（`--rotate`）
 *   - エッジが bootstrap に到達する前に先に用意しておきたいとき
 * のための入口として残している。
 *
 * 実行（monitor ディレクトリで、本番 env を渡して）:
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SECRETS_ENC_KEY=... \
 *     bun run scripts/provision-edge-auth.ts <edge_id> [--rotate]
 *   引数省略時は EDGE_ID env、`--all` で未 provisioning のエッジを一括処理。
 *
 * ⚠ 鍵/パスワードはチャットに貼らない。env と Supabase 内にのみ存在させる。
 */
import { createClient } from '@supabase/supabase-js'
import { ensureEdgeAuthPassword, edgeAuthEmail, canProvisionEdgeAuth } from '../src/lib/edge/auth-provision'

async function main() {
  const args = process.argv.slice(2)
  const rotate = args.includes('--rotate')
  const all = args.includes('--all')
  const edgeId = args.find((a) => !a.startsWith('--')) ?? process.env.EDGE_ID

  if (!all && !edgeId) {
    console.error('usage: provision-edge-auth.ts <edge_id> [--rotate]  |  --all')
    process.exit(1)
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY required'); process.exit(1)
  }
  if (!canProvisionEdgeAuth()) {
    console.error('SECRETS_ENC_KEY required（でないとパスワードが plain: で保存される）'); process.exit(1)
  }

  const supa = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

  let q = supa.from('edge_devices').select('id, store_id, auth_user_id, auth_password_enc')
  q = all ? q.is('auth_user_id', null) : q.eq('id', edgeId!)
  const { data: edges, error } = await q
  if (error) { console.error('edge_devices 取得に失敗:', error.message); process.exit(1) }
  if (!edges?.length) { console.log('対象なし（すべて provisioning 済み）'); return }

  let ok = 0
  for (const edge of edges) {
    const password = await ensureEdgeAuthPassword(supa, edge, { rotate })
    if (!password) { console.error(`NG edge_id=${edge.id}`); continue }
    ok++
    console.log(`OK edge_id=${edge.id} email=${edgeAuthEmail(edge.id)}`)
  }
  console.log(`${ok}/${edges.length} 台を provisioning しました。`)
  if (ok !== edges.length) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
