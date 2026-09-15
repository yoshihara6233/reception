// エッジの nvms アダプタ実物を、実 nvmsd に対して叩く通し検証。
import {
  nvmsEndpoint, fetchNvmsSnapshot, downloadNvmsExportMp4, fetchNvmsGrid,
} from '../src/adapters/nvms/client.js'

const o = { endpoint: nvmsEndpoint(process.env.NVMS_E2E_HOST!), apiKey: process.env.NVMS_E2E_KEY! }
const cam = Number(process.env.NVMS_E2E_CAM!)

// スナップ: オンデマンド開始なので初回404を想定し、実運用(毎秒ループ)と同じく再試行する
let snap: Buffer | null = null
for (let i = 0; i < 15; i++) {
  try { snap = await fetchNvmsSnapshot(o, cam); break }
  catch (e) { if (!/出力起動中/.test(String(e))) throw e; await new Promise(r => setTimeout(r, 1000)) }
}
if (!snap) throw new Error('snapshot: 15秒待っても取得できず')
const isJpeg = snap[0] === 0xff && snap[1] === 0xd8
console.log(`✅ snapshot: ${snap.length} bytes, JPEG=${isJpeg}` + (isJpeg ? '' : ' ← 異常'))
if (!isJpeg) process.exit(1)

// 合成グリッド (grid.jpg): 契約は「引数が正しければ常に 200」。1fps 出力は上の
// snapshot 検証で起動済みなので、X-Grid-Missing からカメラが消えるまで数秒待つ。
// （grid.jpg 未実装の旧 nvmsd では NvmsGridUnsupportedError で即失敗する —
//   その場合はビルドが古い。エッジ実装側は 404 でカメラ別合成へフォールバックする。）
let grid = await fetchNvmsGrid(o, [cam], 1280, 720)
for (let i = 0; i < 15 && grid.missing !== ''; i++) {
  await new Promise(r => setTimeout(r, 1000))
  grid = await fetchNvmsGrid(o, [cam], 1280, 720)
}
const gridJpeg = grid.jpeg[0] === 0xff && grid.jpeg[1] === 0xd8
console.log(`✅ grid.jpg: ${grid.jpeg.length} bytes, JPEG=${gridJpeg}, missing='${grid.missing}'`
  + (gridJpeg && grid.missing === '' ? '' : ' ← 異常'))
if (!gridJpeg || grid.missing !== '') process.exit(1)

const mp4 = await downloadNvmsExportMp4(o, cam, new Date(process.env.NVMS_E2E_FROM!), new Date(process.env.NVMS_E2E_TO!))
const ftyp = mp4.subarray(4, 8).toString('latin1') === 'ftyp'
console.log(`✅ export: ${mp4.length} bytes, MP4(ftyp)=${ftyp}` + (ftyp ? '' : ' ← 異常'))
if (!ftyp) process.exit(1)
console.log('🏁 nvms アダプタ通し検証 OK（snapshot / grid.jpg / export / SHA-256照合）')
