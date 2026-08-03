import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHmac } from 'node:crypto'
import { signEdgeImageUrl, edgeImagesWorkerConfigured } from './edge-images-sign'

const EDGE = '11111111-1111-4111-8111-111111111111'
const SECRET = 'test-secret'
const BASE = 'https://img.genesis-edge.com'

/**
 * Worker(src/index.js) の検証ロジックを再現する。
 * 正規化文字列がズレると本番で全フレーム 403 になるため、両者を突き合わせて固定する。
 */
function workerVerify(rawUrl: string, method: 'PUT' | 'GET', secret: string): boolean {
  const u = new URL(rawUrl)
  const PREFIX = '/v1/'
  if (!u.pathname.startsWith(PREFIX)) return false
  const key = decodeURIComponent(u.pathname.slice(PREFIX.length))
  const KEY_RE = /^edges\/[0-9a-fA-F-]{36}\/(grid\.jpg|cam\/[0-9a-fA-F-]{36}\/snapshot\.jpg)$/
  if (!KEY_RE.test(key)) return false
  const exp = u.searchParams.get('exp')
  const sig = u.searchParams.get('sig')
  if (!exp || !sig || !/^\d+$/.test(exp)) return false
  if (Number(exp) < Math.floor(Date.now() / 1000)) return false
  const expected = createHmac('sha256', secret).update(`${method}\n${key}\n${exp}`).digest('hex')
  return expected === sig.toLowerCase()
}

describe('edge-images 署名 (monitor ↔ Worker の往復)', () => {
  const saved = { ...process.env }
  beforeEach(() => {
    process.env.EDGE_IMAGES_BASE_URL = BASE
    process.env.EDGE_IMAGES_SIGNING_SECRET = SECRET
  })
  afterEach(() => { process.env = { ...saved } })

  it('PUT 署名を Worker が受理する', () => {
    const url = signEdgeImageUrl('PUT', `edges/${EDGE}/grid.jpg`)!
    expect(url.startsWith(`${BASE}/v1/edges/${EDGE}/grid.jpg?`)).toBe(true)
    expect(workerVerify(url, 'PUT', SECRET)).toBe(true)
  })

  it('GET 署名を Worker が受理する（snapshot の入れ子キーも）', () => {
    const cam = '22222222-2222-4222-8222-222222222222'
    const url = signEdgeImageUrl('GET', `edges/${EDGE}/cam/${cam}/snapshot.jpg`)!
    expect(workerVerify(url, 'GET', SECRET)).toBe(true)
  })

  it('PUT 署名では GET できない（method を署名対象に含めている）', () => {
    const url = signEdgeImageUrl('PUT', `edges/${EDGE}/grid.jpg`)!
    expect(workerVerify(url, 'GET', SECRET)).toBe(false)
  })

  it('鍵が違えば拒否される', () => {
    const url = signEdgeImageUrl('GET', `edges/${EDGE}/grid.jpg`)!
    expect(workerVerify(url, 'GET', 'wrong-secret')).toBe(false)
  })

  it('別キーへの流用はできない（キーを署名対象に含めている）', () => {
    const url = signEdgeImageUrl('GET', `edges/${EDGE}/grid.jpg`)!
    const other = '33333333-3333-4333-8333-333333333333'
    const tampered = url.replace(EDGE, other)
    expect(workerVerify(tampered, 'GET', SECRET)).toBe(false)
  })

  it('env 未設定なら null（＝従来経路へフォールバック）', () => {
    delete process.env.EDGE_IMAGES_SIGNING_SECRET
    expect(edgeImagesWorkerConfigured()).toBe(false)
    expect(signEdgeImageUrl('GET', `edges/${EDGE}/grid.jpg`)).toBeNull()
  })
})
