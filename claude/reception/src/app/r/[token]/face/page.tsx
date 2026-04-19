'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { startCamera, captureFrame, stopCamera } from '@/lib/camera/capture'
import { compressImage } from '@/lib/camera/compress'
import { useLocale } from '@/lib/i18n/useLocale'
import { useAnnounce } from '@/lib/speech/useAnnounce'

export default function FaceCapturePage() {
  const params = useParams<{ token: string }>()
  const router = useRouter()
  const { t } = useLocale()
  const { announce } = useAnnounce()
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const [phase, setPhase] = useState<'camera' | 'preview' | 'error'>('camera')
  const [capturedImage, setCapturedImage] = useState<string | null>(null)
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [faceRequired, setFaceRequired] = useState(false)

  // 店舗設定を読み込む
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('reception-area-settings')
      if (raw) {
        const s = JSON.parse(raw)
        setFaceRequired(s.require_face_photo === 'required')
        // hidden の場合はスキップして確認画面へ
        if (s.require_face_photo === 'hidden') {
          router.replace(`/r/${params.token}/confirm`)
        }
      }
    } catch { /* ignore */ }
  }, [params.token, router])

  const initCamera = useCallback(async () => {
    if (!videoRef.current) return

    // Secure context check — getUserMedia is blocked on HTTP non-localhost
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
      const stream = await startCamera(videoRef.current, { facingMode: 'user' })
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
    return () => {
      if (streamRef.current) stopCamera(streamRef.current)
    }
  }, [initCamera])

  // カメラ起動時にアナウンス
  useEffect(() => {
    if (phase === 'camera') announce('face')
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

  const handleUse = async () => {
    if (!capturedBlob) return

    const file = new File([capturedBlob], 'face.jpg', { type: 'image/jpeg' })
    const compressed = await compressImage(file)

    const reader = new FileReader()
    reader.onload = () => {
      sessionStorage.setItem('reception-face-photo', reader.result as string)
      router.push(`/r/${params.token}/confirm`)
    }
    reader.readAsDataURL(compressed)
  }

  const handleSkip = () => {
    router.push(`/r/${params.token}/confirm`)
  }

  if (phase === 'error') {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center px-8">
        <p className="text-white text-center mb-6">{cameraError}</p>
        <button
          onClick={handleSkip}
          className="px-6 py-3 bg-white text-black rounded-xl font-medium"
        >
          {t('common.skip')}
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-black flex flex-col">
      {/* Header */}
      <div className="pt-12 pb-4 px-6 text-center">
        <h1 className="text-white text-lg font-medium">{t('camera.facePhoto')}</h1>
        <p className="text-gray-400 text-sm mt-1">{t('camera.facePhotoGuide')}</p>
      </div>

      {/* Camera / Preview */}
      <div className="flex-1 flex items-center justify-center px-6">
        <div className="relative w-64 h-80 rounded-2xl overflow-hidden">
          {phase === 'camera' && (
            <>
              <video
                ref={videoRef}
                className="w-full h-full object-cover scale-x-[-1]"
                playsInline
                autoPlay
                muted
              />
              {/* Oval guide */}
              <div className="absolute inset-8 border-2 border-white/50 rounded-full pointer-events-none" />
            </>
          )}
          {phase === 'preview' && capturedImage && (
            <img
              src={capturedImage}
              alt="Captured"
              className="w-full h-full object-cover scale-x-[-1]"
            />
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="pb-12 px-6">
        {phase === 'camera' && (
          <div className="flex items-center justify-center gap-6">
            {faceRequired ? (
              <div className="w-12 text-center text-xs text-red-400">必須</div>
            ) : (
              <button onClick={handleSkip} className="text-gray-400 text-sm">
                {t('common.skip')}
              </button>
            )}
            <button
              onClick={handleCapture}
              className="w-16 h-16 rounded-full border-4 border-white flex items-center justify-center"
            >
              <div className="w-12 h-12 rounded-full bg-white" />
            </button>
            <div className="w-12" />
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
              className="flex-1 py-4 bg-white text-black rounded-xl font-medium"
            >
              {t('camera.usePhoto')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
