import { describe, expect, it } from 'vitest'
import { isOwnStorageUrl } from './own-storage-url'

const SB = 'https://abcd.supabase.co'

describe('isOwnStorageUrl (ASVS 1.3.6)', () => {
  it('自分の保存先の URL だけを通す', () => {
    expect(isOwnStorageUrl(`${SB}/storage/v1/object/public/bcp-clips/a/b.jpg`, SB)).toBe(true)
  })
  it('ほかのホスト・http・保存先以外の経路・資格情報入りは断る', () => {
    for (const bad of [
      'https://evil.example/storage/v1/object/public/x.jpg',
      'http://abcd.supabase.co/storage/v1/object/public/x.jpg',
      `${SB}/rest/v1/stores`,
      'https://u:p@abcd.supabase.co/storage/v1/object/x.jpg',
      'https://abcd.supabase.co.evil.example/storage/v1/object/x.jpg',
      'not a url', '', null,
    ]) {
      expect(isOwnStorageUrl(bad, SB)).toBe(false)
    }
  })
  it('自分の URL がわからなければ何も通さない', () => {
    expect(isOwnStorageUrl(`${SB}/storage/v1/object/x.jpg`, '')).toBe(false)
  })
})
