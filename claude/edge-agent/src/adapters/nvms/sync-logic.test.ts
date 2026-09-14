import { describe, expect, it } from 'vitest'
import { buildSyncRows, buildHealthSummary, type NvmsCameraRaw } from './sync-logic'

const folders = [
  { id: 1, path: '本社' },
  { id: 2, path: '本社 / 3F' },
]

describe('buildSyncRows', () => {
  it('folder_id をフォルダの path 表示名へ引き当てる', () => {
    const rows = buildSyncRows([{ id: 10, name: '3F東-01', folder_id: 2, enabled: true }], folders)
    expect(rows[0]).toEqual({ id: 10, name: '3F東-01', folder_path: '本社 / 3F', enabled: true })
  })

  it('folder_id 無し・未知の folder_id は未分類（null）', () => {
    const rows = buildSyncRows([
      { id: 1, name: 'a' },
      { id: 2, name: 'b', folder_id: 999 },
    ], folders)
    expect(rows.map((r) => r.folder_path)).toEqual([null, null])
  })

  it('空名はクラウドの zod(min 1) で落ちないよう補完する', () => {
    const rows = buildSyncRows([{ id: 7, name: '  ' }], [])
    expect(rows[0].name).toBe('camera-7')
  })

  it('enabled は明示 false のときだけ false（undefined=true 扱い）', () => {
    const rows = buildSyncRows([{ id: 1 }, { id: 2, enabled: false }], [])
    expect(rows.map((r) => r.enabled)).toEqual([true, false])
  })
})

describe('buildHealthSummary', () => {
  const cams: NvmsCameraRaw[] = [
    { id: 1, name: 'ok-1',   enabled: true,  status: { running: true } },
    { id: 2, name: 'down-2', enabled: true,  status: { running: false }, folder_id: 2 },
    { id: 3, name: 'off-3',  enabled: false, status: { running: false } },  // 意図停止
  ]

  it('★無効カメラの停止は「異常」に数えない（意図した停止と障害を混ぜない）', () => {
    const h = buildHealthSummary(null, cams, folders, null)
    expect(h.cameras_total).toBe(2)
    expect(h.cameras_offline).toBe(1)
    expect(h.down).toEqual([{ id: 2, name: 'down-2', folder_path: '本社 / 3F' }])
  })

  it('health/detail の集計があればそちらを優先する', () => {
    const h = buildHealthSummary(
      { cameras: { total: 98412, online: 98395, offline: 17 }, version: '1.4.0', nodes: { total: 3, ok: 3 } },
      cams, folders, { days_until_full: 41.7 },
    )
    expect(h).toMatchObject({
      cameras_total: 98412, cameras_online: 98395, cameras_offline: 17,
      nodes_total: 3, nodes_ok: 3, nvms_version: '1.4.0', disk_days_left: 41.7,
    })
  })

  it('down は 50 件で打ち切る（サマリに全行を運ばない）', () => {
    const many: NvmsCameraRaw[] = Array.from({ length: 80 }, (_, i) =>
      ({ id: i + 1, name: `c${i + 1}`, enabled: true, status: { running: false } }))
    const h = buildHealthSummary(null, many, [], null)
    expect(h.cameras_offline).toBe(80)
    expect(h.down).toHaveLength(50)
  })

  it('storage 無し（旧版/取得失敗）でも壊れない', () => {
    const h = buildHealthSummary(null, [], [], null)
    expect(h.disk_days_left).toBeNull()
  })
})
