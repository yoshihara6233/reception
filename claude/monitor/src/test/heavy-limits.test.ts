import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CSV_MAX_ROWS, csvTooManyRows } from '@/lib/admin/csv'

/**
 * 重い処理の守りの棚卸し (2026-10-30・自主診断 ASVS 15.2.2・2.4.1)。
 *
 * 以前は、ログイン済みの人が BCP の ZIP・報告書の作り直し・月次の手動確定・CSV の取り込み・
 * 顔の照合・遠隔視聴のセッション・VOD の依頼・住所の座標を、回数の制限なく呼べた。
 * 外への fetch の多くにも時間切れが無く、相手が詰まると関数の上限まで待っていた。
 *
 * ここでは「どの受け口がどの上限を掛けているか」を表で固定し、外したら CI を落とす。
 * 値そのものは lib/limits/heavy.ts と docs/security-maintenance.md §3.2。
 */

const SRC = fileURLToPath(new URL('..', import.meta.url))
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8')

/** 受け口 → 掛けるべき上限の名前 */
const HEAVY_ROUTES: Record<string, string[]> = {
  'app/api/bcp/[id]/snapshots.zip/route.ts':   ['bcp-zip'],
  'app/api/bcp/[id]/generate-report/route.ts': ['bcp-report'],
  'app/api/admin/reports/monthly/route.ts':    ['monthly-finalize'],
  'app/api/admin/import/stores/route.ts':      ['csv-import'],
  'app/api/admin/import/cameras/route.ts':     ['csv-import'],
  'app/api/baggage/kiosk/face-auth/route.ts':  ['face-auth'],
  'app/api/video/sessions/route.ts':           ['video-session'],
  'app/api/vod/route.ts':                      ['vod-request'],
  'app/api/geocode/route.ts':                  ['geocode', 'nominatim'],
  'app/api/admin/geocode/route.ts':            ['geocode', 'nominatim'],
}

describe('重い処理の受け口は回数の上限を掛ける', () => {
  for (const [file, actions] of Object.entries(HEAVY_ROUTES)) {
    it(file, () => {
      const src = read(file)
      for (const a of actions) {
        expect(src, `${file} に heavyAllows(…, '${a}', …) が無い`).toMatch(
          new RegExp(`heavyAllows\\([\\s\\S]{0,80}?'${a}'`),
        )
      }
    })
  }
})

describe('BCP の ZIP は流しながら作る', () => {
  const src = read('app/api/bcp/[id]/snapshots.zip/route.ts')
  it('全部をメモリに置く作り (JSZip の generateAsync) を使わない', () => {
    expect(src).not.toMatch(/generateAsync|from 'jszip'/)
    expect(src).toMatch(/zipStream\(/)
  })
  it('画像を全部同時に取りに行かない (Promise.all で並べない)', () => {
    expect(src).not.toMatch(/Promise\.all\(clips/)
  })
  it('項目の数の上限と関数の時間の上限がある', () => {
    expect(src).toMatch(/ZIP_MAX_FILES/)
    expect(src).toMatch(/export const maxDuration/)
  })
})

describe('CSV の取り込みは行数に上限がある', () => {
  it('拠点 1,000 行・カメラ 5,000 行', () => {
    expect(CSV_MAX_ROWS).toEqual({ stores: 1000, cameras: 5000 })
    expect(read('app/api/admin/import/stores/route.ts')).toMatch(/CSV_MAX_ROWS\.stores/)
    expect(read('app/api/admin/import/cameras/route.ts')).toMatch(/CSV_MAX_ROWS\.cameras/)
  })
  it('超えたときの文は行数と上限を三桁区切りで出す', () => {
    const b = csvTooManyRows(1234, 1000)
    expect(b.error).toBe('too_many_rows')
    expect(b.message).toContain('1,000 行まで')
    expect(b.message).toContain('1,234 行')
  })
})

/**
 * サーバ側の fetch は時間切れ (signal) を持つ。
 * 画面 ('use client') と、ブラウザでだけ動く部品は除く。
 */
const BROWSER_ONLY = new Set([
  'lib/saveJpeg.ts',        // ブラウザで画像を保存する
  'lib/auth/post-json.ts',  // ログインまわりの画面から呼ぶ
  'lib/viewing-session.ts', // 視聴の画面から終わりを送る (keepalive)
])

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(e) && !/\.test\.tsx?$/.test(e)) out.push(p)
  }
  return out
}

describe('サーバ側の外への fetch は時間切れを持つ', () => {
  const files = [...walk(join(SRC, 'app/api')), ...walk(join(SRC, 'lib'))]
  const offenders: string[] = []
  for (const f of files) {
    const rel = relative(SRC, f)
    if (BROWSER_ONLY.has(rel)) continue
    const src = readFileSync(f, 'utf8')
    if (/^\s*['"]use client['"]/.test(src)) continue
    const lines = src.split('\n')
    lines.forEach((line, i) => {
      if (!/(^|[^.\w])fetch\(/.test(line)) return
      if (/^\s*(\/\/|\*)/.test(line)) return
      // 呼び出しの引数 (おおむね 20 行) の中に signal があるか
      const call = lines.slice(i, i + 20).join('\n')
      if (!/signal\s*[:,]|signal\s*}/.test(call)) offenders.push(`${rel}:${i + 1}`)
    })
  }
  it('signal の無い fetch が無い', () => {
    expect(offenders).toEqual([])
  })
})
