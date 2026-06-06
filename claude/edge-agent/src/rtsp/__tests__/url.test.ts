/**
 * Tests for VOD source URL builder.
 *
 * Locks in the per-vendor URL shape that ffmpeg ingests:
 *   - uniview : rtsp://user:pass@host:port/c{ch}/b{unixFrom}/e{unixTo}/replay
 *   - frigate : http://host:5000/api/<cam>/start/<unixFrom>/end/<unixTo>/clip.mp4
 *   - ipro    : throws (ONVIF Profile-G not implemented)
 *
 * If the recorder protocol changes (e.g. Frigate moves the clip endpoint),
 * this is the file to update.
 */
import { describe, it, expect } from 'vitest'
import { vodSourceUrl } from '../url.js'

const FROM = '2024-04-01T00:00:00.000Z'  // unix 1711929600
const TO   = '2024-04-01T00:05:00.000Z'  // unix 1711929900

describe('vodSourceUrl', () => {
  it('uniview: RTSP replay URL with credentials and b/e bookends', () => {
    const url = vodSourceUrl({
      vendor: 'uniview',
      host: '10.0.0.5',
      port: 554,
      username: 'admin',
      password: 'pa ss!',           // space + special char → must be URI-encoded
      channel: 3,
    }, FROM, TO)
    expect(url).toBe(
      'rtsp://admin:pa%20ss!@10.0.0.5:554/c3/b1711929600/e1711929900/replay',
    )
  })

  it('frigate: HTTP MP4 export with explicit camera name', () => {
    const url = vodSourceUrl({
      vendor: 'frigate',
      host: '10.0.0.6',
      port: 8554,                    // RTSP port — irrelevant for VOD
      username: '',
      password: '',
      channel: 1,
      frigateCamera: 'entrance_cam',
    }, FROM, TO)
    expect(url).toBe(
      'http://10.0.0.6:5000/api/entrance_cam/start/1711929600/end/1711929900/clip.mp4',
    )
  })

  it('frigate: falls back to camera_NN when frigateCamera is unset', () => {
    const url = vodSourceUrl({
      vendor: 'frigate',
      host: 'frigate.local',
      port: 8554,
      username: '',
      password: '',
      channel: 7,
    }, FROM, TO)
    expect(url).toBe(
      'http://frigate.local:5000/api/camera_07/start/1711929600/end/1711929900/clip.mp4',
    )
  })

  it('frigate: frigateApiPort overrides default 5000 (macOS AirPlay escape hatch)', () => {
    const url = vodSourceUrl({
      vendor: 'frigate',
      host: '127.0.0.1',
      port: 8554,
      username: '',
      password: '',
      channel: 1,
      frigateCamera: 'camera_01',
      frigateApiPort: 5050,
    }, FROM, TO)
    expect(url).toBe(
      'http://127.0.0.1:5050/api/camera_01/start/1711929600/end/1711929900/clip.mp4',
    )
  })

  it('ipro: throws (ONVIF Profile-G not implemented)', () => {
    expect(() => vodSourceUrl({
      vendor: 'ipro',
      host: '10.0.0.7',
      port: 554,
      username: 'admin',
      password: 'pw',
      channel: 1,
    }, FROM, TO)).toThrow(/ipro/)
  })
})
