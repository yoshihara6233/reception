import { describe, it, expect, afterEach } from 'vitest'
import { gridKey, snapshotKey, edgeImagesR2Configured } from './edge-images-r2'

const EDGE = '11111111-1111-4111-8111-111111111111'
const CAM  = '22222222-2222-4222-8222-222222222222'

describe('edge-images-r2 keys', () => {
  it('grid キーは Supabase 側と同じ相対パス（移行時の突合のため）', () => {
    expect(gridKey(EDGE)).toBe(`edges/${EDGE}/grid.jpg`)
  })

  it('snapshot キーは Supabase 側と同じ相対パス', () => {
    expect(snapshotKey(EDGE, CAM)).toBe(`edges/${EDGE}/cam/${CAM}/snapshot.jpg`)
  })

  it('エッジとカメラが違えばキーも必ず違う（取り違え防止）', () => {
    const other = '33333333-3333-4333-8333-333333333333'
    expect(snapshotKey(EDGE, CAM)).not.toBe(snapshotKey(other, CAM))
    expect(snapshotKey(EDGE, CAM)).not.toBe(snapshotKey(EDGE, other))
  })
})

describe('edgeImagesR2Configured', () => {
  const saved = { ...process.env }
  afterEach(() => { process.env = { ...saved } })

  it('3つの env が揃って初めて有効（欠けたら Supabase 経路のまま）', () => {
    process.env.R2_ACCOUNT_ID = 'acct'
    process.env.R2_ACCESS_KEY_ID = 'key'
    delete process.env.R2_SECRET_ACCESS_KEY
    expect(edgeImagesR2Configured()).toBe(false)

    process.env.R2_SECRET_ACCESS_KEY = 'secret'
    expect(edgeImagesR2Configured()).toBe(true)
  })
})
