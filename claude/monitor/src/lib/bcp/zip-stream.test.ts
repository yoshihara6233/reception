import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { crc32, zipStream, type ZipEntrySource } from './zip-stream'

/**
 * BCP の ZIP を流しながら作る部品 (自主診断 ASVS 15.2.2)。
 * 作った ZIP を JSZip (別の実装) で開き直して、中身と名前が合うことを見る。
 */

async function readAll(s: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = []
  const r = s.getReader()
  for (;;) {
    const { done, value } = await r.read()
    if (done) break
    parts.push(value)
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}

const bytes = (s: string) => new TextEncoder().encode(s)

describe('crc32', () => {
  it('既知の値 ("123456789" → cbf43926)', () => {
    expect(crc32(bytes('123456789')).toString(16)).toBe('cbf43926')
  })
})

describe('zipStream', () => {
  it('JSZip で開ける・日本語の名前・中身が一致', async () => {
    const entries: ZipEntrySource[] = [
      { name: '渋谷南店/レジ前カメラ/m5_5分前.jpg', load: async () => bytes('a'.repeat(1000)) },
      { name: '渋谷南店/レジ前カメラ/p0_発生時.jpg', load: async () => bytes('bbb') },
    ]
    const zip = await JSZip.loadAsync(await readAll(zipStream(entries)))
    expect(Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort()).toEqual([
      '渋谷南店/レジ前カメラ/m5_5分前.jpg',
      '渋谷南店/レジ前カメラ/p0_発生時.jpg',
    ])
    expect(await zip.file('渋谷南店/レジ前カメラ/p0_発生時.jpg')!.async('string')).toBe('bbb')
    expect((await zip.file('渋谷南店/レジ前カメラ/m5_5分前.jpg')!.async('string')).length).toBe(1000)
  })

  it('取れなかった項目は飛ばす (null・例外)', async () => {
    const skipped: string[] = []
    const entries: ZipEntrySource[] = [
      { name: 'a.jpg', load: async () => null },
      { name: 'b.jpg', load: async () => { throw new Error('boom') } },
      { name: 'c.jpg', load: async () => bytes('c') },
    ]
    const zip = await JSZip.loadAsync(await readAll(zipStream(entries, { onSkip: (n) => skipped.push(n) })))
    expect(Object.keys(zip.files)).toEqual(['c.jpg'])
    expect(skipped).toEqual(['a.jpg', 'b.jpg'])
  })

  it('全部取れなくても空の ZIP として開ける', async () => {
    const zip = await JSZip.loadAsync(await readAll(zipStream([{ name: 'a.jpg', load: async () => null }])))
    expect(Object.keys(zip.files)).toEqual([])
  })

  it('同じ名前は上書きせず _2 を付ける', async () => {
    const entries: ZipEntrySource[] = [
      { name: 's/cam/p0.jpg', load: async () => bytes('1') },
      { name: 's/cam/p0.jpg', load: async () => bytes('2') },
    ]
    const zip = await JSZip.loadAsync(await readAll(zipStream(entries)))
    expect(await zip.file('s/cam/p0.jpg')!.async('string')).toBe('1')
    expect(await zip.file('s/cam/p0_2.jpg')!.async('string')).toBe('2')
  })

  it('合計の上限を超える項目は入れない', async () => {
    const entries: ZipEntrySource[] = [
      { name: 'a', load: async () => new Uint8Array(60) },
      { name: 'b', load: async () => new Uint8Array(60) },
      { name: 'c', load: async () => new Uint8Array(30) },
    ]
    const zip = await JSZip.loadAsync(await readAll(zipStream(entries, { maxTotalBytes: 100 })))
    expect(Object.keys(zip.files).sort()).toEqual(['a', 'c'])
  })

  it('同時に取りに行くのは prefetch 件まで (全部を同時に取らない)', async () => {
    let inflight = 0
    let peak = 0
    const entries: ZipEntrySource[] = Array.from({ length: 30 }, (_, i) => ({
      name: `f${i}.jpg`,
      load: async () => {
        inflight++
        peak = Math.max(peak, inflight)
        await new Promise((r) => setTimeout(r, 1))
        inflight--
        return bytes(String(i))
      },
    }))
    const zip = await JSZip.loadAsync(await readAll(zipStream(entries, { prefetch: 3 })))
    expect(Object.keys(zip.files)).toHaveLength(30)
    expect(peak).toBeLessThanOrEqual(3)
  })

  it('受け手が切れたら残りを取りに行かない', async () => {
    let loads = 0
    const entries: ZipEntrySource[] = Array.from({ length: 50 }, (_, i) => ({
      name: `f${i}`,
      load: async () => { loads++; return bytes('x') },
    }))
    const r = zipStream(entries, { prefetch: 2 }).getReader()
    await r.read()
    await r.cancel()
    await new Promise((res) => setTimeout(res, 5))
    expect(loads).toBeLessThan(10)
  })
})
