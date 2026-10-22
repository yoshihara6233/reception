/**
 * 使われ方の 1 日の集計（GVMS_CLOUD_SPEC §12.4・D-2-22）の形と掃除。
 *
 * **知らない項目は捨てて、拒否しない**（§2 の決まり）。断るのは、日（day）と版（schema）が
 * 読めないときだけ。数は 0 以上の有限の数に、文字は決まった形と長さに限る — 拠点から来た値を
 * そのまま保存しない（名前や IP が紛れ込んでいても、形の合わない値はここで落ちる）。
 */

/** 本文の上限（§12.4）。 */
export const USAGE_MAX_BYTES = 64 * 1024

/** 保存の期間（§4.3: 25 か月）。 */
export const USAGE_RETENTION_MONTHS = 25

/** 受け付ける日の幅: 送り直しは 7 日前まで（余裕を見て 31 日）・明日以降は受けない。 */
const MAX_AGE_DAYS = 31

const KEY = /^[a-z0-9._]{1,64}$/
const DEVICE = /^[A-Za-z0-9 ._()/+-]{1,64}$/
const VERSION = /^[A-Za-z0-9._/+-]{1,64}$/
const RES = /^[0-9]{2,5}x[0-9]{2,5}$/
const LIMIT_ENTRIES = 200

export interface UsagePayload {
  features: Record<string, number>
  errors: Record<string, number>
  cameras: CameraGroup[]
  load: Record<string, number>
  clients: { browsers: Record<string, number>; os: Record<string, number>; widths: Record<string, number>; max_concurrent: number }
  doctor: { ok: number; warn: number; fail: number }
}

export interface CameraGroup {
  vendor: string
  model: string
  firmware: string
  codec: string
  res: string
  fps: number
  gop: string
  audio: boolean
  count: number
}

export interface UsageHeader {
  day: string
  schema: number
  agentVersion: string | null
}

function num(v: unknown, max = 1e12): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? v : null
}

function str(v: unknown, re: RegExp): string {
  return typeof v === 'string' && re.test(v.trim()) ? v.trim() : ''
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

/** 名前が形に合い、値が数のものだけを残す（200 件まで）。 */
function counts(v: unknown, keyRe = KEY): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [k, x] of Object.entries(obj(v))) {
    if (Object.keys(out).length >= LIMIT_ENTRIES) break
    const n = num(x)
    if (keyRe.test(k) && n !== null) out[k] = n
  }
  return out
}

const LOAD_KEYS = ['cameras', 'nodes', 'cpu_avg', 'cpu_max', 'mem_gb_max', 'disk_used_ratio', 'rec_gb'] as const
const GOP = new Set(['', 'le2s', 'le10s', 'le60s', 'gt60s'])
const CODEC = new Set(['', 'h264', 'h265', 'other'])

/**
 * 日と版を読む。読めなければ null（400）。
 * 日は YYYY-MM-DD で、今日（日本時間）から 31 日前までのもの。
 */
export function parseHeader(raw: unknown, now = new Date()): UsageHeader | null {
  const o = obj(raw)
  const day = typeof o.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.day) ? o.day : null
  const schema = typeof o.schema === 'number' && Number.isInteger(o.schema) && o.schema >= 1 && o.schema <= 1000 ? o.schema : null
  if (!day || !schema) return null
  const t = Date.parse(`${day}T00:00:00+09:00`)
  if (Number.isNaN(t)) return null
  const todayJst = Date.parse(`${new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10)}T00:00:00+09:00`)
  if (t > todayJst || t < todayJst - MAX_AGE_DAYS * 86400_000) return null
  const agent = str(o.agent_version, VERSION)
  return { day, schema, agentVersion: agent || null }
}

/** 本文から、知らない項目と形の合わない値を落とす。 */
export function cleanPayload(raw: unknown): UsagePayload {
  const o = obj(raw)
  const cams: CameraGroup[] = []
  for (const c of Array.isArray(o.cameras) ? o.cameras.slice(0, LIMIT_ENTRIES) : []) {
    const x = obj(c)
    const count = num(x.count, 1e6)
    if (count === null || count < 1) continue
    const codec = typeof x.codec === 'string' && CODEC.has(x.codec) ? x.codec : ''
    const gop = typeof x.gop === 'string' && GOP.has(x.gop) ? x.gop : ''
    cams.push({
      vendor: str(x.vendor, DEVICE), model: str(x.model, DEVICE), firmware: str(x.firmware, DEVICE),
      codec, res: str(x.res, RES), fps: Math.round(num(x.fps, 1000) ?? 0), gop,
      audio: x.audio === true, count: Math.round(count),
    })
  }
  const loadIn = obj(o.load)
  const load: Record<string, number> = {}
  for (const k of LOAD_KEYS) {
    const n = num(loadIn[k], 1e9)
    if (n !== null) load[k] = n
  }
  const cl = obj(o.clients)
  const doc = obj(o.doctor)
  return {
    features: counts(o.features),
    errors: counts(o.errors),
    cameras: cams,
    load,
    clients: {
      browsers: counts(cl.browsers), os: counts(cl.os), widths: counts(cl.widths),
      max_concurrent: Math.round(num(cl.max_concurrent, 1e6) ?? 0),
    },
    doctor: {
      ok: Math.round(num(doc.ok, 1000) ?? 0), warn: Math.round(num(doc.warn, 1000) ?? 0), fail: Math.round(num(doc.fail, 1000) ?? 0),
    },
  }
}

/** 保存の期間を過ぎた日の境目（これより前の日を消す）。 */
export function usageRetentionCutoff(now = new Date()): string {
  const d = new Date(now)
  d.setUTCMonth(d.getUTCMonth() - USAGE_RETENTION_MONTHS)
  return d.toISOString().slice(0, 10)
}

/** 受け口を開けてよいか（約款の施行後に GVMS_USAGE_INTAKE=on）。 */
export function usageIntakeOpen(env: Record<string, string | undefined> = process.env): boolean {
  return (env.GVMS_USAGE_INTAKE ?? '').toLowerCase() === 'on'
}
