'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { startCamera, captureFrame, stopCamera } from '@/lib/camera/capture'
import { compressImage } from '@/lib/camera/compress'
import { useLocale } from '@/lib/i18n/useLocale'
import { useAnnounce } from '@/lib/speech/useAnnounce'

type Phase = 'camera' | 'preview' | 'scanning' | 'error'

export default function CardCapturePage() {
  const params = useParams<{ token: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  const preToken = searchParams.get('pre')
  const { t } = useLocale()
  const { announce } = useAnnounce()
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const [phase, setPhase] = useState<Phase>('camera')
  const [capturedImage, setCapturedImage] = useState<string | null>(null)
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [scanProgress, setScanProgress] = useState<string>('名刺を読み取り中...')
  const [cardRequired, setCardRequired] = useState(false)

  // 店舗設定を読み込む
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('reception-area-settings')
      if (raw) {
        const s = JSON.parse(raw)
        setCardRequired(s.require_business_card === 'required')
      }
    } catch { /* ignore */ }
  }, [])

  const initCamera = useCallback(async () => {
    if (!videoRef.current) return
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError(
        window.isSecureContext === false
          ? 'カメラにはHTTPS接続が必要です。QRコードのURLを確認してください。'
          : 'このブラウザはカメラに対応していません'
      )
      setPhase('error')
      return
    }
    try {
      const stream = await startCamera(videoRef.current, { facingMode: 'environment' })
      streamRef.current = stream
    } catch (err) {
      const name = (err as DOMException).name
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        setCameraError('カメラの使用が許可されていません。ブラウザの設定でカメラを許可してください。')
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        setCameraError('カメラが見つかりません。端末にカメラが接続されているか確認してください。')
      } else if (name === 'NotReadableError' || name === 'TrackStartError') {
        setCameraError('カメラが他のアプリで使用中です。他のアプリを閉じてから再試行してください。')
      } else {
        setCameraError(`カメラを起動できませんでした（${name ?? 'Unknown'}）`)
      }
      setPhase('error')
    }
  }, [])

  useEffect(() => {
    initCamera()
    return () => { if (streamRef.current) stopCamera(streamRef.current) }
  }, [initCamera])

  // カメラフェーズ開始時にアナウンス
  useEffect(() => {
    if (phase === 'camera') announce('card')
  }, [phase, announce])

  const handleCapture = () => {
    if (!videoRef.current) return
    const blob = captureFrame(videoRef.current)
    if (blob) {
      setCapturedBlob(blob)
      setCapturedImage(URL.createObjectURL(blob))
      setPhase('preview')
      if (streamRef.current) stopCamera(streamRef.current)
    }
  }

  const handleRetake = async () => {
    setCapturedImage(null)
    setCapturedBlob(null)
    setPhase('camera')
    await initCamera()
  }

  // 「使用する」→ OCR → register へ
  const handleUse = async () => {
    if (!capturedBlob) return
    setPhase('scanning')
    setScanProgress('画像を圧縮中...')

    try {
      // 1. 圧縮
      const file = new File([capturedBlob], 'card.jpg', { type: 'image/jpeg' })
      const compressed = await compressImage(file)

      // 2. base64 変換
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = reject
        reader.readAsDataURL(compressed)
      })

      // 3. sessionStorage に写真を保存
      sessionStorage.setItem('reception-card-photo', dataUrl)

      // 4. OCR API 呼び出し
      setScanProgress('名刺を読み取り中...')
      const res = await fetch('/api/v1/ocr/business-card', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataUrl, token: params.token }),
      })

      if (res.ok) {
        const { result } = await res.json()
        if (result) {
          sessionStorage.setItem('reception-ocr-result', JSON.stringify(result))
        }
      } else {
        // 503: APIキー未設定 / 500: OCRエラー → スキップして続行
        const status = res.status
        console.warn(`[OCR] API returned ${status} — skipping OCR`)
      }

      // 5. register ページへ（OCR結果がある場合は自動入力される）
      router.push(`/r/${params.token}/register${preToken ? `?pre=${preToken}` : ''}`)
    } catch (err) {
      console.error('[card] error:', err)
      // エラーでも写真なしで先へ進む
      router.push(`/r/${params.token}/register${preToken ? `?pre=${preToken}` : ''}`)
    }
  }

  // 名刺をスキップ → そのまま register へ
  const handleSkip = () => {
    sessionStorage.removeItem('reception-card-photo')
    sessionStorage.removeItem('reception-ocr-result')
    router.push(`/r/${params.token}/register${preToken ? `?pre=${preToken}` : ''}`)
  }

  // ── エラー画面 ─────────────────────────────────────────────────────────
  if (phase === 'error') {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center px-8">
        <p className="text-white text-center mb-6">{cameraError}</p>
        <button
          onClick={handleSkip}
          className="px-6 py-3 bg-white text-black rounded-xl font-medium"
        >
          {t('camera.manualEntry')}
        </button>
      </div>
    )
  }

  // ── OCR 読み取り中 ────────────────────────────────────────────────────
  if (phase === 'scanning') {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center px-8 gap-6">
        {capturedImage && (
          <div className="w-full max-w-sm aspect-[16/10] rounded-2xl overflow-hidden opacity-60">
            <img src={capturedImage} alt="card" className="w-full h-full object-cover" />
          </div>
        )}
        {/* スピナー */}
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-white/20 border-t-white rounded-full animate-spin" />
          <p className="text-white text-sm">{scanProgress}</p>
        </div>
      </div>
    )
  }

  // ── メイン画面 ────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-black flex flex-col">
      {/* ステップ表示 */}
      <div className="pt-10 pb-2 px-6 text-center">
        <div className="flex items-center justify-between mb-3">
          <button onClick={() => router.back()} className="text-white/50 text-xs flex items-center gap-1">
            ← 戻る
          </button>
          <div className="flex items-center gap-1">
            <span className="w-6 h-1 rounded-full bg-white" />
            <span className="w-6 h-1 rounded-full bg-white/30" />
            <span className="w-6 h-1 rounded-full bg-white/30" />
          </div>
          <a href={`/r/${params.token}`} className="text-white/50 text-xs">
            TOPへ ↑
          </a>
        </div>
        <h1 className="text-white text-lg font-medium">{t('camera.businessCard')}</h1>
        <p className="text-gray-400 text-sm mt-1">{t('camera.businessCardGuide')}</p>
        <p className="text-gray-500 text-xs mt-1">📋 OCRで情報を自動入力します</p>
      </div>

      {/* カメラ / プレビュー */}
      <div className="flex-1 flex items-center justify-center px-6">
        <div className="relative w-full max-w-sm aspect-[16/10] rounded-2xl overflow-hidden bg-gray-900">
          {phase === 'camera' && (
            <>
              <video
                ref={videoRef}
                className="w-full h-full object-cover"
                playsInline
                autoPlay
                muted
              />
              {/* ガイド枠 */}
              <div className="absolute inset-4 border-2 border-white/50 rounded-lg pointer-events-none" />
              <div className="absolute bottom-3 left-0 right-0 text-center text-white/40 text-xs">
                名刺を枠内に収めてください
              </div>
            </>
          )}
          {phase === 'preview' && capturedImage && (
            <img src={capturedImage} alt="Captured" className="w-full h-full object-cover" />
          )}
        </div>
      </div>

      {/* コントロール */}
      <div className="pb-12 px-6">
        {phase === 'camera' && (
          <div className="flex items-center justify-center gap-6">
            {cardRequired ? (
              <div className="w-16 text-center text-xs text-red-400">必須</div>
            ) : (
              <button onClick={handleSkip} className="text-gray-400 text-sm w-16 text-center">
                {t('common.skip')}
              </button>
            )}
            <button
              onClick={handleCapture}
              className="w-16 h-16 rounded-full border-4 border-white flex items-center justify-center"
            >
              <div className="w-12 h-12 rounded-full bg-white" />
            </button>
            <div className="w-16" />
          </div>
        )}
        {phase === 'preview' && (
          <div className="flex gap-3">
            <button
              onClick={handleRetake}
              className="flex-1 py-4 border-2 border-white text-white rounded-xl font-medium"
            >
              {t('camera.retake')}
            </button>
            <button
              onClick={handleUse}
              className="flex-1 py-4 bg-white text-black rounded-xl font-medium flex items-center justify-center gap-2"
            >
              <span>📋</span>
              <span>読み取る</span>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
