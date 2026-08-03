import { afterEach, describe, expect, it } from 'vitest'
import { appBaseUrl, absoluteUrl } from './app-url'

const KEYS = ['NEXT_PUBLIC_SITE_URL', 'NEXT_PUBLIC_APP_URL'] as const

afterEach(() => {
  for (const k of KEYS) delete process.env[k]
})

describe('appBaseUrl', () => {
  it('env 未設定でも本番URLに落ちる（メールのリンク切れを作らない）', () => {
    expect(appBaseUrl()).toBe('https://intereco-monitor.vercel.app')
  })

  it('NEXT_PUBLIC_SITE_URL を最優先する', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://site.example'
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.example'
    expect(appBaseUrl()).toBe('https://site.example')
  })

  it('旧名 NEXT_PUBLIC_APP_URL も後方互換で読む', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.example'
    expect(appBaseUrl()).toBe('https://app.example')
  })

  it('空文字・空白のみの env は未設定として扱う（?? では素通りしてしまう罠）', () => {
    process.env.NEXT_PUBLIC_SITE_URL = ''
    process.env.NEXT_PUBLIC_APP_URL = '   '
    expect(appBaseUrl()).toBe('https://intereco-monitor.vercel.app')
  })

  it('末尾スラッシュを落とす（// の二重スラッシュを作らない）', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://site.example///'
    expect(appBaseUrl()).toBe('https://site.example')
  })
})

describe('absoluteUrl', () => {
  it('必ず絶対URLになる（相対パスはメーラーが解決できない）', () => {
    expect(absoluteUrl('/bcp/abc')).toBe('https://intereco-monitor.vercel.app/bcp/abc')
  })

  it('先頭スラッシュが無くても補う', () => {
    expect(absoluteUrl('bcp/abc')).toBe('https://intereco-monitor.vercel.app/bcp/abc')
  })
})
