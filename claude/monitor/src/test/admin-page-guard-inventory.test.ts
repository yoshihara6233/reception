/**
 * /admin 配下のページが、それぞれどのロール判定で守られているかの棚卸し。
 * API 版（api-guard-inventory.test.ts）のページ版。
 *
 * ── なぜ要るのか ──────────────────────────────────────────────────────
 * middleware は認証を強制しない（手荷物検査店長の遮断だけ）。各ページが
 * 自前でロールを見るしかないので、**書き忘れても静かに動いてしまう**。
 * 2026-08-09 の E2E 導入時、28 ページ中 7 ページにロール判定が無く、
 * 閲覧者(viewer)が店舗マスタ・店舗編集・レコーダ接続設定・CSV一括投入・
 * BCP発動条件・アクセスログ・変更履歴へ直 URL で到達できた。
 *
 * 見落としの理由もはっきりしている。`ctx.role !== 'super_admin'` のような
 * **表示の絞り込み**がガードに見えてしまう。/admin/audit/changes がまさに
 * それで、行のフィルタしかしていないのにガード済みに見えていた。
 *
 * 書き込み側（API の requireAdmin / server action の RLS）は塞がっていたので
 * データは壊せなかったが、「押してから断る」状態だった。入口で断る。
 *
 * ブラウザ E2E（e2e/role-matrix.spec.ts）が本物の到達可否を見るのに対し、
 * こちらは**全ページを漏れなく数える**役。新しいページを足したら、
 * EXPECTED に書くまで落ちる。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

type Guard =
  | 'super-admin'   // super_admin のみ
  | 'admin'         // ADMIN_ROLES（super_admin / tenant_admin / store_manager）
  | 'tenant-admin'  // super_admin + tenant_admin
  | 'all-roles'     // ログイン済みなら全ロール（意図的に開いている）
  | 'redirect'      // 転送のみ（実体は転送先が守る）
  | 'NONE'

/**
 * 判定は「ソースにその形が出てくるか」で行う。**強いものから順に見る**。
 * 形だけを見る検査は嘘をつきうる（2026-08-09、正規表現の検査が壊した実装を
 * 素通りさせた）ので、実際の到達可否は E2E 側で別途確かめている。
 * ここが担うのは「数え漏れを出さない」ことだけ。
 */
const RULES: [Guard, RegExp][] = [
  ['redirect',     /^import \{ redirect \}[\s\S]*export default function \w+\(\) \{\s*redirect\(/m],
  ['super-admin',  /requireSuperAdmin\(\)/],
  ['super-admin',  /role !== 'super_admin'\)\s*(\{[\s\S]{0,80})?notFound\(\)/],
  ['admin',        /requireAdmin\(\)/],
  ['tenant-admin', /role !== 'super_admin' && \w*\.?role !== 'tenant_admin'/],
  ['tenant-admin', /!\['super_admin', 'tenant_admin'\]\.includes\(/],
  ['all-roles',    /\['super_admin', 'tenant_admin', 'store_manager', 'viewer', 'baggage_manager'\]\.includes\(/],
]

/**
 * 期待するガード。**弱める変更をするときは、必ずここも変えることになる**
 * ＝レビューで気づける。強める分にはここを更新すればよい。
 */
const EXPECTED: Record<string, Guard> = {
  '/admin':                       'redirect',
  '/admin/audit':                 'admin',
  '/admin/audit/changes':         'admin',
  '/admin/baggage':               'tenant-admin',
  '/admin/bcp':                   'admin',
  '/admin/edges':                 'super-admin',
  '/admin/edges/[id]':            'super-admin',
  '/admin/edges/new':             'super-admin',
  '/admin/import':                'admin',
  '/admin/limits':                'admin',        // 本文でさらに super_admin に絞る
  '/admin/nvr-models':            'super-admin',
  '/admin/nvr-models/[id]':       'super-admin',
  '/admin/ops-audit':             'super-admin',
  '/admin/ops-users':             'super-admin',
  '/admin/ops-users/[id]':        'super-admin',
  '/admin/ops-users/new':         'super-admin',
  // 利用状況レポートだけは全ロールに開いている（読むだけの画面・①設定の着地）。
  // 意図的な例外なので、ここに 'all-roles' と書いて明示しておく。
  '/admin/reports/usage':         'all-roles',
  '/admin/stores':                'admin',
  '/admin/stores/[id]':           'admin',
  '/admin/stores/[id]/nvr':       'admin',
  '/admin/stores/new':            'tenant-admin',
  '/admin/tenants':               'super-admin',
  '/admin/tenants/[id]':          'super-admin',
  '/admin/tenants/new':           'super-admin',
  '/admin/users':                 'admin',
  '/admin/users/[id]':            'tenant-admin',
  '/admin/users/new':             'tenant-admin',
}

const ADMIN_DIR = fileURLToPath(new URL('../app/admin', import.meta.url))

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (e === 'page.tsx') out.push(p)
  }
  return out
}

function routeOf(file: string): string {
  const rel = file.slice(ADMIN_DIR.length).replace(/\/page\.tsx$/, '')
  return `/admin${rel}`
}

function classify(src: string): Guard {
  for (const [guard, re] of RULES) if (re.test(src)) return guard
  return 'NONE'
}

const actual: Record<string, Guard> = {}
for (const file of walk(ADMIN_DIR)) {
  actual[routeOf(file)] = classify(readFileSync(file, 'utf8'))
}

describe('/admin のページガード棚卸し', () => {
  it('ロール判定の無いページが無い', () => {
    const bare = Object.entries(actual).filter(([, g]) => g === 'NONE').map(([r]) => r)
    expect(
      bare,
      'ロール判定がありません。ログインさえしていれば誰でも開けます:\n' + bare.join('\n'),
    ).toEqual([])
  })

  it('新しいページは EXPECTED に登録されている', () => {
    const added = Object.keys(actual).filter((r) => !(r in EXPECTED))
    expect(
      added,
      '新しい管理ページです。ガードを実装したうえで EXPECTED に追記してください:\n' + added.join('\n'),
    ).toEqual([])
  })

  it('削除済みのページが EXPECTED に残っていない', () => {
    const removed = Object.keys(EXPECTED).filter((r) => !(r in actual))
    expect(removed, 'EXPECTED に残っている削除済みページ:\n' + removed.join('\n')).toEqual([])
  })

  it('ガードが台帳どおり', () => {
    const changed = Object.keys(EXPECTED)
      .filter((r) => r in actual && actual[r] !== EXPECTED[r])
      .map((r) => `${r}: ${EXPECTED[r]} → ${actual[r]}`)
    expect(
      changed,
      'ガードが変化しました。強化なら EXPECTED を更新、弱化なら実装を戻してください:\n' + changed.join('\n'),
    ).toEqual([])
  })

  it('全ロールに開いているページは利用状況レポートだけ', () => {
    // 「読むだけだから」で開くページが増えていないかの歯止め。
    const open = Object.entries(actual).filter(([, g]) => g === 'all-roles').map(([r]) => r)
    expect(open.sort()).toEqual(['/admin/reports/usage'])
  })
})
