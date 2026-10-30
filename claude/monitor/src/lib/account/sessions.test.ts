import { describe, expect, it } from 'vitest'
import { deviceLabel, validSessionId } from './sessions'

describe('deviceLabel', () => {
  it('よくある端末を短い名前にする', () => {
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36')).toBe('Chrome・Windows')
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0')).toBe('Edge・Windows')
    expect(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1')).toBe('Safari・iPhone')
    expect(deviceLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15')).toBe('Safari・Mac')
    expect(deviceLabel('Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0')).toBe('Firefox・Linux')
  })
  it('名乗りが無い・わからないとき', () => {
    expect(deviceLabel(null)).toBe('不明な端末')
    expect(deviceLabel('curl/8.0')).toBe('ブラウザ')
  })
})

describe('validSessionId', () => {
  it('UUID の形だけを受ける', () => {
    expect(validSessionId('5e000000-0000-0000-0000-000000000001')).toBe(true)
    expect(validSessionId('x')).toBe(false)
    expect(validSessionId(null)).toBe(false)
  })
})
