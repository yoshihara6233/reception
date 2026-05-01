'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { startCamera, captureFrame, stopCamera } from '@/lib/camera/capture'
import { compressImage } from '@/lib/camera/compress'
import { useLocale } from '@/lib/i18n/useLocale'
import { useAnnounce } from '@/lib/speech/useAnnounce'

/**
 * 手荷物検査フロー (2枚撮影)
 *
 * declare          → 申告テキスト入力
 * camera_contents  → 1枚目: カバンの中身を出して撮影
 * preview_contents → 1枚目プレビュー確認
 * camera_empty     → 2枚目: 空のカバンの中を撮影
 * preview_empty    → 2枚目プレビュー確認
 */
type Phase =
  | 'declare'
  | 'camera_contents'
  | 'preview_contents'
  | 'camera_empty'
  | 'preview_empty'

export default function BaggagePage() {
  const params = useParams<{ token: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  const context = (searchParams.get('context') ?? 'checkin') as 'checkin' | 'checkout'
  const { t } = useLocale()
  const { announce, stop } = useAnnounce()

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const [phase, setPhase] = useState<Phase>('declare')
  const [declaration, setDeclaration] = useState('')

  // 1枚目: 中身写真
  const [imgContents, setImgContents] = useState<string | null>(null)
  const [blobContents, setBlobContents] = useState<Blob | null>(null)
  // 2枚目: 空カバン写真
  const [imgEmpty, setImgEmpty] = useState<string | null>(null)
  const [blobEmpty, setBlobEmpty] = useState<Blob | null>(null)

  const [inspectionMode, setInspectionMode] = useState<'photo' | 'video'>('photo')
  const [baggageRequired, setBaggageRequired] = useState(false)
  const [cameraAvailable, setCameraAvailable] = useState(true)

  // 店舗設定読み込み
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('reception-area-settings')
      if (raw) {
        const s = JSON.parse(raw)
        const key = context === 'checkin'
          ? 'require_baggage_inspection_checkin'
          : 'require_baggage_inspection_checkout'
        const val = s[key] ?? 'none'
        if (val === 'none') {
          router.replace(context === 'checkin'
            ? `/r/${params.token}/confirm`
            : `/r/${params.token}/checkout`)
          return
        }
        const mode = val === 'video' ? 'video' : 'photo'
        setInspectionMode(mode)
        setBaggageRequired(false) // no longer used for photo, keep for compat
      }
    } catch { /* ignore */ }
    if (!navigator.mediaDevices?.getUserMedia) setCameraAvailable(false)
  }, [params.token, router, context])

  useEffect(() => {
    if (phase === 'declare') announce('baggage')
  }, [phase, announce])

  // カメラ起動
  const initCamera = useCallback(async () => {
    if (!videoRef.current || !navigator.mediaDevices?.getUserMedia) {
      setCameraAvailable(false)
      return
    }
    try {
      const stream = await startCamera(videoRef.current, { facingMode: 'environment' })
      streamRef.current = stream
    } catch {
      setCameraAvailable(false)
      setPhase('declare')
    }
  }, [])

  useEffect(() => {
    if (phase === 'camera_contents' || phase === 'camera_empty') {
      initCamera()
    }
    return () => {
      if (
        (phase === 'camera_contents' || phase === 'camera_empty') &&
        streamRef.current
      ) {
        stopCamera(streamRef.current)
      }
    }
  }, [phase, initCamera])

  // 撮影
  const handleCapture = () => {
    if (!videoRef.current) return
    const blob = captureFrame(videoRef.current)
    if (!blob) return
    if (streamRef.current) stopCamera(streamRef.current)

    if (phase === 'camera_contents') {
      setBlobContents(blob)
      setImgContents(URL.createObjectURL(blob))
      setPhase('preview_contents')
    } else {
      setBlobEmpty(blob)
      setImgEmpty(URL.createObjectURL(blob))
      setPhase('preview_empty')
    }
  }

  // 撮り直し
  const handleRetake = () => {
    if (phase === 'preview_contents') {
      setBlobContents(null)
      setImgContents(null)
      setPhase('camera_contents')
    } else {
      setBlobEmpty(null)
      setImgEmpty(null)
      setPhase('camera_empty')
    }
  }

  // 1枚目を採用 → 2枚目へ
  const handleUseContents = async () => {
    if (!blobContents) return
    const file = new File([blobContents], 'baggage-contents.jpg', { type: 'image/jpeg' })
    const compressed = await compressImage(file)
    const reader = new FileReader()
    reader.onload = () => {
      sessionStorage.setItem(`reception-baggage-${context}-photo-contents`, reader.result as string)
      setPhase('camera_empty')
    }
    reader.readAsDataURL(compressed)
  }

  // 2枚目を採用 → declareに戻る（両方完了）
  const handleUseEmpty = async () => {
    if (!blobEmpty) return
    const file = new File([blobEmpty], 'baggage-empty.jpg', { type: 'image/jpeg' })
    const compressed = await compressImage(file)
    const reader = new FileReader()
    reader.onload = () => {
      sessionStorage.setItem(`reception-baggage-${context}-photo-empty`, reader.result as string)
      setPhase('declare')
    }
    reader.readAsDataURL(compressed)
  }

  // 写真を全削除
  const handleRemovePhotos = () => {
    setBlobContents(null); setImgContents(null)
    setBlobEmpty(null); setImgEmpty(null)
    sessionStorage.removeItem(`reception-baggage-${context}-photo-contents`)
    sessionStorage.removeItem(`reception-baggage-${context}-photo-empty`)
  }

  // 次ページへ
  const navigateNext = () => {
    if (context === 'checkout') {
      sessionStorage.setItem('reception-baggage-checkout-done', '1')
    }
    router.push(context === 'checkin'
      ? `/r/${params.token}/confirm`
      : `/r/${params.token}/checkout`)
  }

  const handleNext = () => {
    stop()
    const declKey = `reception-baggage-${context}-declaration`
    declaration.trim()
      ? sessionStorage.setItem(declKey, declaration.trim())
      : sessionStorage.removeItem(declKey)
    sessionStorage.setItem(`reception-baggage-${context}-mode`, inspectionMode)
    navigateNext()
  }

  const handleSkip = () => {
    stop()
    ;[`reception-baggage-${context}-declaration`,
      `reception-baggage-${context}-photo-contents`,
      `reception-baggage-${context}-photo-empty`,
    ].forEach(k => sessionStorage.removeItem(k))
    setBlobContents(null); setImgContents(null)
    setBlobEmpty(null); setImgEmpty(null)
    navigateNext()
  }

  const hasContentsPhoto = !!imgContents ||
    (typeof window !== 'undefined' && !!sessionStorage.getItem(`reception-baggage-${context}-photo-contents`))
  const hasEmptyPhoto = !!imgEmpty ||
    (typeof window !== 'undefined' && !!sessionStorage.getItem(`reception-baggage-${context}-photo-empty`))
  const bothPhotos = hasContentsPhoto && hasEmptyPhoto

  const isCheckin = context === 'checkin'

  const StepBar = ({ dark = false }: { dark?: boolean }) => (
    <div className="flex items-center justify-center gap-1.5 mb-3">
      {isCheckin ? (
        <>
          <span className={`w-6 h-1 rounded-full ${dark ? 'bg-white/50' : 'bg-[var(--ge-accent)]/30'}`} />
          <span className={`w-6 h-1 rounded-full ${dark ? 'bg-white/50' : 'bg-[var(--ge-accent)]/30'}`} />
          <span className={`w-6 h-1 rounded-full ${dark ? 'bg-white/50' : 'bg-[var(--ge-accent)]/30'}`} />
          <span className={`w-6 h-1 rounded-full ${dark ? 'bg-white' : 'bg-[var(--ge-accent)]'}`} />
          <span className={`w-6 h-1 rounded-full ${dark ? 'bg-white/25' : 'bg-[var(--ge-accent)]/15'}`} />
        </>
      ) : (
        <>
          <span className={`w-6 h-1 rounded-full ${dark ? 'bg-white' : 'bg-[var(--ge-accent)]'}`} />
          <span className={`w-6 h-1 rounded-full ${dark ? 'bg-white/25' : 'bg-[var(--ge-accent)]/15'}`} />
        </>
      )}
    </div>
  )

  // ── カメラフェーズ ────────────────────────────────────────────────────────
  if (phase === 'camera_contents' || phase === 'camera_empty') {
    const isContents = phase === 'camera_contents'
    const photoLabel = isContents
      ? '📦 カバンの中身を出して撮影してください'
      : '👜 空っぽのカバンの中を撮影してください'
    const photoStep = isContents ? '1枚目' : '2枚目'

    return (
      <div className="min-h-screen bg-black flex flex-col">
        <div className="pt-10 pb-4 px-6 text-center">
          <StepBar dark />
          <p className="text-gray-400 text-xs font-medium mb-1.5">📷 {photoStep}</p>
          <h1 className="text-white text-base font-medium leading-snug px-4">{photoLabel}</h1>
        </div>

        <div className="flex-1 flex items-center justify-center px-6">
          <div className="relative w-full max-w-sm aspect-[4/3] rounded-2xl overflow-hidden bg-gray-900">
            <video
              ref={videoRef}
              className="w-full h-full object-cover"
              playsInline
              autoPlay
              muted
            />
            <div className="absolute inset-4 border-2 border-white/50 rounded-lg pointer-events-none" />
          </div>
        </div>

        <div className="pb-12 px-6">
          <div className="flex items-center justify-center gap-6">
            <button
              onClick={() => {
                if (streamRef.current) stopCamera(streamRef.current)
                setPhase('declare')
              }}
              className="text-gray-400 text-sm w-16 text-center"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={handleCapture}
              className="w-16 h-16 rounded-full border-4 border-white flex items-center justify-center"
            >
              <div className="w-12 h-12 rounded-full bg-white" />
            </button>
            <div className="w-16" />
          </div>
        </div>
      </div>
    )
  }

  // ── プレビューフェーズ ────────────────────────────────────────────────────
  if (phase === 'preview_contents' || phase === 'preview_empty') {
    const isContents = phase === 'preview_contents'
    const previewImg = isContents ? imgContents : imgEmpty
    const handleUse = isContents ? handleUseContents : handleUseEmpty
    const nextLabel = isContents ? '次の写真へ →' : 'この写真を使う'

    return (
      <div className="min-h-screen bg-black flex flex-col">
        <div className="pt-10 pb-4 px-6 text-center">
          <StepBar dark />
          <p className="text-gray-400 text-xs mb-1">{isContents ? '1枚目 確認' : '2枚目 確認'}</p>
          <h1 className="text-white text-base font-medium">撮影結果の確認</h1>
        </div>

        <div className="flex-1 flex items-center justify-center px-6">
          <div className="w-full max-w-sm aspect-[4/3] rounded-2xl overflow-hidden">
            {previewImg && (
              <img src={previewImg} alt="baggage" className="w-full h-full object-cover" />
            )}
          </div>
        </div>

        {isContents && (
          <div className="mx-6 mb-3 px-4 py-2.5 bg-white/10 rounded-xl text-center">
            <p className="text-white/80 text-sm">👜 次は空のカバンの中を撮影します</p>
          </div>
        )}

        <div className="pb-12 px-6 flex gap-3">
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
            {nextLabel}
          </button>
        </div>
      </div>
    )
  }

  // ── 申告フォームフェーズ ──────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[var(--ge-paper)] flex flex-col">
      <div className="bg-[var(--ge-accent)] px-6 pt-10 pb-8 text-white relative">
        <StepBar />
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={() => router.back()}
            className="text-white/60 text-sm flex items-center gap-1"
          >
            ← {t('common.back')}
          </button>
          <a href={`/r/${params.token}`} className="text-white/50 text-xs">
            受付トップへ ↑
          </a>
        </div>
        <h1 className="text-xl font-semibold">
          🧳 {context === 'checkin' ? '入室時 手荷物検査' : '退室時 手荷物検査'}
        </h1>
        <p className="text-sm text-white/60 mt-1">{t('baggage.subtitle')}</p>
        <div className="absolute bottom-0 left-0 right-0 h-5 bg-[var(--ge-paper)] rounded-t-[20px]" />
      </div>

      <div className="px-5 -mt-1 pb-8 flex-1 flex flex-col gap-4">
        {/* 申告テキスト */}
        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <label className="block text-sm font-medium text-[var(--ge-accent)] mb-2">
            {t('baggage.declarationLabel')}
          </label>
          <textarea
            value={declaration}
            onChange={e => setDeclaration(e.target.value)}
            placeholder={t('baggage.declarationPlaceholder')}
            rows={3}
            className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-700 resize-none focus:outline-none focus:ring-2 focus:ring-[var(--ge-accent)] placeholder:text-gray-400"
          />
        </div>

        {/* 検査モード表示 */}
        {inspectionMode === 'video' ? (
          // Video mode: fixed camera records, just show confirmation message
          <div className="mx-0 mb-0 p-5 bg-white rounded-2xl shadow-sm text-center">
            <div className="w-14 h-14 rounded-full bg-[var(--ge-accent-soft)] flex items-center justify-center mx-auto mb-3">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--ge-accent)" strokeWidth="1.5">
                <path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
              </svg>
            </div>
            <p className="text-[var(--ge-ink)] font-medium text-sm mb-1">固定カメラで自動録画</p>
            <p className="text-[var(--ge-ink-4)] text-xs leading-relaxed">
              手荷物検査エリアの固定カメラが自動的に録画しています。スタッフがあとで確認します。
            </p>
          </div>
        ) : (
          // Photo mode: existing camera/photo buttons
          cameraAvailable && (
            <div className="bg-white rounded-2xl p-5 shadow-sm space-y-3">
              <p className="text-sm font-semibold text-[var(--ge-accent)]">📷 荷物の写真撮影</p>

              {bothPhotos ? (
                // 両方完了
                <div className="space-y-2">
                  <div className="flex items-center gap-2 py-2 px-3 bg-emerald-50 rounded-xl">
                    <span>✅</span>
                    <span className="text-sm text-emerald-700 font-medium">2枚の写真が追加されました</span>
                  </div>
                  <div className="flex gap-3 text-xs">
                    <button
                      onClick={() => {
                        setBlobContents(null); setImgContents(null)
                        sessionStorage.removeItem(`reception-baggage-${context}-photo-contents`)
                        setPhase('camera_contents')
                      }}
                      className="flex-1 py-1.5 text-[var(--ge-accent)] underline text-center"
                    >
                      1枚目を撮り直す
                    </button>
                    <button
                      onClick={() => {
                        setBlobEmpty(null); setImgEmpty(null)
                        sessionStorage.removeItem(`reception-baggage-${context}-photo-empty`)
                        setPhase('camera_empty')
                      }}
                      className="flex-1 py-1.5 text-[var(--ge-accent)] underline text-center"
                    >
                      2枚目を撮り直す
                    </button>
                    <button onClick={handleRemovePhotos} className="py-1.5 text-red-400 underline">
                      全削除
                    </button>
                  </div>
                </div>
              ) : hasContentsPhoto ? (
                // 1枚目のみ完了 → 2枚目を促す
                <div className="space-y-2">
                  <div className="flex items-center gap-2 py-2 px-3 bg-emerald-50 rounded-xl">
                    <span>✅</span>
                    <span className="text-sm text-emerald-700">1枚目 (中身) 完了</span>
                  </div>
                  <button
                    onClick={() => setPhase('camera_empty')}
                    className="w-full flex items-center justify-center gap-2 py-3 bg-[var(--ge-accent)] rounded-xl text-sm text-white font-medium"
                  >
                    <span>📷</span>
                    <span>2枚目: 空のカバンを撮影する</span>
                  </button>
                </div>
              ) : (
                // 未撮影
                <button
                  onClick={() => setPhase('camera_contents')}
                  className="w-full flex items-center gap-3 py-3.5 border-2 border-dashed border-[var(--ge-accent)]/30 rounded-xl hover:border-[var(--ge-accent)]/60 transition-colors"
                >
                  <div className="flex-1 text-left ml-3">
                    <p className="text-sm font-medium text-[var(--ge-accent)]">📦 1枚目: カバンの中身を出して撮影</p>
                    <p className="text-xs text-gray-400 mt-0.5">その後、空のカバンも撮影します (計2枚)</p>
                  </div>
                  <span className="text-[var(--ge-accent)]/40 mr-3">›</span>
                </button>
              )}
            </div>
          )
        )}

        <div className="flex-1" />

        <div className="space-y-3">
          <button
            onClick={handleNext}
            className="w-full py-4 bg-[var(--ge-accent)] text-white rounded-[14px] text-base font-semibold"
          >
            {inspectionMode === 'video' ? '確認して次へ' : t('baggage.submit')}
          </button>
          <button
            onClick={handleSkip}
            className="w-full py-3 text-gray-400 text-sm text-center"
          >
            {t('baggage.skip')}
          </button>
        </div>
      </div>
    </div>
  )
}
