/**
 * エッジ・レコーダ・カメラの削除の前に、連鎖削除を止める発報の記録を消す (2026-10-16)。
 *
 * ── なぜ要るのか ────────────────────────────────────────────────────────
 * edge_devices → recorders → recorder_cameras は ON DELETE CASCADE で消えるが、
 * 発報の記録 `alarm_events.camera_id` と `alarm_frames.camera_id` は
 * recorder_cameras を **ON DELETE の指定なし (NO ACTION)** で参照している
 * (supabase/migrations/20260707090000_remote_baseline.sql)。
 * カメラに発報の記録が 1 件でも残っていると、エッジ・レコーダ・カメラの削除が
 * 外部キー違反で止まり、管理画面には「削除失敗: 500」だけが出ていた
 * (拠点「PoC 熊本店」の旧エッジ「PoC Beelink」)。
 *
 * edge_devices から CASCADE で辿れる表 (recorders・recorder_cameras・edge_jobs・
 * vod_clips・video_sessions・bcp_grid_shots・licenses・diagnostic_bundles・
 * edge_command_runs・nvr_clock_samples・gvms_oidc_clients) を migrations 全体で
 * 確かめ、NO ACTION で参照しているのはこの 2 本だけだった。ほかは CASCADE か
 * SET NULL (列は NULL 可)。テナント削除 (admin_delete_tenant) も同じ 2 表を先に消している。
 *
 * ── 消す順番 ────────────────────────────────────────────────────────────
 *   1. alarm_frames のうち camera_id が対象のカメラのもの
 *   2. alarm_events のうち camera_id が対象のカメラのもの
 *      (alarm_frames.alarm_event_id は CASCADE なので、その発報に付いた
 *       ほかのカメラのコマもここで一緒に消える)
 *
 * ── 対象のカメラの決め方 ────────────────────────────────────────────────
 * alarm_events / alarm_frames の modify ポリシーはロールしか見ない (拠点で絞らない)。
 * そのため、消すカメラの id は**必ずセッションクライアント (RLS 配下) で
 * recorder_cameras / recorders から読み直したもの**に限る。リクエストの id を
 * そのまま渡さないこと (担当外の拠点の発報を消せてしまう)。
 *
 * ⚠ PostgREST 越しなので 1 つのトランザクションにはならない。発報の記録を消した後に
 *   本体の削除が失敗すると、記録だけ消えて本体は残る (やり直せば通る)。
 *   migration を足さずに直すための割り切り (本番への db:push は発注者の操作)。
 */
import type { SupabaseClient } from '@supabase/supabase-js'

/** 1 回の問い合わせで読む行数 (PostgREST の既定の上限 1,000 行に合わせる) */
const PAGE = 1000
/** in 句に並べる id の数 (URL の長さを抑える。uuid 200 個で約 7.4 KB) */
const CHUNK = 200

export type AlarmPurgeResult =
  | { ok: true; cameras: number; alarmFrames: number; alarmEvents: number }
  | { ok: false; stage: string; message: string }

type Failure = Extract<AlarmPurgeResult, { ok: false }>
type PageResult = { data: { id: string }[] | null; error: { message: string } | null }

/** id を全件読む (1,000 行ずつ)。 */
async function collectIds(
  fetchPage: (from: number, to: number) => PromiseLike<PageResult>,
): Promise<{ ids: string[] } | { error: string }> {
  const ids: string[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await fetchPage(from, from + PAGE - 1)
    if (error) return { error: error.message }
    const rows = data ?? []
    for (const r of rows) ids.push(r.id)
    if (rows.length < PAGE) return { ids }
  }
}

function chunks<T>(xs: readonly T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n))
  return out
}

/** レコーダ配下のカメラの id (RLS 配下で見えるものだけ)。 */
async function cameraIdsOfRecorders(
  supa: SupabaseClient,
  recorderIds: readonly string[],
): Promise<{ ids: string[] } | Failure> {
  const ids: string[] = []
  for (const part of chunks(recorderIds, CHUNK)) {
    const cams = await collectIds((from, to) =>
      supa.from('recorder_cameras').select('id').in('recorder_id', part).order('id').range(from, to) as unknown as PromiseLike<PageResult>)
    if ('error' in cams) return { ok: false, stage: 'recorder_cameras', message: cams.error }
    ids.push(...cams.ids)
  }
  return { ids }
}

/**
 * 指定のカメラを参照する発報の記録を消す (共通の本体)。カメラ本体は消さない。
 * `cameraIds` は RLS 配下で読み直した id であること (上の注意を参照)。
 */
export async function purgeAlarmRecordsForCameras(
  supa: SupabaseClient,
  cameraIds: readonly string[],
): Promise<AlarmPurgeResult> {
  let alarmFrames = 0
  let alarmEvents = 0
  for (const part of chunks(cameraIds, CHUNK)) {
    const fr = await supa.from('alarm_frames').delete({ count: 'exact' }).in('camera_id', part)
    if (fr.error) return { ok: false, stage: 'alarm_frames', message: fr.error.message }
    alarmFrames += fr.count ?? 0

    const ev = await supa.from('alarm_events').delete({ count: 'exact' }).in('camera_id', part)
    if (ev.error) return { ok: false, stage: 'alarm_events', message: ev.error.message }
    alarmEvents += ev.count ?? 0
  }
  return { ok: true, cameras: cameraIds.length, alarmFrames, alarmEvents }
}

/** エッジ配下の全カメラの発報の記録を消す (エッジ削除の前)。 */
export async function purgeEdgeAlarmRecords(supa: SupabaseClient, edgeId: string): Promise<AlarmPurgeResult> {
  const recs = await collectIds((from, to) =>
    supa.from('recorders').select('id').eq('edge_id', edgeId).order('id').range(from, to) as unknown as PromiseLike<PageResult>)
  if ('error' in recs) return { ok: false, stage: 'recorders', message: recs.error }
  const cams = await cameraIdsOfRecorders(supa, recs.ids)
  if ('ok' in cams) return cams
  return purgeAlarmRecordsForCameras(supa, cams.ids)
}

/** レコーダ配下の全カメラの発報の記録を消す (レコーダ削除の前)。 */
export async function purgeRecorderAlarmRecords(supa: SupabaseClient, recorderId: string): Promise<AlarmPurgeResult> {
  const cams = await cameraIdsOfRecorders(supa, [recorderId])
  if ('ok' in cams) return cams
  return purgeAlarmRecordsForCameras(supa, cams.ids)
}

/**
 * レコーダの一部のカメラの発報の記録を消す (カメラ一覧の保存で削除する前)。
 * 渡された id のうち、そのレコーダに属して RLS 配下で見えるものだけを対象にする。
 */
export async function purgeCameraAlarmRecords(
  supa: SupabaseClient,
  recorderId: string,
  cameraIds: readonly string[],
): Promise<AlarmPurgeResult> {
  const ids: string[] = []
  for (const part of chunks(cameraIds, CHUNK)) {
    const cams = await collectIds((from, to) =>
      supa.from('recorder_cameras').select('id').eq('recorder_id', recorderId).in('id', part)
        .order('id').range(from, to) as unknown as PromiseLike<PageResult>)
    if ('error' in cams) return { ok: false, stage: 'recorder_cameras', message: cams.error }
    ids.push(...cams.ids)
  }
  return purgeAlarmRecordsForCameras(supa, ids)
}

/** 発報の記録を消せなかったときの応答の本文 (3 つの削除で同じ形にする)。 */
export function alarmPurgeFailureBody(p: Failure): { error: 'alarm_purge_failed'; message: string } {
  return { error: 'alarm_purge_failed', message: `${p.stage}: ${p.message}` }
}

/** 監査ログ・応答に載せる、消した件数 (3 つの削除で同じ形にする)。 */
export function alarmPurgeCounts(p: Extract<AlarmPurgeResult, { ok: true }>) {
  return { cameras: p.cameras, alarm_events: p.alarmEvents, alarm_frames: p.alarmFrames }
}
