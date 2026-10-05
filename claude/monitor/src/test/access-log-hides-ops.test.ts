import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * テナントのアクセスログ (/admin/audit) に運営 (super_admin) の閲覧を出さないこと (2026-10-05)。
 *
 * 以前は「見ている人が super_admin でなければ隠す」だったため、運営がテナントを選んで
 * 開くと運営自身の閲覧が混ざって見えた (利用者の指摘)。テナントの画面は誰が開いても同じ中身にし、
 * 運営の閲覧は運営アクセスログ (/admin/ops-audit) で見る。
 */
const src = readFileSync(join(__dirname, '..', 'app/admin/audit/page.tsx'), 'utf8')

describe('テナントのアクセスログは運営の閲覧を出さない', () => {
  it('見ている人の役割で隠すかを変えない', () => {
    expect(src).not.toMatch(/hideSuperActors/)
    expect(src).toMatch(/sessions\.filter\(\(s\) => !superActorIds\.has\(s\.user_id\)\)/)
    expect(src).toMatch(/footage\.filter\(\(f\) => !superActorIds\.has\(f\.actor_user_id\)\)/)
  })
  it('運営には運営アクセスログへの案内を出す', () => {
    expect(src).toMatch(/href="\/admin\/ops-audit"/)
  })
})

describe('設定変更ログも運営の操作を出さない (2026-10-06)', () => {
  const changes = readFileSync(join(__dirname, '..', 'app/admin/audit/changes/page.tsx'), 'utf8')
  it('見ている人の役割で除外するかを変えない', () => {
    expect(changes).not.toMatch(/if \(ctx\.role !== 'super_admin'\) \{\s*const svc/)
    expect(changes).toMatch(/query\.not\('actor_user_id', 'in'/)
  })
  it('運営には運営アクセスログへの案内を出す', () => {
    expect(changes).toMatch(/href="\/admin\/ops-audit"/)
  })
})
