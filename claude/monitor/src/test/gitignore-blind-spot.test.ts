import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

/**
 * **追跡済みのソースが .gitignore に隠されていないか**の検査。
 *
 * ── なぜ必要だったか ────────────────────────────────────────────────────
 * 2026-08-09 の PR #286（変異テストの自動化）で、Stryker の出力を除外する
 * つもりで `.gitignore` に `reports/` と書いた。gitignore のパターンは
 * **先頭に / が無いと深さを問わず一致する**ので、これが
 *
 *   src/lib/reports/**            利用状況レポートの集計・月次PDF
 *   src/app/admin/reports/usage/  そのレポート画面
 *   src/app/security/reports/     警備日報
 *   src/app/infra/reports/        インフラ帳票
 *
 * まで巻き込み、**src の 14 ファイルが .gitignore を尊重するツールから
 * 見えなくなっていた**（ripgrep・エディタの全文検索・`git add`）。
 *
 * ── なぜ気づけないか ────────────────────────────────────────────────────
 * **追跡済みのファイルは .gitignore の影響を受けない。** 表示も動作も
 * ビルドも今までどおりで、壊れた様子がまったく無い。効いてくるのは
 * 「その配下に新しいファイルを足したとき、`git add .` が黙って拾わない」
 * という形で、しかもそれは足した本人にしか起きない。
 *
 * 実際、この穴のせいで env-check の利用箇所を私が見落とし、
 * 「配線されていない」と誤って結論しかけた（2026-08-10）。
 * **検索が黙って結果を減らす**のは、間違った答えより厄介な壊れ方。
 *
 * ── 何を見るか ──────────────────────────────────────────────────────────
 * git 自身に聞く。追跡されているのに ignore 対象、という矛盾した状態が
 * 1 件でもあれば落とす。パターンの書き方を検査するより確実で、
 * `reports/` に限らずこの形の間違いを全部拾える。
 */

/** リポジトリ相対で、追跡されているのに無視対象になっているファイル。 */
function trackedButIgnored(dirs: string[]): string[] {
  const tracked = execFileSync('git', ['ls-files', '-z', ...dirs], { encoding: 'utf8' })
    .split('\0').filter(Boolean)
  expect(tracked.length, 'git ls-files が空です（git リポジトリではない？）').toBeGreaterThan(50)

  // --no-index を付けないと、check-ignore は追跡済みファイルを黙って飛ばす
  // ＝**まさに今回見つけたかった状態が検出できない**。
  const out = execFileSync('git', ['check-ignore', '--stdin', '--no-index'], {
    input: tracked.join('\n'),
    encoding: 'utf8',
    // 一致が 0 件のとき git は exit 1 を返す（＝正常）。
  }).trim()
  return out ? out.split('\n') : []
}

describe('.gitignore の死角', () => {
  it('★追跡済みのソースが .gitignore に隠されていない', () => {
    let hidden: string[] = []
    try {
      hidden = trackedButIgnored(['src', 'e2e', 'tests', 'supabase', 'scripts'])
    } catch (e) {
      // check-ignore は「一致 0 件」で exit 1。これは成功なので握る。
      const err = e as { status?: number; stdout?: string }
      if (err.status !== 1) throw e
      hidden = (err.stdout ?? '').trim() ? (err.stdout ?? '').trim().split('\n') : []
    }
    expect(
      hidden,
      '.gitignore が追跡済みのソースを隠しています。ripgrep・エディタ検索・git add から'
      + '見えなくなり、その配下の新規ファイルは静かに追跡されません。'
      + 'パターンの先頭に / を付けて位置を固定してください。',
    ).toEqual([])
  })
})
