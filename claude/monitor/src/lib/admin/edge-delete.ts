/**
 * エッジ削除の前に、連鎖削除 (ON DELETE CASCADE) を止める記録を消す (2026-10-16)。
 *
 * ── なぜ要るのか ────────────────────────────────────────────────────────
 * edge_devices → recorders → recorder_cameras は CASCADE で消えるが、
 * 発報の記録 `alarm_events.camera_id` と `alarm_frames.camera_id` は
 * recorder_cameras を **ON DELETE の指定なし (NO ACTION)** で参照している
 * (supabase/migrations/20260707090000_remote_baseline.sql)。
 * そのエッジのカメラに発報の記録が 1 件でも残っていると、エッジの削除が
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
 *   1. alarm_frames のうち camera_id がこのエッジのカメラのもの
 *   2. alarm_events のうち camera_id がこのエッジのカメラのもの
 *      (alarm_frames.alarm_event_id は CASCADE なので、その発報に付いた
 *       ほかのカメラのコマもここで一緒に消える)
 *
 * ⚠ PostgREST 越しなので 1 つのトランザクションにはならない。発報の記録を消した後に
 *   エッジの削除が失敗すると、記録だけ消えてエッジは残る (やり直せば通る)。
 *   migration を足さずに直すための割り切り (本番への db:push は発注者の操作)。
 */
import type { SupabaseClient } from '@supabase/supabase-js'

/** 1 回の問い合わせで読む行数 (PostgREST の既定の上限 1,000 行に合わせる) */
const PAGE = 1000
/** in 句に並べる id の数 (URL の長さを抑える。uuid 200 個で約 7.4 KB) */
const CHUNK = 200

export type EdgeAlarmPurgeResult =
  | { ok: true; cameras: number; alarmFrames: number; alarmEvents: number }
  | { ok: false; stage: string; message: string }

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

/**
 * エッジ配下のカメラを参照する発報の記録を消す。エッジ本体は消さない。
 * `supa` はセッションクライアント (super_admin は alarm_events / alarm_frames の
 * modify ポリシーで削除できる)。
 */
export async function purgeEdgeAlarmRecords(
  supa: SupabaseClient,
  edgeId: string,
): Promise<EdgeAlarmPurgeResult> {
  const recs = await collectIds((from, to) =>
    supa.from('recorders').select('id').eq('edge_id', edgeId).order('id').range(from, to) as unknown as PromiseLike<PageResult>)
  if ('error' in recs) return { ok: false, stage: 'recorders', message: recs.error }

  const cameraIds: string[] = []
  for (const part of chunks(recs.ids, CHUNK)) {
    const cams = await collectIds((from, to) =>
      supa.from('recorder_cameras').select('id').in('recorder_id', part).order('id').range(from, to) as unknown as PromiseLike<PageResult>)
    if ('error' in cams) return { ok: false, stage: 'recorder_cameras', message: cams.error }
    cameraIds.push(...cams.ids)
  }

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
