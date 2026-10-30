import { describe, expect, it } from 'vitest'
import config from '../../next.config'

/**
 * 全応答に付くセキュリティヘッダー。
 *
 * ここで固定したいのは「付いていること」だけではない。**塞ぎすぎて機能を壊さない**
 * ことも同じくらい重要で、実際にこの手の設定は
 *   ・`camera=()` にして iPad キオスクの顔撮影が動かなくなる
 *   ・CSP に `frame-src` を書いて高画質ライブ（Frigate の iframe）が出なくなる
 *   ・CSP に `script-src` を書いて画面が白くなる
 * という形で壊れる。**壊れ方が「動かない」ではなく「特定の画面だけ出ない」**ので
 * 気づきにくい。両方向を固定する。
 */

async function headerMap(): Promise<Map<string, string>> {
  const rules = await config.headers!()
  // 全パスの 1 ルールと、API の保存の禁止の 1 ルール (2026-10-31)。増えたらこの前提を見直すこと。
  expect(rules).toHaveLength(2)
  const all = rules.find((r) => r.source === '/:path*')!
  expect(all).toBeTruthy()
  return new Map(all.headers.map((h) => [h.key, h.value]))
}

describe('API の応答を保存させない (ASVS 14.3.2)', () => {
  it('/api の応答に Cache-Control: no-store を付ける', async () => {
    const rules = await config.headers!()
    const api = rules.find((r) => r.source === '/api/:path*')
    expect(api, '/api の規則が無い').toBeTruthy()
    expect(api!.headers).toContainEqual({ key: 'Cache-Control', value: 'no-store' })
  })
})

describe('セキュリティヘッダー', () => {
  it('必要なヘッダーが揃っている', async () => {
    const h = await headerMap()
    for (const key of [
      'X-Content-Type-Options',
      'X-Frame-Options',
      'Referrer-Policy',
      'Permissions-Policy',
      'Strict-Transport-Security',
      'Content-Security-Policy',
    ]) {
      expect(h.has(key), `${key} が無い`).toBe(true)
    }
  })

  it('MIME 誤解釈を止める', async () => {
    expect((await headerMap()).get('X-Content-Type-Options')).toBe('nosniff')
  })

  it('外部サイトからフレームに入れられない（クリックジャッキング）', async () => {
    const h = await headerMap()
    expect(h.get('X-Frame-Options')).toBe('SAMEORIGIN')
    expect(h.get('Content-Security-Policy')).toContain("frame-ancestors 'self'")
  })

  it('外部へパスを含む Referer を送らない（拠点ID・カメラIDが URL に出る）', async () => {
    expect((await headerMap()).get('Referrer-Policy')).toBe('strict-origin-when-cross-origin')
  })

  it('HSTS に preload を付けない（撤回できなくなる）', async () => {
    const hsts = (await headerMap()).get('Strict-Transport-Security')!
    expect(hsts).toContain('max-age=31536000')
    expect(hsts).not.toContain('preload')
  })

  describe('★塞ぎすぎない（使っている機能を壊さない）', () => {
    it('カメラは自オリジンに許可されている（iPad キオスクの顔撮影）', async () => {
      const pp = (await headerMap()).get('Permissions-Policy')!
      expect(pp).toContain('camera=(self)')
      // `camera=()` にすると手荷物検査の顔照合が動かなくなる。
      expect(pp).not.toMatch(/camera=\(\)/)
    })

    it('未使用の機能は塞いである', async () => {
      const pp = (await headerMap()).get('Permissions-Policy')!
      expect(pp).toContain('microphone=()')
      expect(pp).toContain('geolocation=()')
    })

    it('CSP に frame-src を書かない（レコーダの Frigate UI を iframe で読む）', async () => {
      expect((await headerMap()).get('Content-Security-Policy')).not.toContain('frame-src')
    })

    it('全応答の CSP に script-src / style-src / default-src を書かない（script-src は画面だけ・middleware が nonce つきで付ける）', async () => {
      const csp = (await headerMap()).get('Content-Security-Policy')!
      expect(csp).not.toContain('script-src')
      expect(csp).not.toContain('style-src')
      expect(csp).not.toContain('default-src')
    })
  })

  it('nonce 不要で効く指令は入れてある', async () => {
    const csp = (await headerMap()).get('Content-Security-Policy')!
    expect(csp).toContain("base-uri 'none'")
    expect(csp).toContain("form-action 'self'")
    expect(csp).toContain("object-src 'none'")
  })
})
