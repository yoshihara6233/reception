/**
 * NVMS 同期の純ロジック（workers/nvms-sync.ts から使用）。
 *
 * worker 本体は config / supabase を読むためテストから直接触れない
 * （window-mp4 → upload-fit と同じ切り出し方）。ここには I/O を持たない
 * 変換だけを置く: NVMS の /cameras + /camera-folders + /health/detail の
 * 応答を、クラウド API（nvms-sync / nvms-health）のボディへ写す。
 */

export interface NvmsFolder { id: number; path: string }
export interface NvmsCameraRaw {
  id: number
  name?: string
  enabled?: boolean
  folder_id?: number | null
  status?: { running?: boolean } | null
}

export interface SyncRow { id: number; name: string; folder_path: string | null; enabled: boolean }

/** /cameras + /camera-folders → nvms-sync のカメラ行。 */
export function buildSyncRows(cameras: readonly NvmsCameraRaw[], folders: readonly NvmsFolder[]): SyncRow[] {
  const pathOf = new Map(folders.map((f) => [f.id, f.path]))
  return cameras.map((c) => ({
    id:          c.id,
    // 空名でもクラウド側の zod(min 1) で落ちないように補う（NVMS は空白のみ名を弾くが防御的に）。
    name:        (c.name ?? '').trim() || `camera-${c.id}`,
    folder_path: c.folder_id != null ? (pathOf.get(c.folder_id) ?? null) : null,
    enabled:     c.enabled !== false,
  }))
}

export interface HealthSummary {
  cameras_total: number
  cameras_online: number
  cameras_offline: number
  down: { id: number; name: string; folder_path: string | null }[]
  disk_days_left: number | null
  nodes_total?: number
  nodes_ok?: number
  nvms_version?: string
}

const DOWN_MAX = 50

/**
 * 死活サマリを組み立てる。
 *
 * 台数は /health/detail の集計を優先し、無ければ /cameras から数える
 * （旧版 NVMS への防御）。down の内訳は /cameras の status.running=false
 * （enabled のみ — 意図して止めたカメラを「異常」に数えない）。
 */
export function buildHealthSummary(
  detail: Record<string, unknown> | null,
  cameras: readonly NvmsCameraRaw[],
  folders: readonly NvmsFolder[],
  storage: Record<string, unknown> | null,
): HealthSummary {
  const pathOf = new Map(folders.map((f) => [f.id, f.path]))
  const num = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) ? v : undefined

  const det = (detail ?? {}) as {
    cameras?: { total?: unknown; online?: unknown; offline?: unknown }
    nodes?: { total?: unknown; ok?: unknown }
    version?: unknown
  }

  const enabled = cameras.filter((c) => c.enabled !== false)
  const down = enabled.filter((c) => c.status?.running === false)

  const summary: HealthSummary = {
    cameras_total:   num(det.cameras?.total)   ?? enabled.length,
    cameras_online:  num(det.cameras?.online)  ?? enabled.length - down.length,
    cameras_offline: num(det.cameras?.offline) ?? down.length,
    down: down.slice(0, DOWN_MAX).map((c) => ({
      id:          c.id,
      name:        (c.name ?? '').trim() || `camera-${c.id}`,
      folder_path: c.folder_id != null ? (pathOf.get(c.folder_id) ?? null) : null,
    })),
    disk_days_left: num((storage ?? {} as Record<string, unknown>)['days_until_full']) ?? null,
  }
  const nt = num(det.nodes?.total); if (nt !== undefined) summary.nodes_total = nt
  const no = num(det.nodes?.ok);    if (no !== undefined) summary.nodes_ok = no
  if (typeof det.version === 'string') summary.nvms_version = det.version.slice(0, 50)
  return summary
}
