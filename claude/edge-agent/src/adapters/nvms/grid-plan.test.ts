import { describe, it, expect } from 'vitest'
import { planNvmsGrid } from './grid-plan'
import type { CameraDescriptor } from '../../types.js'

const recorder = (over: Partial<CameraDescriptor['recorder']> = {}): CameraDescriptor['recorder'] => ({
  vendor: 'nvms', host: '192.168.10.5', rtsp_port: 554, onvif_port: null,
  username: 'api', password: 'nvms_key_A',
  vod_host: null, vod_username: null, vod_password: null, vod_channel: null,
  ...over,
})

const cam = (id: string, channel: number, grid_pos: number, r = recorder()): CameraDescriptor => ({
  id, channel, name: `cam-${channel}`, grid_pos,
  frigate_camera: null, live_rtsp: null, recorder: r,
})

describe('planNvmsGrid（合成グリッド API を使えるかの判定）', () => {
  it('単一 NVMS レコーダ・連番なら channels を grid_pos 順で返す', () => {
    const plan = planNvmsGrid([cam('c', 300, 2), cam('a', 100, 0), cam('b', 65, 1)])
    expect(plan).not.toBeNull()
    expect(plan!.channels).toEqual([100, 65, 300])
    expect(plan!.camIds).toEqual(['a', 'b', 'c'])
    expect(plan!.host).toBe('192.168.10.5')
    expect(plan!.apiKey).toBe('nvms_key_A')
  })

  it('grid_pos=-1（ページ割付外）のカメラは判定に影響しない', () => {
    const plan = planNvmsGrid([cam('a', 1, 0), cam('x', 2, -1), cam('b', 3, 1)])
    expect(plan!.channels).toEqual([1, 3])
  })

  it('16 台フル (0..15) も使える', () => {
    const cams = Array.from({ length: 16 }, (_, i) => cam(`c${i}`, i + 1, i))
    expect(planNvmsGrid(cams)!.channels).toHaveLength(16)
  })

  it('他ベンダが 1 台でも混ざると null（カメラ別合成へ）', () => {
    const cams = [cam('a', 1, 0), cam('b', 2, 1, recorder({ vendor: 'onvif-generic' }))]
    expect(planNvmsGrid(cams)).toBeNull()
  })

  it('NVMS レコーダが 2 台に跨ると null', () => {
    const cams = [cam('a', 1, 0), cam('b', 2, 1, recorder({ host: '192.168.10.6' }))]
    expect(planNvmsGrid(cams)).toBeNull()
  })

  it('同一ホストでも API キーが違えば null（別レコーダ登録とみなす）', () => {
    const cams = [cam('a', 1, 0), cam('b', 2, 1, recorder({ password: 'nvms_key_B' }))]
    expect(planNvmsGrid(cams)).toBeNull()
  })

  it('grid_pos が歯抜け (0,2) なら null — grid.jpg は隙間を表現できない', () => {
    expect(planNvmsGrid([cam('a', 1, 0), cam('b', 2, 2)])).toBeNull()
  })

  it('grid_pos 重複なら null', () => {
    expect(planNvmsGrid([cam('a', 1, 0), cam('b', 2, 0)])).toBeNull()
  })

  it('表示対象カメラが 0 台なら null', () => {
    expect(planNvmsGrid([])).toBeNull()
    expect(planNvmsGrid([cam('x', 1, -1)])).toBeNull()
  })
})
