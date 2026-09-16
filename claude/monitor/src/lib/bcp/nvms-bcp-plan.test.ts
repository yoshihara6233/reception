import { describe, expect, it } from 'vitest'
import {
  planNvmsBcp,
  NVMS_BCP_MAX_SHOTS,
  type NvmsBcpRecorder,
} from '../../../supabase/functions/jalert-poller/flow'

/**
 * Phase 2b: NVMS レコーダの BCP 計画（UPLINK_CLIPS_SPEC.md §6）。
 * 1,000 台級で証跡が 8,000 枚にならないこと・フォルダ絞り込み・
 * 512 枚上限・ページ割り規則（表示側 buildGridGroups と同じ）を固定する。
 */

const rec = (over: Partial<NvmsBcpRecorder> = {}): NvmsBcpRecorder => ({
  id: 'rec-1',
  bcp_capture_mode: null,
  bcp_folder_paths: null,
  cameras: [],
  ...over,
})

const cam = (id: number, folder: string | null, enabled = true) => ({
  id: `cam-${id}`, channel: id, folder_path: folder, enabled,
})

describe('planNvmsBcp（合成モード・既定）', () => {
  it('フォルダごとに 16 台ずつページへ割り、フォルダを跨いで同居させない', () => {
    const cameras = [
      ...Array.from({ length: 20 }, (_, i) => cam(i + 1, '1F')),   // 2ページ (16+4)
      ...Array.from({ length: 3 },  (_, i) => cam(100 + i, '3F')), // 1ページ
    ]
    const plan = planNvmsBcp([rec({ cameras })], 8)
    expect(plan.grid_pages).toHaveLength(3)
    expect(plan.grid_pages[0].channels).toHaveLength(16)
    expect(plan.grid_pages[1].channels).toEqual([17, 18, 19, 20]) // 1F の残り
    expect(plan.grid_pages[2].folder_path).toBe('3F')
    expect(plan.cameras).toHaveLength(0)
    expect(plan.truncated).toBe(false)
  })

  it('フォルダ名 ja 昇順・未分類（null）は最後・フォルダ内は channel 昇順', () => {
    const plan = planNvmsBcp([rec({
      cameras: [cam(5, null), cam(3, '売場'), cam(1, '売場'), cam(9, 'バックヤード')],
    })], 8)
    expect(plan.grid_pages.map((p) => p.folder_path)).toEqual(['バックヤード', '売場', null])
    expect(plan.grid_pages[1].channels).toEqual([1, 3])
  })

  it('対象フォルダを選ぶと、それ以外（未分類含む）はページにならない', () => {
    const plan = planNvmsBcp([rec({
      bcp_folder_paths: ['3F'],
      cameras: [cam(1, '1F'), cam(2, '3F'), cam(3, null)],
    })], 8)
    expect(plan.grid_pages).toHaveLength(1)
    expect(plan.grid_pages[0].channels).toEqual([2])
  })

  it('enabled=false（同期で消えたカメラ）は対象にしない', () => {
    const plan = planNvmsBcp([rec({ cameras: [cam(1, '1F'), cam(2, '1F', false)] })], 8)
    expect(plan.grid_pages[0].channels).toEqual([1])
  })

  it('★1,000 台でも 8 オフセットで 64 ページ（=512 枚）で打ち切る', () => {
    const cameras = Array.from({ length: 1000 }, (_, i) =>
      cam(i + 1, `F${Math.floor(i / 50)}`))          // 20 フォルダ × 50 台 = 80 ページぶん
    const plan = planNvmsBcp([rec({ cameras })], 8)
    expect(plan.grid_pages).toHaveLength(NVMS_BCP_MAX_SHOTS / 8) // 64
    expect(plan.truncated).toBe(true)
  })

  it('page_no はレコーダを跨いで通し番号', () => {
    const plan = planNvmsBcp([
      rec({ id: 'rec-1', cameras: [cam(1, 'A')] }),
      rec({ id: 'rec-2', cameras: [cam(2, 'B')] }),
    ], 8)
    expect(plan.grid_pages.map((p) => [p.recorder_id, p.page_no])).toEqual([
      ['rec-1', 1], ['rec-2', 2],
    ])
  })
})

describe('planNvmsBcp（カメラ個別モード）', () => {
  it('per_camera はページを作らずカメラ列を返す（UUID+channel）', () => {
    const plan = planNvmsBcp([rec({
      bcp_capture_mode: 'per_camera',
      bcp_folder_paths: ['売場'],
      cameras: [cam(1, '売場'), cam(2, '倉庫')],
    })], 8)
    expect(plan.grid_pages).toHaveLength(0)
    expect(plan.cameras).toEqual([{ camera_id: 'cam-1', channel: 1 }])
  })

  it('★8 オフセットでは 64 台で打ち切る（512 枚上限）', () => {
    const cameras = Array.from({ length: 100 }, (_, i) => cam(i + 1, '1F'))
    const plan = planNvmsBcp([rec({ bcp_capture_mode: 'per_camera', cameras })], 8)
    expect(plan.cameras).toHaveLength(64)
    expect(plan.truncated).toBe(true)
  })

  it('オフセットが少なければ上限台数は増える（512/枚数）', () => {
    const cameras = Array.from({ length: 300 }, (_, i) => cam(i + 1, '1F'))
    const plan = planNvmsBcp([rec({ bcp_capture_mode: 'per_camera', cameras })], 2)
    expect(plan.cameras).toHaveLength(256)
  })
})
