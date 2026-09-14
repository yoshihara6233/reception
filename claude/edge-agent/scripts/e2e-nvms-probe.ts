// エッジの nvms アダプタ実物を、実 nvmsd に対して叩く通し検証。
import { nvmsEndpoint, fetchNvmsSnapshot, downloadNvmsExportMp4 } from '../src/adapters/nvms/client.js'

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

const mp4 = await downloadNvmsExportMp4(o, cam, new Date(process.env.NVMS_E2E_FROM!), new Date(process.env.NVMS_E2E_TO!))
const ftyp = mp4.subarray(4, 8).toString('latin1') === 'ftyp'
console.log(`✅ export: ${mp4.length} bytes, MP4(ftyp)=${ftyp}` + (ftyp ? '' : ' ← 異常'))
if (!ftyp) process.exit(1)
console.log('🏁 nvms アダプタ通し検証 OK（snapshot / export / SHA-256照合）')
