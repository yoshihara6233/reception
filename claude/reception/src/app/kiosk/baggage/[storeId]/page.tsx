'use client'

/**
 * 手荷物検査 iPad キオスク フロー（T4・全画面）
 *
 * 承認ワイヤー v3 / D5・D6・D9・D10改・D17 準拠の状態機械:
 *   idle（初期グリッド）
 *     entry(staff)   → consent → faceAuth(認証) → complete
 *     entry(visitor) → consent → faceAuth(撮影) → visitorCard(名刺OCR任意) → complete
 *     temp_*         → faceAuth(認証) → recorded
 *     exit           → faceAuth(認証) → step(検査STEP) → complete
 *   顔認証失敗/カメラ不可/3秒超過 → auth_skipped で先へ進める（検査は止めない）。
 *   オフライン（API不達）→ 「係員をお呼びください」オーバーレイ。
 *
 * iPad は独自トーン（D11）。TTS は既定ON（D5）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { startCamera, captureFrame, stopCamera } from '@/lib/camera/capture'
import {
  availableActions, requiresInspection, isTempEvent, normalizeAnnounceSteps,
  firstStep, advanceStep, FACE_AUTH_TIMEOUT_SEC,
  type FlowAction, type PersonKind, type TerminalMode, type StepPhase,
} from '@/lib/baggage/inspection-flow'

type Screen =
  | { s: 'idle' }
  | { s: 'consent'; action: FlowAction; kind: PersonKind }
  | { s: 'faceAuth'; action: FlowAction; kind: PersonKind; authSkipped?: boolean }
  | { s: 'visitorCard'; action: FlowAction; kind: PersonKind }
  | { s: 'recorded'; action: 'temp_exit' | 'temp_return' }
  | { s: 'step'; phase: StepPhase }
  | { s: 'complete'; label: string }

const ACTION_LABEL: Record<FlowAction, { t: string; sub: string; primary?: boolean }> = {
  entry:       { t: '入室', sub: '顔認証' },
  temp_exit:   { t: '途中退室', sub: '顔認証のみ' },
  temp_return: { t: '途中入室', sub: '顔認証のみ' },
  exit:        { t: '退室', sub: '手荷物検査', primary: true },
}
const KIND_LABEL: Record<PersonKind, string> = { staff: '従業員', visitor: '来訪者' }
const COL = {
  paper: '#F7F5F1', paper2: '#EFEBE3', ink: '#0F0F10', ink3: '#5B5B5F',
  line: '#D6CFC1', accent: '#2C4A7E', accentSoft: '#E4EAF3', ok: '#2F7A4F', warn: '#B5761A',
}
const CONSENT_TEXT =
  'この検査エリアは録画されます。顔画像は本人確認に使用し、来訪者の顔データは当日中に自動削除されます。従業員の顔データは登録抹消まで保持します。ご同意のうえお進みください。'

export default function BaggageKioskPage() {
  const params = useParams<{ storeId: string }>()
  const [mode] = useState<TerminalMode>('both')
  const [screen, setScreen] = useState<Screen>({ s: 'idle' })
  const [clock, setClock] = useState('')
  const [offline, setOffline] = useState(false)

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const steps = useMemo(() => normalizeAnnounceSteps(undefined), [])
  const actions = availableActions(mode)

  // 時計
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

  // 完了/記録は3秒でアイドルへ
  useEffect(() => {
    if (screen.s === 'complete' || screen.s === 'recorded') {
      const t = setTimeout(() => resetToIdle(), 3000); return () => clearTimeout(t)
    }
  }, [screen]) // eslint-disable-line react-hooks/exhaustive-deps

  const speak = useCallback((text: string) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
    const u = new SpeechSynthesisUtterance(text); u.lang = 'ja-JP'; window.speechSynthesis.speak(u)
  }, [])

  const stopCam = useCallback(() => {
    if (streamRef.current) { stopCamera(streamRef.current); streamRef.current = null }
  }, [])
  const resetToIdle = useCallback(() => { stopCam(); setScreen({ s: 'idle' }) }, [stopCam])

  // faceAuth 画面に入ったらカメラ起動＋3秒タイムアウト
  useEffect(() => {
    if (screen.s !== 'faceAuth') return
    let cancelled = false
    const timeout = setTimeout(() => { if (!cancelled) proceedAfterFace(screen, true) }, FACE_AUTH_TIMEOUT_SEC * 1000)
    ;(async () => {
      try {
        if (videoRef.current) streamRef.current = await startCamera(videoRef.current, { facingMode: 'user' })
      } catch { /* カメラ不可はスキップ導線で継続 */ }
    })()
    return () => { cancelled = true; clearTimeout(timeout) }
  }, [screen]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── フロー遷移 ──────────────────────────────────────────────────────────────
  const pick = useCallback((action: FlowAction, kind: PersonKind) => {
    if (action === 'entry') { setScreen({ s: 'consent', action, kind }); return }
    setScreen({ s: 'faceAuth', action, kind })
  }, [])

  // 顔撮影/認証の後の分岐
  const proceedAfterFace = useCallback((sc: Extract<Screen, { s: 'faceAuth' }>, authSkipped: boolean) => {
    stopCam()
    if (sc.kind === 'visitor' && sc.action === 'entry') { setScreen({ s: 'visitorCard', action: sc.action, kind: sc.kind }); return }
    finish(sc.action, sc.kind, authSkipped)
  }, [stopCam]) // eslint-disable-line react-hooks/exhaustive-deps

  // 端末の実処理: セッション記録 → 画面遷移
  const finish = useCallback(async (action: FlowAction, kind: PersonKind, authSkipped: boolean) => {
    // API 送信（顔画像アップロードは統合の次段。ここでは記録のみ）
    try {
      await fetch('/api/v1/baggage/sessions', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ storeId: params.storeId, action, personKind: kind, authSkipped }),
      })
    } catch { setOffline(true) }

    if (isTempEvent(action)) { setScreen({ s: 'recorded', action }); return }
    if (requiresInspection(action)) {
      const phase = firstStep(steps)
      if (phase.kind === 'step') speak(phase.text)
      setScreen({ s: 'step', phase }); return
    }
    setScreen({ s: 'complete', label: '入室を記録しました' })
  }, [params.storeId, steps, speak])

  const nextStep = useCallback(() => {
    if (screen.s !== 'step' || screen.phase.kind !== 'step') return
    const np = advanceStep(steps, screen.phase.index)
    if (np.kind === 'complete') { setScreen({ s: 'complete', label: '検査が完了しました' }); return }
    speak(np.text); setScreen({ s: 'step', phase: np })
  }, [screen, steps, speak])

  // ── レンダリング ────────────────────────────────────────────────────────────
  return (
    <div style={{ position: 'fixed', inset: 0, background: COL.paper, color: COL.ink,
      fontFamily: 'Noto Sans JP, sans-serif', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '20px 32px', borderBottom: `1px solid ${COL.line}` }}>
        <b style={{ fontSize: 15 }}>Genesis Edge 受付</b>
        <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 26 }}>{clock}</span>
        <span style={{ fontSize: 13, color: COL.ink3, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#A3332B' }} />
          この検査エリアは録画されています
        </span>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', gap: 28, padding: 32 }}>

        {screen.s === 'idle' && (
          <>
            <div style={{ fontSize: 30, fontWeight: 700 }}>手続きを選んでください</div>
            {(['staff', 'visitor'] as PersonKind[]).map((kind) => (
              <div key={kind} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <span style={{ width: 110, textAlign: 'right', fontSize: 20, fontWeight: 700, paddingRight: 6 }}>{KIND_LABEL[kind]}</span>
                {actions.map((a) => {
                  const primary = ACTION_LABEL[a].primary
                  return (
                    <button key={a} onClick={() => pick(a, kind)} style={{
                      width: 180, height: 104, background: '#fff',
                      border: `${primary ? 2 : 1}px solid ${primary ? COL.accent : COL.line}`,
                      color: primary ? COL.accent : COL.ink, borderRadius: 6, cursor: 'pointer',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                      gap: 2, fontSize: 22, fontWeight: 700, fontFamily: 'inherit' }}>
                      {ACTION_LABEL[a].t}
                      <span style={{ fontSize: 12, fontWeight: 400, color: primary ? COL.accent : COL.ink3 }}>{ACTION_LABEL[a].sub}</span>
                    </button>
                  )
                })}
              </div>
            ))}
            <div style={{ fontSize: 14, color: COL.ink3 }}>顔データ: 従業員=登録抹消まで / 来訪者=当日中に自動削除</div>
          </>
        )}

        {screen.s === 'consent' && (
          <>
            <div style={{ fontSize: 28, fontWeight: 700 }}>ご確認ください</div>
            <div style={{ maxWidth: 720, fontSize: 18, lineHeight: 1.9, color: COL.ink, background: '#fff',
              border: `1px solid ${COL.line}`, borderRadius: 6, padding: '24px 28px' }}>{CONSENT_TEXT}</div>
            <div style={{ display: 'flex', gap: 12 }}>
              <button onClick={resetToIdle} style={ghostBtn}>やめる</button>
              <button onClick={() => setScreen({ s: 'faceAuth', action: screen.action, kind: screen.kind })} style={primaryBtn}>同意して進む</button>
            </div>
          </>
        )}

        {screen.s === 'faceAuth' && (
          <>
            <div style={{ fontSize: 26, fontWeight: 700 }}>
              {screen.kind === 'visitor' && screen.action === 'entry' ? '顔を登録します' : '顔認証をします'}
            </div>
            <div style={{ width: 480, height: 360, background: '#1a1c1f', borderRadius: 6, position: 'relative',
              display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
              <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              <div style={{ position: 'absolute', width: 220, height: 290, border: '2px dashed #8a8f96', borderRadius: '50%/46%' }} />
              <div style={{ position: 'absolute', bottom: 14, color: '#cfd3d9', fontSize: 15 }}>顔を枠に合わせてください（最大3秒）</div>
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <button onClick={() => proceedAfterFace(screen, true)} style={ghostBtn}>認証せずに進む</button>
              <button onClick={() => proceedAfterFace(screen, false)} style={primaryBtn}>
                {screen.kind === 'visitor' && screen.action === 'entry' ? '撮影して進む' : '認証して進む'}
              </button>
            </div>
            <div style={{ fontSize: 13, color: COL.ink3 }}>認証できない場合も、そのまま手続きを続けられます</div>
          </>
        )}

        {screen.s === 'visitorCard' && (
          <>
            <div style={{ fontSize: 26, fontWeight: 700 }}>名刺を撮影してください</div>
            <div style={{ width: 520, height: 300, background: '#1a1c1f', borderRadius: 6,
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8a94a6', fontSize: 14 }}>
              名刺を枠内に収めてください（自動で氏名・会社名を読み取ります）
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <button onClick={() => finish(screen.action, screen.kind, false)} style={ghostBtn}>名刺なしで進む</button>
              <button onClick={() => finish(screen.action, screen.kind, false)} style={primaryBtn}>撮影して進む</button>
            </div>
          </>
        )}

        {screen.s === 'recorded' && (
          <>
            <Check />
            <div style={{ fontSize: 40, fontWeight: 700 }}>{screen.action === 'temp_exit' ? '途中退室' : '途中入室'}を記録しました</div>
            <div style={{ fontSize: 15, color: COL.ink3 }}>3秒後に最初の画面に戻ります</div>
          </>
        )}

        {screen.s === 'step' && screen.phase.kind === 'step' && (
          <div style={{ width: '100%', flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '4px 16px' }}>
              <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 14, background: COL.accent, color: '#fff',
                borderRadius: 4, padding: '3px 14px' }}>STEP {screen.phase.index + 1} / {screen.phase.total}</span>
              <span style={{ flex: 1, height: 1, background: COL.line }} />
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20 }}>
              <div style={{ fontSize: 60, fontWeight: 700, textAlign: 'center', lineHeight: 1.35 }}>{screen.phase.text}</div>
              <div style={{ fontSize: 13, color: COL.ink3 }}>♪ 音声案内 再生中（既定ON）</div>
            </div>
            <button onClick={nextStep} style={{ height: 80, background: COL.accent, color: '#fff', border: 'none',
              borderRadius: 4, fontSize: 26, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}>次へ</button>
          </div>
        )}

        {screen.s === 'complete' && (
          <>
            <Check />
            <div style={{ fontSize: 44, fontWeight: 700 }}>{screen.label}</div>
            <div style={{ fontSize: 15, color: COL.ink3 }}>お疲れさまでした。3秒後に最初の画面に戻ります</div>
          </>
        )}
      </div>

      {offline && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,15,16,0.86)', color: '#fff',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, zIndex: 50 }}>
          <div style={{ fontSize: 34, fontWeight: 700 }}>係員をお呼びください</div>
          <div style={{ fontSize: 15, color: '#cfd3d9' }}>ただいま受付システムに接続できません。復旧すると自動で戻ります。</div>
        </div>
      )}

      <div style={{ textAlign: 'center', padding: 8, fontSize: 11, color: COL.ink3, fontFamily: 'IBM Plex Mono, monospace' }}>
        store {params.storeId}
      </div>
    </div>
  )
}

const primaryBtn: React.CSSProperties = { height: 64, minWidth: 220, padding: '0 28px', background: '#2C4A7E',
  color: '#fff', border: 'none', borderRadius: 4, fontSize: 20, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }
const ghostBtn: React.CSSProperties = { height: 64, minWidth: 180, padding: '0 24px', background: 'none',
  color: '#2A2A2C', border: '1px solid #D6CFC1', borderRadius: 4, fontSize: 16, fontFamily: 'inherit', cursor: 'pointer' }

function Check() {
  return <div style={{ width: 96, height: 96, borderRadius: '50%', border: '3px solid #2F7A4F',
    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 44, color: '#2F7A4F' }}>✓</div>
}
