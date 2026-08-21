import { describe, expect, it } from 'vitest'
import { canFetchVod, isVodVendor, VOD_VENDORS } from './db'

/**
 * 録画切り出しの可否判定。
 *
 * ── 守りたい性質 ────────────────────────────────────────────────────────
 * ① **画面と API が同じ答えを出す**（片方だけ「可」だと、押してから 422 になる）
 * ② onvif-generic は VOD ソース(NVR)が無ければ不可
 *
 * ── 実際にずれた ────────────────────────────────────────────────────────
 * BCP の 5 分動画メニューを足したとき、画面側は isVodVendor() だけで判定し、
 * API 側は vod_host まで見ていた。メニューは押せるのに押したら失敗する形で、
 * **操作するまで誰も気づけない**。判定を 1 関数に寄せた経緯をここで固定する。
 */

describe('canFetchVod', () => {
  it('i-PRO NVR は録画から取れる', () => {
    expect(canFetchVod('i-pro-nvr', null)).toBe(true)
  })

  it('Frigate は録画から取れる', () => {
    expect(canFetchVod('frigate', null)).toBe(true)
  })

  it('★onvif-generic は VOD ソース(NVR)があれば可', () => {
    expect(canFetchVod('onvif-generic', 'https://nvr.example.local')).toBe(true)
  })

  it('★onvif-generic は VOD ソースが無ければ不可（カメラ直では録画が無い）', () => {
    expect(canFetchVod('onvif-generic', null)).toBe(false)
    expect(canFetchVod('onvif-generic', '')).toBe(false)
    expect(canFetchVod('onvif-generic', undefined)).toBe(false)
  })

  it('レガシーの ipro（カメラ直）は不可', () => {
    expect(canFetchVod('ipro', null)).toBe(false)
    // vod_host を入れても、この経路の実装が無いので通さない。
    expect(canFetchVod('ipro', 'https://nvr.example.local')).toBe(false)
  })

  it('★知らないベンダは既定で不可（新ベンダを黙って通さない）', () => {
    expect(canFetchVod('dahua', 'https://nvr.example.local')).toBe(false)
    expect(canFetchVod('', null)).toBe(false)
  })
})

describe('isVodVendor との違い', () => {
  it('★ベンダが対応でも、設定次第で実際には取れない', () => {
    // ここが 2 つの関数を分けている理由。isVodVendor だけで画面を作ると、
    // VOD ソース未設定の onvif-generic で「押せるのに失敗する」になる。
    expect(isVodVendor('onvif-generic')).toBe(true)
    expect(canFetchVod('onvif-generic', null)).toBe(false)
  })

  it('VOD_VENDORS に列挙されたベンダは、設定が揃えばすべて取れる', () => {
    for (const v of VOD_VENDORS) {
      expect(canFetchVod(v, 'https://nvr.example.local'), v).toBe(true)
    }
  })
})
