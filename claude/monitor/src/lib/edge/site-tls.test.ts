import { describe, it, expect, afterEach } from 'vitest'
import { hostnameFor, isPrivateIPv4, normalizeLabel, txtNameAllowed } from './site-tls'

afterEach(() => { delete process.env.GVMS_SITE_DOMAIN })

describe('normalizeLabel', () => {
  it('英小文字・数字・ハイフンだけを通し、小文字にそろえる', () => {
    expect(normalizeLabel(' Site200 ')).toBe('site200')
    expect(normalizeLabel('a')).toBe('a')
    expect(normalizeLabel('x-1')).toBe('x-1')
  })
  it('ドット・空・先頭末尾のハイフン・長すぎる・文字列以外は断る', () => {
    for (const bad of ['site.200', '', '-a', 'a-', 'a'.repeat(64), 'sites/../x', 42, null]) {
      expect(normalizeLabel(bad)).toBeNull()
    }
  })
})

describe('isPrivateIPv4', () => {
  it('私設の範囲だけ', () => {
    expect(isPrivateIPv4('192.168.0.200')).toBe(true)
    expect(isPrivateIPv4('10.1.2.3')).toBe(true)
    expect(isPrivateIPv4('172.16.0.1')).toBe(true)
    expect(isPrivateIPv4('172.32.0.1')).toBe(false)
    expect(isPrivateIPv4('8.8.8.8')).toBe(false)
    expect(isPrivateIPv4('192.168.0.256')).toBe(false)
    expect(isPrivateIPv4('::1')).toBe(false)
  })
})

describe('hostnameFor / txtNameAllowed', () => {
  it('既定のドメインは sites.genesis-edge.com', () => {
    expect(hostnameFor('site200')).toBe('site200.sites.genesis-edge.com')
  })
  it('GVMS_SITE_DOMAIN で変えられる（前後のドットは除く）', () => {
    process.env.GVMS_SITE_DOMAIN = '.Sites.Example.jp.'
    expect(hostnameFor('site200')).toBe('site200.sites.example.jp')
  })
  it('自分の名前の _acme-challenge だけを許す', () => {
    const h = 'site200.sites.genesis-edge.com'
    expect(txtNameAllowed('_acme-challenge.site200.sites.genesis-edge.com', h)).toBe(true)
    expect(txtNameAllowed('_ACME-Challenge.Site200.sites.genesis-edge.com ', h)).toBe(true)
    expect(txtNameAllowed('_acme-challenge.site201.sites.genesis-edge.com', h)).toBe(false)
    expect(txtNameAllowed('site200.sites.genesis-edge.com', h)).toBe(false)
    expect(txtNameAllowed('_acme-challenge.genesis-edge.com', h)).toBe(false)
    expect(txtNameAllowed('_acme-challenge.site200.sites.genesis-edge.com', null)).toBe(false)
    expect(txtNameAllowed(undefined, h)).toBe(false)
  })
})
