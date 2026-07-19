/**
 * Supabase Storage 全バケット移行スクリプト（Mumbai → Tokyo リージョン移行用）
 *
 * 使い方（キーはチャットに貼らず、ローカル環境変数で渡す）:
 *   export OLD_SUPABASE_URL="https://jmlviywilxzavjbmlpnf.supabase.co"
 *   export OLD_SERVICE_ROLE_KEY="sb_secret_...(旧)"
 *   export NEW_SUPABASE_URL="https://<新ref>.supabase.co"
 *   export NEW_SERVICE_ROLE_KEY="sb_secret_...(新)"
 *   node scripts/region-migrate/copy-storage.mjs           # 全バケット
 *   node scripts/region-migrate/copy-storage.mjs --dry-run # 一覧のみ
 *
 * - 旧側の全バケットを列挙 → 新側に同設定で作成（既存ならスキップ）
 * - 各バケットのオブジェクトを再帰列挙し download → upload（upsert）
 * - 冪等: 再実行しても上書きコピーされるだけ
 */
import { createClient } from '@supabase/supabase-js'

const req = (k) => {
  const v = process.env[k]
  if (!v) { console.error(`missing env: ${k}`); process.exit(1) }
  return v
}

const DRY = process.argv.includes('--dry-run')
const oldc = createClient(req('OLD_SUPABASE_URL'), req('OLD_SERVICE_ROLE_KEY'))
const newc = createClient(req('NEW_SUPABASE_URL'), req('NEW_SERVICE_ROLE_KEY'))

/** バケット内を再帰列挙してフルパス配列を返す */
async function walk(client, bucket, prefix = '') {
  const out = []
  let offset = 0
  for (;;) {
    const { data, error } = await client.storage.from(bucket).list(prefix, { limit: 1000, offset })
    if (error) throw new Error(`list ${bucket}/${prefix}: ${error.message}`)
    if (!data || data.length === 0) break
    for (const item of data) {
      const path = prefix ? `${prefix}/${item.name}` : item.name
      if (item.id) out.push(path)                    // ファイル
      else out.push(...await walk(client, bucket, path)) // フォルダ
    }
    if (data.length < 1000) break
    offset += data.length
  }
  return out
}

const { data: buckets, error: bErr } = await oldc.storage.listBuckets()
if (bErr) { console.error('listBuckets failed:', bErr.message); process.exit(1) }

let files = 0, bytes = 0, failed = 0
for (const b of buckets) {
  const paths = await walk(oldc, b.name)
  console.log(`\n[bucket] ${b.name} (public=${b.public}) — ${paths.length} objects`)
  if (DRY) continue

  const { error: cErr } = await newc.storage.createBucket(b.name, {
    public: b.public,
    fileSizeLimit: b.file_size_limit ?? undefined,
    allowedMimeTypes: b.allowed_mime_types ?? undefined,
  })
  if (cErr && !/already exists/i.test(cErr.message)) {
    console.error(`  createBucket failed: ${cErr.message}`); failed++; continue
  }

  for (const p of paths) {
    const { data: blob, error: dErr } = await oldc.storage.from(b.name).download(p)
    if (dErr) { console.error(`  download ${p}: ${dErr.message}`); failed++; continue }
    const buf = Buffer.from(await blob.arrayBuffer())
    const { error: uErr } = await newc.storage.from(b.name).upload(p, buf, {
      upsert: true,
      contentType: blob.type || 'application/octet-stream',
    })
    if (uErr) { console.error(`  upload ${p}: ${uErr.message}`); failed++; continue }
    files++; bytes += buf.length
    if (files % 50 === 0) console.log(`  ...${files} files copied`)
  }
}
console.log(`\ndone: ${files} files / ${(bytes / 1024 / 1024).toFixed(1)} MB copied, ${failed} failed${DRY ? ' (dry-run)' : ''}`)
process.exit(failed > 0 ? 1 : 0)
