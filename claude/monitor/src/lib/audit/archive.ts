/**
 * 監査の記録を別の置き場へ毎日書き出す (ASVS 5.0 L2 16.4.3・2026-11-06)。
 *
 * 目的: アプリ (Vercel) や DB (service_role) を奪われても、証跡が消されたり
 * 書き換えられたりしないようにする。そのため置き場は次の形にする (docs/audit-archive.md):
 *   - **専用の R2 バケット**に、**専用のキー** (そのバケットだけ・映像の R2 キーとは別) で書く
 *   - バケットに **Bucket lock (保持 5 年)** を掛ける。キーが漏れても期限までは消せず上書きもできない
 *   - こちらも上書きしない (PUT に If-None-Match: * を付ける)
 *
 * 書き出す表と、日付を決める列:
 *   admin_audit_log (管理操作) ts / live_sessions (ライブの視聴) started_at /
 *   video_sessions (遠隔視聴) created_at / footage_access_log (証跡の静止画の閲覧) accessed_at
 *
 * 置き場の名前 (UTC の日付):
 *   audit/v1/YYYY/MM/DD/<表>.jsonl.gz  … 1 行 1 件の JSON を gzip
 *   audit/v1/YYYY/MM/DD/manifest.json  … 各ファイルの件数・SHA-256 と、**前の日の manifest の SHA-256**
 * manifest を最後に書く。manifest がある日 = 書き出し済み。前の日の SHA-256 で日をつなぐので、
 * 途中の日を差し替えると後ろの日の manifest と合わなくなる。
 *
 * 書き出すのは**前の日まで** (今日は途中なので出さない)。直近 LOOKBACK_DAYS 日で
 * manifest の無い日を古い順に書き出す (cron が 1 日止まっても次の日に拾う)。
 *
 * **後からさかのぼったときのつなぎ (link.json・2026-11-07)**: 置き場を作った最初の日の manifest は
 * 前の日が無いので prev_manifest_sha256 が null。あとから前の日々をさかのぼって書くと、最初の日は
 * Bucket lock で書き換えられないので、鎖が 2 本に分かれる。そこで、その日に link.json
 * (前の日の manifest の SHA-256 と、その日の manifest の SHA-256) を書いて 2 本をつなぐ。
 * 検査は「manifest の prev_manifest_sha256、それが null なら同じ日の link.json」で前の日へたどる。
 * 行は書き出した時点の内容 (視聴の終わりの時刻などは、日をまたいで終わった視聴だと空のことがある)。
 */
import { createHash } from 'node:crypto'
import { gunzipSync, gzipSync } from 'node:zlib'
import type { SupabaseClient } from '@supabase/supabase-js'

export const ARCHIVE_PREFIX = 'audit/v1'
/** 直近何日を見て、抜けている日を書き出すか */
export const LOOKBACK_DAYS = 7
/** 初回などにさかのぼって書き出す日数の上限 (?backfill_days=) */
export const MAX_BACKFILL_DAYS = 400
/** 1 回の問い合わせで読む行数 */
const PAGE = 1000

export interface ArchiveTable {
  table: string
  /** その日に入れるかを決める列 (UTC の日付) */
  timeColumn: string
}

export const ARCHIVE_TABLES: readonly ArchiveTable[] = [
  { table: 'admin_audit_log', timeColumn: 'ts' },
  { table: 'live_sessions', timeColumn: 'started_at' },
  { table: 'video_sessions', timeColumn: 'created_at' },
  { table: 'footage_access_log', timeColumn: 'accessed_at' },
]

/** 置き場 (R2)。試験では手元の Map で置き換える。 */
export interface ArchiveStore {
  /** 無ければ null */
  get(key: string): Promise<Buffer | null>
  /** 無いときだけ書く。既にあれば 'exists' (上書きしない) */
  putOnce(key: string, body: Buffer, contentType: string): Promise<'created' | 'exists'>
}

export interface ManifestFile {
  table: string
  key: string
  rows: number
  bytes: number
  sha256: string
}

export interface Manifest {
  version: 1
  date: string
  generated_at: string
  files: ManifestFile[]
  prev_manifest_sha256: string | null
}

export interface DayResult {
  date: string
  status: 'exported' | 'present' | 'error'
  rows?: number
  error?: string
  /** さかのぼりで前の日とつないだ (link.json を書いた) */
  linked?: boolean
}

/** 鎖の先頭だった日を、あとから書いた前の日へつなぐ記録 (audit/v1/YYYY/MM/DD/link.json) */
export interface ChainLink {
  version: 1
  date: string
  generated_at: string
  manifest_sha256: string
  prev_manifest_sha256: string
}

export interface ArchiveSummary {
  ok: boolean
  days: DayResult[]
  /** 時間切れで残した日 (次の実行で書き出す) */
  deferred: number
}

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex')

/** UTC の日付 'YYYY-MM-DD' */
export function utcDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function addDays(date: string, n: number): string {
  const t = new Date(`${date}T00:00:00Z`)
  t.setUTCDate(t.getUTCDate() + n)
  return utcDate(t)
}

export function dayPrefix(date: string): string {
  const [y, m, d] = date.split('-')
  return `${ARCHIVE_PREFIX}/${y}/${m}/${d}`
}

/** その日の 1 表の行をすべて読む (列の順は id・同じ日の行は後から増えない) */
async function readDay(svc: SupabaseClient, t: ArchiveTable, date: string): Promise<Record<string, unknown>[]> {
  const from = `${date}T00:00:00Z`
  const to = `${addDays(date, 1)}T00:00:00Z`
  const out: Record<string, unknown>[] = []
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await svc
      .from(t.table)
      .select('*')
      .gte(t.timeColumn, from)
      .lt(t.timeColumn, to)
      .order('id', { ascending: true })
      .range(off, off + PAGE - 1)
    if (error) throw new Error(`${t.table}: ${error.message}`)
    const rows = (data ?? []) as Record<string, unknown>[]
    out.push(...rows)
    if (rows.length < PAGE) return out
  }
}

/** 1 日分を書き出し、その日の manifest の SHA-256 を返す */
async function exportDay(
  svc: SupabaseClient,
  store: ArchiveStore,
  date: string,
  prev: string | null,
  now: Date,
): Promise<{ manifestSha: string; rows: number }> {
  const files: ManifestFile[] = []
  let rows = 0
  for (const t of ARCHIVE_TABLES) {
    const list = await readDay(svc, t, date)
    const body = gzipSync(Buffer.from(list.map((r) => JSON.stringify(r)).join('\n') + (list.length ? '\n' : ''), 'utf8'))
    const key = `${dayPrefix(date)}/${t.table}.jsonl.gz`
    let stored: Buffer = body
    if ((await store.putOnce(key, body, 'application/gzip')) === 'exists') {
      // 前の実行が manifest の前で止まった。置き場にある方を正として数える (上書きしない)
      const cur = await store.get(key)
      if (!cur) throw new Error(`${key}: 置き場にあるはずのファイルが読めません`)
      stored = cur
    }
    files.push({ table: t.table, key, rows: stored === body ? list.length : countLines(stored), bytes: stored.length, sha256: sha256(stored) })
    rows += files[files.length - 1].rows
  }
  const manifest: Manifest = { version: 1, date, generated_at: now.toISOString(), files, prev_manifest_sha256: prev }
  const mBody = Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  const mKey = `${dayPrefix(date)}/manifest.json`
  if ((await store.putOnce(mKey, mBody, 'application/json')) === 'exists') {
    const cur = await store.get(mKey)
    if (!cur) throw new Error(`${mKey}: 置き場にあるはずの manifest が読めません`)
    return { manifestSha: sha256(cur), rows }
  }
  return { manifestSha: sha256(mBody), rows }
}

function countLines(gz: Buffer): number {
  // 既にある gzip の行数 (manifest の件数のため)
  const text = gunzipSync(gz).toString('utf8')
  return text === '' ? 0 : text.trimEnd().split('\n').length
}

export interface ArchiveOptions {
  now: Date
  /** さかのぼる日数 (既定 LOOKBACK_DAYS・上限 MAX_BACKFILL_DAYS) */
  days?: number
  /** この時刻を過ぎたら新しい日に手を付けない (Vercel の上限の前に止める) */
  deadline?: number
}

/** 前の日まで、manifest の無い日を古い順に書き出す */
export async function runAuditArchive(svc: SupabaseClient, store: ArchiveStore, o: ArchiveOptions): Promise<ArchiveSummary> {
  const span = Math.min(Math.max(1, o.days ?? LOOKBACK_DAYS), MAX_BACKFILL_DAYS)
  const yesterday = addDays(utcDate(o.now), -1)
  const first = addDays(yesterday, -(span - 1))
  const days: DayResult[] = []

  const before = await store.get(`${dayPrefix(addDays(first, -1))}/manifest.json`)
  let prev: string | null = before ? sha256(before) : null
  let deferred = 0
  for (let d = first; d <= yesterday; d = addDays(d, 1)) {
    const have = await store.get(`${dayPrefix(d)}/manifest.json`)
    if (have) {
      const haveSha = sha256(have)
      const linked = prev !== null && (await linkIfHead(store, d, have, haveSha, prev, o.now))
      prev = haveSha
      days.push(linked ? { date: d, status: 'present', linked } : { date: d, status: 'present' })
      continue
    }
    if (o.deadline !== undefined && Date.now() > o.deadline) {
      deferred++
      // 前の日が書けていないので、この後の日を前の日とつながない
      prev = null
      continue
    }
    try {
      const r = await exportDay(svc, store, d, prev, o.now)
      prev = r.manifestSha
      days.push({ date: d, status: 'exported', rows: r.rows })
    } catch (e) {
      days.push({ date: d, status: 'error', error: e instanceof Error ? e.message : String(e) })
      // 鎖が切れるので、後ろの日は次の実行に回す
      deferred += countDays(addDays(d, 1), yesterday)
      break
    }
  }
  return { ok: days.every((x) => x.status !== 'error'), days, deferred }
}

/**
 * その日の manifest が鎖の先頭 (prev が null) で、すぐ前の日の manifest がある (prev) なら、
 * link.json を書いてつなぐ。書いた (既にあった) ら true。
 */
async function linkIfHead(store: ArchiveStore, date: string, have: Buffer, haveSha: string, prev: string, now: Date): Promise<boolean> {
  let m: Partial<Manifest>
  try {
    m = JSON.parse(have.toString('utf8')) as Partial<Manifest>
  } catch {
    return false
  }
  if (m.prev_manifest_sha256 !== null) return false
  const link: ChainLink = { version: 1, date, generated_at: now.toISOString(), manifest_sha256: haveSha, prev_manifest_sha256: prev }
  const key = `${dayPrefix(date)}/link.json`
  if ((await store.putOnce(key, Buffer.from(JSON.stringify(link, null, 2) + '\n', 'utf8'), 'application/json')) === 'exists') {
    const cur = await store.get(key)
    return !!cur && (JSON.parse(cur.toString('utf8')) as ChainLink).prev_manifest_sha256 === prev
  }
  return true
}

function countDays(from: string, to: string): number {
  if (from > to) return 0
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1
}
