'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useLocale } from '@/lib/i18n/useLocale'

type Phase = 'requesting' | 'scanning' | 'error' | 'photo-fallback'

// BarcodeDetector は Chrome/Safari のみ — TypeScript の型定義がないため手動定義
declare class BarcodeDetector {
  constructor(options: { formats: string[] })
  detect(source: HTMLVideoElement | HTMLImageElement | ImageBitmap): Promise<Array<{ rawValue: string }>>
  static getSupportedFormats(): Promise<string[]>
}

export default function ScanQrPage() {
  const params = useParams<{ token: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { locale } = useLocale()
  const mode = (searchParams.get('mode') ?? 'checkin') as 'checkin' | 'checkout'
  const isCheckout = mode === 'checkout'

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number | null>(null)
  const detectorRef = useRef<InstanceType<typeof BarcodeDetector> | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [phase, setPhase] = useState<Phase>('requesting')
  const [errorMsg, setErrorMsg] = useState('')
  const [photoDecoding, setPhotoDecoding] = useState(false)

  const L = (ja: string, en: string, zh: string = en, ko: string = en) => {
    if (locale === 'zh') return zh
    if (locale === 'ko') return ko
    if (locale === 'ja') return ja
    return en
  }

  const handleDetected = useCallback((raw: string) => {
    try {
      const url = new URL(raw)
      const preToken = url.searchParams.get('pre')

      if (preToken) {
        if (isCheckout) {
          router.replace(`/r/${params.token}/checkout?pre=${preToken}`)
        } else {
          router.replace(`/r/${params.token}/consent?pre=${preToken}`)
        }
      } else if (url.pathname.startsWith('/r/')) {
        router.replace(url.pathname + url.search)
      } else {
        setErrorMsg(L('このQRコードは対応していません。事前登録QRをかざしてください。', 'QR code not recognized. Please show your pre-registration QR.', '此二维码不受支持，请出示预注册二维码。', '이 QR 코드는 지원되지 않습니다. 사전 등록 QR 코드를 제시해 주세요.'))
        setPhase('error')
      }
    } catch {
      setErrorMsg(L('QRコードを読み取れませんでした。もう一度お試しください。', 'Could not read QR code. Please try again.', '无法读取二维码，请重试。', 'QR 코드를 읽을 수 없습니다. 다시 시도해 주세요.'))
      setPhase('error')
    }
  }, [isCheckout, params.token, router, locale]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // BarcodeDetector API サポートチェック — 非対応の場合は写真フォールバック
    if (!('BarcodeDetector' in window)) {
      setPhase('photo-fallback')
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
          setErrorMsg(L('カメラへのアクセスが拒否されました。ブラウザの設定でカメラを許可してください。', 'Camera access denied. Please allow camera in browser settings.', '相机访问被拒绝，请在浏览器设置中允许相机。', '카메라 접근이 거부되었습니다. 브라우저 설정에서 카메라를 허용해 주세요.'))
        } else {
          setErrorMsg(msg || L('カメラを起動できませんでした', 'Could not start camera', '无法启动相机', '카메라를 시작할 수 없습니다'))
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
          stopped = true
          stopCamera()
          handleDetected(barcodes[0].rawValue)
          return
        }
      } catch { /* ignore frame errors */ }

      if (!stopped) {
        rafRef.current = requestAnimationFrame(scan)
      }
    }

    start()

    return () => {
      stopped = true
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      stopCamera()
    }
  }, [handleDetected]) // eslint-disable-line react-hooks/exhaustive-deps

  function stopCamera() {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }

  // jsQR フォールバック: 写真を撮ってQRを読み取る
  const handlePhotoSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setPhotoDecoding(true)

    try {
      const jsQR = (await import('jsqr')).default
      const img = new Image()
      const url = URL.createObjectURL(file)
      img.src = url

      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = reject
      })

      const canvas = document.createElement('canvas')
      canvas.width = img.width
      canvas.height = img.height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      URL.revokeObjectURL(url)

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const code = jsQR(imageData.data, imageData.width, imageData.height)

      if (code) {
        handleDetected(code.data)
      } else {
        setErrorMsg(L('QRコードが見つかりませんでした。明るい場所でQRコード全体が写るように撮影してください。', 'QR code not found. Please take a clear photo of the entire QR code in good lighting.', '未找到二维码，请在光线充足的地方拍摄完整的二维码。', 'QR 코드를 찾을 수 없습니다. 밝은 곳에서 QR 코드 전체가 나오도록 촬영해 주세요.'))
        setPhase('error')
      }
    } catch {
      setErrorMsg(L('写真の読み取りに失敗しました。', 'Failed to read the photo.', '读取照片失败。', '사진 읽기에 실패했습니다.'))
      setPhase('error')
    } finally {
      setPhotoDecoding(false)
      // Reset file input for re-selection
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleRetry = () => {
    setPhase('requesting')
    setErrorMsg('')
    router.replace(`/r/${params.token}/scan?mode=${mode}`)
  }

  const handleBack = () => {
    router.replace(`/r/${params.token}`)
  }

  return (
    <div className="min-h-screen bg-black flex flex-col">
      {/* Header */}
      <div className="bg-gradient-to-b from-black/80 to-transparent px-5 pt-10 pb-6 z-10 relative">
        <button
          onClick={handleBack}
          className="text-white/60 text-sm flex items-center gap-1 mb-4"
        >
          &larr; {L('戻る', 'Back', '返回', '돌아가기')}
        </button>
        <h1 className="text-white text-lg font-semibold">
          {isCheckout
            ? L('退室用QRを読み取る', 'Scan QR for Check-Out', '扫描离场二维码', '퇴실용 QR 스캔')
            : L('事前登録QRを読み取る', 'Scan Pre-Registration QR', '扫描预注册二维码', '사전 등록 QR 스캔')}
        </h1>
        <p className="text-white/60 text-sm mt-1">
          {L('スマートフォンに表示されたQRコードをカメラにかざしてください', 'Hold the QR code from your smartphone up to the camera', '请将手机上显示的二维码对准相机', '스마트폰에 표시된 QR 코드를 카메라에 비춰주세요')}
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

        {/* Scanning overlay */}
        {phase === 'scanning' && (
          <div className="relative z-10 flex flex-col items-center">
            <div className="w-64 h-64 relative">
              <div className="absolute inset-0 border-2 border-white/30 rounded-2xl" />
              <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-white rounded-tl-xl" />
              <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-white rounded-tr-xl" />
              <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-white rounded-bl-xl" />
              <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-white rounded-br-xl" />
              <div className="absolute left-2 right-2 h-0.5 bg-emerald-400 rounded-full opacity-80 animate-scan-line" />
            </div>
            <p className="text-white/70 text-sm mt-6 text-center px-6">
              {L('QRコードを枠内に合わせてください', 'Align the QR code within the frame', '请将二维码对准框内', 'QR 코드를 프레임 안에 맞춰주세요')}
            </p>
          </div>
        )}

        {/* Loading */}
        {phase === 'requesting' && (
          <div className="relative z-10 text-center">
            <div className="w-10 h-10 border-2 border-white border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-white/70 text-sm">
              {L('カメラを起動中...', 'Starting camera...', '正在启动相机...', '카메라 시작 중...')}
            </p>
          </div>
        )}

        {/* Photo fallback (iPhone Safari / browsers without BarcodeDetector) */}
        {phase === 'photo-fallback' && (
          <div className="relative z-10 bg-black/80 rounded-2xl p-6 mx-6 text-center max-w-sm w-full">
            <div className="text-5xl mb-4">📷</div>
            <h2 className="text-white font-semibold mb-2">
              {L('QRコードを写真で読み取る', 'Scan QR Code via Photo', '通过拍照扫描二维码', '사진으로 QR 코드 스캔')}
            </h2>
            <p className="text-white/60 text-sm mb-6">
              {L(
                'カメラでQRコードを撮影してください。明るい場所でQRコード全体が写るように撮ってください。',
                'Take a photo of the QR code. Make sure the entire QR code is visible in good lighting.',
                '请拍摄二维码照片，确保在光线充足的地方拍摄完整的二维码。',
                'QR 코드를 촬영해 주세요. 밝은 곳에서 QR 코드 전체가 나오도록 촬영해 주세요.'
              )}
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handlePhotoSelected}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={photoDecoding}
              className="w-full py-4 bg-white text-black rounded-xl font-semibold text-sm mb-3 disabled:opacity-50"
            >
              {photoDecoding
                ? L('読み取り中...', 'Scanning...', '正在扫描...', '스캔 중...')
                : L('📷  写真を撮る', '📷  Take Photo', '📷  拍照', '📷  사진 촬영')}
            </button>
            <button
              onClick={handleBack}
              className="w-full py-3 border border-white/30 text-white rounded-xl text-sm"
            >
              {L('戻る', 'Back', '返回', '돌아가기')}
            </button>
          </div>
        )}

        {/* Error */}
        {phase === 'error' && (
          <div className="relative z-10 bg-black/80 rounded-2xl p-6 mx-6 text-center max-w-sm">
            <div className="text-4xl mb-4">⚠️</div>
            <h2 className="text-white font-semibold mb-2">
              {L('エラーが発生しました', 'An error occurred', '发生错误', '오류가 발생했습니다')}
            </h2>
            <p className="text-white/60 text-sm mb-6">{errorMsg}</p>
            <div className="flex gap-3 flex-col">
              <button
                onClick={handleRetry}
                className="w-full py-3 bg-white text-black rounded-xl font-semibold text-sm"
              >
                {L('もう一度試す', 'Try Again', '重试', '다시 시도')}
              </button>
              <button
                onClick={handleBack}
                className="w-full py-3 border border-white/30 text-white rounded-xl text-sm"
              >
                {L('戻る', 'Back', '返回', '돌아가기')}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Hidden file input (global, for photo fallback) */}
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
