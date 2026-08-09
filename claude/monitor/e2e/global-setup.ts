/**
 * E2E の前処理: ローカル DB に 6 ロールのペルソナを流し込む。
 *
 * seed.sql は **各自の実験用で gitignore 済み**なので、それに依存すると
 * 「自分の環境では通るが CI では落ちる」が起きる。共有物である
 * seed.example.sql をここで明示的に当て、誰の環境でも同じ前提から始める。
 *
 * seed.example.sql は全 INSERT が `on conflict do nothing` なので、
 * `supabase db reset` の直後でも、すでに seed 済みでも、同じ結果になる。
 *
 * ⚠ migration の適用まではやらない（`supabase db reset` の担当）。
 *    ここで DDL まで面倒を見ると「テストが勝手にスキーマを直す」ことになり、
 *    migration の不備をテストが隠してしまう。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Client } from 'pg'

const DEFAULT_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

export default async function globalSetup(): Promise<void> {
  const connectionString = process.env.SUPABASE_DB_URL ?? DEFAULT_DB_URL
  // Playwright は CJS へ変換して読むので import.meta は使えない（__dirname は使える）。
  const seedPath = resolve(__dirname, '../supabase/seed.example.sql')
  const sql = readFileSync(seedPath, 'utf8')

  const client = new Client({ connectionString })
  await client.connect()
  try {
    // 6 ロールが揃っていること自体が前提条件。ここで落ちたら
    // 「migration が当たっていない」か「seed が壊れている」のどちらか。
    await client.query(sql)
    const { rows } = await client.query<{ role: string; n: string }>(
      `select role, count(*)::text as n
         from public.admin_users
        where email like '%@local.dev'
        group by role order by role`,
    )
    const total = rows.reduce((a, r) => a + Number(r.n), 0)
    if (total !== 6) {
      throw new Error(
        `seed 後のペルソナが 6 人ではありません（${total} 人）: ` +
        rows.map((r) => `${r.role}=${r.n}`).join(', ') +
        '\n`bunx supabase db reset` で migration を当て直してください。',
      )
    }
    console.log(`[e2e] ペルソナ ${total} 人を確認: ${rows.map((r) => r.role).join(', ')}`)
  } finally {
    await client.end()
  }
}
