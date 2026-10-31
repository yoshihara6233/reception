import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  toIproUtcStamp, iproVodMinuteRange, extractMp4FromMultipart, iproNvrLogin, downloadIproNvrMp4, nvrPlaybackSemaphore, nvrVodStatusMessage,
} from './nvr-vod'

const opts = { endpoint: 'https://192.168.0.250', username: 'ADMIN', password: 'Admin123' }
afterEach(() => vi.restoreAllMocks())

describe('toIproUtcStamp', () => {
  it('Date を UTC の yymmddhhmm00 に整形（ss=00固定）', () => {
    // 2026-06-19 04:20:37 UTC → 260619042000
    expect(toIproUtcStamp(new Date(Date.UTC(2026, 5, 19, 4, 20, 37)))).toBe('260619042000')
  })
  it('JST 13:20 の絶対時刻は UTC 04:20 として整形される', () => {
    // 2026-06-19 13:20 JST = 04:20 UTC
    expect(toIproUtcStamp(new Date('2026-06-19T13:20:00+09:00'))).toBe('260619042000')
  })
})

describe('iproVodMinuteRange（分単位丸め・同一分窓の START==END 回避）', () => {
  it('検査窓が同一分内でも START<END（END を次の分へ切り上げ）', () => {
    // 08:33:05〜08:33:20 JST（= 23:33:05〜23:33:20 UTC・同一分）→ START 23:33 / END 23:34
    const from = new Date('2026-07-23T08:33:05+09:00')
    const to = new Date('2026-07-23T08:33:20+09:00')
    const { startStamp, endStamp } = iproVodMinuteRange(from, to)
    expect(startStamp).toBe('260722233300')
    expect(endStamp).toBe('260722233400')
    expect(startStamp).not.toBe(endStamp)
  })

  it('分境界をまたぐ窓は START=切り捨て/END=切り上げ', () => {
    // 08:29:56〜08:30:04 JST（23:29:56〜23:30:04 UTC）→ START 23:29 / END 23:31
    const from = new Date('2026-07-23T08:29:56+09:00')
    const to = new Date('2026-07-23T08:30:04+09:00')
    const { startStamp, endStamp } = iproVodMinuteRange(from, to)
    expect(startStamp).toBe('260722232900')
    expect(endStamp).toBe('260722233100')
  })

  it('END が既に分ちょうどならそのまま（切り上げ不要）', () => {
    const from = new Date(Date.UTC(2026, 6, 22, 23, 33, 0))
    const to = new Date(Date.UTC(2026, 6, 22, 23, 35, 0))
    const { startStamp, endStamp } = iproVodMinuteRange(from, to)
    expect(startStamp).toBe('260722233300')
    expect(endStamp).toBe('260722233500')
  })
})

// multipart 応答を組み立てるヘルパ
function multipart(parts: { headers: string; body: Buffer }[]): Buffer {
  const B = '--myboundary'
  const segs: Buffer[] = []
  for (const p of parts) {
    segs.push(Buffer.from(`${B}\r\n${p.headers}\r\n\r\n`, 'latin1'))
    segs.push(p.body)
    segs.push(Buffer.from('\r\n', 'latin1'))
  }
  segs.push(Buffer.from(`${B}--\r\n`, 'latin1'))
  return Buffer.concat(segs)
}
const FTYP = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]) // ...ftypmp42

describe('extractMp4FromMultipart', () => {
  it('octet-stream パートを連結し status を返す', () => {
    const buf = multipart([
      { headers: 'Content-Type: application/octet-stream\r\nX-Temp-FileName: filename = "a.tmp"\r\nX-RecData-Satus: 0', body: FTYP },
    ])
    const r = extractMp4FromMultipart(buf)
    expect(r.status).toBe(0)
    expect(r.mp4.subarray(4, 8).toString('latin1')).toBe('ftyp')
  })
  it('分割された複数パートを連結', () => {
    const buf = multipart([
      { headers: 'Content-Type: application/octet-stream\r\nX-RecData-Satus: 0', body: FTYP },
      { headers: 'Content-Type: application/octet-stream\r\nX-RecData-Satus: 0', body: Buffer.from([1, 2, 3, 4]) },
    ])
    const r = extractMp4FromMultipart(buf)
    expect(r.mp4.length).toBe(FTYP.length + 4)
  })
  it('録画なし(status:1)は空MP4', () => {
    const buf = multipart([
      { headers: 'Content-Type: application/octet-stream\r\nX-Temp-FileName: filename = ""\r\nX-RecData-Satus: 1', body: Buffer.alloc(0) },
    ])
    const r = extractMp4FromMultipart(buf)
    expect(r.status).toBe(1)
    expect(r.mp4.length).toBe(0)
  })
})

describe('iproNvrLogin', () => {
  it('HTML 中の UID を抽出', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('', { status: 401, headers: { 'www-authenticate': 'Digest realm="Network disk recorder", nonce="abc", qop="auth"' } }))
      .mockResolvedValueOnce(new Response('<html>...location.href = "./hdrctl.cgi?UID=13313&HTML=..."</html>', { status: 200 }))
    const uid = await iproNvrLogin(opts)
    expect(uid).toBe('13313')
  })
})

describe('downloadIproNvrMp4', () => {
  it('login→httpdl(status:0)→MP4 を返す', async () => {
    const body = multipart([
      { headers: 'Content-Type: application/octet-stream\r\nX-RecData-Satus: 0', body: FTYP },
    ])
    vi.spyOn(globalThis, 'fetch')
      // login: 401 → 200(HTML, UID)
      .mockResolvedValueOnce(new Response('', { status: 401, headers: { 'www-authenticate': 'Digest realm="r", nonce="n", qop="auth"' } }))
      .mockResolvedValueOnce(new Response('hdrctl.cgi?UID=777', { status: 200 }))
      // httpdl: 401 → 200(multipart)
      .mockResolvedValueOnce(new Response('', { status: 401, headers: { 'www-authenticate': 'Digest realm="r", nonce="n", qop="auth"' } }))
      .mockResolvedValueOnce(new Response(body, { status: 200 }))
      // logout: 200
      .mockResolvedValueOnce(new Response('', { status: 200 }))
    const mp4 = await downloadIproNvrMp4(opts, 1, new Date('2026-06-19T13:20:00+09:00'), new Date('2026-06-19T13:25:00+09:00'))
    expect(mp4.subarray(4, 8).toString('latin1')).toBe('ftyp')
  })

  it('録画なし(status:1)は throw', async () => {
    const body = multipart([
      { headers: 'Content-Type: application/octet-stream\r\nX-RecData-Satus: 1', body: Buffer.alloc(0) },
    ])
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('', { status: 401, headers: { 'www-authenticate': 'Digest realm="r", nonce="n"' } }))
      .mockResolvedValueOnce(new Response('UID=777', { status: 200 }))
      .mockResolvedValueOnce(new Response('', { status: 401, headers: { 'www-authenticate': 'Digest realm="r", nonce="n"' } }))
      .mockResolvedValueOnce(new Response(body, { status: 200 }))
      .mockResolvedValueOnce(new Response('', { status: 200 }))
    // 文言そのものではなく**性質**を見る。「録画なし」という語を固定すると、
    // 現場に伝わる文へ直したときにテストだけが落ちる（実際そうなった）。
    await expect(downloadIproNvrMp4(opts, 1, new Date(), new Date()))
      .rejects.toThrow(/見つかりません/)
  })
})

describe('nvrPlaybackSemaphore（NVR 1台あたり再生 DL 同時 2 本制限）', () => {
  it('同一 endpoint は同時 2 本まで・3 本目は待たされる（実測 2026-08-01: 3本目から Satus=3）', async () => {
    const sem = nvrPlaybackSemaphore('https://10.0.0.9')
    let active = 0
    let peak = 0
    const gate: Array<() => void> = []
    const task = () => sem.run(async () => {
      active++; peak = Math.max(peak, active)
      await new Promise<void>((res) => gate.push(res))
      active--
    })
    const all = Promise.all([task(), task(), task(), task()])
    // マイクロタスクを消化して開始状態を確定させる
    await new Promise((r) => setTimeout(r, 10))
    expect(peak).toBe(2)
    expect(gate.length).toBe(2)   // 実行中は 2 本だけ・残り 2 本は待機
    // 1 本終わると 3 本目が開始する
    gate.shift()!()
    await new Promise((r) => setTimeout(r, 10))
    expect(gate.length).toBe(2)
    while (gate.length) gate.shift()!()
    await new Promise((r) => setTimeout(r, 10))
    while (gate.length) gate.shift()!()
    await all
    expect(peak).toBe(2)
  })

  it('endpoint ごとに独立（別 NVR の枠を食わない）・表記ゆれは同一視', () => {
    expect(nvrPlaybackSemaphore('https://10.0.0.1')).not.toBe(nvrPlaybackSemaphore('https://10.0.0.2'))
    expect(nvrPlaybackSemaphore('https://10.0.0.3/')).toBe(nvrPlaybackSemaphore('HTTPS://10.0.0.3'))
  })
})

describe('nvrVodStatusMessage — 現場が読む文', () => {
  const from = new Date('2026-07-06T23:38:35.866Z')   // JST 2026-07-07 08:38

  it('★録画なしは「見つからない」＋要求時刻＋考えられる理由', () => {
    // 旧実装は「指定時間帯に録画なし」だけで、不具合のように読めた。
    // 2026-08-21 の調査で、6 週間前の録画を要求した失敗を
    // 「取得できないバグ」と読みかけた（実際は保存期間切れ）。
    const m = nvrVodStatusMessage(1, from)
    expect(m).toContain('2026/07/07')
    expect(m).toContain('08:38')
    expect(m).toContain('保存期間')
    // **断定しない。** その時間帯だけ録画が無いこともある。
    expect(m).toContain('録画されていない可能性')
  })

  it('MP4 で取り出せない記録は、原因（JPEG 記録）を書く', () => {
    expect(nvrVodStatusMessage(2, from)).toContain('JPEG')
  })

  it('★同時処理超過は「もう一度」と伝える（利用者の手で直せる）', () => {
    expect(nvrVodStatusMessage(3, from)).toContain('もう一度')
  })

  it('未知の status も status 番号を残す（切り分けの手掛かりを消さない）', () => {
    expect(nvrVodStatusMessage(9, from)).toContain('status=9')
  })
})
