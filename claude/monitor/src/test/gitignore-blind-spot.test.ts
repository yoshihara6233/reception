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

/**
 * 秘密ファイルが **無視される側** にいるか。上の検査と対になる。
 *
 * ── なぜ後から足したか（2026-08-14）────────────────────────────────────
 * 上の検査は「隠れてはいけないものが隠れていないか」だけを見ていた。
 * 逆方向——**コミットされてはいけないものが無視されていない**——は原理的に
 * 拾えず、**死角の検査に死角があった**。
 *
 * 実際に穴が空いていた。各プロジェクトの .gitignore は `.env` `.env.local`
 * `.env*.local` と**個別の名前を列挙**しており、変種が素通りしていた:
 *
 *   .env.demo  .env.production  .env.bak  *.pem  id_rsa
 *
 * `.env.demo` は仮定ではない。**退役した `intereco-edge-demo` が実際に使って
 * いたファイル名**そのもので、service_role 鍵が入っていた（2026-08-03 に
 * 現地で発見・削除）。`.env.save` も OSS-VMS に実在した。
 *
 * ── 何を見るか ──────────────────────────────────────────────────────────
 * git 自身に聞く。実在しないパスでも `check-ignore` は判定できるので、
 * 「もし置かれたら」を先回りして固定できる。`vercel env pull` は
 * `.env.local` を、機器作業のバックアップは `.env.bak` を作る——どちらも
 * 1 回の `git add -A` で本番の秘密が履歴に入る。履歴に入った秘密は消せない。
 *
 * ⚠ 上の検査と対で効く。ここで無視を広げすぎて追跡済みファイルを隠すと、
 *   上の「追跡済みが隠れていない」が落ちる。両方向で挟んでいる。
 */
/**
 * ⚠ **git はリポジトリのルートで実行する。** vitest の cwd は `claude/monitor`
 *   なので、そのまま `claude/monitor/.env` を渡すと
 *   `claude/monitor/claude/monitor/.env` として評価され、別物を測ってしまう。
 *   2026-08-14 に実際これで空振りした（ついでに worktree のルートを取り違えて
 *   HOME 側の .gitignore を編集し、当然何も変わらなかった）。
 */
const REPO_ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()

function ignoredMap(paths: string[]): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const p of paths) {
    try {
      execFileSync('git', ['check-ignore', '-q', '--no-index', p], { cwd: REPO_ROOT, stdio: 'ignore' })
      out[p] = true
    } catch {
      out[p] = false   // 一致なし = exit 1 = 無視されていない
    }
  }
  return out
}

describe('.gitignore の死角（逆方向: 秘密が無視されているか）', () => {
  /** 置かれたら必ず無視されるべきパス。ワークスペースごとに同じ形で確かめる。 */
  const WORKSPACES = ['claude/monitor', 'claude/edge-agent', 'claude/shared']
  const SECRET_NAMES = [
    '.env', '.env.local', '.env.production', '.env.development',
    // 実在した変種。**この2つが今回の穴だった。**
    '.env.demo', '.env.bak', '.env.save',
    // 鍵・証明書
    'id_rsa', 'id_ed25519', 'server.pem', 'client.p12',
  ]

  it('★秘密ファイルは、どのワークスペースに置かれても無視される', () => {
    const paths = WORKSPACES.flatMap((w) => SECRET_NAMES.map((n) => `${w}/${n}`))
    const map = ignoredMap(paths)
    const exposed = paths.filter((p) => !map[p])
    expect(
      exposed,
      '無視されていない秘密ファイルのパスがあります。1 回の `git add -A` で本番の'
      + '秘密が履歴に入り、履歴からは消せません。.gitignore に規則を足してください。',
    ).toEqual([])
  })

  it('.example は追跡できる（無視を広げすぎていない）', () => {
    const examples = [
      'claude/monitor/.env.example',
      'claude/monitor/.env.local.example',
      'claude/edge-agent/.env.example',
    ]
    const map = ignoredMap(examples)
    expect(
      Object.entries(map).filter(([, ignored]) => ignored).map(([p]) => p),
      '雛形まで無視すると、必要な env の一覧が誰にも見えなくなります。',
    ).toEqual([])
  })
})

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
