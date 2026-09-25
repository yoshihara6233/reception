'use client'

/**
 * 遠隔視聴のセッションを開いて、再生できるようになるまでを見張る（GVMS_CLOUD_SPEC §5.1・§5.2.2）。
 *
 *   1. POST /api/video/sessions でセッションを開く
 *   2. GET /api/video/sessions/<id> を 1 秒ごとに見て、プレイリストが届く（ready）のを待つ。
 *      **hls.js は 404 を取り直さない**ので、届く前に再生を始めない
 *   3. 再生中も 10 秒ごとに GET する。これが画面の生存の合図で、途切れるとクラウドは
 *      拠点へ stop_video を渡す（閉じたのに送り続けさせない）
 *   4. 画面を閉じたら DELETE（ページを離れるときも keepalive で送る）
 *
 * SFU（§5.4）は、拠点が部屋へ送り始めたら ready になり、購読専用のトークン（livekit）が届く。
 * 映像は LiveKit へつなぐ側（live-remote-sfu-mode.tsx）が受ける。見張りと停止はここで共通。
 *
 * 失敗は §5.1 の値で返す。busy / bandwidth / codec_unsupported は fallback=true で、
 * 呼び出し側が静止画ライブへ戻す。
 */
import { useEffect, useState } from 'react'
import { VIEWER_KEEPALIVE_MS, shouldFallbackToJpeg, type VideoState } from '@/lib/video/session-logic'

export interface RemoteVideoRequest {
  cameraId: string
  kind: 'hls_live' | 'hls_vod' | 'sfu'
  from?: string
  to?: string
}

export type RemotePhase = 'starting' | 'playing' | 'ended' | 'failed'

export interface RemoteFailure {
  /** §5.1 の値、または timeout / stopped / not_supported / storage_unavailable / sfu_unavailable */
  code: string
  fallback: boolean
}

export interface LiveKitJoin { url: string; room: string; token: string }

interface StatusResp {
  state: VideoState
  error: string | null
  ready: boolean
  livekit?: LiveKitJoin
}

const START_POLL_MS = 1_000
/** 開始の指示から映像が届くまで待つ上限。受け入れ基準は 10 秒以内（§7-1・§7-2）。余裕を見て 25 秒。 */
const START_TIMEOUT_MS = 25_000

function stopSession(id: string): void {
  void fetch(`/api/video/sessions/${id}`, { method: 'DELETE', keepalive: true }).catch(() => {})
}

/**
 * @param attempt 変えると開き直す（再試行・録画再生の時刻の指定し直し）。
 */
interface SessionView {
  phase: RemotePhase
  src: string | null
  /** SFU のときだけ。最初に届いたものを持ち続ける（取り直すたびにつなぎ直さない） */
  livekit: LiveKitJoin | null
  failure: RemoteFailure | null
}

const STARTING: SessionView = { phase: 'starting', src: null, livekit: null, failure: null }

export function useRemoteVideoSession(req: RemoteVideoRequest, attempt: number): SessionView {
  const { cameraId, kind, from, to } = req
  // 状態は「どの要求のものか」と一緒に持つ。開き直したら古い状態は読まない
  // （効果の中で同期的に初期化しない＝描画を連鎖させない）
  const key = `${cameraId}|${kind}|${from ?? ''}|${to ?? ''}|${attempt}`
  const [state, setState] = useState<{ key: string } & SessionView>({ key, ...STARTING })

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let sessionId: string | null = null
    const startedAt = Date.now()
    const update = (patch: Partial<SessionView>) => {
      if (cancelled) return
      setState((prev) => ({ ...(prev.key === key ? prev : { key, ...STARTING }), ...patch }))
    }

    const fail = (code: string, fallback = shouldFallbackToJpeg(code)) => {
      update({ failure: { code, fallback }, phase: 'failed', src: null })
    }

    const poll = async (ready: boolean) => {
      if (cancelled || !sessionId) return
      let s: StatusResp | null = null
      try {
        const r = await fetch(`/api/video/sessions/${sessionId}`, { cache: 'no-store' })
        if (r.ok) s = await r.json() as StatusResp
      } catch { /* 一時的な失敗は次の周期で取り直す */ }
      if (cancelled) return

      if (s?.state === 'error') return fail(s.error ?? 'internal')
      if (s?.state === 'stopped') return fail('stopped', false)
      if (!ready) {
        if (s?.ready && kind === 'sfu') {
          if (!s.livekit) return fail('internal', false)
          update({ livekit: s.livekit, phase: 'playing' })
          timer = setTimeout(() => void poll(true), VIEWER_KEEPALIVE_MS)
          return
        }
        if (s?.ready) {
          update({ src: `/api/video/sessions/${sessionId}/hls/index.m3u8`, phase: s.state === 'ended' ? 'ended' : 'playing' })
          timer = setTimeout(() => void poll(true), VIEWER_KEEPALIVE_MS)
          return
        }
        if (s?.state === 'ended') return fail('no_recording', false)
        if (Date.now() - startedAt > START_TIMEOUT_MS) return fail('timeout', false)
        timer = setTimeout(() => void poll(false), START_POLL_MS)
        return
      }
      if (s?.state === 'ended') update({ phase: 'ended' })
      timer = setTimeout(() => void poll(true), VIEWER_KEEPALIVE_MS)
    }

    void (async () => {
      try {
        const r = await fetch('/api/video/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ camera_id: cameraId, kind, from, to }),
        })
        const j = await r.json().catch(() => null) as { id?: string; error?: string } | null
        if (!r.ok || !j?.id) {
          // 名乗りが消えた・置き場が未設定: 静止画ライブで見られるので戻す
          const code = j?.error === 'not_supported' || j?.error === 'storage_unavailable' || j?.error === 'sfu_unavailable'
            ? j.error : 'internal'
          return fail(code, code !== 'internal')
        }
        if (cancelled) { stopSession(j.id); return }
        sessionId = j.id
        void poll(false)
      } catch {
        fail('internal', false)
      }
    })()

    const onPageHide = () => { if (sessionId) stopSession(sessionId) }
    window.addEventListener('pagehide', onPageHide)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      window.removeEventListener('pagehide', onPageHide)
      if (sessionId) stopSession(sessionId)
    }
  }, [key, cameraId, kind, from, to])

  return state.key === key ? state : STARTING
}
