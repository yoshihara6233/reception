import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * API ルートの認可ガード棚卸し。
 *
 * middleware は `/api/**` を認証ゲートしない。89 本のルートがそれぞれ自前で
 * ガードを書いており、認証方式は 11 種類に分かれている。チョークポイントが
 * 無いので、**新しいルートを 1 本足すたびにガードを書き忘れる機会が 1 回増える**。
 *
 * このテストは「どのルートがどの方式で守られているか」を表として固定し、
 * ずれたら CI を落とす。守るべきものは 3 つ。
 *   1. 新しいルートを表に載せずに追加できない（＝必ずガードを申告させる）
 *   2. 既存ルートのガードが弱くなったら気づく（admin → session-only 等）
 *   3. 無認証(PUBLIC)は許可リストに明記した 3 本だけ
 *
 * 表の更新は「実装を変えたから表も直す」順で行うこと。**表に合わせて実装を
 * 緩めない**。ガードを増やす方向（session-only → admin 等）の変更は歓迎。
 */

type Guard =
  | 'super-admin'     // ②運営管理。requireSuperAdmin()
  | 'admin'           // ①管理。requireAdmin() = super_admin/tenant_admin/store_manager
  | 'baggage-role'    // + baggage_manager。requireBaggageRole()
  | 'baggage-store'   // 手荷物検査の店舗スコープ。requireBaggageAccess()
  | 'kiosk'           // iPad キオスクの署名 cookie
  | 'edge-view'       // エッジ映像の可視性。requireEdgeViewAccess()
  | 'cron'            // CRON_SECRET / x-vercel-cron
  | 'device-token'    // エッジ端末トークン
  | 'webhook-secret'  // 共有 secret（未設定はフェイルクローズであること）
  | 'tenant-scope'    // resolveAdminContext/resolveMonitorScope + 明示ロール検査
  | 'session-only'    // ログインのみ。ロール検査なし（RLS 頼み）
  | 'PUBLIC'          // 無認証

/** 上から順に当てる。1 ファイルに複数ハンドラがあるときは最も強いガードを採る。 */
const RULES: [Guard, RegExp][] = [
  ['super-admin',    /requireSuperAdmin\s*\(/],
  ['admin',          /requireAdmin\s*\(/],
  ['baggage-role',   /requireBaggageRole\s*\(/],
  ['baggage-store',  /requireBaggageAccess\s*\(/],
  ['kiosk',          /requireKioskStore|requireKioskSession|readKioskSession|KIOSK_COOKIE/],
  ['edge-view',      /requireEdgeViewAccess/],
  ['cron',           /CRON_SECRET|x-vercel-cron/],
  ['device-token',   /device_token|x-device-token/],
  ['webhook-secret', /WEBHOOK_SECRET/],
  ['tenant-scope',   /resolveMonitorScope|resolveAdminContext/],
  ['session-only',   /auth\.getUser\s*\(|getSessionUser\s*\(/],
]

/**
 * 無認証で公開してよいルート。増やすときは理由をここに書くこと。
 *   /api/server-time  : 時刻のみ。キオスクの時刻ずれ検出に使う。秘密なし。
 *   /api/geocode      : 住所→座標。外部(Nominatim)への proxy。※レート制限は未実装（別タスク）
 *   /api/auth/reset-link : パスワード再設定。ワンタイムリンクはメールでのみ配送。
 */
const PUBLIC_ALLOWLIST = new Set([
  '/api/server-time',
  '/api/geocode',
  '/api/auth/reset-link',
])

const API_DIR = fileURLToPath(new URL('../app/api', import.meta.url))

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (e === 'route.ts') out.push(p)
  }
  return out
}

function classify(file: string): Guard {
  const src = readFileSync(file, 'utf8')
  return RULES.find(([, re]) => re.test(src))?.[0] ?? 'PUBLIC'
}

const actual: Record<string, Guard> = {}
for (const f of walk(API_DIR).sort()) {
  const route = '/api' + f.slice(API_DIR.length).replace(/\/route\.ts$/, '')
  actual[route] = classify(f)
}

// ---- 貼り付け用 ----
const EXPECTED: Record<string, Guard> = {
  '/api/admin/acting-tenant': 'admin',
  '/api/admin/baggage-settings': 'admin',
  '/api/admin/edge-jobs/[id]': 'admin',
  '/api/admin/edges/[id]': 'super-admin',
  '/api/admin/edges/ota/promote': 'super-admin',
  '/api/admin/edges': 'super-admin',
  '/api/admin/enrollments/[id]/reissue': 'admin',
  '/api/admin/enrollments/[id]': 'admin',
  '/api/admin/enrollments': 'admin',
  '/api/admin/geocode': 'admin',
  '/api/admin/import/cameras': 'admin',
  '/api/admin/import/stores': 'admin',
  '/api/admin/recorders/[id]/cameras': 'admin',
  '/api/admin/recorders/[id]/conn-test': 'admin',
  '/api/admin/recorders/[id]/discover': 'admin',
  '/api/admin/recorders/[id]': 'admin',
  '/api/admin/recorders': 'admin',
  '/api/admin/reports/monthly': 'tenant-scope',
  '/api/admin/stores/[id]/nvr/test-connection': 'admin',
  '/api/admin/stores/[id]': 'admin',
  '/api/admin/stores': 'admin',
  '/api/admin/tenants/[id]': 'admin',
  '/api/admin/tenants': 'admin',
  '/api/admin/users/[id]': 'admin',
  '/api/admin/users': 'admin',
  '/api/admin/vod/cleanup': 'cron',
  '/api/alarms/frames/[frameId]/image': 'session-only',
  '/api/alarms/frames/ingest': 'device-token',
  '/api/alarms/ingest': 'device-token',
  '/api/alarms/open-count': 'session-only',
  '/api/auth/reset-link': 'PUBLIC',
  '/api/baggage/clips/[id]': 'session-only',
  '/api/baggage/debug/sessions': 'baggage-store',
  '/api/baggage/edge/clip-upload': 'device-token',
  '/api/baggage/employees/[id]/face': 'admin',
  '/api/baggage/employees/[id]/photo': 'admin',
  '/api/baggage/employees/[id]': 'admin',
  '/api/baggage/employees': 'baggage-store',
  '/api/baggage/kiosk-orientation': 'baggage-store',
  '/api/baggage/kiosk-pin': 'baggage-store',
  '/api/baggage/kiosk/employees': 'kiosk',
  '/api/baggage/kiosk/face-auth': 'kiosk',
  '/api/baggage/kiosk/photo': 'kiosk',
  '/api/baggage/kiosk/pin-login': 'kiosk',
  '/api/baggage/kiosk/sessions': 'kiosk',
  '/api/baggage/sessions/[id]/clips/retry': 'session-only',
  '/api/baggage/sessions/[id]/confirm': 'admin',
  '/api/baggage/sessions/[id]/detail': 'session-only',
  '/api/baggage/sessions/[id]/photo': 'session-only',
  '/api/baggage/settings': 'baggage-store',
  '/api/bcp-webhook': 'webhook-secret',
  '/api/bcp/[id]/generate-report': 'session-only',
  '/api/bcp/[id]/report': 'session-only',
  '/api/bcp/[id]/retrieve': 'admin',
  '/api/bcp/[id]/snapshots.zip': 'session-only',
  '/api/bcp/clip/[id]': 'session-only',
  '/api/bcp/events': 'admin',
  '/api/bcp/test': 'tenant-scope',
  '/api/bcp/test/stores': 'session-only',
  '/api/cron/alarm-dispatch-retry': 'cron',
  '/api/cron/baggage-daily': 'cron',
  '/api/cron/edge-health': 'cron',
  '/api/cron/monthly-report': 'cron',
  '/api/cron/security-patrol': 'cron',
  '/api/cron/security-report': 'cron',
  '/api/cron/sfu-reaper': 'cron',
  '/api/cron/usage-rollup': 'cron',
  '/api/edge/bootstrap': 'device-token',
  '/api/edge/enroll': 'device-token',
  '/api/edges/[id]/cam/[cameraId]/snapshot': 'edge-view',
  '/api/edges/[id]/commands': 'session-only',
  '/api/edges/[id]/grid': 'edge-view',
  '/api/edges/[id]/image-upload-url': 'device-token',
  '/api/geocode': 'PUBLIC',
  '/api/live-proxy/[cameraId]/[...path]': 'session-only',
  '/api/live-sign/[cameraId]': 'session-only',
  '/api/livekit/publish': 'session-only',
  '/api/livekit/token': 'session-only',
  '/api/metrics': 'session-only',
  '/api/security/alarms/[eventId]/snapshot': 'session-only',
  '/api/security/patrol/[runId]/[cameraId]/snapshot': 'session-only',
  '/api/security/patrol/ingest': 'device-token',
  '/api/server-time': 'PUBLIC',
  '/api/sessions': 'session-only',
  '/api/vod-hls/[cameraId]/[...path]': 'session-only',
  '/api/vod/[clipId]': 'session-only',
  '/api/vod/[clipId]/status': 'session-only',
  '/api/vod': 'session-only',
  '/api/webhooks/onvif/[storeId]': 'webhook-secret',
}

describe('API ルートの認可ガード棚卸し', () => {
  it('表に無いルートが増えていない（新規ルートは必ずガードを申告する）', () => {
    const added = Object.keys(actual).filter((r) => !(r in EXPECTED))
    expect(added, `新しい API ルートです。ガードを実装したうえで EXPECTED に追記してください:\n${added.join('\n')}`).toEqual([])
  })

  it('表にあるルートが消えていない（消したなら表からも消す）', () => {
    const removed = Object.keys(EXPECTED).filter((r) => !(r in actual))
    expect(removed, `EXPECTED に残っている削除済みルート:\n${removed.join('\n')}`).toEqual([])
  })

  it('既存ルートのガードが変わっていない（弱くなっていないか）', () => {
    const changed = Object.keys(EXPECTED)
      .filter((r) => r in actual && actual[r] !== EXPECTED[r])
      .map((r) => `${r}: ${EXPECTED[r]} → ${actual[r]}`)
    expect(changed, `ガードが変化しました。強化なら EXPECTED を更新、弱化なら実装を戻してください:\n${changed.join('\n')}`).toEqual([])
  })

  it('無認証のルートは許可リストの 3 本だけ', () => {
    const publics = Object.entries(actual).filter(([, g]) => g === 'PUBLIC').map(([r]) => r)
    const unlisted = publics.filter((r) => !PUBLIC_ALLOWLIST.has(r))
    expect(unlisted, `ガードが検出できませんでした。実装したか、PUBLIC_ALLOWLIST に理由付きで追加してください:\n${unlisted.join('\n')}`).toEqual([])
    expect(publics.sort()).toEqual([...PUBLIC_ALLOWLIST].sort())
  })

  it('②運営管理(/api/admin/edges 系)は super_admin 限定のまま', () => {
    // メニューで隠すだけでは直 URL で到達される。API 側のゲートが本体。
    for (const r of ['/api/admin/edges', '/api/admin/edges/[id]', '/api/admin/edges/ota/promote']) {
      expect(actual[r], `${r} は super-admin であるべき`).toBe('super-admin')
    }
  })

  it('cron ルートはすべて cron secret で守られている', () => {
    const crons = Object.keys(actual).filter((r) => r.startsWith('/api/cron/'))
    expect(crons.length).toBeGreaterThan(0)
    for (const r of crons) expect(actual[r], `${r} に cron ガードが無い`).toBe('cron')
  })

  it('webhook 系のルートは 2 本（フェイルクローズの実挙動は webhook-fail-closed.test.ts で検証）', () => {
    // 正規表現でコードの「形」を見る検査は当てにならない。
    // 実際に `if (!secret) { /* skip */ } else {` へ書き換えても素通りしたため、
    // フェイルクローズの検証はハンドラを呼ぶ別テストへ移した。ここでは本数だけ固定する。
    const hooks = Object.keys(actual).filter((r) => actual[r] === 'webhook-secret')
    expect(hooks.sort()).toEqual(['/api/bcp-webhook', '/api/webhooks/onvif/[storeId]'])
  })

  it('session-only（ロール検査なし）の本数が増えていない', () => {
    // 最も弱い層。RLS に全面依存するので、service client を使うルートが
    // ここに入ると越権になる（/api/bcp/test が実際にそうだった）。
    // 減らす分には自由。増やすときはこの数字ごと見直すこと。
    const n = Object.values(actual).filter((g) => g === 'session-only').length
    expect(n).toBeLessThanOrEqual(24)
  })
})
