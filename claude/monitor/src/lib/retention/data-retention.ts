/**
 * データの保持期間で消す (2026-10-30 発注者の決定・docs/data-classification.md §3・§4)。
 * 日次の cron `/api/cron/data-retention` から呼ぶ。
 *
 *   従業員の顔 (Rekognition の常設のコレクション baggage-emp-<store> の顔と、baggage-photos の
 *     employees/<store>/ の顔写真):
 *       - 登録を外したら即時 (画面の操作で消している)。ここでは消し残しを拾う
 *       - 1 年照合に使っていなければ消す (employees.face_last_matched_at・従業員は登録のまま。
 *         キオスクで撮り直せば戻る)
 *       - どの従業員にも結び付いていない顔写真 (消すのに失敗した写真など) を消す
 *   従業員の氏名・社員番号: 登録を外してから 1 年で行ごと消す (employees.deactivated_at)
 *   BCP の生画像 (bcp-clips の置き場の <eventId>/ 以下・bcp_clips・bcp_grid_shots): 90 日。
 *     消したら bcp_events.raw_purged_at に印を付ける。レポートの PDF (bcp-reports) は残す
 *   管理操作の記録 admin_audit_log: 5 年
 *   ライブの視聴の記録 live_sessions: 1 年
 *   遠隔視聴の記録 video_sessions: 180 日 (置き場 R2 を消し終えた行だけ・purged_at あり)
 *
 * 作りは /api/admin/vod/cleanup に合わせる:
 *   - 1 回に消す数に上限を付ける (残りは次の日に回る)
 *   - 置き場 (と Rekognition) を先に消し、成功した分だけ DB の行を消す・書き換える。
 *     失敗した分は行を残し、次の実行でやり直す
 *   - dry_run は数えるだけで何も消さない
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { deleteFacesInCollection, employeeCollectionId } from '@/lib/aws/rekognition'

/** 保持期間 (発注者の決定 2026-10-30)。変えるときは docs/data-classification.md と docs/data-governance-sla.md も同じ日に直す。 */
export const RETENTION = {
  /** 従業員の顔: 照合に使わなくなってから */
  employeeFaceUnusedYears: 1,
  /** 従業員の氏名・社員番号: 登録を外してから */
  employeeNameAfterDeactivationYears: 1,
  /** BCP の生画像 */
  bcpRawDays: 90,
  /** 管理操作の記録 */
  adminAuditYears: 5,
  /** ライブの視聴の記録 */
  liveSessionsYears: 1,
  /** 遠隔視聴の記録 */
  videoSessionsDays: 180,
} as const

/** 1 回の実行で扱う数の上限。超えた分は次の実行に回る。 */
export const LIMITS = {
  /** 従業員の行 (顔・氏名それぞれ) */
  employeesPerRun: 500,
  /** 結び付きの無い顔写真 */
  orphanPhotosPerRun: 1000,
  /** BCP の発令 */
  bcpEventsPerRun: 50,
  /** BCP の置き場のファイル */
  bcpObjectsPerRun: 5000,
  /** 記録の表: 1 回に読む行 (PostgREST の既定の上限) と回数 */
  logPage: 1000,
  logRounds: 10,
  /** 置き場の remove に 1 度に渡す数 */
  removeChunk: 1000,
  /** 行の id を in に並べる数 (URL の長さを抑える) */
  idChunk: 200,
  /** 顔写真を置いてから DB に書くまでの間は消さない (登録の途中のもの) */
  orphanGraceMs: 24 * 60 * 60 * 1000,
} as const

const PHOTOS_BUCKET = 'baggage-photos'
const BCP_BUCKET = 'bcp-clips'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface StepResult {
  /** 期限を過ぎた数 (dry_run では消す予定の数・それ以外では今回扱った数) */
  targets: number
  /** 消した数 */
  deleted: number
  /** 消せなかった数 (次の実行でやり直す) */
  failed: number
  errors: string[]
}

export interface RetentionSummary {
  ok: boolean
  dry_run: boolean
  now: string
  cutoffs: ReturnType<typeof retentionCutoffs>
  steps: {
    employee_faces_deactivated: StepResult
    employee_faces_unused: StepResult
    employee_names: StepResult
    employee_photo_orphans: StepResult
    bcp_raw: StepResult & { objects: number; partial: boolean }
    admin_audit_log: StepResult
    live_sessions: StepResult
    video_sessions: StepResult
  }
}

const empty = (): StepResult => ({ targets: 0, deleted: 0, failed: 0, errors: [] })

function yearsAgo(now: Date, years: number): Date {
  const d = new Date(now.getTime())
  d.setUTCFullYear(d.getUTCFullYear() - years)
  return d
}
const daysAgo = (now: Date, days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000)

/** 各データの「これより古いものを消す」時刻 (ISO)。 */
export function retentionCutoffs(now: Date) {
  return {
    employee_face_unused: yearsAgo(now, RETENTION.employeeFaceUnusedYears).toISOString(),
    employee_name: yearsAgo(now, RETENTION.employeeNameAfterDeactivationYears).toISOString(),
    bcp_raw: daysAgo(now, RETENTION.bcpRawDays).toISOString(),
    admin_audit_log: yearsAgo(now, RETENTION.adminAuditYears).toISOString(),
    live_sessions: yearsAgo(now, RETENTION.liveSessionsYears).toISOString(),
    video_sessions: daysAgo(now, RETENTION.videoSessionsDays).toISOString(),
  }
}

function chunks<T>(xs: readonly T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n))
  return out
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e))

/** 置き場から消す (まとめて)。失敗したら誤りの文を返す。 */
async function removeObjects(svc: SupabaseClient, bucket: string, paths: string[]): Promise<string | null> {
  for (const part of chunks(paths, LIMITS.removeChunk)) {
    const { error } = await svc.storage.from(bucket).remove(part)
    if (error) return error.message
  }
  return null
}

// ── 従業員の顔 ──────────────────────────────────────────────────────────────

interface EmployeeFaceRow {
  id: string
  store_id: string
  rekognition_face_id: string | null
  face_photo_path: string | null
}

const FACE_LEFT = 'rekognition_face_id.not.is.null,face_photo_path.not.is.null'

/**
 * 顔 (Rekognition の顔と写真) を消し、列を空にする。消せなかった分は列を残す。
 * 更新は行ごとに「読んだときの値のまま」の条件を付ける (その間に登録し直した顔を消さない)。
 */
async function removeEmployeeFaces(
  svc: SupabaseClient, rows: EmployeeFaceRow[], action: string, now: Date, out: StepResult,
): Promise<void> {
  // 1. Rekognition (店舗ごとのコレクション)
  const faceGone = new Set<string>()
  const byStore = new Map<string, string[]>()
  for (const r of rows) {
    if (!r.rekognition_face_id) continue
    const list = byStore.get(r.store_id) ?? []
    list.push(r.rekognition_face_id)
    byStore.set(r.store_id, list)
  }
  for (const [storeId, faceIds] of byStore) {
    try {
      const res = await deleteFacesInCollection(employeeCollectionId(storeId), faceIds)
      for (const f of res.deleted) faceGone.add(f)
      if (res.error) out.errors.push(`rekognition ${storeId.slice(0, 8)}: ${res.error}`)
    } catch (e) {
      // AWS の鍵が無いなど。行は残して次の実行でやり直す
      out.errors.push(`rekognition ${storeId.slice(0, 8)}: ${msg(e)}`)
    }
  }

  // 2. 写真 (顔が消えた行・顔の無い行だけ)
  const faceOk = rows.filter((r) => !r.rekognition_face_id || faceGone.has(r.rekognition_face_id))
  const photoPaths = faceOk.map((r) => r.face_photo_path).filter((p): p is string => !!p)
  const photoErr = photoPaths.length > 0 ? await removeObjects(svc, PHOTOS_BUCKET, photoPaths) : null
  if (photoErr) out.errors.push(`photo remove: ${photoErr}`)

  // 3. 列を空にする
  const audit: Record<string, unknown>[] = []
  for (const r of rows) {
    const faceDone = !r.rekognition_face_id || faceGone.has(r.rekognition_face_id)
    if (!faceDone) { out.failed++; continue }
    const patch: Record<string, null> = { rekognition_face_id: null }
    if (!photoErr) patch.face_photo_path = null
    let q = svc.from('employees').update(patch).eq('id', r.id)
    q = r.rekognition_face_id ? q.eq('rekognition_face_id', r.rekognition_face_id) : q.is('rekognition_face_id', null)
    q = r.face_photo_path ? q.eq('face_photo_path', r.face_photo_path) : q.is('face_photo_path', null)
    const { data: upd, error } = await q.select('id')
    if (error) { out.failed++; out.errors.push(`employees update: ${error.message}`); continue }
    if (!upd || upd.length === 0) continue // 読んだ後に顔を登録し直した (新しい顔は消していない)
    if (photoErr && r.face_photo_path) { out.failed++; continue } // 顔は消えた・写真は次の実行で
    out.deleted++
    audit.push({
      actor_user_id: null, action, target_type: 'employee', target_id: r.id, store_id: r.store_id,
      changes: { retention: true, at: now.toISOString() },
    })
  }
  if (audit.length > 0) {
    const { error } = await svc.from('admin_audit_log').insert(audit)
    if (error) out.errors.push(`audit insert: ${error.message}`)
  }
}

/** 登録を外した従業員に残っている顔 (画面の操作で消し損ねたもの) を消す。 */
export async function purgeDeactivatedEmployeeFaces(svc: SupabaseClient, now: Date, dryRun: boolean): Promise<StepResult> {
  const out = empty()
  const { data, error } = await svc
    .from('employees')
    .select('id, store_id, rekognition_face_id, face_photo_path')
    .eq('status', 'inactive')
    .or(FACE_LEFT)
    .limit(LIMITS.employeesPerRun)
  if (error) { out.errors.push(`employees select: ${error.message}`); return out }
  const rows = (data ?? []) as EmployeeFaceRow[]
  out.targets = rows.length
  if (dryRun || rows.length === 0) return out
  await removeEmployeeFaces(svc, rows, 'retention.employee.face_cleanup', now, out)
  return out
}

/** 1 年照合に使っていない顔を消す (従業員は登録のまま)。 */
export async function purgeUnusedEmployeeFaces(svc: SupabaseClient, now: Date, dryRun: boolean): Promise<StepResult> {
  const out = empty()
  const cutoff = retentionCutoffs(now).employee_face_unused
  const { data, error } = await svc
    .from('employees')
    .select('id, store_id, rekognition_face_id, face_photo_path')
    .eq('status', 'active')
    .or(FACE_LEFT)
    .lt('face_last_matched_at', cutoff)
    .order('face_last_matched_at', { ascending: true })
    .limit(LIMITS.employeesPerRun)
  if (error) { out.errors.push(`employees select: ${error.message}`); return out }
  const rows = (data ?? []) as EmployeeFaceRow[]
  out.targets = rows.length
  if (dryRun || rows.length === 0) return out
  await removeEmployeeFaces(svc, rows, 'retention.employee.face_expire', now, out)
  return out
}

/** 登録を外してから 1 年たった従業員の行 (氏名・社員番号) を消す。顔が残っている行は先に顔を消す。 */
export async function purgeDeactivatedEmployees(svc: SupabaseClient, now: Date, dryRun: boolean): Promise<StepResult> {
  const out = empty()
  const cutoff = retentionCutoffs(now).employee_name
  const { data, error } = await svc
    .from('employees')
    .select('id, store_id, deactivated_at')
    .eq('status', 'inactive')
    .lt('deactivated_at', cutoff)
    .is('rekognition_face_id', null)
    .is('face_photo_path', null)
    .order('deactivated_at', { ascending: true })
    .limit(LIMITS.employeesPerRun)
  if (error) { out.errors.push(`employees select: ${error.message}`); return out }
  const rows = (data ?? []) as { id: string; store_id: string; deactivated_at: string }[]
  out.targets = rows.length
  if (dryRun || rows.length === 0) return out

  const audit: Record<string, unknown>[] = []
  for (const part of chunks(rows, LIMITS.idChunk)) {
    // 条件を付け直す (読んだ後に登録し直された行・顔を付け直された行は消さない)
    const { data: gone, error: delErr } = await svc
      .from('employees')
      .delete()
      .in('id', part.map((r) => r.id))
      .eq('status', 'inactive')
      .lt('deactivated_at', cutoff)
      .is('rekognition_face_id', null)
      .is('face_photo_path', null)
      .select('id')
    if (delErr) { out.failed += part.length; out.errors.push(`employees delete: ${delErr.message}`); continue }
    const goneIds = new Set(((gone ?? []) as { id: string }[]).map((g) => g.id))
    out.deleted += goneIds.size
    for (const r of part.filter((x) => goneIds.has(x.id))) {
      audit.push({
        actor_user_id: null, action: 'retention.employee.purge', target_type: 'employee', target_id: r.id,
        store_id: r.store_id, changes: { retention: true, deactivated_at: r.deactivated_at },
      })
    }
  }
  if (audit.length > 0) {
    const { error: auErr } = await svc.from('admin_audit_log').insert(audit)
    if (auErr) out.errors.push(`audit insert: ${auErr.message}`)
  }
  return out
}

interface StorageEntry { name: string; id?: string | null; created_at?: string | null }

/** 置き場の 1 階層を全部読む (1,000 件ずつ)。 */
async function listAll(
  svc: SupabaseClient, bucket: string, prefix: string, max: number,
): Promise<{ entries: StorageEntry[]; complete: boolean } | { error: string }> {
  const entries: StorageEntry[] = []
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await svc.storage.from(bucket).list(prefix, { limit: 1000, offset })
    if (error) return { error: error.message }
    const page = (data ?? []) as StorageEntry[]
    entries.push(...page)
    if (entries.length >= max) return { entries: entries.slice(0, max), complete: false }
    if (page.length < 1000) return { entries, complete: true }
  }
}

/** どの従業員にも結び付いていない顔写真 (employees/<store>/) を消す。置いてから 1 日たったものだけ。 */
export async function purgeOrphanEmployeePhotos(svc: SupabaseClient, now: Date, dryRun: boolean): Promise<StepResult> {
  const out = empty()
  const top = await listAll(svc, PHOTOS_BUCKET, 'employees', 10_000)
  if ('error' in top) { out.errors.push(`list employees: ${top.error}`); return out }
  const graceIso = new Date(now.getTime() - LIMITS.orphanGraceMs).toISOString()
  let budget: number = LIMITS.orphanPhotosPerRun

  for (const folder of top.entries) {
    if (budget <= 0) break
    if (folder.id || !UUID_RE.test(folder.name)) continue // 店舗の id のフォルダだけ
    const prefix = `employees/${folder.name}`
    const listed = await listAll(svc, PHOTOS_BUCKET, prefix, 10_000)
    if ('error' in listed) { out.errors.push(`list ${prefix}: ${listed.error}`); continue }
    const files = listed.entries.filter((f) => !!f.id)
    if (files.length === 0) continue

    const { data: refs, error } = await svc
      .from('employees')
      .select('face_photo_path')
      .eq('store_id', folder.name)
      .not('face_photo_path', 'is', null)
    if (error) { out.errors.push(`employees refs: ${error.message}`); continue }
    const referenced = new Set(((refs ?? []) as { face_photo_path: string }[]).map((r) => r.face_photo_path))

    const orphans = files
      .filter((f) => !referenced.has(`${prefix}/${f.name}`))
      .filter((f) => !!f.created_at && f.created_at < graceIso)
      .slice(0, budget)
      .map((f) => `${prefix}/${f.name}`)
    if (orphans.length === 0) continue
    budget -= orphans.length
    out.targets += orphans.length
    if (dryRun) continue
    const err = await removeObjects(svc, PHOTOS_BUCKET, orphans)
    if (err) { out.failed += orphans.length; out.errors.push(`orphan remove: ${err}`); continue }
    out.deleted += orphans.length
  }
  return out
}

// ── BCP の生画像 ────────────────────────────────────────────────────────────

/** 昔の行の clip_url / thumbnail_url (Storage の URL) から bcp-clips の中の場所を取り出す。 */
export function bcpPathFromUrl(url: string | null | undefined): string | null {
  if (!url) return null
  const m = /\/storage\/v1\/object\/(?:public|sign|authenticated)\/bcp-clips\/([^?#]+)/.exec(url)
  if (!m) return null
  try { return decodeURIComponent(m[1]) } catch { return null }
}

/** 発令 1 件の置き場のファイル (<eventId>/ と、その下のフォルダ 1 段) を集める。 */
async function listBcpEventObjects(
  svc: SupabaseClient, eventId: string, max: number,
): Promise<{ paths: string[]; complete: boolean } | { error: string }> {
  const top = await listAll(svc, BCP_BUCKET, eventId, max)
  if ('error' in top) return top
  const paths: string[] = []
  let complete = top.complete
  for (const e of top.entries) {
    if (paths.length >= max) { complete = false; break }
    if (e.id) { paths.push(`${eventId}/${e.name}`); continue }
    const sub = await listAll(svc, BCP_BUCKET, `${eventId}/${e.name}`, max - paths.length)
    if ('error' in sub) return sub
    for (const f of sub.entries) if (f.id) paths.push(`${eventId}/${e.name}/${f.name}`)
    if (!sub.complete) { complete = false; break }
  }
  return { paths, complete }
}

/** 90 日を過ぎた BCP の生画像を消し、発令に印を付ける。PDF (bcp-reports・bcp_reports) は残す。 */
export async function purgeBcpRaw(
  svc: SupabaseClient, now: Date, dryRun: boolean,
): Promise<StepResult & { objects: number; partial: boolean }> {
  const out = { ...empty(), objects: 0, partial: false }
  const cutoff = retentionCutoffs(now).bcp_raw
  const { data, error } = await svc
    .from('bcp_events')
    .select('id')
    .is('raw_purged_at', null)
    .lt('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(LIMITS.bcpEventsPerRun)
  if (error) { out.errors.push(`bcp_events select: ${error.message}`); return out }
  const events = (data ?? []) as { id: string }[]
  out.targets = events.length
  if (dryRun || events.length === 0) return out

  let budget: number = LIMITS.bcpObjectsPerRun
  for (const ev of events) {
    if (budget <= 0) { out.partial = true; break }
    const listed = await listBcpEventObjects(svc, ev.id, budget)
    if ('error' in listed) { out.failed++; out.errors.push(`bcp list ${ev.id.slice(0, 8)}: ${listed.error}`); continue }

    const [{ data: clips, error: cErr }, { data: grids, error: gErr }] = await Promise.all([
      svc.from('bcp_clips').select('storage_path, clip_url, thumbnail_url').eq('event_id', ev.id),
      svc.from('bcp_grid_shots').select('storage_path').eq('event_id', ev.id),
    ])
    if (cErr || gErr) { out.failed++; out.errors.push(`bcp rows ${ev.id.slice(0, 8)}: ${(cErr ?? gErr)!.message}`); continue }
    const fromRows = [
      ...((clips ?? []) as { storage_path: string | null; clip_url: string | null; thumbnail_url: string | null }[])
        .flatMap((c) => [c.storage_path, bcpPathFromUrl(c.clip_url), bcpPathFromUrl(c.thumbnail_url)]),
      ...((grids ?? []) as { storage_path: string | null }[]).map((g) => g.storage_path),
    ].filter((p): p is string => !!p)
    const paths = [...new Set([...listed.paths, ...fromRows])]

    const rmErr = paths.length > 0 ? await removeObjects(svc, BCP_BUCKET, paths) : null
    if (rmErr) { out.failed++; out.errors.push(`bcp remove ${ev.id.slice(0, 8)}: ${rmErr}`); continue }
    budget -= paths.length
    out.objects += paths.length
    if (!listed.complete) { out.partial = true; break } // 置き場に残りがある。次の実行で続きから

    const { error: d1 } = await svc.from('bcp_clips').delete().eq('event_id', ev.id)
    const { error: d2 } = d1 ? { error: null } : await svc.from('bcp_grid_shots').delete().eq('event_id', ev.id)
    if (d1 || d2) { out.failed++; out.errors.push(`bcp rows delete ${ev.id.slice(0, 8)}: ${(d1 ?? d2)!.message}`); continue }
    const { error: mErr } = await svc.from('bcp_events').update({ raw_purged_at: now.toISOString() }).eq('id', ev.id)
    if (mErr) { out.failed++; out.errors.push(`bcp mark ${ev.id.slice(0, 8)}: ${mErr.message}`); continue }
    out.deleted++
  }
  return out
}

// ── 記録の表 ────────────────────────────────────────────────────────────────

/**
 * 時刻の列が cutoff より古い行を消す。1 回に読むのは logPage 行まで・logRounds 回まで
 * (古い順に読み、読んだ最後の時刻までを消す)。onlyPurged は video_sessions 用
 * (置き場を消し終えた行だけ)。
 */
export async function purgeOlderThan(
  svc: SupabaseClient,
  table: 'admin_audit_log' | 'live_sessions' | 'video_sessions',
  col: 'ts' | 'started_at' | 'created_at',
  cutoff: string,
  dryRun: boolean,
  onlyPurged = false,
): Promise<StepResult> {
  const out = empty()
  if (dryRun) {
    let q = svc.from(table).select(col, { count: 'exact', head: true }).lt(col, cutoff)
    if (onlyPurged) q = q.not('purged_at', 'is', null)
    const { count, error } = await q
    if (error) out.errors.push(`${table} count: ${error.message}`)
    out.targets = count ?? 0
    return out
  }
  for (let round = 0; round < LIMITS.logRounds; round++) {
    let sel = svc.from(table).select(col).lt(col, cutoff)
    if (onlyPurged) sel = sel.not('purged_at', 'is', null)
    const { data, error } = await sel.order(col, { ascending: true }).limit(LIMITS.logPage)
    if (error) { out.errors.push(`${table} select: ${error.message}`); break }
    const rows = (data ?? []) as unknown as Record<string, string>[]
    if (rows.length === 0) break
    out.targets += rows.length

    let del = svc.from(table).delete({ count: 'exact' }).lt(col, cutoff)
    if (onlyPurged) del = del.not('purged_at', 'is', null)
    if (rows.length === LIMITS.logPage) del = del.lte(col, rows[rows.length - 1][col])
    const { error: dErr, count } = await del
    if (dErr) { out.failed += rows.length; out.errors.push(`${table} delete: ${dErr.message}`); break }
    out.deleted += count ?? rows.length
    if (rows.length < LIMITS.logPage) break
  }
  return out
}

// ── まとめ ──────────────────────────────────────────────────────────────────

async function guarded<T extends StepResult>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn() } catch (e) { fallback.errors.push(msg(e)); return fallback }
}

/** 全部の保持期間の削除を順に行う。1 つが失敗しても他は続ける。 */
export async function runDataRetention(svc: SupabaseClient, opts: { now: Date; dryRun: boolean }): Promise<RetentionSummary> {
  const { now, dryRun } = opts
  const cutoffs = retentionCutoffs(now)
  // 顔は「登録を外した人の消し残し」→「1 年使っていない顔」→ 氏名 (顔が消えた行だけ) の順
  const employee_faces_deactivated = await guarded(() => purgeDeactivatedEmployeeFaces(svc, now, dryRun), empty())
  const employee_faces_unused = await guarded(() => purgeUnusedEmployeeFaces(svc, now, dryRun), empty())
  const employee_names = await guarded(() => purgeDeactivatedEmployees(svc, now, dryRun), empty())
  const employee_photo_orphans = await guarded(() => purgeOrphanEmployeePhotos(svc, now, dryRun), empty())
  const bcp_raw = await guarded(() => purgeBcpRaw(svc, now, dryRun), { ...empty(), objects: 0, partial: false })
  const admin_audit_log = await guarded(() => purgeOlderThan(svc, 'admin_audit_log', 'ts', cutoffs.admin_audit_log, dryRun), empty())
  const live_sessions = await guarded(() => purgeOlderThan(svc, 'live_sessions', 'started_at', cutoffs.live_sessions, dryRun), empty())
  const video_sessions = await guarded(
    () => purgeOlderThan(svc, 'video_sessions', 'created_at', cutoffs.video_sessions, dryRun, true), empty())

  const steps = {
    employee_faces_deactivated, employee_faces_unused, employee_names, employee_photo_orphans,
    bcp_raw, admin_audit_log, live_sessions, video_sessions,
  }
  const ok = Object.values(steps).every((s) => s.errors.length === 0 && s.failed === 0)
  return { ok, dry_run: dryRun, now: now.toISOString(), cutoffs, steps }
}
