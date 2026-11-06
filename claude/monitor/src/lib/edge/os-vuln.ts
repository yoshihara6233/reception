/**
 * 拠点の OS の既知の脆弱性の申告（NVMS/docs/GVMS_CLOUD_SPEC.md §13・WBS F-7）。
 *
 * 拠点の各サーバが照合表と OS の部品の版を比べた結果を heartbeat の os_vuln で受ける。
 * 守ること（§13.2）:
 *  - **形の崩れた os_vuln で heartbeat を拒否しない。** 読めた分だけ使い、読めなければ null。
 *  - 保存するのは決めた項目だけ（拠点が余分な項目を送っても写さない）。16 台・1 台 20 件まで。
 */

export type OsVulnLevel = 'urgent' | 'routine' | 'deferred'

export interface OsVulnFinding {
  id?: string
  cve: string
  package: string
  level: OsVulnLevel
  fixed: string
  installed: string
  needs_reboot?: boolean
}

export interface OsVulnServer {
  node: string
  kernel?: string
  table_version: number
  urgent: number
  routine: number
  deferred: number
  checked_at?: string
  findings: OsVulnFinding[]
}

export interface OsVulnStatus {
  table_version: number
  urgent: number
  routine: number
  servers: OsVulnServer[]
}

export const MAX_OS_VULN_SERVERS = 16
export const MAX_OS_VULN_FINDINGS = 20

const str = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.length > 0 ? v.slice(0, max) : null
const count = (v: unknown): number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 100_000 ? v : 0
const LEVELS: readonly OsVulnLevel[] = ['urgent', 'routine', 'deferred']

/** heartbeat の os_vuln を保存できる形に整える。オブジェクトでなければ null（＝申告なし）。 */
export function sanitizeOsVuln(input: unknown): OsVulnStatus | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const o = input as Record<string, unknown>
  const servers: OsVulnServer[] = []
  for (const sv of Array.isArray(o.servers) ? o.servers : []) {
    if (servers.length >= MAX_OS_VULN_SERVERS) break
    if (!sv || typeof sv !== 'object') continue
    const s = sv as Record<string, unknown>
    const node = str(s.node, 64)
    if (!node) continue
    const findings: OsVulnFinding[] = []
    for (const fv of Array.isArray(s.findings) ? s.findings : []) {
      if (findings.length >= MAX_OS_VULN_FINDINGS) break
      if (!fv || typeof fv !== 'object') continue
      const f = fv as Record<string, unknown>
      const cve = str(f.cve, 32)
      const pkg = str(f.package, 64)
      if (!cve || !pkg) continue
      const level = LEVELS.includes(f.level as OsVulnLevel) ? (f.level as OsVulnLevel) : 'deferred'
      const item: OsVulnFinding = { cve, package: pkg, level, fixed: str(f.fixed, 64) ?? '', installed: str(f.installed, 64) ?? '' }
      const id = str(f.id, 32)
      if (id) item.id = id
      if (f.needs_reboot === true) item.needs_reboot = true
      findings.push(item)
    }
    const out: OsVulnServer = {
      node, table_version: count(s.table_version),
      urgent: count(s.urgent), routine: count(s.routine), deferred: count(s.deferred), findings,
    }
    const kernel = str(s.kernel, 64)
    if (kernel) out.kernel = kernel
    const at = str(s.checked_at, 40)
    if (at) out.checked_at = at
    servers.push(out)
  }
  return {
    table_version: count(o.table_version),
    // 合計は拠点の申告を使う（16 台を超えて切った分も数えるため）
    urgent: count(o.urgent),
    routine: count(o.routine),
    servers,
  }
}

/** 一覧に出す状態。none = 要らない・urgent = 緊急・routine = 定期保守・reboot = 修正版は入っていて再起動で直る */
export type OsVulnState = 'none' | 'urgent' | 'routine' | 'reboot'

export function osVulnState(st: OsVulnStatus | null | undefined): OsVulnState {
  if (!st || st.urgent + st.routine === 0) return 'none'
  const acts = st.servers.flatMap((s) => s.findings.filter((f) => f.level !== 'deferred'))
  if (acts.length > 0 && acts.every((f) => f.needs_reboot)) return 'reboot'
  return st.urgent > 0 ? 'urgent' : 'routine'
}
