/**
 * エッジ・レコーダ・カメラの削除の試験用に、発報の記録まわりの外部キーを再現する小さな DB (2026-10-16)。
 *
 * 再現する外部キー (supabase/migrations/20260707090000_remote_baseline.sql):
 *   - edge_devices → recorders → recorder_cameras は ON DELETE CASCADE
 *   - alarm_frames.alarm_event_id → alarm_events は ON DELETE CASCADE
 *   - alarm_events.camera_id / alarm_frames.camera_id → recorder_cameras は NO ACTION
 *     (参照が残っていれば、カメラを消す削除が外部キー違反で失敗する)
 *
 * 使う分だけの問い合わせ (select / delete({count}) / eq / in / order / range) を真似る。
 * RLS は無い。`failOn` に表名を入れると、その表への問い合わせが失敗を返す。
 */

export type FkRow = Record<string, string | null>
export type FkDb = Record<'edge_devices' | 'recorders' | 'recorder_cameras' | 'alarm_events' | 'alarm_frames', FkRow[]>

export function createAlarmFkDb(seed: FkDb) {
  const state = {
    db: seed,
    /** 実行した削除の順番 (表名) */
    deletes: [] as string[],
    /** in 句に並べた id の数の最大 */
    maxIn: 0,
    failOn: null as string | null,
  }

  /** この削除で消える (CASCADE で巻き込まれる) カメラの id。 */
  function camerasRemovedBy(table: string, hit: FkRow[]): Set<string> {
    const db = state.db
    let recIds = new Set<string>()
    if (table === 'edge_devices') {
      const edges = new Set(hit.map((e) => e.id))
      recIds = new Set(db.recorders.filter((r) => edges.has(r.edge_id)).map((r) => r.id as string))
    } else if (table === 'recorders') {
      recIds = new Set(hit.map((r) => r.id as string))
    } else if (table === 'recorder_cameras') {
      return new Set(hit.map((c) => c.id as string))
    } else {
      return new Set()
    }
    return new Set(db.recorder_cameras.filter((c) => recIds.has(c.recorder_id as string)).map((c) => c.id as string))
  }

  function runDelete(table: keyof FkDb, hit: FkRow[]) {
    const db = state.db
    const cams = camerasRemovedBy(table, hit)
    const blocker = db.alarm_events.some((a) => cams.has(a.camera_id as string))
      ? 'alarm_events_camera_id_fkey'
      : db.alarm_frames.some((f) => cams.has(f.camera_id as string)) ? 'alarm_frames_camera_id_fkey' : null
    if (blocker) {
      return { message: `update or delete on table "recorder_cameras" violates foreign key constraint "${blocker}"` }
    }
    // CASCADE
    if (table === 'edge_devices') {
      const edges = new Set(hit.map((e) => e.id))
      db.recorders = db.recorders.filter((r) => !edges.has(r.edge_id))
    }
    if (table === 'recorders') {
      const recs = new Set(hit.map((r) => r.id))
      db.recorders = db.recorders.filter((r) => !recs.has(r.id))
    }
    db.recorder_cameras = db.recorder_cameras.filter((c) => !cams.has(c.id as string))
    if (table === 'alarm_events') {
      const gone = new Set(hit.map((a) => a.id))
      db.alarm_frames = db.alarm_frames.filter((f) => !gone.has(f.alarm_event_id))
    }
    db[table] = db[table].filter((r) => !hit.includes(r))
    return null
  }

  const client = {
    from(table: keyof FkDb) {
      const filters: ((r: FkRow) => boolean)[] = []
      let mode: 'select' | 'delete' = 'select'
      let range: [number, number] | null = null
      let wantCount = false
      const run = () => {
        if (state.failOn === table) return { data: null, error: { message: `${table} down` }, count: null }
        const hit = (state.db[table] ?? []).filter((r) => filters.every((f) => f(r)))
        if (mode === 'select') {
          let out = [...hit].sort((a, b) => String(a.id).localeCompare(String(b.id)))
          if (range) out = out.slice(range[0], range[1] + 1)
          return { data: out.map((r) => ({ id: r.id })), error: null }
        }
        state.deletes.push(table)
        const err = runDelete(table, hit)
        if (err) return { data: null, error: err, count: null }
        return { data: null, error: null, count: wantCount ? hit.length : null }
      }
      const b = {
        select() { mode = 'select'; return b },
        delete(o?: { count?: string }) { mode = 'delete'; wantCount = !!o?.count; return b },
        eq(col: string, v: string) { filters.push((r) => r[col] === v); return b },
        in(col: string, vs: string[]) {
          state.maxIn = Math.max(state.maxIn, vs.length)
          filters.push((r) => vs.includes(r[col] as string))
          return b
        },
        order() { return b },
        range(a: number, z: number) { range = [a, z]; return b },
        then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
          return Promise.resolve().then(run).then(res, rej)
        },
      }
      return b
    },
  }

  return { state, client }
}

/**
 * 試験の土台: 旧エッジ (old) と動いているエッジ (live)。旧エッジのカメラ c-old-1 に発報 a-old、
 * c-old-2 のコマ f-cross が動いているエッジの発報 a-live に付いている (camera_id の NO ACTION で止まる形)。
 */
export function seedTwoEdges(): FkDb {
  return {
    edge_devices: [{ id: 'old' }, { id: 'live' }],
    recorders: [{ id: 'r-old', edge_id: 'old' }, { id: 'r-live', edge_id: 'live' }],
    recorder_cameras: [
      { id: 'c-old-1', recorder_id: 'r-old' },
      { id: 'c-old-2', recorder_id: 'r-old' },
      { id: 'c-live-1', recorder_id: 'r-live' },
    ],
    alarm_events: [
      { id: 'a-old', camera_id: 'c-old-1' },
      { id: 'a-live', camera_id: 'c-live-1' },
    ],
    alarm_frames: [
      { id: 'f-old', alarm_event_id: 'a-old', camera_id: 'c-old-1' },
      { id: 'f-cross', alarm_event_id: 'a-live', camera_id: 'c-old-2' },
      { id: 'f-live', alarm_event_id: 'a-live', camera_id: 'c-live-1' },
    ],
  }
}
