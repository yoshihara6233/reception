/**
 * Tests for the WHIP proxy SDP stripper.
 *
 * The reference SDP body is the actual LiveKit Cloud answer that broke
 * ffmpeg 8.1's WHIP muxer in production (logged 2026-05-30, error:
 * "Protocol tcp is not supported by RTC, choose udp"). All four TCP
 * candidates must drop; all four UDP candidates and the surrounding
 * SDP must survive verbatim.
 */
import { describe, it, expect } from 'vitest'
import { stripTcpCandidates, wrapWhip } from '../whip-proxy.js'

const LIVEKIT_ANSWER = [
  'v=0',
  'o=- 2412979677194934109 1780131761 IN IP4 0.0.0.0',
  's=-',
  't=0 0',
  'a=msid-semantic:WMS *',
  'a=fingerprint:sha-256 E9:19:C2:65:FE:2F:62:22:EB:C2:59:0D:95:E5:6B:27:C8:5D:CF:8D:08:4A:91:ED:FD:14:66:A2:F0:0E:E9:3A',
  'a=extmap-allow-mixed',
  'a=group:BUNDLE 1',
  'm=video 9 UDP/TLS/RTP/SAVPF 106 105',
  'c=IN IP4 0.0.0.0',
  'a=setup:active',
  'a=mid:1',
  'a=ice-ufrag:RqlfGcxIsePGwTce',
  'a=ice-pwd:kqMSRnjxfBevwOZbOXlGcIJApkjEsQYw',
  'a=rtcp-mux',
  'a=rtcp-rsize',
  'a=rtpmap:106 H264/90000',
  'a=fmtp:106 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=4d0033',
  'a=rtcp-fb:106 nack',
  'a=rtpmap:105 rtx/90000',
  'a=fmtp:105 apt=106',
  'a=recvonly',
  'a=candidate:4105269533 1 tcp 1671430143 161.115.166.11 7881 typ host tcptype passive ufrag RqlfGcxIsePGwTce',
  'a=candidate:4105269533 2 tcp 1671430143 161.115.166.11 7881 typ host tcptype passive ufrag RqlfGcxIsePGwTce',
  'a=candidate:1348559589 1 tcp 1671430143 2603:c021:801d:d600:0:d46a:fcf6:1120 7881 typ host tcptype passive ufrag RqlfGcxIsePGwTce',
  'a=candidate:1348559589 2 tcp 1671430143 2603:c021:801d:d600:0:d46a:fcf6:1120 7881 typ host tcptype passive ufrag RqlfGcxIsePGwTce',
  'a=candidate:1229062397 1 udp 2130706431 161.115.166.11 50014 typ host ufrag RqlfGcxIsePGwTce',
  'a=candidate:1229062397 2 udp 2130706431 161.115.166.11 50014 typ host ufrag RqlfGcxIsePGwTce',
  'a=candidate:3985773317 1 udp 2130706431 2603:c021:801d:d600:0:d46a:fcf6:1120 50014 typ host ufrag RqlfGcxIsePGwTce',
  'a=candidate:3985773317 2 udp 2130706431 2603:c021:801d:d600:0:d46a:fcf6:1120 50014 typ host ufrag RqlfGcxIsePGwTce',
  'a=end-of-candidates',
].join('\r\n')

describe('stripTcpCandidates', () => {
  it('drops all 4 TCP host candidates from the real LiveKit answer', () => {
    const out = stripTcpCandidates(LIVEKIT_ANSWER)
    const tcpLines = out.split(/\r?\n/).filter((l) => /\btcp\b/i.test(l))
    expect(tcpLines).toEqual([])
  })

  it('preserves all 4 UDP candidates (IPv4 + IPv6, components 1 & 2)', () => {
    const out = stripTcpCandidates(LIVEKIT_ANSWER)
    const udpLines = out.split(/\r?\n/).filter((l) => /^a=candidate:\S+\s+\d+\s+udp\b/i.test(l))
    expect(udpLines).toHaveLength(4)
  })

  it('preserves SDP structural lines (m=, c=, a=fingerprint, a=end-of-candidates)', () => {
    const out = stripTcpCandidates(LIVEKIT_ANSWER)
    expect(out).toContain('m=video 9 UDP/TLS/RTP/SAVPF 106 105')
    expect(out).toContain('c=IN IP4 0.0.0.0')
    expect(out).toContain('a=fingerprint:sha-256')
    expect(out).toContain('a=end-of-candidates')
  })

  it('keeps CRLF line endings when the input used CRLF', () => {
    const out = stripTcpCandidates(LIVEKIT_ANSWER)
    // First line + CRLF should still be intact.
    expect(out.startsWith('v=0\r\n')).toBe(true)
  })

  it('is a no-op on an SDP that has no TCP candidates', () => {
    const udpOnly = 'v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=candidate:1 1 udp 2130706431 1.2.3.4 5000 typ host\r\n'
    expect(stripTcpCandidates(udpOnly)).toBe(udpOnly)
  })

  it('does not strip lines that merely contain "tcp" in unrelated positions', () => {
    // Defensive: an unrelated attribute containing the substring "tcp" must survive.
    const sdp = 'v=0\r\na=group:BUNDLE tcp-fallback\r\na=candidate:1 1 udp 2130706431 1.2.3.4 5000 typ host\r\n'
    const out = stripTcpCandidates(sdp)
    expect(out).toContain('a=group:BUNDLE tcp-fallback')
  })
})

describe('wrapWhip', () => {
  it('encodes the upstream URL into the proxy query string', () => {
    const url = wrapWhip('http://127.0.0.1:9123', 'https://x.whip.livekit.cloud/w/KEY')
    expect(url).toBe('http://127.0.0.1:9123/whip?upstream=https%3A%2F%2Fx.whip.livekit.cloud%2Fw%2FKEY')
  })
})
