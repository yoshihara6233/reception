'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useLocale } from '@/lib/i18n/useLocale'

type Phase = 'requesting' | 'scanning' | 'error' | 'unsupported'

// BarcodeDetector は Chrome/Safari のみ — TypeScript の型定義がないため手動定義
declare class BarcodeDetector {
  constructor(options: { formats: string[] })
  detect(source: HTMLVideoElement | HTMLImageElement | ImageBitmap): Promise<Array<{ rawValue: string }>>
  static getSupportedFormats(): Promise<string[]>
}

export default function ScanQrPage() {
  const params = useParams<{ token: string }>()
  const router = useRouter()
  const { locale } = useLocale()

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number | null>(null)
  const detectorRef = useRef<InstanceType<typeof BarcodeDetector> | null>(null)

  const [phase, setPhase] = useState<Phase>('requesting')
  const [errorMsg, setErrorMsg] = useState('')

  const t = (ja: string, en: string) => locale === 'ja' ? ja : en

  useEffect(() => {
    // BarcodeDetector API サポートチェック
    if (!('BarcodeDetector' in window)) {
      setPhase('unsupported')
      return
    }

    let stopped = false

    async function start() {
      try {
        detectorRef.current = new BarcodeDetector({ formats: ['qr_code'] })

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        })
        if (stopped) { stream.getTracks().forEach(t => t.stop()); return }

        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }
        setPhase('scanning')
        scan()
      } catch (err) {
        if (stopped) return
        const msg = (err as Error).message || ''
        if (msg.includes('Permission') || msg.includes('NotAllowed')) {
          setErrorMsg(t('カメラへのアクセスが拒否されました。ブラウザの設定でカメラを許可してください。', 'Camera access denied. Please allow camera in browser settings.'))
        } else {
          setErrorMsg(msg || t('カメラを起動できませんでした', 'Could not start camera'))
        }
        setPhase('error')
      }
    }

    async function scan() {
      if (stopped || !videoRef.current || !detectorRef.current) return
      if (videoRef.current.readyState < 2) {
        rafRef.current = requestAnimationFrame(scan)
        return
      }

      try {
        const barcodes = await detectorRef.current.detect(videoRef.current)
        if (barcodes.length > 0) {
          const raw: string = barcodes[0].rawValue
          handleDetected(raw)
          return
        }
      } catch { /* ignore frame errors */ }

      if (!stopped) {
        rafRef.current = requestAnimationFrame(scan)
      }
    }

    function handleDetected(raw: string) {
      stopped = true
      stopCamera()

      try {
        const url = new URL(raw)
        const preToken = url.searchParams.get('pre')

        if (preToken) {
          // 事前登録QR: /r/{area_token}?pre={pre_token} → そのまま受付フローへ
          router.replace(`/r/${params.token}/consent?pre=${preToken}`)
        } else if (url.pathname.startsWith('/r/')) {
          // 別エリアのキオスクQR → そのページに遷移
          router.replace(url.pathname + url.search)
        } else {
          // 未対応のQR → エラー表示して再スキャン
          setErrorMsg(t('このQRコードは対応していません。事前登録QRをかざしてください。', 'QR code not recognized. Please show your pre-registration QR.'))
          setPhase('error')
        }
      } catch {
        setErrorMsg(t('QRコードを読み取れませんでした。もう一度お試しください。', 'Could not read QR code. Please try again.'))
        setPhase('error')
      }
    }

    start()

    return () => {
      stopped = true
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      stopCamera()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function stopCamera() {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }

  const handleRetry = () => {
    setPhase('requesting')
    setErrorMsg('')
    // Remount by navigating to the same page
    router.replace(`/r/${params.token}/scan`)
  }

  return (
    <div className="min-h-screen bg-black flex flex-col">
      {/* Header */}
      <div className="bg-gradient-to-b from-black/80 to-transparent px-5 pt-10 pb-6 z-10 relative">
        <button
          onClick={() => router.back()}
          className="text-white/60 text-sm flex items-center gap-1 mb-4"
        >
          &larr; {t('戻る', 'Back')}
        </button>
        <h1 className="text-white text-lg font-semibold">
          {t('事前登録QRを読み取る', 'Scan Pre-Registration QR')}
        </h1>
        <p className="text-white/60 text-sm mt-1">
          {t('スマートフォンに表示されたQRコードをカメラにかざしてください', 'Hold the QR code from your smartphone up to the camera')}
        </p>
      </div>

      {/* Camera / Status area */}
      <div className="flex-1 relative flex items-center justify-center">
        {/* Video feed */}
        <video
          ref={videoRef}
          className="absolute inset-0 w-full h-full object-cover"
          playsInline
          muted
        />

        {/* Overlay */}
        {phase === 'scanning' && (
          <div className="relative z-10 flex flex-col items-center">
            {/* Viewfinder frame */}
            <div className="w-64 h-64 relative">
              <div className="absolute inset-0 border-2 border-white/30 rounded-2xl" />
              {/* Corner accents */}
              <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-white rounded-tl-xl" />
              <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-white rounded-tr-xl" />
              <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-white rounded-bl-xl" />
              <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-white rounded-br-xl" />
              {/* Scan line animation */}
              <div className="absolute left-2 right-2 h-0.5 bg-emerald-400 rounded-full opacity-80 animate-scan-line" />
            </div>
            <p className="text-white/70 text-sm mt-6 text-center px-6">
              {t('QRコードを枠内に合わせてください', 'Align the QR code within the frame')}
            </p>
          </div>
        )}

        {/* Loading */}
        {phase === 'requesting' && (
          <div className="relative z-10 text-center">
            <div className="w-10 h-10 border-2 border-white border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-white/70 text-sm">
              {t('カメラを起動中...', 'Starting camera...')}
            </p>
          </div>
        )}

        {/* Error */}
        {(phase === 'error' || phase === 'unsupported') && (
          <div className="relative z-10 bg-black/80 rounded-2xl p-6 mx-6 text-center max-w-sm">
            <div className="text-4xl mb-4">
              {phase === 'unsupported' ? '📵' : '⚠️'}
            </div>
            <h2 className="text-white font-semibold mb-2">
              {phase === 'unsupported'
                ? t('このブラウザはQRスキャンに対応していません', 'QR scanning not supported in this browser')
                : t('エラーが発生しました', 'An error occurred')}
            </h2>
            <p className="text-white/60 text-sm mb-6">
              {phase === 'unsupported'
                ? t('Chrome または Safari の最新版をお使いください', 'Please use the latest Chrome or Safari')
                : errorMsg}
            </p>
            <div className="flex gap-3 flex-col">
              {phase === 'error' && (
                <button
                  onClick={handleRetry}
                  className="w-full py-3 bg-white text-black rounded-xl font-semibold text-sm"
                >
                  {t('もう一度試す', 'Try Again')}
                </button>
              )}
              <button
                onClick={() => router.back()}
                className="w-full py-3 border border-white/30 text-white rounded-xl text-sm"
              >
                {t('戻る', 'Back')}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Tailwind custom animation */}
      <style>{`
        @keyframes scan-line {
          0%   { top: 8px; }
          100% { top: calc(100% - 8px); }
        }
        .animate-scan-line {
          animation: scan-line 2s ease-in-out infinite alternate;
        }
      `}</style>
    </div>
  )
}
