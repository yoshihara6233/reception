'use client'

/**
 * 手荷物検査 iPad キオスク — SCREEN A〜F（M3・ワイヤーフレーム v3 / D17 準拠）
 *
 * 状態機械:
 *   idle（A: 区分×動作グリッド）
 *     entry       → faceAuth(C) → complete(E相当「入室を記録しました」)
 *     temp_*      → faceAuth(C) → recorded(B・2秒→idle)
 *     exit        → faceAuth(C) → [不一致→authFail(F)] → step(D) → complete(E・3秒→idle)
 *   顔認証はプレビュー約1秒→自動撮影→照合（サーバ側3秒レース）。カメラ不可・
 *   超過・障害は auth_skipped でフロー継続（検査を止めない）。
 *   STEP は各STEP無操作タイムアウトで interrupted 記録→idle。
 *   API 不達は「係員をお呼びください」オーバーレイ。
 *
 * iPad は独自トーン（D11）— Genesis Edge トークン色をインラインで使用。
 * TTS 既定ON（D5・店舗設定 audio_enabled / audio_volume）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { startCamera, captureFrame, stopCamera, blobToDataUrl } from '@/lib/camera/capture'
import {
  availableActions, isTempEvent, firstStep, advanceStep, AUTO_IDLE_SEC,
  type AnnounceStep, type FlowAction, type PersonKind, type TerminalMode, type StepPhase,
} from '@/lib/baggage/inspection-flow'

interface Props {
  storeId: string
  storeName: string
  terminalMode: TerminalMode
  timeoutSec: number
  audioEnabled: boolean
  audioVolume: number
  steps: AnnounceStep[]
}

/** 顔照合の結果（face-auth API 応答）を後続画面へ引き回す。 */
interface FaceCtx {
  facePath: string | null
  employeeId?: string
  entrySessionId?: string
  lastName?: string
  authSkipped: boolean
}

type Screen =
  | { s: 'idle' }
  | { s: 'faceAuth'; action: FlowAction; kind: PersonKind }
  | { s: 'authFail'; kind: PersonKind; ctx: FaceCtx }               // F（退出のみ）
  | { s: 'step'; phase: StepPhase; kind: PersonKind; ctx: FaceCtx; startedAt: string }
  | { s: 'recorded'; action: 'temp_exit' | 'temp_return'; lastName?: string }  // B
  | { s: 'complete'; label: string }                                 // E
  // セルフ顔登録（顔未登録の従業員のみ選択可 — 上書きなりすまし防止・差し替えは管理画面）
  | { s: 'regList'; employees: { id: string; name: string }[] | null; error?: string }
  | { s: 'regCapture'; employee: { id: string; name: string }; captured?: string; busy?: boolean; error?: string }
  | { s: 'regDone'; name: string }

const ACTION_LABEL: Record<FlowAction, { t: string; sub: string; primary?: boolean }> = {
  entry:       { t: '入室', sub: '顔認証' },
  temp_exit:   { t: '途中退室', sub: '顔認証のみ' },
  temp_return: { t: '途中入室', sub: '顔認証のみ' },
  exit:        { t: '退室', sub: '手荷物検査', primary: true },
}
const KIND_LABEL: Record<PersonKind, string> = { staff: '従業員', visitor: '来訪者' }

// Genesis Edge トークン（iPad 独自トーン・D11）
const COL = {
  paper: '#F7F5F1', paper3: '#E4DED3', ink: '#0F0F10', ink2: '#2A2A2C', ink3: '#5B5B5F',
  line: '#D6CFC1', line2: '#B9B0A0', accent: '#2C4A7E', accentSoft: '#E4EAF3',
  ok: '#2F7A4F', warn: '#B5761A', warnSoft: '#F6EFE2', danger: '#A3332B',
}

/** 撮影までのプレビュー時間（顔を枠に合わせる猶予）。 */
const CAPTURE_DELAY_MS = 1200
/** face-auth 全体のクライアント側ガード（サーバ3秒レース＋通信の余裕）。 */
const FACE_TOTAL_GUARD_MS = 10000

export function KioskClient(props: Props) {
  const { storeId, storeName, terminalMode, timeoutSec, audioEnabled, audioVolume, steps } = props
  const [screen, setScreen] = useState<Screen>({ s: 'idle' })
  const [clock, setClock] = useState('')
  const [offline, setOffline] = useState(false)
  const [remaining, setRemaining] = useState(timeoutSec)

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const finishingRef = useRef(false)   // 退出POSTの二重送信ガード
  const actions = availableActions(terminalMode)

  // 時計（アイドルヘッダー）
  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }))
    tick(); const t = setInterval(tick, 10_000); return () => clearInterval(t)
  }, [])

  // オフライン検知
  useEffect(() => {
    const on = () => setOffline(false), off = () => setOffline(true)
    setOffline(!navigator.onLine)
    window.addEventListener('online', on); window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

  const speak = useCallback((text: string) => {
    if (!audioEnabled || typeof window === 'undefined' || !('speechSynthesis' in window)) return
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'ja-JP'; u.volume = Math.min(1, Math.max(0, audioVolume))
    window.speechSynthesis.speak(u)
  }, [audioEnabled, audioVolume])

  const stopCam = useCallback(() => {
    if (streamRef.current) { stopCamera(streamRef.current); streamRef.current = null }
  }, [])
  const resetToIdle = useCallback(() => { stopCam(); setScreen({ s: 'idle' }) }, [stopCam])

  // 完了=AUTO_IDLE_SEC(3秒) / 途中記録=2秒 でアイドルへ（B・E・顔登録完了）
  useEffect(() => {
    if (screen.s === 'complete' || screen.s === 'recorded' || screen.s === 'regDone') {
      const t = setTimeout(resetToIdle, screen.s === 'recorded' ? 2000 : AUTO_IDLE_SEC * 1000)
      return () => clearTimeout(t)
    }
  }, [screen, resetToIdle])

  // オフライン表示中は 10秒毎に API へ疎通確認（ネットワークは生きていて API 側が
  // 一時失敗だった場合、online イベントは発火しないため自動復帰しない問題の対策）
  useEffect(() => {
    if (!offline) return
    const t = setInterval(async () => {
      try {
        const res = await fetch('/api/server-time', { cache: 'no-store' })
        if (res.ok) setOffline(false)
      } catch { /* まだ不達 */ }
    }, 10_000)
    return () => clearInterval(t)
  }, [offline])

  // ── API ─────────────────────────────────────────────────────────────────────
  const postSession = useCallback(async (payload: Record<string, unknown>): Promise<boolean> => {
    try {
      const res = await fetch('/api/baggage/kiosk/sessions', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ storeId, ...payload }),
      })
      if (!res.ok) throw new Error(String(res.status))
      return true
    } catch {
      setOffline(true)
      return false
    }
  }, [storeId])

  const startInspection = useCallback((kind: PersonKind, ctx: FaceCtx) => {
    const phase = firstStep(steps)
    if (phase.kind === 'step') speak(phase.text)
    setRemaining(timeoutSec)
    setScreen({ s: 'step', phase, kind, ctx, startedAt: new Date().toISOString() })
  }, [steps, speak, timeoutSec])

  // ── 顔認証後の分岐（C → B/D/E/F） ───────────────────────────────────────────
  const proceedAfterFace = useCallback(async (action: FlowAction, kind: PersonKind, ctx: FaceCtx) => {
    stopCam()

    // 退出で不一致（省略含む）→ F（本人がスキップ/再試行を選ぶ）
    if (action === 'exit' && !ctx.lastName && !ctx.entrySessionId) {
      setScreen({ s: 'authFail', kind, ctx }); return
    }

    if (isTempEvent(action)) {
      const ok = await postSession({
        action, personKind: kind, facePath: ctx.facePath,
        employeeId: ctx.employeeId ?? null, entrySessionId: ctx.entrySessionId ?? null,
        authSkipped: ctx.authSkipped,
      })
      if (ok) setScreen({ s: 'recorded', action, lastName: ctx.lastName })
      return
    }

    if (action === 'entry') {
      const ok = await postSession({
        action, personKind: kind, facePath: ctx.facePath,
        employeeId: ctx.employeeId ?? null, authSkipped: ctx.authSkipped,
      })
      if (ok) setScreen({ s: 'complete', label: '入室を記録しました' })
      return
    }

    // exit → 検査 STEP へ（D）
    startInspection(kind, ctx)
  }, [postSession, stopCam, startInspection])

  const finishExit = useCallback(async (
    kind: PersonKind, ctx: FaceCtx, startedAt: string, status: 'completed' | 'interrupted',
  ) => {
    // 二重送信ガード（最終「次へ」の連打・タイムアウト効果の再発火）。
    if (finishingRef.current) return
    finishingRef.current = true
    try {
      const ok = await postSession({
        action: 'exit', personKind: kind, facePath: ctx.facePath,
        employeeId: ctx.employeeId ?? null, entrySessionId: ctx.entrySessionId ?? null,
        authSkipped: ctx.authSkipped,
        inspectionStartedAt: startedAt, inspectionEndedAt: new Date().toISOString(), status,
      })
      if (!ok) return
      if (status === 'completed') setScreen({ s: 'complete', label: '検査が完了しました' })
      else resetToIdle()
    } finally {
      finishingRef.current = false
    }
  }, [postSession, resetToIdle])

  const nextStep = useCallback(() => {
    if (screen.s !== 'step' || screen.phase.kind !== 'step') return
    const np = advanceStep(steps, screen.phase.index)
    if (np.kind === 'complete') { finishExit(screen.kind, screen.ctx, screen.startedAt, 'completed'); return }
    speak(np.text)
    setRemaining(timeoutSec)
    setScreen({ ...screen, phase: np })
  }, [screen, steps, speak, timeoutSec, finishExit])

  // ── C: 顔認証（カメラ起動→自動撮影→照合。失敗はスキップ動線） ──────────────
  useEffect(() => {
    if (screen.s !== 'faceAuth') return
    const { action, kind } = screen
    let cancelled = false
    const skip = () => { if (!cancelled) { cancelled = true; proceedAfterFace(action, kind, { facePath: null, authSkipped: true }) } }
    const guard = setTimeout(skip, FACE_TOTAL_GUARD_MS)

    ;(async () => {
      try {
        if (!videoRef.current) throw new Error('no video')
        streamRef.current = await startCamera(videoRef.current, { facingMode: 'user' })
        await new Promise((r) => setTimeout(r, CAPTURE_DELAY_MS))
        if (cancelled) return
        const blob = videoRef.current ? captureFrame(videoRef.current, 2) : null
        if (!blob) throw new Error('capture failed')
        const image = await blobToDataUrl(blob)
        const res = await fetch('/api/baggage/kiosk/face-auth', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ storeId, personKind: kind, action, image }),
        })
        if (!res.ok) throw new Error(String(res.status))
        const r = await res.json() as {
          matched: boolean; authSkipped: boolean; facePath: string | null
          employeeId?: string; lastName?: string; entrySessionId?: string
        }
        if (cancelled) return
        cancelled = true; clearTimeout(guard)
        proceedAfterFace(action, kind, {
          facePath: r.facePath,
          employeeId: r.employeeId, lastName: r.lastName, entrySessionId: r.entrySessionId,
          // サーバの判定をそのまま使う。authSkipped=true は「認証を省略/実行できなかった」
          // （AWS未設定・タイムアウト・カメラ/通信不可）のみ。顔照合は実行できたが該当者
          // なし（no_match）は authSkipped=false のまま＝「認証省略」ではなく単に未特定として
          // 記録し、本人特定できないため紐づけない（アンマッチ）。
          authSkipped: r.authSkipped,
        })
      } catch {
        clearTimeout(guard); skip()   // カメラ不可・通信失敗 → 認証省略で継続
      }
    })()
    return () => { cancelled = true; clearTimeout(guard) }
  }, [screen]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── セルフ顔登録（顔未登録の従業員が自分の名前を選んで登録・差し替えは管理画面） ──
  const openRegList = useCallback(async () => {
    setScreen({ s: 'regList', employees: null })
    try {
      const res = await fetch(`/api/baggage/kiosk/employees?storeId=${storeId}`)
      if (!res.ok) throw new Error(String(res.status))
      const j = await res.json() as { employees: { id: string; name: string }[] }
      setScreen({ s: 'regList', employees: j.employees })
    } catch {
      setScreen({ s: 'regList', employees: [], error: '一覧を取得できませんでした。係員をお呼びください。' })
    }
  }, [storeId])

  // regCapture: プレビュー中（未撮影）だけカメラを起動。撮影・画面遷移で停止。
  useEffect(() => {
    if (screen.s !== 'regCapture' || screen.captured) return
    ;(async () => {
      try {
        if (videoRef.current) streamRef.current = await startCamera(videoRef.current, { facingMode: 'user' })
      } catch { /* カメラ不可でも撮影ボタンでエラー表示になる */ }
    })()
    return () => { stopCam() }
  }, [screen, stopCam])

  const captureForReg = useCallback(async () => {
    if (screen.s !== 'regCapture') return
    const blob = videoRef.current ? captureFrame(videoRef.current, 2) : null
    if (!blob) { setScreen({ ...screen, error: 'カメラを起動できませんでした。係員をお呼びください。' }); return }
    const image = await blobToDataUrl(blob)
    stopCam()
    setScreen({ ...screen, captured: image, error: undefined })
  }, [screen, stopCam])

  const REG_ERR: Record<string, string> = {
    already_registered: 'この方の顔は登録済みです。変更は管理者にご相談ください。',
    face_not_detected: '顔を検出できませんでした。正面を向いて、もう一度撮影してください。',
    rekognition_failed: '登録サービスに接続できませんでした。時間をおいてお試しください。',
  }

  const submitReg = useCallback(async () => {
    if (screen.s !== 'regCapture' || !screen.captured || screen.busy) return
    setScreen({ ...screen, busy: true, error: undefined })
    try {
      const res = await fetch(`/api/baggage/employees/${screen.employee.id}/face`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image: screen.captured, onlyIfUnregistered: true }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => null) as { error?: string } | null
        setScreen({ ...screen, busy: false, error: REG_ERR[j?.error ?? ''] ?? `登録に失敗しました（${j?.error ?? res.status}）` })
        return
      }
      setScreen({ s: 'regDone', name: screen.employee.name })
    } catch {
      setScreen({ ...screen, busy: false, error: '通信に失敗しました。もう一度お試しください。' })
    }
  }, [screen]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── D: STEP 無操作タイムアウト（各STEP・満了で interrupted 記録） ─────────────
  // 0 で打ち止め（負値まで減らすと effect が毎秒再発火して退出POSTを連射してしまう）。
  useEffect(() => {
    if (screen.s !== 'step') return
    const t = setInterval(() => setRemaining((r) => Math.max(0, r - 1)), 1000)
    return () => clearInterval(t)
  }, [screen])
  useEffect(() => {
    if (screen.s === 'step' && remaining === 0) {
      finishExit(screen.kind, screen.ctx, screen.startedAt, 'interrupted')
    }
  }, [remaining, screen, finishExit])

  // ── レンダリング ────────────────────────────────────────────────────────────
  const personChip = (ctx: FaceCtx, kind: PersonKind) => (
    <span style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#EFEBE3',
      border: `1px solid ${COL.line}`, borderRadius: 4, padding: '6px 14px', fontSize: 14 }}>
      {ctx.lastName ? `認証OK — ${ctx.lastName}さん` : '認証省略'}
      <span style={{ fontSize: 11, background: COL.accentSoft, color: COL.accent, borderRadius: 4, padding: '1px 8px' }}>
        {KIND_LABEL[kind]}
      </span>
    </span>
  )

  return (
    <div style={{ position: 'fixed', inset: 0, background: COL.paper, color: COL.ink,
      fontFamily: 'Noto Sans JP, sans-serif', display: 'flex', flexDirection: 'column' }}>

      {/* ── トップバー ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '20px 32px', borderBottom: `1px solid ${COL.line}`, gap: 16 }}>
        <b style={{ fontSize: 14 }}>Genesis Edge 受付 — {storeName}</b>
        {screen.s === 'idle' && (
          <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 28, letterSpacing: '.04em' }}>{clock}</span>
        )}
        {screen.s === 'step' && personChip(screen.ctx, screen.kind)}
        <span style={{ fontSize: 13, color: COL.ink3, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: COL.danger }} />
          {screen.s === 'idle' ? 'この検査エリアは録画されています' : '録画中'}
        </span>
      </div>

      {/* ── A: アイドル＝初期画面（区分×動作を1タップ・D17） ── */}
      {screen.s === 'idle' && (
        <div style={centerBox(24)}>
          <div style={{ fontSize: 30, fontWeight: 700 }}>手続きを選んでください</div>
          {(['staff', 'visitor'] as PersonKind[]).map((kind) => (
            <div key={kind} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <span style={{ width: 110, textAlign: 'right', fontSize: 20, fontWeight: 700, paddingRight: 6 }}>
                {KIND_LABEL[kind]}
              </span>
              {actions.map((a) => {
                const primary = ACTION_LABEL[a].primary
                return (
                  <button key={a} onClick={() => setScreen({ s: 'faceAuth', action: a, kind })} style={{
                    width: 180, height: 104, background: '#fff',
                    border: `${primary ? 2 : 1}px solid ${primary ? COL.accent : COL.line}`,
                    color: primary ? COL.accent : COL.ink, borderRadius: 6, cursor: 'pointer',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    gap: 2, fontSize: 22, fontWeight: 700, fontFamily: 'inherit' }}>
                    {ACTION_LABEL[a].t}
                    <span style={{ fontSize: 12, fontWeight: 400, color: primary ? COL.accent : COL.ink3 }}>
                      {ACTION_LABEL[a].sub}
                    </span>
                  </button>
                )
              })}
            </div>
          ))}
          <div style={{ fontSize: 14, color: COL.ink3 }}>
            顔データ: 従業員=登録抹消まで / 来訪者=当日中に自動削除
          </div>
          <button onClick={openRegList} style={{ ...ghostFullBtn, width: 'auto', minWidth: 260, height: 48, fontSize: 15 }}>
            はじめての方の顔登録（従業員）
          </button>
        </div>
      )}

      {/* ── セルフ顔登録: 名前選択（顔未登録の従業員のみ） ── */}
      {screen.s === 'regList' && (
        <div style={centerBox(24)}>
          <div style={{ fontSize: 28, fontWeight: 700 }}>お名前を選んでください</div>
          {screen.employees === null && <div style={{ fontSize: 15, color: COL.ink3 }}>読み込んでいます…</div>}
          {screen.error && <div style={{ fontSize: 15, color: COL.warn }}>{screen.error}</div>}
          {screen.employees !== null && !screen.error && screen.employees.length === 0 && (
            <div style={{ fontSize: 15, color: COL.ink3, textAlign: 'center', lineHeight: 1.9 }}>
              この端末の店舗（{storeName}）に顔登録が必要な従業員はいません。<br />
              名前が出ない場合は、管理画面の従業員マスタで「{storeName}」に登録されているかご確認ください。
            </div>
          )}
          {screen.employees !== null && screen.employees.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'center',
              maxWidth: 780, maxHeight: 360, overflowY: 'auto', padding: 4 }}>
              {screen.employees.map((e) => (
                <button key={e.id} onClick={() => setScreen({ s: 'regCapture', employee: e })} style={{
                  minWidth: 180, height: 72, background: '#fff', border: `1px solid ${COL.line}`,
                  borderRadius: 6, fontSize: 20, fontWeight: 700, fontFamily: 'inherit',
                  color: COL.ink, cursor: 'pointer', padding: '0 20px' }}>
                  {e.name}
                </button>
              ))}
            </div>
          )}
          <div style={{ fontSize: 13, color: COL.ink3 }}>
            登録済みの方はここに表示されません。顔の変更は管理者が行います。
          </div>
          <button onClick={resetToIdle} style={ghostFullBtn}>最初の画面に戻る</button>
        </div>
      )}

      {/* ── セルフ顔登録: 撮影 → 確認 → 登録 ── */}
      {screen.s === 'regCapture' && (
        <div style={centerBox(20)}>
          <div style={{ fontSize: 26, fontWeight: 700 }}>{lastNameOfClient(screen.employee.name)}さんの顔を登録します</div>
          <div style={{ width: 520, height: 390, background: '#1a1c1f', borderRadius: 6, position: 'relative',
            display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
            {screen.captured
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={screen.captured} alt="撮影した写真" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : <>
                  <video ref={videoRef} autoPlay playsInline muted
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  <div style={{ position: 'absolute', width: 230, height: 300, border: '2px dashed #8a8f96',
                    borderRadius: '50%/46%' }} />
                </>}
          </div>
          {screen.error && <div style={{ fontSize: 15, color: COL.warn }}>{screen.error}</div>}
          <div style={{ display: 'flex', gap: 12 }}>
            {screen.captured ? (
              <>
                <button disabled={screen.busy}
                  onClick={() => setScreen({ s: 'regCapture', employee: screen.employee })}
                  style={{ ...ghostFullBtn, width: 'auto', minWidth: 180 }}>撮り直す</button>
                <button disabled={screen.busy} onClick={submitReg}
                  style={{ ...primaryFullBtn, width: 'auto', minWidth: 260, height: 64, fontSize: 20 }}>
                  {screen.busy ? '登録しています…' : 'この写真で登録'}
                </button>
              </>
            ) : (
              <>
                <button onClick={openRegList} style={{ ...ghostFullBtn, width: 'auto', minWidth: 180 }}>名前を選び直す</button>
                <button onClick={captureForReg}
                  style={{ ...primaryFullBtn, width: 'auto', minWidth: 260, height: 64, fontSize: 20 }}>撮影する</button>
              </>
            )}
          </div>
          <div style={{ fontSize: 13, color: COL.ink3 }}>正面を向いて、枠に顔を合わせてから撮影してください</div>
        </div>
      )}

      {/* ── セルフ顔登録: 完了（3秒→idle） ── */}
      {screen.s === 'regDone' && (
        <div style={centerBox(36)}>
          <CheckMark />
          <div style={{ fontSize: 40, fontWeight: 700 }}>{lastNameOfClient(screen.name)}さんの顔を登録しました</div>
          <div style={{ fontSize: 14, color: COL.ink3 }}>次回から顔認証で入退室できます。3秒後に最初の画面に戻ります</div>
        </div>
      )}

      {/* ── C: 顔認証（自動撮影） ── */}
      {screen.s === 'faceAuth' && (
        <div style={centerBox(24)}>
          <div style={{ fontSize: 32, fontWeight: 700 }}>
            {screen.kind === 'visitor' && screen.action === 'entry' ? '顔をカメラに向けてください（登録）' : '顔をカメラに向けてください'}
          </div>
          <div style={{ width: 520, height: 390, background: '#1a1c1f', borderRadius: 6, position: 'relative',
            display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
            <video ref={videoRef} autoPlay playsInline muted
              style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            <div style={{ position: 'absolute', width: 230, height: 300, border: '2px dashed #8a8f96',
              borderRadius: '50%/46%' }} />
            <div style={{ position: 'absolute', bottom: 16, left: 0, right: 0, textAlign: 'center',
              color: '#cfd3d9', fontSize: 15 }}>認証しています…</div>
          </div>
          <div style={{ fontSize: 14, color: COL.ink3 }}>認証できない場合も、そのまま手続きを続けられます（自動でご案内します）</div>
        </div>
      )}

      {/* ── F: 退出の顔照合失敗（中立文言・スキップ可） ── */}
      {screen.s === 'authFail' && (
        <div style={centerBox(28)}>
          <div style={{ width: 720, background: COL.warnSoft, border: `1px solid ${COL.warn}`,
            borderRadius: 6, padding: '20px 24px' }}>
            <div style={{ fontWeight: 700, fontSize: 18 }}>認証できませんでした</div>
            <div style={{ fontSize: 15, color: COL.ink2 }}>そのまま検査へお進みください。手続きは通常どおり完了します。</div>
          </div>
          <div style={{ width: 720, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <button onClick={() => startInspection(screen.kind, { ...screen.ctx, authSkipped: true })}
              style={primaryFullBtn}>検査へ進む</button>
            <button onClick={() => setScreen({ s: 'faceAuth', action: 'exit', kind: screen.kind })}
              style={ghostFullBtn}>もう一度顔認証する</button>
          </div>
        </div>
      )}

      {/* ── D: 検査 STEP（64pxテキスト主・音声従・無操作タイムアウト） ── */}
      {screen.s === 'step' && screen.phase.kind === 'step' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '24px 48px 0' }}>
            <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 14, background: COL.accent,
              color: '#fff', borderRadius: 4, padding: '3px 14px' }}>
              STEP {screen.phase.index + 1} / {screen.phase.total}
            </span>
            <span style={{ flex: 1, height: 1, background: COL.line }} />
            {screen.phase.index + 1 < screen.phase.total && (
              <span style={{ fontSize: 13, color: COL.ink3 }}>次: {steps[screen.phase.index + 1]?.text}</span>
            )}
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', gap: 24, padding: '0 48px' }}>
            <div style={{ fontSize: 64, fontWeight: 700, textAlign: 'center', lineHeight: 1.35,
              letterSpacing: '.02em' }}>{screen.phase.text}</div>
            {audioEnabled && (
              <div style={{ fontSize: 13, color: COL.ink3 }}>♪ 音声案内 再生中（店舗設定で OFF・音量変更可）</div>
            )}
          </div>
          <div style={{ padding: '0 48px 40px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 13, color: COL.ink3 }}>
              <span>のこり {Math.max(0, remaining)}秒</span>
              <span style={{ flex: 1, height: 4, background: COL.paper3, borderRadius: 2, overflow: 'hidden' }}>
                <i style={{ display: 'block', height: '100%', background: COL.line2,
                  width: `${Math.max(0, Math.min(100, (remaining / timeoutSec) * 100))}%` }} />
              </span>
              <span>無操作で検査は中断として記録されます</span>
            </div>
            <button onClick={nextStep} style={{ height: 80, width: '100%', background: COL.accent, color: '#fff',
              border: 'none', borderRadius: 4, fontSize: 26, fontWeight: 700, fontFamily: 'inherit',
              cursor: 'pointer' }}>次へ</button>
          </div>
        </div>
      )}

      {/* ── B: 途中退室/途中入室 記録完了（2秒→idle） ── */}
      {screen.s === 'recorded' && (
        <div style={centerBox(36)}>
          <CheckMark />
          <div style={{ fontSize: 44, fontWeight: 700 }}>
            {screen.action === 'temp_exit' ? '途中退室' : '途中入室'}を記録しました
          </div>
          <div style={{ fontSize: 14, color: COL.ink3 }}>
            {screen.lastName ? `${screen.lastName}さん ${clock} — ` : ''}
            {screen.action === 'temp_exit' ? 'いってらっしゃい。' : 'おかえりなさい。'}2秒後に最初の画面に戻ります
          </div>
        </div>
      )}

      {/* ── E: 完了（3秒→idle） ── */}
      {screen.s === 'complete' && (
        <div style={centerBox(36)}>
          <CheckMark />
          <div style={{ fontSize: 44, fontWeight: 700 }}>{screen.label}</div>
          <div style={{ fontSize: 14, color: COL.ink3 }}>お疲れさまでした。3秒後に最初の画面に戻ります</div>
        </div>
      )}

      {/* ── オフライン ── */}
      {offline && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,15,16,0.86)', color: '#fff',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 16, zIndex: 50 }}>
          <div style={{ fontSize: 34, fontWeight: 700 }}>係員をお呼びください</div>
          <div style={{ fontSize: 15, color: '#cfd3d9' }}>ただいま受付システムに接続できません。復旧すると自動で戻ります。</div>
        </div>
      )}
    </div>
  )
}

function centerBox(gap: number): React.CSSProperties {
  return { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', gap, padding: 32 }
}

const primaryFullBtn: React.CSSProperties = { height: 80, width: '100%', background: '#2C4A7E', color: '#fff',
  border: 'none', borderRadius: 4, fontSize: 26, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }
const ghostFullBtn: React.CSSProperties = { height: 56, width: '100%', background: 'none', color: '#2A2A2C',
  border: '1px solid #D6CFC1', borderRadius: 4, fontSize: 16, fontFamily: 'inherit', cursor: 'pointer' }

/** 「田中 花子」→「田中」（表示用・サーバ側 lastNameOf と同義のクライアント簡易版）。 */
function lastNameOfClient(name: string): string {
  return name.trim().split(/[\s　]+/)[0] ?? name
}

function CheckMark() {
  return (
    <div style={{ width: 96, height: 96, borderRadius: '50%', border: '3px solid #2F7A4F',
      display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#2F7A4F" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
    </div>
  )
}
