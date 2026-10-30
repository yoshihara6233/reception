import { describe, expect, it } from 'vitest'
import { decodeImageDataUrl, isKioskPhotoPath, isSafePathSegment, isUpstreamAddress, postgrestSearchTerm, safeZipSegment } from './input'

const STORE = '11111111-2222-3333-4444-555555555555'
const UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46])
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])
const dataUrl = (mime: string, b: Buffer) => `data:${mime};base64,${b.toString('base64')}`

describe('postgrestSearchTerm (ASVS 1.2.4)', () => {
  it('普通の名前とメールはそのまま', () => {
    expect(postgrestSearchTerm('山田')).toBe('山田')
    expect(postgrestSearchTerm('taro.yamada@example.jp')).toBe('taro.yamada@example.jp')
  })
  it('絞り込みの書式の記号を外す（条件を足せない）', () => {
    const v = postgrestSearchTerm('x%,role.eq.super_admin')!
    expect(v).not.toContain(',')
    expect(postgrestSearchTerm('a),or(role.eq.x')).not.toMatch(/[()]/)
    expect(postgrestSearchTerm('"a"\\b:c*')).toBe('a b c')
  })
  it('空や記号だけなら null・長さは 100 字まで', () => {
    expect(postgrestSearchTerm('')).toBeNull()
    expect(postgrestSearchTerm(' ,(),')).toBeNull()
    expect(postgrestSearchTerm('あ'.repeat(300))!.length).toBe(100)
  })
})

describe('isSafePathSegment (ASVS 1.3.3)', () => {
  it('英数字・_・- だけを通す', () => {
    expect(isSafePathSegment('cam_01-a')).toBe(true)
    expect(isSafePathSegment(UUID)).toBe(true)
  })
  it('親のフォルダや区切りを含む値は断る', () => {
    for (const bad of ['..', '../x', 'a/b', 'a\\b', '', 'x'.repeat(65), 'a.b', null, undefined]) {
      expect(isSafePathSegment(bad as string)).toBe(false)
    }
  })
})

describe('isKioskPhotoPath (ASVS 1.3.3)', () => {
  it('その店舗の顔と名刺の経路だけ通す', () => {
    expect(isKioskPhotoPath(`${STORE}/20261031/${UUID}.jpg`, STORE)).toBe(true)
    expect(isKioskPhotoPath(`${STORE}/20261031/card-${UUID}.png`, STORE)).toBe(true)
  })
  it('先頭が自店舗でも .. で外へ出る経路や他店舗は断る', () => {
    expect(isKioskPhotoPath(`${STORE}/../99999999-2222-3333-4444-555555555555/20261031/${UUID}.jpg`, STORE)).toBe(false)
    expect(isKioskPhotoPath(`99999999-2222-3333-4444-555555555555/20261031/${UUID}.jpg`, STORE)).toBe(false)
    expect(isKioskPhotoPath(`${STORE}/20261031/${UUID}.jpg/../x.jpg`, STORE)).toBe(false)
    expect(isKioskPhotoPath(`${STORE}/20261031/${UUID}.svg`, STORE)).toBe(false)
    expect(isKioskPhotoPath(null, STORE)).toBe(false)
  })
})

describe('safeZipSegment (ASVS 5.3.2)', () => {
  it('区切り文字を置き換える', () => {
    expect(safeZipSegment('1F/東口', 'x')).toBe('1F_東口')
  })
  it('. だけの名前は使わない', () => {
    expect(safeZipSegment('..', 'store')).toBe('store')
    expect(safeZipSegment('.', 'camera')).toBe('camera')
    expect(safeZipSegment('  ', 'camera')).toBe('camera')
  })
})

describe('decodeImageDataUrl (ASVS 5.2.2)', () => {
  it('宣言と中身が一致すれば読む', () => {
    const r = decodeImageDataUrl(dataUrl('image/jpeg', JPEG))!
    expect(r.mime).toBe('image/jpeg')
    expect(r.ext).toBe('jpg')
    expect(r.buf.equals(JPEG)).toBe(true)
  })
  it('宣言と中身が違えば断る（画像でないものを image/jpeg として保存させない）', () => {
    expect(decodeImageDataUrl(dataUrl('image/jpeg', PNG))).toBeNull()
    expect(decodeImageDataUrl(dataUrl('image/png', Buffer.from('<svg onload=alert(1)>')))).toBeNull()
  })
  it('受ける形式を絞れる', () => {
    expect(decodeImageDataUrl(dataUrl('image/png', PNG), ['image/jpeg'])).toBeNull()
    expect(decodeImageDataUrl(dataUrl('image/png', PNG), ['image/jpeg', 'image/png'])!.ext).toBe('png')
  })
  it('形の違う dataURL は断る', () => {
    expect(decodeImageDataUrl('data:image/svg+xml;base64,PHN2Zz4=')).toBeNull()
    expect(decodeImageDataUrl('data:image/jpeg;base64,')).toBeNull()
    expect(decodeImageDataUrl('not a data url')).toBeNull()
  })
})

describe('isUpstreamAddress (ASVS 2.2.1)', () => {
  it('http(s) の URL を通す', () => {
    expect(isUpstreamAddress('https://site1.genesis-edge.com/api/stream.m3u8?src=cam1')).toBe(true)
    expect(isUpstreamAddress('http://192.168.0.20:1984/api/stream.m3u8')).toBe(true)
  })
  it('スキームなしのホストは allowBareHost のときだけ', () => {
    expect(isUpstreamAddress('192.168.0.20:5000')).toBe(false)
    expect(isUpstreamAddress('192.168.0.20:5000', { allowBareHost: true })).toBe(true)
    expect(isUpstreamAddress('frigate.local', { allowBareHost: true })).toBe(true)
  })
  it('ほかのスキーム・資格情報入り・空白・長すぎる値は断る', () => {
    for (const bad of ['javascript:alert(1)', 'file:///etc/passwd', 'https://user:pass@host/x', 'https://a b/', '', 'https://' + 'a'.repeat(300)]) {
      expect(isUpstreamAddress(bad, { allowBareHost: true })).toBe(false)
    }
    expect(isUpstreamAddress('host/../x', { allowBareHost: true })).toBe(false)
  })
})
