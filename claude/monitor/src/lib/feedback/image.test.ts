import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  ATTACHMENT_MAX_BYTES, AttachmentDecl, attachmentPurgeCutoff, checkAttachment, cleanPageUrl, decodeBase64Strict,
  detectImageType, isAttachmentExpired, normalizePageUrl, sha256Hex,
} from './image'

/**
 * 要望に添える画像と該当の画面の URL の決まり（GVMS_CLOUD_SPEC §12.2・§12.6）。
 *   ★先頭の印（マジックバイト）で形式を決め、宣言と type・大きさ・sha256 が合わなければ断る
 *   ★page_url は画面の場所だけ（scheme とホスト＝拠点の IP や名前を落とす・形の違うものは捨てる）
 *   ★受けてから 365 日を過ぎたら消す対象
 */

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46])
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x10, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20])
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')

describe('detectImageType — 先頭の印', () => {
  it('PNG・JPEG・WebP を見分ける', () => {
    expect(detectImageType(PNG)).toBe('image/png')
    expect(detectImageType(JPEG)).toBe('image/jpeg')
    expect(detectImageType(WEBP)).toBe('image/webp')
  })

  it.each([
    ['GIF', new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])],
    ['PDF', new TextEncoder().encode('%PDF-1.7')],
    ['RIFF だが WAVE', new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45])],
    ['短すぎる', new Uint8Array([0x89, 0x50])],
    ['空', new Uint8Array(0)],
  ])('%s は null', (_n, b) => {
    expect(detectImageType(b)).toBeNull()
  })
})

describe('sha256Hex', () => {
  it('Node の createHash と同じ小文字 16 進 64 字', async () => {
    expect(await sha256Hex(PNG)).toBe(sha(PNG))
    expect(await sha256Hex(new Uint8Array(0))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })
})

describe('checkAttachment — 宣言と中身', () => {
  const decl = { type: 'image/png' as const, size: PNG.length, sha256: sha(PNG) }

  it('合えば null', async () => {
    expect(await checkAttachment(PNG, decl)).toBeNull()
  })

  it('★大きさが違う', async () => {
    expect(await checkAttachment(PNG, { ...decl, size: PNG.length + 1 })).toBe('size_mismatch')
  })

  it('★先頭の印が 3 形式のどれでもない', async () => {
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
    expect(await checkAttachment(gif, { ...decl, size: gif.length, sha256: sha(gif) })).toBe('magic_mismatch')
  })

  it('★宣言の type と先頭の印が違う（PNG と宣言して JPEG）', async () => {
    expect(await checkAttachment(JPEG, { ...decl, size: JPEG.length, sha256: sha(JPEG) })).toBe('type_mismatch')
  })

  it('★sha256 が違う', async () => {
    expect(await checkAttachment(PNG, { ...decl, sha256: 'a'.repeat(64) })).toBe('sha256_mismatch')
  })

  it('3 MiB を超えるものは too_large', async () => {
    const big = new Uint8Array(ATTACHMENT_MAX_BYTES + 1)
    big.set(PNG)
    expect(await checkAttachment(big, decl)).toBe('too_large')
  })
})

describe('AttachmentDecl — 宣言の形', () => {
  const ok = { type: 'image/webp', size: 1024, sha256: 'b'.repeat(64) }
  it('3 形式・1〜3 MiB・小文字 16 進 64 字なら通る', () => {
    expect(AttachmentDecl.safeParse(ok).success).toBe(true)
    expect(AttachmentDecl.safeParse({ ...ok, size: ATTACHMENT_MAX_BYTES }).success).toBe(true)
  })
  it.each([
    ['image/gif', { type: 'image/gif' }],
    ['3 MiB を超える', { size: ATTACHMENT_MAX_BYTES + 1 }],
    ['大きさ 0', { size: 0 }],
    ['大きさが小数', { size: 1.5 }],
    ['sha256 が大文字', { sha256: 'B'.repeat(64) }],
    ['sha256 が 63 字', { sha256: 'b'.repeat(63) }],
  ])('%s は通さない', (_n, over) => {
    expect(AttachmentDecl.safeParse({ ...ok, ...over }).success).toBe(false)
  })
})

describe('normalizePageUrl — 画面の場所だけ', () => {
  it.each([
    ['/live/grid?split=16', '/live/grid?split=16'],
    ['#/cameras/3', '#/cameras/3'],
    ['  /stores  ', '/stores'],
    // ★http(s) の URL は scheme とホスト（拠点の IP や名前）を落とす
    ['https://192.168.0.10:8080/live/grid?split=64#top', '/live/grid?split=64#top'],
    ['http://nvms-honten.local/#/settings', '/#/settings'],
    ['HTTPS://gvms-cloud.com/stores', '/stores'],
  ])('%s → %s', (raw, want) => {
    expect(normalizePageUrl(raw)).toBe(want)
  })

  it.each([
    ['相対パス', 'live/grid'],
    ['プロトコル相対（ホストを含む）', '//evil.example/x'],
    ['バックスラッシュでホストに読まれる形', '/\\evil.example'],
    ['javascript:', 'javascript:alert(1)'],
    ['ftp:', 'ftp://192.168.0.10/x'],
    ['空白を含む', '/live grid'],
    ['制御文字を含む', '/live\u0000'],
    ['501 字', '/' + 'a'.repeat(500)],
    ['空', '   '],
    ['文字列でない', 123],
  ])('★%s は捨てる（null）', (_n, raw) => {
    expect(normalizePageUrl(raw)).toBeNull()
  })

  it('ちょうど 500 字なら残す', () => {
    const s = '/' + 'a'.repeat(499)
    expect(normalizePageUrl(s)).toBe(s)
  })
})

describe('cleanPageUrl — 保存する形', () => {
  it('★クエリの IP アドレス・メールアドレスは伏せ字にする（§12.5-4）', () => {
    const r = cleanPageUrl('https://192.168.0.10/cameras?host=192.168.0.101&mail=foo@example.com')
    expect(r).not.toMatch(/192\.168|foo@/)
    expect(r?.startsWith('/cameras?')).toBe(true)
  })
  it('形の違うものは null', () => {
    expect(cleanPageUrl('cameras')).toBeNull()
  })
})

describe('decodeBase64Strict', () => {
  it('base64 を戻す（改行は読み飛ばす）', () => {
    const b64 = Buffer.from(PNG).toString('base64')
    expect(decodeBase64Strict(b64)).toEqual(PNG)
    expect(decodeBase64Strict(b64.slice(0, 8) + '\n' + b64.slice(8))).toEqual(PNG)
  })
  it.each([['余計な文字', 'iVBO*w0K'], ['長さが合わない', 'iVBORw0']])('%s は null', (_n, s) => {
    expect(decodeBase64Strict(s)).toBeNull()
  })
})

describe('isAttachmentExpired — 1 年で消す対象', () => {
  const now = new Date('2026-10-06T00:00:00Z')
  it('★受けてから 365 日を過ぎたものだけ', () => {
    expect(isAttachmentExpired('2025-10-05T23:59:59Z', now)).toBe(true)
    expect(isAttachmentExpired('2025-10-06T00:00:01Z', now)).toBe(false)
    expect(isAttachmentExpired('2026-10-05T00:00:00Z', now)).toBe(false)
  })
  it('受けていない（null）・読めない時刻は対象外', () => {
    expect(isAttachmentExpired(null, now)).toBe(false)
    expect(isAttachmentExpired('yesterday', now)).toBe(false)
  })
  it('境目は 365 日前', () => {
    expect(attachmentPurgeCutoff(now).toISOString()).toBe('2025-10-06T00:00:00.000Z')
  })
})
