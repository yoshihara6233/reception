import { describe, expect, it } from 'vitest'
import { snapshotUrl } from '../url.js'

/**
 * スナップショット URL の組み立て。
 *
 * ── なぜ検査するのか ────────────────────────────────────────────────────
 * `snapshotUrl()` は **grid / live / BCP / 巡回の 4 経路**が使う。
 * ここが null を返すと、グリッドは暗いセルを描き、live は
 * 「no snapshot source」で落ちる。**壊れても例外にならない側**の関数なので、
 * 形を固定しておく。
 *
 * ── この検査を書いた経緯 ────────────────────────────────────────────────
 * Uniview 削除（2026-08-19）で、呼び出し元の無くなった liveRtspUrl() /
 * vodSourceUrl() と一緒に、この関数のテストファイルごと消えていた。
 * 消された関数の検査は不要だが、**残った関数の検査まで一緒に消えていた**。
 */

const base = {
  host: '192.168.0.50',
  port: 554,
  username: 'admin',
  password: 'secret',
  channel: 1,
} as const

describe('snapshotUrl — Frigate', () => {
  it('★カメラ名が無ければ channel から camera_01 形式で組む', () => {
    expect(snapshotUrl({ ...base, vendor: 'frigate' }))
      .toBe('http://192.168.0.50:5000/api/camera_01/latest.jpg')
  })

  it('2 桁になるまで 0 埋めする', () => {
    expect(snapshotUrl({ ...base, vendor: 'frigate', channel: 12 }))
      .toBe('http://192.168.0.50:5000/api/camera_12/latest.jpg')
  })

  it('カメラ名が渡されればそちらを使う', () => {
    expect(snapshotUrl({ ...base, vendor: 'frigate', frigateCamera: 'entrance' }))
      .toBe('http://192.168.0.50:5000/api/entrance/latest.jpg')
  })

  it('★API ポートを差し替えられる（macOS の AirPlay が 5000 を使うため）', () => {
    expect(snapshotUrl({ ...base, vendor: 'frigate', frigateApiPort: 5001 }))
      .toBe('http://192.168.0.50:5001/api/camera_01/latest.jpg')
  })

  it('★URL に資格情報を混ぜない（ログや DOM に載る経路のため）', () => {
    const url = snapshotUrl({ ...base, vendor: 'frigate' })!
    expect(url).not.toContain('admin')
    expect(url).not.toContain('secret')
  })
})

describe('snapshotUrl — 非対応ベンダ', () => {
  // null は「暗いセルを描く」の合図。例外にならないので、
  // ここが崩れると画面が黙って黒くなるだけで誰も気づけない。
  it('★i-PRO NVR は null（NVR 経由は専用の取得経路を使う）', () => {
    expect(snapshotUrl({ ...base, vendor: 'i-pro-nvr' })).toBeNull()
  })

  it('★onvif-generic は null（ONVIF の snapshot URI を別途解決する）', () => {
    expect(snapshotUrl({ ...base, vendor: 'onvif-generic' })).toBeNull()
  })

  it('★レガシーの ipro は null', () => {
    expect(snapshotUrl({ ...base, vendor: 'ipro' })).toBeNull()
  })
})
