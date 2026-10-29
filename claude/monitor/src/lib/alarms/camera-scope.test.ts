import { describe, expect, it } from 'vitest'
import { cameraScope } from './camera-scope'

const STORE = '00000000-0000-0000-0000-0000000000c1'
const OTHER = '00000000-0000-0000-0000-0000000000c3'
const CAM = '6a620d14-8d60-4d45-b9c3-88eba2b389bb'

/** store_of_camera の答えを決め打ちする最小の偽物。呼ばれた引数も残す。 */
function fakeSvc(answer: { data: unknown; error: unknown }) {
  const calls: Array<[string, unknown]> = []
  return {
    calls,
    rpc: (async (fn: string, args: unknown) => { calls.push([fn, args]); return answer }) as never,
  }
}

describe('発報のカメラは店舗のもの（ASVS 2.2.3）', () => {
  it('同じ店舗のカメラは通す', async () => {
    const svc = fakeSvc({ data: STORE, error: null })
    expect(await cameraScope(svc, CAM, STORE)).toBe('ok')
    expect(svc.calls).toEqual([['store_of_camera', { p_camera: CAM }]])
  })
  it('別の店舗のカメラは断る', async () => {
    expect(await cameraScope(fakeSvc({ data: OTHER, error: null }), CAM, STORE)).toBe('other_store')
  })
  it('存在しないカメラは断る', async () => {
    expect(await cameraScope(fakeSvc({ data: null, error: null }), CAM, STORE)).toBe('other_store')
  })
  it('UUID でない値は DB に聞かずに断る', async () => {
    const svc = fakeSvc({ data: STORE, error: null })
    expect(await cameraScope(svc, 'ch01', STORE)).toBe('invalid')
    expect(svc.calls).toEqual([])
  })
  it('確かめられないときは error（呼び出し側は記録しない）', async () => {
    expect(await cameraScope(fakeSvc({ data: null, error: { message: 'x' } }), CAM, STORE)).toBe('error')
  })
})
