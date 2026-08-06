import { describe, it, expect } from 'vitest'
import { parseIproNvrChannels } from './nvr-info'

describe('parseIproNvrChannels', () => {
  it('★実機(NU101 2026-08-06)の応答: 01/02CH が接続', () => {
    const body = [
      'CAM_CONNECT_01CH=1',
      'CAM_CONNECT_02CH=1',
      'CAM_CONNECT_03CH=0',
      'CAM_CONNECT_04CH=0',
    ].join('\r\n')
    expect(parseIproNvrChannels(body)).toEqual([
      { channel: 1, connected: true },
      { channel: 2, connected: true },
      { channel: 3, connected: false },
      { channel: 4, connected: false },
    ])
  })

  it('チャンネル昇順に並べ替える（応答順に依存しない）', () => {
    const body = 'CAM_CONNECT_10CH=1\nCAM_CONNECT_02CH=1'
    expect(parseIproNvrChannels(body).map((c) => c.channel)).toEqual([2, 10])
  })

  it('無関係なキーは拾わない', () => {
    const body = 'HDD_STATUS=0\r\nCAM_CONNECT_01CH=1\r\nREC_MODE=1'
    expect(parseIproNvrChannels(body)).toEqual([{ channel: 1, connected: true }])
  })

  it('該当キーが無ければ空（呼び出し側が UID 付きで再試行する契機になる）', () => {
    expect(parseIproNvrChannels('<html>404</html>')).toEqual([])
    expect(parseIproNvrChannels('')).toEqual([])
  })
})
