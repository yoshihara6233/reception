/**
 * Storage オブジェクト移行（SQL主導版）
 *
 * 旧プロジェクトの REST バケット一覧が [] を返す不具合があるため、
 * psql で storage.objects から書き出した一覧ファイルを入力にコピーする。
 *
 * 使い方:
 *   psql -d "$OLD" -tA -F'|' -c "SELECT bucket_id, name FROM storage.objects" > /tmp/mig/objects.txt
 *   export OLD_SUPABASE_URL=... OLD_SERVICE_ROLE_KEY=... NEW_SUPABASE_URL=... NEW_SERVICE_ROLE_KEY=...
 *   node scripts/region-migrate/copy-objects.mjs /tmp/mig/objects.txt
 *
 * 冪等（upsert）。失敗したパスは最後に一覧表示。
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const req = (k) => {
  const v = process.env[k]
  if (!v) { console.error(`missing env: ${k}`); process.exit(1) }
  return v
}
const listFile = process.argv[2]
if (!listFile) { console.error('usage: node copy-objects.mjs <objects.txt>'); process.exit(1) }

const OLD_URL = req('OLD_SUPABASE_URL')
const OLD_KEY = req('OLD_SERVICE_ROLE_KEY')
const newc = createClient(req('NEW_SUPABASE_URL'), req('NEW_SERVICE_ROLE_KEY'))

const lines = readFileSync(listFile, 'utf8').split('\n').map(l => l.trim()).filter(Boolean)
console.log(`objects to copy: ${lines.length}`)

let ok = 0, bytes = 0
const failed = []
for (const line of lines) {
  const i = line.indexOf('|')
  if (i < 0) continue
  const bucket = line.slice(0, i)
  const path = line.slice(i + 1)
  try {
    // 旧: REST 直ダウンロード（apikey + Bearer 両ヘッダ必須）
    const res = await fetch(
      `${OLD_URL}/storage/v1/object/authenticated/${bucket}/${encodeURIComponent(path).replaceAll('%2F', '/')}`,
      { headers: { apikey: OLD_KEY, Authorization: `Bearer ${OLD_KEY}` } },
    )
    if (!res.ok) {
      const body = (await res.text()).slice(0, 120)
      throw new Error(`download HTTP ${res.status}: ${body}`)
    }
    const buf = Buffer.from(await res.arrayBuffer())
    // content-type は ASCII のみ許可（非ASCII混入で fetch ヘッダが ByteString エラーになるため）
    let contentType = (res.headers.get('content-type') || '').split(';')[0].trim()
    if (!/^[\x20-\x7e]+\/[\x20-\x7e]+$/.test(contentType)) contentType = 'application/octet-stream'

    const { error } = await newc.storage.from(bucket).upload(path, buf, { upsert: true, contentType })
    if (error) throw new Error(`upload: ${error.message}`)
    ok++; bytes += buf.length
    if (ok % 25 === 0) console.log(`  ...${ok}/${lines.length}`)
  } catch (e) {
    failed.push(`${bucket}/${path} — ${e.message}`)
  }
}
console.log(`\ndone: ${ok}/${lines.length} copied, ${(bytes / 1024 / 1024).toFixed(1)} MB`)
if (failed.length) {
  console.log(`FAILED (${failed.length}):`)
  for (const f of failed) console.log('  ' + f)
  process.exit(1)
}
