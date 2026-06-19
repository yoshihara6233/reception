/**
 * i-PRO WJ-NU 実機スパイク検証ハーネス
 * ──────────────────────────────────────────────────────────────────────────
 * 目的: WJ-NU101K（4ch小型NVR）実機に対し、**既存アダプタのコードがそのまま通るか**
 *       を疎通→スナップ→ライブ→VOD の順で実測し、GA日程の go/no-go 判定材料を出す。
 *       （docs/release-plan-v1-ga.md の Phase A / G1 判定点）
 *
 * 設計方針: 並行実装はせず、本番と同じ registry → createIProNuAdapter を叩く。
 *           つまり「ここで緑なら本番コードも緑」になる検証。
 *
 * 実行:
 *   IPRO_ENDPOINT=http://192.168.x.x \
 *   IPRO_USER=admin IPRO_PASS=xxxx \
 *   [IPRO_VENDOR=i-pro-nu] [IPRO_RTSP_PORT=554] [IPRO_VOD_MINUTES=5] \
 *   bun run spike:ipro-nu
 *
 *   - IPRO_VOD_MINUTES: 「今から N 分前〜1分前」の録画を VOD 取得して試す（既定 5）
 *   - ffprobe があれば RTSP / VOD を自動プローブ（無くてもURL/ファイルは出力する）
 *
 * 出力: ./spike-out/ipro-nu-<ts>/ に snapshot JPEG・VOD mp4・report.json を保存。
 */
import { mkdirSync, writeFileSync, createWriteStream, statSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { pipeline } from 'node:stream/promises'
import { getAdapter } from '../adapters/_registry'
import type { NvrAdapter, NvrAdapterConfig, NvrChannel } from '@intereco/shared/nvr-adapter'

// ── 設定読み込み ──────────────────────────────────────────────────────────────
const endpoint = process.env.IPRO_ENDPOINT
const username = process.env.IPRO_USER
const password = process.env.IPRO_PASS
const vendor = (process.env.IPRO_VENDOR ?? 'i-pro-nu') as NvrAdapterConfig['vendor']
const rtspPort = Number(process.env.IPRO_RTSP_PORT ?? 554)
const vodMinutes = Number(process.env.IPRO_VOD_MINUTES ?? 5)

if (!endpoint || !username || !password) {
  console.error(
    'ERROR: IPRO_ENDPOINT / IPRO_USER / IPRO_PASS は必須です。\n' +
    '例: IPRO_ENDPOINT=http://192.168.1.50 IPRO_USER=admin IPRO_PASS=*** bun run spike:ipro-nu',
  )
  process.exit(2)
}

const ts = new Date().toISOString().replace(/[:.]/g, '-')
const outDir = join(process.cwd(), 'spike-out', `ipro-nu-${ts}`)
mkdirSync(outDir, { recursive: true })

type StepResult = {
  step: string
  ok: boolean
  ms: number
  detail?: unknown
  error?: string
}
const results: StepResult[] = []

function redactEndpoint(s: string): string {
  // ログにIPは残すが資格情報は出さない（このスクリプトはURLに資格を埋めない）
  return s
}

function hasFfprobe(): boolean {
  try {
    return spawnSync('ffprobe', ['-version'], { timeout: 5000 }).status === 0
  } catch {
    return false
  }
}
const ffprobeAvailable = hasFfprobe()

async function step<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
  const t0 = Date.now()
  process.stdout.write(`▶ ${name} ... `)
  try {
    const out = await fn()
    const ms = Date.now() - t0
    results.push({ step: name, ok: true, ms, detail: summarize(out) })
    console.log(`✅ (${ms}ms)`)
    return out
  } catch (e) {
    const ms = Date.now() - t0
    const err = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
    results.push({ step: name, ok: false, ms, error: err })
    console.log(`❌ (${ms}ms) ${err}`)
    return undefined
  }
}

// 出力をJSONに残せる形へ（Buffer/Stream等は要約）
function summarize(v: unknown): unknown {
  if (Buffer.isBuffer(v)) return { type: 'Buffer', bytes: v.length }
  return v
}

function isJpeg(buf: Buffer): boolean {
  return buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[buf.length - 2] === 0xff && buf[buf.length - 1] === 0xd9
}
function isMp4(buf: Buffer): boolean {
  // ftyp box は先頭8バイト目あたりに 'ftyp'
  const head = buf.subarray(0, 16).toString('latin1')
  return head.includes('ftyp') || head.includes('moov') || head.includes('mdat')
}

function ffprobeUri(uri: string): unknown {
  if (!ffprobeAvailable) return { skipped: 'ffprobe not installed' }
  const r = spawnSync('ffprobe', [
    '-v', 'error', '-print_format', 'json', '-show_streams', '-show_format',
    '-rtsp_transport', 'tcp', '-timeout', '5000000', uri,
  ], { timeout: 20000, encoding: 'utf8' })
  if (r.status !== 0) return { ffprobe_status: r.status, stderr: (r.stderr || '').slice(0, 500) }
  try {
    const j = JSON.parse(r.stdout)
    const v = (j.streams ?? []).find((s: { codec_type?: string }) => s.codec_type === 'video')
    return { codec: v?.codec_name, width: v?.width, height: v?.height, format: j.format?.format_name }
  } catch {
    return { ffprobe_raw: (r.stdout || '').slice(0, 300) }
  }
}

async function main() {
  console.log('═'.repeat(70))
  console.log(`i-PRO WJ-NU 実機スパイク  endpoint=${redactEndpoint(endpoint!)}  vendor=${vendor}`)
  console.log(`ffprobe: ${ffprobeAvailable ? 'あり（RTSP/VOD自動プローブ実施）' : 'なし（URL/ファイル出力のみ）'}`)
  console.log(`出力先: ${outDir}`)
  console.log('═'.repeat(70))

  const config: NvrAdapterConfig = {
    storeId: 'spike',
    vendor,
    endpoint: endpoint!,
    credentials: { username: username!, password: password! },
    options: { rtsp_port: rtspPort },
    timeoutMs: 10000,
  }

  // S1: 疎通＋認証＋ファームウェア判定（createIProNuAdapter が内部で detectIProFirmware を呼ぶ）
  const adapter = await step('S1 接続・認証・FW世代判定 (createIProNuAdapter)', async () => {
    const a = await getAdapter(vendor, config)
    return a
  }) as NvrAdapter | undefined

  if (!adapter) {
    console.log('\n⛔ S1 失敗。疎通/認証/FW検出が通らないため後続を中止します。')
    console.log('   確認: endpoint(スキーム+IP)・ID/PW(digest)・到達性(同一網/ルーティング)・機種が WJ-NU 系か。')
    return finish(false)
  }

  // capabilities（matrix が実機にどう答えたか）
  results.push({ step: 'S1.caps capability-matrix 値', ok: true, ms: 0, detail: adapter.capabilities })
  console.log('  capabilities:', JSON.stringify({
    maxChannels: adapter.capabilities.maxChannels,
    supportsVod: adapter.capabilities.supportsVod,
    vodFormats: adapter.capabilities.vodFormats,
    supportsSnapshot: adapter.capabilities.supportsSnapshot,
    supportsLiveRtsp: adapter.capabilities.supportsLiveRtsp,
    protocol: adapter.capabilities.protocol,
  }))

  // S2: testConnection
  await step('S2 testConnection()', () => adapter.testConnection())

  // S3: チャンネル一覧
  const channels = (await step('S3 getChannelList()', () => adapter.getChannelList())) as NvrChannel[] | undefined
  const targets = (channels ?? []).filter((c) => c.enabled).slice(0, 4)
  if (channels) console.log('  channels:', channels.map((c) => `#${c.index}:${c.name}${c.enabled ? '' : '(off)'}`).join(' '))
  // チャンネルが取れない場合でも ch1 で続行できるようフォールバック
  const probeChannels = targets.length ? targets.map((c) => c.index) : [1]

  // S4: スナップショット（グリッドの土台）
  for (const ch of probeChannels) {
    await step(`S4 getSnapshot(ch=${ch})`, async () => {
      const buf = await adapter.getSnapshot(ch)
      const file = join(outDir, `snapshot-ch${ch}.jpg`)
      writeFileSync(file, buf)
      return { bytes: buf.length, jpeg: isJpeg(buf), file }
    })
  }

  // S5: ライブ RTSP（URL生成 + 任意でffprobe）
  for (const ch of probeChannels) {
    await step(`S5 getLiveRtspUri(ch=${ch})`, async () => {
      const uri = await adapter.getLiveRtspUri(ch, 'main')
      const probe = ffprobeUri(uri)
      // 資格情報入りURLはreportに残さない（マスク）
      const masked = uri.replace(/\/\/[^@]+@/, '//<creds>@')
      return { uri: masked, probe }
    })
  }

  // S6: VOD（本命の賭け）— 「N分前〜1分前」を mp4 取得
  const now = Date.now()
  const from = new Date(now - vodMinutes * 60_000)
  const to = new Date(now - 1 * 60_000)
  for (const ch of probeChannels.slice(0, 1)) { // まず1chで成否を見る
    await step(`S6 getVodMp4(ch=${ch}, ${from.toISOString()} → ${to.toISOString()})`, async () => {
      if (typeof adapter.getVodMp4 !== 'function') {
        throw new Error('adapter.getVodMp4 が未定義（capability上 VOD非対応）')
      }
      const stream = await adapter.getVodMp4(ch, from, to)
      const file = join(outDir, `vod-ch${ch}.mp4`)
      await pipeline(stream, createWriteStream(file))
      const bytes = statSync(file).size
      // 先頭16バイトでmp4判定
      const head = Buffer.alloc(16)
      const fd = await import('node:fs/promises').then((m) => m.open(file, 'r'))
      await fd.read(head, 0, 16, 0)
      await fd.close()
      const probe = ffprobeUri(file)
      return { bytes, looksMp4: isMp4(head), file, probe }
    })
  }

  await adapter.dispose?.()
  finish(true)
}

function finish(reachedAdapter: boolean) {
  const reportFile = join(outDir, 'report.json')
  const summary = {
    when: ts,
    endpoint: redactEndpoint(endpoint!),
    vendor,
    ffprobeAvailable,
    reachedAdapter,
    results,
  }
  writeFileSync(reportFile, JSON.stringify(summary, null, 2))

  console.log('\n' + '═'.repeat(70))
  console.log('スパイク結果サマリ')
  console.log('═'.repeat(70))
  for (const r of results) {
    if (r.step.endsWith('caps capability-matrix 値')) continue
    console.log(`${r.ok ? '✅' : '❌'} ${r.step}  (${r.ms}ms)${r.error ? '  ' + r.error : ''}`)
  }

  // go/no-go の機械判定
  const vodStep = results.find((r) => r.step.startsWith('S6'))
  const snapStep = results.find((r) => r.step.startsWith('S4'))
  const liveStep = results.find((r) => r.step.startsWith('S5'))
  console.log('\n── GA判定の素材 ──')
  console.log(`接続/認証(S1): ${results.find((r) => r.step.startsWith('S1 '))?.ok ? 'OK' : 'NG'}`)
  console.log(`スナップ(S4): ${snapStep?.ok ? 'OK = グリッド結線可' : 'NG'}`)
  console.log(`ライブ(S5):   ${liveStep?.ok ? 'OK = 監視ライブ可' : 'NG'}`)
  console.log(`VOD(S6):      ${vodStep?.ok ? 'OK = CGI playback で10月GA維持の根拠' : 'NG = ONVIF Profile-G 切替を検討（GA日程再評価）'}`)
  console.log(`\nレポート: ${reportFile}`)

  process.exit(results.some((r) => !r.ok) ? 1 : 0)
}

main().catch((e) => {
  console.error('FATAL', e)
  process.exit(1)
})
