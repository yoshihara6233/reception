/**
 * i-PRO NVR のカメラ接続情報（CGI-IF v1.5R1 §5.3 `as_getinfo.cgi?FILE=2`）。
 *
 * ## なぜ ONVIF ではないのか
 *
 * 管理画面の「ONVIF探索」は ONVIF `GetProfiles` を叩くが、**WJ-NU101 は ONVIF を
 * 提供していない**（2026-06-19 実機: `/onvif/device_service` は 404、RTSP 554 も閉）。
 * NVR 経由構成では探索が必ず失敗し、チャンネルを手で入力するしかなかった。
 * NVR が持つカメラ接続情報 CGI なら、実際に繋がっているチャンネルだけを列挙できる。
 *
 * 応答は `KEY=VALUE` の羅列で、カメラは `CAM_CONNECT_01CH=1`（1=接続 / 0=未接続）。
 * 実機(2026-08-06 NU101)で 01CH/02CH=1、他は 0 を確認。
 */
import { logger } from '../../logger.js'
import { parseDigestChallenge, buildHttpDigest } from '../onvif/onvif-soap-client'
import { iproNvrLogin, type IproNvrVodOptions } from './nvr-vod'

export interface IproNvrChannel {
  channel:   number
  connected: boolean
}

/** `CAM_CONNECT_<nn>CH=<0|1>` を抜き出してチャンネル昇順で返す（純粋関数）。 */
export function parseIproNvrChannels(body: string): IproNvrChannel[] {
  const out = new Map<number, boolean>()
  for (const m of body.matchAll(/CAM_CONNECT_(\d+)CH\s*=\s*(\d+)/gi)) {
    const ch = Number(m[1])
    if (!Number.isInteger(ch) || ch < 1) continue
    out.set(ch, m[2] !== '0')
  }
  return [...out.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([channel, connected]) => ({ channel, connected }))
}

function insecureFetch(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  return fetch(url, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
    tls: { rejectUnauthorized: false },      // NVR は自己署名 HTTPS
  } as unknown as RequestInit)
}

async function digestGetText(url: string, user: string, pass: string, timeoutMs: number): Promise<string> {
  const r1 = await insecureFetch(url, { method: 'GET' }, timeoutMs)
  if (r1.status !== 401) {
    if (!r1.ok) throw new Error(`HTTP ${r1.status}`)
    return r1.text()
  }
  const ch = parseDigestChallenge(r1.headers.get('www-authenticate') ?? '')
  const r2 = await insecureFetch(url, {
    method: 'GET',
    headers: { Authorization: buildHttpDigest('GET', url, user, pass, ch) },
  }, timeoutMs)
  if (!r2.ok) throw new Error(`HTTP ${r2.status}`)
  return r2.text()
}

/**
 * NVR 配下のカメラチャンネルを列挙する。
 *
 * まず UID 無しで問い合わせ、チャンネルが1つも読めなければセッションを張って再試行する
 * （機種/FW によって UID 必須かが変わるため。無駄なログインを常態化させない）。
 */
export async function fetchIproNvrChannels(opts: IproNvrVodOptions): Promise<IproNvrChannel[]> {
  const timeoutMs = opts.timeoutMs ?? 10_000
  const url = `${opts.endpoint}/cgi-bin/as_getinfo.cgi?FILE=2`

  const first = await digestGetText(url, opts.username, opts.password, timeoutMs).catch((e) => {
    logger.debug({ err: String(e) }, 'i-pro-nvr: as_getinfo without UID failed')
    return ''
  })
  const parsed = parseIproNvrChannels(first)
  if (parsed.length > 0) return parsed

  const uid = await iproNvrLogin(opts)
  try {
    return parseIproNvrChannels(await digestGetText(`${url}&UID=${uid}`, opts.username, opts.password, timeoutMs))
  } finally {
    await digestGetText(`${opts.endpoint}/cgi-bin/logout.cgi?UID=${uid}`, opts.username, opts.password, 5_000)
      .catch(() => undefined)
  }
}
