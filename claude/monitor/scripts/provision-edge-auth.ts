/**
 * エッジ専用 Supabase Auth ユーザの provisioning（エッジ専用スコープ鍵化 Phase B1）。
 *
 * 指定 edge_id に対して:
 *   1. ランダムパスワードを生成
 *   2. Supabase Auth ユーザを作成（email = edge+<edge_id>@edge.intereco.local /
 *      email_confirm=true / app_metadata = {edge_id, store_id, tenant_id, role:'edge'}）
 *   3. パスワードを AES-256-GCM(secret-codec)で暗号化し edge_devices.auth_user_id /
 *      auth_password_enc に保存
 * これで bootstrap が signInWithPassword で短命スコープトークンを発行できるようになる。
 *
 * 実行（monitor ディレクトリで、本番 env を渡して）:
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SECRETS_ENC_KEY=... \
 *     bun run scripts/provision-edge-auth.ts <edge_id>
 *
 * 冪等: 既に auth ユーザがある場合はパスワードをリセットして再保存する（再実行で復旧可能）。
 * ⚠ 鍵/パスワードはチャットに貼らない。env と Supabase 内にのみ存在させる。
 */
import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'
import { encryptSecret } from '@intereco/shared'

function edgeAuthEmail(edgeId: string): string {
  return `edge+${edgeId}@edge.intereco.local`
}

async function main() {
  const edgeId = process.argv[2]
  if (!edgeId) { console.error('usage: provision-edge-auth.ts <edge_id>'); process.exit(1) }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) { console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY required'); process.exit(1) }
  if (!process.env.SECRETS_ENC_KEY) {
    console.error('SECRETS_ENC_KEY required (でないと平文 plain: で保存され Vault 化されない)'); process.exit(1)
  }

  const supa = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

  // 1) edge_devices から store_id を取得し、stores から tenant_id を解決。
  const { data: edge, error: eErr } = await supa
    .from('edge_devices')
    .select('id, store_id, auth_user_id')
    .eq('id', edgeId)
    .single()
  if (eErr || !edge) { console.error('edge_devices not found:', eErr?.message); process.exit(1) }

  const { data: store, error: sErr } = await supa
    .from('stores')
    .select('id, tenant_id')
    .eq('id', edge.store_id)
    .single()
  if (sErr || !store) { console.error('stores not found for edge:', sErr?.message); process.exit(1) }

  const email = edgeAuthEmail(edgeId)
  const password = randomBytes(24).toString('base64url')   // 32文字級の高エントロピー
  const app_metadata = {
    edge_id: edgeId,
    store_id: edge.store_id,
    tenant_id: store.tenant_id,
    role: 'edge',
  }

  // 2) auth ユーザ作成（既存ならパスワード+app_metadataを更新）。
  let authUserId = edge.auth_user_id as string | null
  if (!authUserId) {
    const { data: created, error: cErr } = await supa.auth.admin.createUser({
      email, password, email_confirm: true, app_metadata,
    })
    if (cErr || !created?.user) {
      // 既に同 email が居る場合は探して更新に回す。
      const { data: list } = await supa.auth.admin.listUsers({ perPage: 200 })
      const found = list?.users?.find((u) => u.email === email)
      if (!found) { console.error('createUser failed:', cErr?.message); process.exit(1) }
      authUserId = found.id
    } else {
      authUserId = created.user.id
    }
  }
  if (edge.auth_user_id || (authUserId && authUserId !== edge.auth_user_id)) {
    const { error: uErr } = await supa.auth.admin.updateUserById(authUserId!, {
      password, email_confirm: true, app_metadata,
    })
    if (uErr) { console.error('updateUserById failed:', uErr.message); process.exit(1) }
  }

  // 3) 暗号化PWと auth_user_id を edge_devices に保存。
  const { error: wErr } = await supa
    .from('edge_devices')
    .update({ auth_user_id: authUserId, auth_password_enc: encryptSecret(password) })
    .eq('id', edgeId)
  if (wErr) { console.error('edge_devices update failed:', wErr.message); process.exit(1) }

  console.log(`provisioned edge auth user: edge_id=${edgeId} auth_user_id=${authUserId} email=${email}`)
  console.log('app_metadata=', JSON.stringify(app_metadata))
  console.log('OK. bootstrap が scoped トークンを発行できるようになりました。')
}

main().catch((e) => { console.error(e); process.exit(1) })
