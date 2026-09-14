import { describe, expect, it } from 'vitest'
import { planCameraRows, computeGoneIds, type ExistingCam } from './nvms-sync-plan'

const inc = (id: number, over: Partial<{ name: string; folder_path: string | null; enabled: boolean }> = {}) =>
  ({ id, name: over.name ?? `cam-${id}`, folder_path: over.folder_path ?? null, enabled: over.enabled ?? true })

describe('planCameraRows（grid_pos 割付）', () => {
  it('新規は空きスロット 0..15 を先着で埋める', () => {
    const rows = planCameraRows('r1', [], [inc(101), inc(102), inc(103)])
    expect(rows.map((r) => r.grid_pos)).toEqual([0, 1, 2])
    expect(rows.map((r) => r.channel)).toEqual([101, 102, 103])
  })

  it('17 台目以降は -1（フォルダページ表示のみ）', () => {
    const rows = planCameraRows('r1', [], Array.from({ length: 20 }, (_, i) => inc(i + 1)))
    expect(rows.slice(0, 16).map((r) => r.grid_pos)).toEqual([...Array(16).keys()])
    expect(rows.slice(16).map((r) => r.grid_pos)).toEqual([-1, -1, -1, -1])
  })

  it('★既存カメラの grid_pos は維持する（手動配置を同期が壊さない）', () => {
    const existing: ExistingCam[] = [{ id: 'a', channel: 101, grid_pos: 7 }]
    const rows = planCameraRows('r1', existing, [inc(101, { name: '改名後' }), inc(102)])
    expect(rows[0]).toMatchObject({ channel: 101, grid_pos: 7, name: '改名後' })
    // 新規は既存が使う 7 を避けて 0 から
    expect(rows[1].grid_pos).toBe(0)
  })

  it('既存が -1 でも維持する（毎回スロットを取り直さない）', () => {
    const existing: ExistingCam[] = [{ id: 'a', channel: 5, grid_pos: -1 }]
    const rows = planCameraRows('r1', existing, [inc(5)])
    expect(rows[0].grid_pos).toBe(-1)
  })

  it('穴あきスロットを埋める（0,1,3 使用中 → 新規は 2）', () => {
    const existing: ExistingCam[] = [
      { id: 'a', channel: 1, grid_pos: 0 },
      { id: 'b', channel: 2, grid_pos: 1 },
      { id: 'c', channel: 3, grid_pos: 3 },
    ]
    const rows = planCameraRows('r1', existing, [inc(1), inc(2), inc(3), inc(99)])
    expect(rows[3].grid_pos).toBe(2)
  })
})

describe('computeGoneIds（NVMS から消えたカメラ）', () => {
  const existing: ExistingCam[] = [
    { id: 'a', channel: 1, grid_pos: 0 },
    { id: 'b', channel: 2, grid_pos: 1 },
    { id: 'c', channel: 3, grid_pos: -1 },
  ]

  it('スナップショットに無い channel だけを返す', () => {
    expect(computeGoneIds(existing, [1, 3])).toEqual(['b'])
  })

  it('全部残っていれば空', () => {
    expect(computeGoneIds(existing, [1, 2, 3])).toEqual([])
  })

  it('presentIds が空なら全カメラが対象（NVMS 側の全削除に追従）', () => {
    expect(computeGoneIds(existing, [])).toEqual(['a', 'b', 'c'])
  })
})
