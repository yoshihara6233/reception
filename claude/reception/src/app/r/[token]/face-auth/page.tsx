'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { startCamera, captureFrame, stopCamera } from '@/lib/camera/capture'
import { compressImage } from '@/lib/camera/compress'

// ── 型 ────────────────────────────────────────────────────────────────────────

interface MatchedVisitor {
  id:         string
  name:       string
  company:    string
  department: string
  phone:      string
  email:      string
}

type Phase =
  | 'camera'       // カメラ起動・撮影
  | 'searching'    // Rekognition 問い合わせ中
  | 'confirm'      // マッチ確認画面 (confidence 80-100%)
  | 'checkin'      // チェックイン処理中
  | 'done'         // チェックイン完了
  | 'no_match'     // 顔が認識できなかった
  | 'error'        // エラー

// ── メインページ ──────────────────────────────────────────────────────────────

export default function FaceAuthPage() {
  const params = useParams<{ token: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  const mode = (searchParams.get('mode') ?? 'checkin') as 'checkin' | 'checkout'
  const isCheckout = mode === 'checkout'

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const [phase, setPhase]         = useState<Phase>('camera')
  const [isCheckingIn, setIsCheckingIn] = useState(false)
  const [capturedUrl, setCapturedUrl] = useState<string | null>(null)
  const [capturedDataUrl, setCapturedDataUrl] = useState<string | null>(null)
  const [visitor, setVisitor]     = useState<MatchedVisitor | null>(null)
  const [confidence, setConfidence] = useState(0)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [errorMsg, setErrorMsg]   = useState<string | null>(null)
  const [countdown, setCountdown] = useState(5)

  // ── カメラ起動 ───────────────────────────────────────────────────────────────

  const initCamera = useCallback(async () => {
    if (!videoRef.current) return
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('このブラウザはカメラに対応していません')
      setPhase('error')
      return
    }
    try {
      const stream = await startCamera(videoRef.current, { facingMode: 'user' })
      streamRef.current = stream
    } catch (err) {
      const name = (err as DOMException).name
      const msg = name === 'NotAllowedError'
        ? 'カメラの使用が許可されていません'
        : name === 'NotFoundError'
        ? 'カメラが見つかりません'
        : `カメラを起動できませんでした（${name}）`
      setCameraError(msg)
      setPhase('error')
    }
  }, [])

  useEffect(() => {
    if (phase === 'camera') initCamera()
    return () => {
      if (streamRef.current) stopCamera(streamRef.current)
    }
  }, [phase, initCamera])

  // ── 撮影 → 顔検索 ────────────────────────────────────────────────────────────

  const handleCapture = async () => {
    if (!videoRef.current) return
    const blob = captureFrame(videoRef.current)
    if (!blob) return

    if (streamRef.current) stopCamera(streamRef.current)
    setCapturedUrl(URL.createObjectURL(blob))

    // 圧縮 → dataURL
    const file = new File([blob], 'face.jpg', { type: 'image/jpeg' })
    const compressed = await compressImage(file)
    const dataUrl = await new Promise<string>(resolve => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.readAsDataURL(compressed)
    })
    setCapturedDataUrl(dataUrl)

    // Rekognition 問い合わせ
    setPhase('searching')
    try {
      const res = await fetch('/api/v1/visitors/face-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: params.token, facePhotoDataUrl: dataUrl }),
      })
      const data = await res.json()

      if (!res.ok) throw new Error(data.error || '検索に失敗しました')

      if (data.matched && data.visitor) {
        setVisitor(data.visitor)
        setConfidence(data.confidence)
        setPhase('confirm')
      } else {
        setPhase('no_match')
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'エラーが発生しました')
      setPhase('error')
    }
  }

  // ── 手荷物検査の要否チェック ─────────────────────────────────────────────────

  const isBaggageRequired = (context: 'checkin' | 'checkout'): boolean => {
    try {
      const raw = sessionStorage.getItem('reception-area-settings')
      if (!raw) return false
      const s = JSON.parse(raw)
      const key = context === 'checkin'
        ? 'require_baggage_inspection_checkin'
        : 'require_baggage_inspection_checkout'
      return (s[key] ?? 'none') !== 'none'
    } catch { return false }
  }

  // ── 確認後の処理 ─────────────────────────────────────────────────────────────

  const handleCheckIn = async () => {
    if (!visitor || isCheckingIn) return

    // ビジター情報を sessionStorage に保存（baggage 後の画面で使用）
    sessionStorage.setItem('reception-purpose-visitor', JSON.stringify({
      visitorId:  visitor.id,
      name:       visitor.name,
      company:    visitor.company,
      department: visitor.department,
      phone:      visitor.phone,
      email:      visitor.email,
      source:     'face-auth',
    }))

    if (!isCheckout) {
      // 入室モード: (手荷物検査 →) 来訪目的選択 → done
      const baggageDone = !!sessionStorage.getItem('reception-baggage-checkin-mode')
      if (isBaggageRequired('checkin') && !baggageDone) {
        router.replace(`/r/${params.token}/baggage?context=checkin&next=purpose-select`)
      } else {
        router.replace(`/r/${params.token}/purpose-select`)
      }
      return
    }

    // 退室モード: (手荷物検査 →) checkout ページで退室実行
    // visitorId を保存して checkout ページが顔認証退室を自動実行できるようにする
    sessionStorage.setItem('reception-face-checkout-visitor-id', visitor.id)

    // 前回フローの残留フラグを必ずリセット（stale なフラグで手荷物検査がスキップされるのを防ぐ）
    sessionStorage.removeItem('reception-baggage-checkout-done')
    sessionStorage.removeItem('reception-baggage-checkout-mode')
    sessionStorage.removeItem('reception-baggage-checkout-declaration')
    sessionStorage.removeItem('reception-baggage-checkout-photo-contents')
    sessionStorage.removeItem('reception-baggage-checkout-photo-empty')

    if (isBaggageRequired('checkout')) {
      router.replace(`/r/${params.token}/baggage?context=checkout`)
    } else {
      router.replace(`/r/${params.token}/checkout`)
    }
  }

  // ── 退室完了後 カウントダウン → TOP ─────────────────────────────────────────

  useEffect(() => {
    if (phase !== 'done') return
    const timer = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) {
          clearInterval(timer)
          window.location.href = `/r/${params.token}`
          return 0
        }
        return c - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [phase, params.token])

  // ── 通常フローへ ─────────────────────────────────────────────────────────────

  const goToNormalFlow = () => {
    if (isCheckout) {
      router.replace(`/r/${params.token}/checkout`)
    } else {
      router.replace(`/r/${params.token}/consent`)
    }
  }

  // ── 完了画面 ─────────────────────────────────────────────────────────────────

  if (phase === 'done') {
    const doneTitle = isCheckout ? '退室完了' : 'チェックイン完了'
    const doneSubtitle = isCheckout ? 'Check-out Complete' : 'Check-in Complete'
    const doneMsg = isCheckout ? '顔認証で退室しました' : '顔認証でチェックインしました'
    const doneIcon = isCheckout ? '🚶' : '👤'

    return (
      <div className="min-h-screen bg-[var(--ge-paper)] flex flex-col">
        <div className="bg-[var(--ge-accent)] px-6 pt-16 pb-14 text-white text-center relative">
          <div className="w-16 h-16 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-emerald-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold">{doneTitle}</h1>
          <p className="text-sm text-white/60 mt-1">{doneSubtitle}</p>
          <div className="absolute bottom-0 left-0 right-0 h-5 bg-[var(--ge-paper)] rounded-t-[20px]" />
        </div>

        <div className="px-5 -mt-1 flex-1 space-y-4">
          <div className="bg-white rounded-2xl p-6 shadow-sm text-center">
            <div className="w-12 h-12 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-3">
              <span className="text-2xl">{doneIcon}</span>
            </div>
            <p className="font-semibold text-[var(--ge-accent)] text-lg">{visitor?.name}</p>
            <p className="text-sm text-gray-400 mt-1">{visitor?.company}</p>
            <div className="mt-4 pt-4 border-t border-gray-100">
              <p className="text-sm text-gray-500">{doneMsg}</p>
              <p className="text-xs text-gray-400 mt-1">類似度: {confidence.toFixed(1)}%</p>
            </div>
          </div>
          <a
            href={`/r/${params.token}`}
            className="block w-full py-4 bg-[var(--ge-accent)] text-white text-center text-sm font-semibold rounded-2xl shadow-sm"
          >
            受付トップに戻る
            <span className="ml-2 text-white/60 text-xs font-normal">({countdown}秒後に自動で戻ります)</span>
          </a>
        </div>

        <div className="py-6 text-center mt-auto">
          <p className="text-[11px] text-gray-400 tracking-widest uppercase">
            Powered by Reception Kiosk
          </p>
        </div>
      </div>
    )
  }

  // ── 認識できなかった ──────────────────────────────────────────────────────────

  if (phase === 'no_match') {
    return (
      <div className="min-h-screen bg-[var(--ge-paper)] flex flex-col items-center justify-center px-8 text-center">
        <div className="text-5xl mb-4">😔</div>
        <h2 className="text-lg font-semibold text-[var(--ge-accent)] mb-2">
          顔を認識できませんでした
        </h2>
        <p className="text-sm text-gray-500 mb-8 leading-relaxed">
          {isCheckout
            ? '顔認証で退室できませんでした。\nデジタルパスでの退室をお試しください。'
            : '顔認証には事前の顔登録が必要です。\n通常の受付フォームからお手続きください。'}
        </p>

        <div className="w-full max-w-xs space-y-3">
          <button
            onClick={() => { setCapturedUrl(null); setPhase('camera') }}
            className="w-full py-3 border-2 border-[var(--ge-accent)] text-[var(--ge-accent)] rounded-[14px] font-medium text-sm"
          >
            もう一度試す
          </button>
          <button
            onClick={goToNormalFlow}
            className="w-full py-4 bg-[var(--ge-accent)] text-white rounded-[14px] text-base font-semibold"
          >
            {isCheckout ? 'デジタルパスで退室 →' : '通常フォームで入室登録 →'}
          </button>
        </div>
      </div>
    )
  }

  // ── エラー ────────────────────────────────────────────────────────────────────

  if (phase === 'error') {
    return (
      <div className="min-h-screen bg-[var(--ge-paper)] flex flex-col items-center justify-center px-8 text-center">
        <div className="text-5xl mb-4">⚠️</div>
        <h2 className="text-lg font-semibold text-[var(--ge-accent)] mb-2">エラーが発生しました</h2>
        <p className="text-sm text-gray-500 mb-8">{cameraError ?? errorMsg ?? 'もう一度お試しください'}</p>
        <button
          onClick={goToNormalFlow}
          className="w-full max-w-xs py-4 bg-[var(--ge-accent)] text-white rounded-[14px] text-base font-semibold"
        >
          通常フォームで入室登録 →
        </button>
      </div>
    )
  }

  // ── マッチ確認画面 ────────────────────────────────────────────────────────────

  if (phase === 'confirm' && visitor) {
    const isHighConfidence = confidence >= 90

    return (
      <div className="min-h-screen bg-[var(--ge-paper)] flex flex-col">
        {/* Header */}
        <div className="bg-[var(--ge-accent)] px-6 pt-10 pb-10 text-white text-center relative">
          <p className="text-sm text-white/60 mb-1">{isCheckout ? '顔認証で退室' : '顔認証でチェックイン'}</p>
          <h1 className="text-xl font-semibold">
            {isHighConfidence ? (isCheckout ? 'お疲れさまでした！' : 'お帰りなさい！') : 'こちらのお客様ですか？'}
          </h1>
          <div className="absolute bottom-0 left-0 right-0 h-5 bg-[var(--ge-paper)] rounded-t-[20px]" />
        </div>

        <div className="px-5 -mt-1 flex-1">
          {/* 撮影プレビュー + 認識結果 */}
          <div className="bg-white rounded-2xl p-5 shadow-sm mb-4">
            <div className="flex items-center gap-4">
              {/* 撮影した顔写真 */}
              {capturedUrl && (
                <div className="w-20 h-20 rounded-full overflow-hidden border-2 border-[var(--ge-accent)]/20 flex-shrink-0">
                  <img src={capturedUrl} alt="Captured" className="w-full h-full object-cover scale-x-[-1]" />
                </div>
              )}

              <div className="flex-1">
                <p className="font-bold text-[var(--ge-accent)] text-lg leading-tight">{visitor.name}</p>
                <p className="text-sm text-gray-500 mt-0.5">{visitor.company}</p>
                {visitor.department && (
                  <p className="text-xs text-gray-400">{visitor.department}</p>
                )}
              </div>
            </div>

            {/* 類似度バー */}
            <div className="mt-4 pt-4 border-t border-gray-100">
              <div className="flex justify-between text-xs text-gray-400 mb-1.5">
                <span>認識精度</span>
                <span className={`font-semibold ${isHighConfidence ? 'text-emerald-600' : 'text-amber-600'}`}>
                  {confidence.toFixed(1)}%
                </span>
              </div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${isHighConfidence ? 'bg-emerald-500' : 'bg-amber-500'}`}
                  style={{ width: `${confidence}%` }}
                />
              </div>
              {!isHighConfidence && (
                <p className="text-xs text-amber-600 mt-1.5">
                  精度が低めです。本人確認をお願いします。
                </p>
              )}
            </div>
          </div>

          {/* アクションボタン */}
          <div className="space-y-3">
            <button
              onClick={handleCheckIn}
              disabled={isCheckingIn}
              className="w-full py-5 bg-[var(--ge-accent)] text-white rounded-[14px] text-base font-semibold disabled:opacity-40 flex items-center justify-center gap-2"
            >
              {isCheckingIn
                ? <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                : <>
                    <span className="text-xl">{isCheckout ? '🚶' : '🚪'}</span>
                    {isCheckout ? 'はい、退室します' : 'はい、チェックインします'}
                  </>
              }
            </button>

            <button
              onClick={() => { setCapturedUrl(null); setCapturedDataUrl(null); setPhase('camera') }}
              className="w-full py-3 border border-gray-300 text-gray-600 rounded-[14px] text-sm font-medium"
            >
              別の人 / 撮り直す
            </button>

            <button
              onClick={goToNormalFlow}
              className="w-full py-3 text-gray-400 text-sm"
            >
              {isCheckout ? 'デジタルパスで退室' : '通常フォームで登録'}
            </button>
          </div>
        </div>

        <div className="bg-[var(--ge-accent)] py-4 text-center mt-auto">
          <p className="text-[11px] text-white/50">Reception Kiosk — Face Auth</p>
        </div>
      </div>
    )
  }

  // ── カメラ / 検索中 ───────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-black flex flex-col">
      {/* Header */}
      <div className="pt-10 pb-4 px-6 text-center">
        <button
          onClick={() => router.replace(isCheckout ? `/r/${params.token}/checkoutchoice` : `/r/${params.token}/checkin`)}
          className="text-gray-400 text-sm mb-3 flex items-center gap-1"
        >
          &larr; 戻る
        </button>
        <h1 className="text-white text-lg font-semibold">
          {isCheckout ? '顔認証で退室' : '顔認証でチェックイン'}
        </h1>
        <p className="text-gray-400 text-sm mt-1">
          {phase === 'searching'
            ? '認証中...'
            : '顔をカメラに向けて、ボタンを押してください'}
        </p>
      </div>

      {/* Camera / Captured preview */}
      <div className="flex-1 flex items-center justify-center px-6">
        <div className="relative w-64 h-80 rounded-3xl overflow-hidden bg-gray-900">
          {/* カメラ映像 */}
          {phase === 'camera' && (
            <>
              <video
                ref={videoRef}
                className="w-full h-full object-cover scale-x-[-1]"
                playsInline
                autoPlay
                muted
              />
              {/* 顔ガイド楕円 */}
              <div className="absolute inset-8 border-2 border-white/60 rounded-full pointer-events-none" />
              <div className="absolute bottom-3 left-0 right-0 text-center">
                <p className="text-white/50 text-xs">顔を枠内に収めてください</p>
              </div>
            </>
          )}

          {/* 撮影済みプレビュー (認証中) */}
          {(phase === 'searching') && capturedUrl && (
            <>
              <img src={capturedUrl} alt="Captured" className="w-full h-full object-cover scale-x-[-1]" />
              <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center gap-3">
                <div className="w-10 h-10 border-3 border-white border-t-transparent rounded-full animate-spin" />
                <p className="text-white text-sm font-medium">認証中...</p>
              </div>
            </>
          )}
        </div>
      </div>

      {/* 撮影ボタン */}
      <div className="pb-14 px-6 flex flex-col items-center gap-4">
        {phase === 'camera' && (
          <button
            onClick={handleCapture}
            className="w-20 h-20 rounded-full border-4 border-white flex items-center justify-center active:scale-95 transition-transform"
          >
            <div className="w-14 h-14 rounded-full bg-white flex items-center justify-center">
              <span className="text-2xl">👤</span>
            </div>
          </button>
        )}

        <button
          onClick={goToNormalFlow}
          className="text-gray-400 text-sm underline"
        >
          フォームで登録する
        </button>
      </div>
    </div>
  )
}
