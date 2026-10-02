// PR が G・VMS-Cloud の画面を変えたとき、取扱説明書 第 2 部のどの章に当たるかを PR へ書き込む。
//
// 説明書の正本は G・VMS のリポジトリにあるため、ここで更新を強制はできない (CI は落とさない)。
// 代わりに「どの章を確かめるか」を毎回目の前に出す — 決まりを書いただけでは読まれず、
// 2026-10-02 の PR 3 本 (削除したカメラの表示・現地更新の札・環境変数の警告) で第 2 部が古くなった。
//
//   node .github/scripts/manual-reminder.mjs            (CI: PR の変更ファイルを gh で引く)
//   MANUAL_FILES="a\nb" node .github/scripts/manual-reminder.mjs --dry-run   (手元の確認)
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const MARK = '<!-- manual-part2-reminder -->'
const ROOT = 'claude/monitor/src/'
const cfg = JSON.parse(readFileSync(new URL('../manual-part2-map.json', import.meta.url), 'utf8'))
const dry = process.argv.includes('--dry-run')
const repo = process.env.GITHUB_REPOSITORY
const pr = process.env.PR_NUMBER

const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8' })

const files = process.env.MANUAL_FILES
  ? process.env.MANUAL_FILES.split('\n').filter(Boolean)
  : gh('api', `repos/${repo}/pulls/${pr}/files`, '--paginate', '--jq', '.[].filename').split('\n').filter(Boolean)

// 試験 (*.test.*) と受け口 (app/api) は画面ではない
const screens = files
  .filter((f) => f.startsWith(ROOT))
  .map((f) => f.slice(ROOT.length))
  .filter((f) => !/\.test\.[jt]sx?$/.test(f) && !f.startsWith('app/api/'))

const hits = new Map() // 章 → 変更したファイル
for (const f of screens) {
  const m = cfg.map.find(([prefix]) => f.startsWith(prefix))
  if (!m) continue
  for (const ch of m[1]) {
    if (!hits.has(ch)) hits.set(ch, [])
    hits.get(ch).push(f)
  }
}

if (hits.size === 0) {
  console.log('取扱説明書 第 2 部に当たる画面の変更はありません')
  process.exit(0)
}

const chs = [...hits.keys()].sort((a, b) => Number(a) - Number(b))
const lines = [
  MARK,
  '### 取扱説明書 第 2 部の確認',
  '',
  'この PR は G・VMS-Cloud の画面を変えています。次の章が古くならないか確かめてください。',
  '説明書の正本は **yoshihara6233/NVMS** の `docs/ProjectFile/NVMS_取扱説明書_第2部_第N章.html` です（直したら `python3 scripts/manual_build.py --part 2 --word` で組み直す）。',
  '',
  '| 章 | 変更したファイル |',
  '|---|---|',
  ...chs.map((ch) => `| ${ch} 章 ${cfg.chapters[ch] ?? ''} | ${[...new Set(hits.get(ch))].map((f) => '`' + f + '`').join('<br>')} |`),
  '',
  '本文の「取扱説明書 第 2 部」の欄で、更新したか・変更が無いかに印を付けてください。',
]
const body = lines.join('\n')

if (dry) {
  console.log(body)
  process.exit(0)
}

// 前回の書き込みがあれば書き換える (push のたびに増やさない)
const prev = JSON.parse(gh('api', `repos/${repo}/issues/${pr}/comments`, '--paginate', '--jq',
  `[.[] | select(.body | startswith("${MARK}")) | .id]`).trim() || '[]')
if (prev.length > 0) {
  gh('api', '-X', 'PATCH', `repos/${repo}/issues/comments/${prev[0]}`, '-f', `body=${body}`)
  console.log(`書き換えました (comment ${prev[0]})`)
} else {
  gh('api', '-X', 'POST', `repos/${repo}/issues/${pr}/comments`, '-f', `body=${body}`)
  console.log('書き込みました')
}
