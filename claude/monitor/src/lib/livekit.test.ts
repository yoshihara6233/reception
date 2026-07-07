import { describe, it, expect, afterEach } from 'vitest'
import { livekitEnabled, roomForCamera } from './livekit'

const KEYS = ['LIVEKIT_ENABLED', 'LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET'] as const
afterEach(() => { for (const k of KEYS) delete process.env[k] })

function setCreds() {
  process.env.LIVEKIT_URL = 'wss://x.livekit.cloud'
  process.env.LIVEKIT_API_KEY = 'key'
  process.env.LIVEKIT_API_SECRET = 'secret'
}

describe('roomForCamera', () => {
  it('go2rtc と同規則の cam_<id> を返す', () => {
    expect(roomForCamera('98fa4408-9bc8')).toBe('cam_98fa4408-9bc8')
  })
})

describe('livekitEnabled', () => {
  it('フラグ未設定なら creds があっても false（安全既定）', () => {
    setCreds()
    expect(livekitEnabled()).toBe(false)
  })
  it('フラグ true でも creds 欠落なら false', () => {
    process.env.LIVEKIT_ENABLED = 'true'
    expect(livekitEnabled()).toBe(false)
  })
  it('フラグ true ＋ creds 3点で true', () => {
    process.env.LIVEKIT_ENABLED = 'true'
    setCreds()
    expect(livekitEnabled()).toBe(true)
  })
  it('フラグが true 以外の文字列なら false', () => {
    process.env.LIVEKIT_ENABLED = '1'
    setCreds()
    expect(livekitEnabled()).toBe(false)
  })
})
