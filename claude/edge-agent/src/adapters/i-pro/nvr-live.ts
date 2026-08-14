/**
 * i-PRO NVR 経由のライブ1コマ取得（`push.cgi COMP=H265|H264`）。**永続ストリーム方式**。
 *
 * ## なぜ JPEG をやめたか（2026-08-06 実機 NU101）
 *
 * 当初は `COMP=JPEG` で MJPEG を受けていたが、**JPEG 配信を持たないカメラに対して
 * NVR が 39×37 のプレースホルダ画像を HTTP 200 で返す**ことが判明した。16分割グリッドに
 * 黒コマが並ぶだけで、エラーにもならない。カメラ側で JPEG 配信を有効化して回る運用は
 * 100 店舗規模で成立しないため、**H.265/H.264 を受けてエッジでデコードする**方式に変更。
 * カメラの配信設定に一切依存しない。実機で 1920×1080 のデコードを確認済み。
 *
 * ## 構成
 *
 * - push.cgi は「開きっぱなしのストリーム」。毎フレーム START/STOP するとセッションが
 *   飽和し START が 204(空) になる(churn)。→ カメラ(endpoint+channel)ごとに1本だけ開いて
 *   常時受信し、直近のキーフレームをメモリに保持。grid/live の要求で JPEG 化して返す。
 * - UID は NVR 単位で共有（同時16セッション制限）。status.cgi でキープアライブ。
 *   一定時間要求が無ければ自動停止して NVR セッションを解放。
 * - コーデックは受信 RTP のペイロードタイプ(98=H.264/101=H.265)で判定する。要求 COMP は
 *   H265 から試し、フレームが来なければ H264 に切り替えてチャンネル単位で記憶する。
 */
import { logger } from '../../logger.js'
import { config } from '../../config.js'
import { parseDigestChallenge, buildHttpDigest } from '../onvif/onvif-soap-client'
import { iproNvrLogin, type IproNvrVodOptions } from './nvr-vod'
import {
  KeyframeAssembler,
  NalReassembler,
  codecForPayloadType,
  extractMultipartParts,
  parseRtpPacket,
  type Codec,
} from './nvr-rtp.js'
import { decodeAnnexBToJpeg } from '../../util/decode-frame.js'
import { assertUsableJpeg } from '../../util/jpeg.js'

export type IproNvrLiveOptions = IproNvrVodOptions

const IDLE_MS      = 30_000   // この時間 grid 要求が無ければストリーム停止
const KEEPALIVE_MS = 60_000   // status.cgi keepalive 間隔(<90秒)
const FIRST_FRAME_WAIT_MS = 12_000
/** この時間キーフレームが来なければ COMP を切り替えて再接続する。 */
const CODEC_PROBE_MS = 8_000
/** ヘッダが返るまでの制限。**本体の寿命ではない**（混同すると 10 秒で切れる）。 */
const CONNECT_TIMEOUT_MS = 10_000
/** 一度流れ始めたストリームが、この時間まったく無音なら切って繋ぎ直す。 */
const STALL_MS = 15_000
/** 生きているストリームの実測（bytes/packets/キーフレーム間隔）を出す間隔。 */
const SUMMARY_MS = 60_000
/** 受信バッファがこれを超えたら同期が壊れたとみなして捨てる。 */
const MAX_ACC_BYTES = 8_000_000

type Comp = 'H265' | 'H264'
const COMP_FOR: Record<Codec, Comp> = { h265: 'H265', h264: 'H264' }

/**
 * カメラごとに「実際に流れてきたコーデック」を覚えておく（プロセスが生きている間）。
 *
 * ストリーマは 30 秒アイドルで破棄されるので、覚えないとグリッドを開き直すたびに
 * H265 から探り直す。H265 を配信していないカメラでは**毎回きっちり外れる**ので、
 * 実機で 14 秒（失敗3回 + 探索待ち 12 秒）を払っていた。その間そのコマは前の絵のまま。
 *
 * ⚠ 記録するのは **実際に PT を受け取ったとき**だけ。COMP 切替は当たるか分からない
 *   推測なので、覚えると外れた推測が次回に持ち越される。
 */
const COMP_MEMO = new Map<string, Comp>()

/** 前回このカメラで実際に流れたコーデック。無ければ H265 から試す。 */
export function initialComp(key: string): Comp {
  return COMP_MEMO.get(key) ?? 'H265'
}

/**
 * 実際に受信できたコーデックを採用する。**次のストリーマへの引き継ぎとセット**に
 * してあるのは、片方だけ書いて探索が復活する事故を防ぐため。
 */
export function adoptCodec(s: { comp: Comp }, key: string, codec: Codec): void {
  s.comp = COMP_FOR[codec]
  COMP_MEMO.set(key, s.comp)
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function insecureFetch(url: string, init: RequestInit, signal: AbortSignal): Promise<Response> {
  return fetch(url, { ...init, signal, tls: { rejectUnauthorized: false } } as unknown as RequestInit)
}

async function digestGet(url: string, user: string, pass: string, timeoutMs: number): Promise<Response> {
  const r1 = await insecureFetch(url, { method: 'GET' }, AbortSignal.timeout(timeoutMs))
  if (r1.status !== 401) return r1
  const ch = parseDigestChallenge(r1.headers.get('www-authenticate') ?? '')
  return insecureFetch(url, { method: 'GET', headers: { Authorization: buildHttpDigest('GET', url, user, pass, ch) } }, AbortSignal.timeout(timeoutMs))
}

/**
 * 接続だけに時間制限を掛けた fetch。**本体の寿命は外部 signal だけで決まる。**
 *
 * `AbortSignal.timeout()` を直接渡してはいけない。あれは**本体の受信中も動き続ける**
 * ので、開きっぱなしのストリームがその時間で必ず切れる（2026-08-14 の実障害）。
 * ここではヘッダが返った時点（fetch が解決した時点）でタイマーを止め、以後は
 * 呼び出し側の signal だけが本体を切れるようにする。
 */
export function fetchStreamWithConnectTimeout(
  url: string, init: RequestInit, signal: AbortSignal, connectMs: number,
): Promise<Response> {
  const ctl = new AbortController()
  // 外部 signal は**本体を読んでいる間もずっと**中継し続ける（ここで外さない）。
  if (signal.aborted) ctl.abort(signal.reason)
  else signal.addEventListener('abort', () => ctl.abort(signal.reason), { once: true })
  const timer = setTimeout(
    () => ctl.abort(new DOMException('connect timed out', 'TimeoutError')),
    connectMs,
  )
  return insecureFetch(url, init, ctl.signal).finally(() => clearTimeout(timer))
}

/** Digest GET（ストリーミング・本体は呼び出し側で読む）。abort は外部 signal。 */
async function digestGetStream(url: string, user: string, pass: string, signal: AbortSignal): Promise<Response> {
  // ⚠ NVR は `UID=` 付きの要求に digest を要求せず **いきなり 200 を返す**ので、
  //   401 分岐は通らない。つまりこの1本目の応答がそのままストリーム本体になる。
  const r1 = await fetchStreamWithConnectTimeout(url, { method: 'GET' }, signal, CONNECT_TIMEOUT_MS)
  if (r1.status !== 401) return r1
  const ch = parseDigestChallenge(r1.headers.get('www-authenticate') ?? '')
  return fetchStreamWithConnectTimeout(
    url,
    { method: 'GET', headers: { Authorization: buildHttpDigest('GET', url, user, pass, ch) } },
    signal,
    CONNECT_TIMEOUT_MS,
  )
}

/** NVR のホスト(IP or URL)から HTTPS エンドポイントを組む。NVR は自己署名 HTTPS。 */
export function buildIproNvrEndpoint(host: string, port: number | null): string {
  if (/^https?:\/\//i.test(host)) return host.replace(/\/+$/, '')
  return `https://${host}:${port ?? 443}`
}

interface Streamer {
  assembler:  KeyframeAssembler | null
  /** 直近デコード済み JPEG と、その元になったキーフレームの受信時刻。 */
  jpeg:       Buffer | null
  jpegKeyAt:  number
  decoding:   Promise<void> | null
  comp:       Comp
  lastReqAt:  number
  stopped:    boolean
}
const STREAMERS = new Map<string, Streamer>()

function keyOf(endpoint: string, channel: number): string {
  return `${endpoint}|${channel}`
}

// ── 共有UID管理 (NVR 1台 = 1 UID を全カメラで共有。UID上限16/503対策) ──
interface UidState {
  uid:     string | null
  pending: Promise<string> | null
  ka:      ReturnType<typeof setInterval> | null
  refs:    number
}
const UID_STATE = new Map<string, UidState>()

/** 参照を1つ確保 (ストリーマ開始時に1回)。 */
function retainNvr(opts: IproNvrLiveOptions): void {
  let st = UID_STATE.get(opts.endpoint)
  if (!st) { st = { uid: null, pending: null, ka: null, refs: 0 }; UID_STATE.set(opts.endpoint, st) }
  st.refs++
}

/** 共有UIDを取得 (無ければ1回だけログイン。並行呼び出しは同じログインを待つ)。ref は変えない。 */
async function getNvrUid(opts: IproNvrLiveOptions): Promise<string> {
  const st = UID_STATE.get(opts.endpoint)
  if (!st) throw new Error('i-pro-nvr: uid state missing (retain not called)')
  if (st.uid) return st.uid
  if (!st.pending) {
    st.pending = (async () => {
      const uid = await iproNvrLogin(opts)
      st.uid = uid
      if (!st.ka) {
        st.ka = setInterval(() => {
          if (st.uid) digestGet(`${opts.endpoint}/cgi-bin/status.cgi?UID=${st.uid}&PC=AS60`, opts.username, opts.password, 8_000).catch(() => undefined)
        }, KEEPALIVE_MS)
      }
      return uid
    })()
    st.pending.finally(() => { st.pending = null }).catch(() => undefined)
  }
  return st.pending
}

/** UID が失効(401/503等)した時に破棄。次の getNvrUid で再ログイン。 */
function invalidateUid(endpoint: string): void {
  const st = UID_STATE.get(endpoint)
  if (st) st.uid = null
}

/** 参照を1つ手放す。0になったら keepalive 停止＋logout。 */
function releaseNvr(opts: IproNvrLiveOptions): void {
  const st = UID_STATE.get(opts.endpoint)
  if (!st) return
  st.refs = Math.max(0, st.refs - 1)
  if (st.refs === 0) {
    if (st.ka) clearInterval(st.ka)
    const uid = st.uid
    UID_STATE.delete(opts.endpoint)
    if (uid) digestGet(`${opts.endpoint}/cgi-bin/logout.cgi?UID=${uid}`, opts.username, opts.password, 5_000).catch(() => undefined)
  }
}

/** push.cgi を常時受信し、直近キーフレームを s.assembler に反映し続ける（共有UID・自己再接続）。 */
async function runStreamLoop(opts: IproNvrLiveOptions, channel: number, s: Streamer, key: string): Promise<void> {
  let backoff = 2_000
  let failedProbes = 0
  retainNvr(opts)   // 共有UIDの参照を1つ確保 (このストリーマの生存中)
  while (!s.stopped && STREAMERS.get(key) === s) {
    if (Date.now() - s.lastReqAt > IDLE_MS) break   // アイドル停止
    const ctrl = new AbortController()
    const comp = s.comp
    let sawKeyframe = false
    let codecDetected = false
    let stalled = false
    let lastDataAt = Date.now()
    const connectedAt = Date.now()
    // 番犬。`read()` は永久にブロックしうる（NVR が接続だけ受けて何も流さない）ので、
    // ループ内の時刻比較では届かず、外から abort するしかない。3つを見る:
    //   ① COMP 違い     … 既知の PT が1つも来ない → COMP を替えて繋ぎ直す
    //   ② 途中で無音     … 流れていたのに STALL_MS 何も来ない → 繋ぎ直す
    //   ③ アイドル/停止  … 誰も見ていない・停止要求
    // ②が要るのは、接続に時間制限を掛けられないため（掛けると開きっぱなしの
    // ストリームがその時間で必ず切れる。2026-08-14 の実障害）。
    let switchCodec = false
    const watchdog = setInterval(() => {
      const now = Date.now()
      if (s.stopped || STREAMERS.get(key) !== s || now - s.lastReqAt > IDLE_MS) { ctrl.abort(); return }
      if (!codecDetected && !sawKeyframe) {
        if (now - connectedAt > CODEC_PROBE_MS) { switchCodec = true; ctrl.abort() }
        return
      }
      if (now - lastDataAt > STALL_MS) { stalled = true; ctrl.abort() }
    }, 1_000)
    try {
      const uid = await getNvrUid(opts)   // NVR共有UID (全カメラで1つ)
      await digestGet(`${opts.endpoint}/cgi-bin/hdrctl.cgi?UID=${uid}&SCREEN=1X&PC=AS60`, opts.username, opts.password, 8_000).catch(() => undefined)

      const url = `${opts.endpoint}/cgi-bin/push.cgi?UID=${uid}&CAM=${channel}&CMD=START&COMP=${comp}&INTERNETMODE=ON`
      const res = await digestGetStream(url, opts.username, opts.password, ctrl.signal)
      if (res.status === 401) { invalidateUid(opts.endpoint); throw new Error('push.cgi 401 (UID失効)') }
      if (!res.ok || !res.body) throw new Error(`push.cgi HTTP ${res.status}`)
      logger.info({ key, comp, status: res.status, ct: res.headers.get('content-type') }, 'i-pro-nvr: push connected')

      const reader = res.body.getReader()
      let acc: Buffer = Buffer.alloc(0)
      let bytes = 0
      let packets = 0
      let lastSeq: number | null = null
      let reassembler: NalReassembler | null = null
      const startedAt = Date.now()
      let lastSummaryAt = Date.now()

      for (;;) {
        if (s.stopped || STREAMERS.get(key) !== s || Date.now() - s.lastReqAt > IDLE_MS) { ctrl.abort(); break }
        const { done, value } = await reader.read()
        if (done) break
        if (value) {
          bytes += value.byteLength
          lastDataAt = Date.now()   // 無音判定の基準（番犬②）
          acc = Buffer.concat([acc, Buffer.from(new Uint8Array(value))])
        }
        const { parts, rest } = extractMultipartParts(acc)
        acc = rest.length > MAX_ACC_BYTES ? Buffer.alloc(0) : rest

        for (const part of parts) {
          const rtp = parseRtpPacket(part.body)
          if (!rtp) continue
          const codec = codecForPayloadType(rtp.payloadType)
          if (!codec) continue
          packets++
          codecDetected = true
          if (!s.assembler || s.assembler.codecName !== codec) {
            s.assembler = new KeyframeAssembler(codec)
            reassembler = new NalReassembler(codec)
            adoptCodec(s, key, codec)   // 今回も次のストリーマも、このコーデックで要求する
            logger.info({ key, codec, pt: rtp.payloadType }, 'i-pro-nvr: codec detected')
          }
          if (!reassembler) reassembler = new NalReassembler(codec)
          // シーケンス不連続＝欠落。組み立て中の FU を捨てて壊れた NAL を出さない。
          if (lastSeq !== null && ((lastSeq + 1) & 0xffff) !== rtp.sequence) reassembler.reset()
          lastSeq = rtp.sequence
          for (const nal of reassembler.push(rtp.payload)) s.assembler.push(nal)
        }

        // ⚠ `packets > 0` が要る。`s.assembler` は**再接続をまたいで残る**ので、
        //   前の接続のキーフレームで ready のまま新しい接続の最初の1チャンクを読むと、
        //   受信ゼロなのに「キーフレームが来た」と誤判定して番犬を解除してしまう
        //   （実機で `bytes: 14 / elapsedMs: 0` として出ていた。2026-08-14）。
        if (!sawKeyframe && packets > 0 && s.assembler?.ready) {
          sawKeyframe = true
          // 番犬は止めない。ここから先は「途中で無音になっていないか」を見続ける。
          logger.info(
            { key, codec: s.assembler.codecName, bytes, elapsedMs: Date.now() - startedAt },
            'i-pro-nvr: first keyframe assembled',
          )
        }

        // 定期サマリ。**接続が切れなくなった副作用で `push loop ended` がほぼ出なくなり、
        // bytes/packets/keyframeIntervalMs を見る場所が消えた**ので、生きている側から出す。
        // `keyframeIntervalMs` は grid の更新間隔の下限（キーフレームしかデコードしない）
        // ＝ NVR/カメラのリフレッシュ間隔の実測値になる。
        if (Date.now() - lastSummaryAt >= SUMMARY_MS) {
          lastSummaryAt = Date.now()
          logger.info(
            {
              key, comp,
              uptimeMs: Date.now() - startedAt, bytes, packets,
              keyframeIntervalMs: s.assembler?.keyframeIntervalMs ?? 0,
            },
            'i-pro-nvr: stream alive',
          )
        }
      }
      logger.info(
        { key, comp, bytes, packets, keyframeIntervalMs: s.assembler?.keyframeIntervalMs ?? 0 },
        'i-pro-nvr: push loop ended',
      )
      const cur = UID_STATE.get(opts.endpoint)?.uid
      if (cur) digestGet(`${opts.endpoint}/cgi-bin/push.cgi?UID=${cur}&CAM=${channel}&CMD=STOP&COMP=${comp}`, opts.username, opts.password, 5_000).catch(() => undefined)
      backoff = 2_000
    } catch (e) {
      // 番犬による abort は「異常」ではなく想定内の切り替え／繋ぎ直し。
      if (switchCodec) {
        /* COMP を替えて即再接続（finally で切替） */
      } else if (stalled) {
        // NVR が黙っただけ。ここで指数バックオフに入れると、画が止まったまま
        // 最大 20 秒待つことになる（利用者にはフリーズに見える）。短く繋ぎ直す。
        logger.warn({ key, comp, silentMs: STALL_MS }, 'i-pro-nvr: stream went silent; reconnecting')
        await sleep(2_000)
        backoff = 2_000
      } else {
        const msg = String(e)
        if (/HTTP 503/.test(msg)) invalidateUid(opts.endpoint)   // UID上限等 → 取り直し
        logger.warn({ key, comp, err: msg }, 'i-pro-nvr: stream error; will reconnect')
        await sleep(backoff)
        backoff = Math.min(backoff * 2, 20_000)
      }
    } finally {
      clearInterval(watchdog)
      ctrl.abort()
      if (switchCodec) {
        s.comp = comp === 'H265' ? 'H264' : 'H265'
        failedProbes++
        logger.warn({ key, from: comp, to: s.comp, failedProbes }, 'i-pro-nvr: no video; switching codec')
        // 両方試して駄目なら、そのカメラは配信していない。NVR を叩き続けない。
        if (failedProbes >= 2) { await sleep(backoff); backoff = Math.min(backoff * 2, 20_000) }
      } else if (sawKeyframe) {
        failedProbes = 0
      }
    }
  }
  STREAMERS.delete(key)
  releaseNvr(opts)   // 参照を返す (0なら logout)
  logger.info({ key }, 'i-pro-nvr: stream stopped')
}

function ensureStreamer(opts: IproNvrLiveOptions, channel: number): Streamer {
  const key = keyOf(opts.endpoint, channel)
  let s = STREAMERS.get(key)
  if (s) { s.lastReqAt = Date.now(); return s }
  s = { assembler: null, jpeg: null, jpegKeyAt: 0, decoding: null, comp: initialComp(key), lastReqAt: Date.now(), stopped: false }
  STREAMERS.set(key, s)
  void runStreamLoop(opts, channel, s, key)
  logger.info({ key }, 'i-pro-nvr: stream started')
  return s
}

/**
 * 直近キーフレームを JPEG 化して返す。同じキーフレームなら再デコードせずキャッシュを返す
 * （16ch × 数秒間隔でも iGPU を焼かないための要）。並行要求は1回のデコードに相乗りする。
 */
async function currentJpeg(s: Streamer, key: string): Promise<Buffer> {
  const asm = s.assembler
  if (!asm?.ready) throw new Error('i-pro-nvr: keyframe not ready')
  if (s.jpeg && s.jpegKeyAt === asm.keyframeAt) return s.jpeg

  let inflight = s.decoding
  if (!inflight) {
    const es = asm.snapshot()!
    const at = asm.keyframeAt
    const codec = asm.codecName
    inflight = (async () => {
      const jpeg = await decodeAnnexBToJpeg(es, codec, config.FFMPEG_BIN)
      assertUsableJpeg(jpeg, `i-pro-nvr(${key})`)
      s.jpeg = jpeg
      s.jpegKeyAt = at
    })()
    s.decoding = inflight
    // 失敗しても次の要求で再挑戦できるよう、必ず解放する。
    inflight.catch(() => undefined).finally(() => { if (s.decoding === inflight) s.decoding = null })
  }
  await inflight
  if (!s.jpeg) throw new Error('i-pro-nvr: decode produced no frame')
  return s.jpeg
}

/**
 * NVR から指定チャンネルのライブ画像を JPEG で1枚返す。
 * 初回はキーフレーム到着まで最大 FIRST_FRAME_WAIT_MS 待つ。
 */
export async function captureIproNvrJpeg(opts: IproNvrLiveOptions, channel: number): Promise<Buffer> {
  const key = keyOf(opts.endpoint, channel)
  const s = ensureStreamer(opts, channel)
  if (s.assembler?.ready) return currentJpeg(s, key)

  const deadline = Date.now() + FIRST_FRAME_WAIT_MS
  while (Date.now() < deadline) {
    await sleep(200)
    s.lastReqAt = Date.now()          // 待っている間にアイドル停止させない
    if (s.assembler?.ready) return currentJpeg(s, key)
  }
  logger.warn({ ch: channel, key, comp: s.comp, waitedMs: FIRST_FRAME_WAIT_MS }, 'i-pro-nvr: no keyframe yet')
  throw new Error(`i-pro-nvr: no keyframe yet (ch=${channel})`)
}

/** テスト・接続テスト用に、開いているストリームを全て止める。 */
export function stopAllIproNvrStreams(): void {
  for (const s of STREAMERS.values()) s.stopped = true
}
