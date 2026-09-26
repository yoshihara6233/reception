import { describe, expect, it } from 'vitest'
import { safeNext } from './safe-next'

describe('ログイン後の戻り先', () => {
  it('G・VMS の拠点へのログイン (同意画面) だけ通す', () => {
    expect(safeNext('/oauth/consent?authorization_id=abc-123_X')).toBe('/oauth/consent?authorization_id=abc-123_X')
  })
  it('それ以外は既定へ (外のサイトへの踏み台にしない)', () => {
    for (const bad of [null, '', '/stores', 'https://evil.example/', '//evil.example/oauth/consent?authorization_id=a',
      '/oauth/consent?authorization_id=a&next=https://evil', '/oauth/consent?authorization_id=../x']) {
      expect(safeNext(bad)).toBe('/stores')
    }
  })
})
