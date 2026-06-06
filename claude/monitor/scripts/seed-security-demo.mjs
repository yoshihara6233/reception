/**
 * SECURITY 巡回レポート デモデータ投入
 *
 * 4 店舗 × 直近 4 週間 (週1レポート) で security_reports を作る。各レポートの
 * 期間内に patrol_runs を 3〜6 回 / run あたり patrol_findings を 1〜3 件
 * 投入し、status 分布 (normal / anomaly / review / confirmed / false_positive)
 * にバラエティを持たせて UI の集計列が意味ある数字を出すようにする。
 *
 * 世田谷店だけは実 Frigate カメラ ID を使い、他店舗の findings は
 * camera_id=null (= テナント単位の発見) として記録する。
 *
 * 既存データに非破壊 (insert only)。完全リセットしたければ
 * security_reports / patrol_findings / patrol_runs を順に truncate。
 *
 * 使い方:
 *   cd claude/monitor && node --env-file=.env.local scripts/seed-security-demo.mjs
 */
import { createClient } from '@supabase/supabase-js'

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
)

// ── helpers ──────────────────────────────────────────────────────────────────
const daysAgo = (d, h = 9, m = 0) => {
  const x = new Date()
  x.setUTCDate(x.getUTCDate() - d)
  x.setUTCHours(h - 9, m, 0, 0)  // JST → UTC
  return x.toISOString()
}
const minutesLater = (iso, minutes) =>
  new Date(new Date(iso).getTime() + minutes * 60_000).toISOString()
const randInt   = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min
const pick      = (arr) => arr[Math.floor(Math.random() * arr.length)]
const between01 = () => +(Math.random()).toFixed(3)

// Status distribution for findings — leaning normal but with enough variety
// for the UI stats columns to be meaningful.
const FINDING_STATUSES = [
  'normal', 'normal', 'normal', 'normal',     // 4/9 normal
  'anomaly',                                  // 1/9 anomaly
  'review', 'review',                         // 2/9 review (要確認)
  'confirmed',                                // 1/9 confirmed (= anomaly 確定)
  'false_positive',                           // 1/9 誤検知
]

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  const wantedStores = ['世田谷店', '練馬店', 'つくば店', '板橋店']
  const { data: stores } = await supa
    .from('stores')
    .select('id, name')
    .in('name', wantedStores)
  const byName = Object.fromEntries(stores.map((s) => [s.name, s]))
  console.log('Stores:', Object.entries(byName).map(([n, s]) => `${n}=${s.id.slice(0,8)}`).join(', '))

  // Resolve real Frigate cameras at 世田谷店 for snapshot_url targeting
  let setagayaCams = []
  if (byName['世田谷店']) {
    const { data: edge } = await supa
      .from('edge_devices')
      .select('id, recorders(id, recorder_cameras(id))')
      .eq('store_id', byName['世田谷店'].id)
      .limit(1)
      .maybeSingle()
    setagayaCams = (edge?.recorders ?? []).flatMap((r) => r.recorder_cameras).filter(Boolean)
    console.log('Setagaya cameras:', setagayaCams.map((c) => c.id.slice(0, 8)).join(', ') || '(none)')
  }

  // 4 weekly periods, oldest-first
  const periods = [
    { weeksAgo: 4, label: '4週前' },
    { weeksAgo: 3, label: '3週前' },
    { weeksAgo: 2, label: '2週前' },
    { weeksAgo: 1, label: '先週' },
  ]

  let totalRuns = 0
  let totalFindings = 0
  let totalReports = 0

  for (const store of Object.values(byName)) {
    for (const p of periods) {
      const fromIso = daysAgo(p.weeksAgo * 7,     0, 0)
      const toIso   = daysAgo(p.weeksAgo * 7 - 7, 0, 0)

      // 3〜6 patrol_runs spread over the week
      const runCount = randInt(3, 6)
      const insertedRuns = []
      for (let r = 0; r < runCount; r++) {
        const startIso = minutesLater(fromIso, randInt(0, 7 * 24 * 60 - 30))
        const { data: insRun, error: runErr } = await supa
          .from('patrol_runs')
          .insert({
            store_id:      store.id,
            trigger:       Math.random() < 0.9 ? 'scheduled' : 'manual',
            scheduled_for: startIso,
            started_at:    startIso,
            status:        Math.random() < 0.95 ? 'done' : 'failed',
          })
          .select('id, status')
          .single()
        if (runErr) { console.warn('  run insert failed:', runErr.message); continue }
        insertedRuns.push(insRun)
        totalRuns++
      }

      // For each successful run, generate 1〜3 findings
      for (const run of insertedRuns.filter((r) => r.status === 'done')) {
        const findingCount = randInt(1, 3)
        for (let f = 0; f < findingCount; f++) {
          const status = pick(FINDING_STATUSES)
          // 世田谷店だけ camera_id を実 ID にする、他店舗は null
          const cameraId = store.name === '世田谷店' && setagayaCams.length > 0
            ? pick(setagayaCams).id
            : null
          const { error: fErr } = await supa.from('patrol_findings').insert({
            run_id:        run.id,
            camera_id:     cameraId,
            snapshot_url:  cameraId ? `https://example.com/security/snap-${run.id.slice(0,8)}-${f}.jpg` : null,
            diff_score:    between01(),
            status,
            ai_status:     status === 'pending' ? 'pending' : (Math.random() < 0.8 ? 'done' : 'none'),
            ai_verdict:    status === 'anomaly' || status === 'confirmed' ? 'anomaly' :
                           status === 'review' ? null : 'normal',
            ai_confidence: between01(),
          })
          if (fErr) { console.warn('    finding insert failed:', fErr.message); continue }
          totalFindings++
        }
      }

      // The report itself
      const { error: repErr } = await supa.from('security_reports').insert({
        store_id:       store.id,
        period_from:    fromIso,
        period_to:      toIso,
        pdf_url:        `https://example.com/security/${store.id.slice(0,8)}-${p.weeksAgo}w.pdf`,
        generated_at:   minutesLater(toIso, 30),
        sent_to_emails: ['ops@example.com', 'security@example.com'],
      })
      if (repErr) console.warn(`  report insert failed: ${repErr.message}`)
      else {
        totalReports++
        console.log(`  ✓ ${store.name} ${p.label} — ${insertedRuns.length} runs / report`)
      }
    }
  }

  console.log(`\nInserted — runs=${totalRuns}, findings=${totalFindings}, reports=${totalReports}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
