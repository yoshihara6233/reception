'use client'

/**
 * /r/[token]/face-register
 *
 * 受付キオスクでの顔登録ページ。
 * 用途:
 *   1. チェックイン完了後に「顔を登録する」を選んだ場合 → ?visitId=xxx
 *   2. 来店者管理で登録済みの従業員・外部登録者が顔登録 → ?visitorId=xxx
 *
 * フロー: カメラ → 撮影 → 送信 → 完了
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { startCamera, captureFrame, stopCamera } from '@/lib/camera/capture'

// ── 型 ────────────────────────────────────────────────────────────────────────

type Phase = 'camera' | 'preview' | 'uploading' | 'done' | 'error'

// ── i18n ──────────────────────────────────────────────────────────────────────

const LABELS = {
  title:      { ja: '顔登録', en: 'Face Registration', zh: '人脸注册', ko: '얼굴 등록' },
  subtitle:   { ja: '顔をカメラに向けてください', en: 'Look at the camera', zh: '请面向摄像头', ko: '카메라를 바라봐 주세요' },
  capture:    { ja: '撮影する', en: 'Capture', zh: '拍摄', ko: '촬영하기' },
  retake:     { ja: '撮り直す', en: 'Retake', zh: '重新拍摄', ko: '다시 찍기' },
  register:   { ja: '登録する', en: 'Register', zh: '注册', ko: '등록하기' },
  uploading:  { ja: '登録中...', en: 'Registering...', zh: '注册中...', ko: '등록 중...' },
  doneTitle:  { ja: '顔登録が完了しました', en: 'Face Registered!', zh: '人脸注册完成', ko: '얼굴 등록 완료' },
  doneMsg:    { ja: '次回からは顔認証で受付できます', en: 'You can check in with face auth next time', zh: '下次可以使用人脸识别签到', ko: '다음부터 얼굴 인증으로 접수하실 수 있습니다' },
  backTop:    { ja: '受付トップに戻る', en: 'Back to Reception', zh: '返回受理台首页', ko: '안내 데스크로 돌아가기' },
  skip:       { ja: 'スキップ', en: 'Skip', zh: '跳过', ko: '건너뛰기' },
  errorTitle: { ja: 'エラーが発生しました', en: 'An error occurred', zh: '发生错误', ko: '오류가 발생했습니다' },
  retry:      { ja: 'もう一度試す', en: 'Retry', zh: '再试一次', ko: '다시 시도하기' },
  noFace:     { ja: '顔が検出されませんでした。もう一度撮影してください。', en: 'Face not detected. Please try again.', zh: '未检测到人脸，请重新拍摄。', ko: '얼굴이 인식되지 않았습니다. 다시 시도해 주세요.' },
  cameraErr:  { ja: 'カメラを起動できませんでした', en: 'Could not start camera', zh: '无法启动摄像头', ko: '카메라를 시작할 수 없습니다' },
} as const

type LabelKey = keyof typeof LABELS
type LangKey  = 'ja' | 'en' | 'zh' | 'ko'

// ── メインページ ──────────────────────────────────────────────────────────────

export default function FaceRegisterPage() {
  const params      = useParams<{ token: string }>()
  const searchP     = useSearchParams()
  const visitId     = searchP.get('visitId')    // チェックイン後フロー
  const visitorId   = searchP.get('visitorId')  // 来店者管理フロー
  const langParam   = (searchP.get('lang') || 'ja') as LangKey

  const videoRef    = useRef<HTMLVideoElement>(null)
  const streamRef   = useRef<MediaStream | null>(null)

  const [phase, setPhase]         = useState<Phase>('camera')
  const [capturedUrl, setCapturedUrl] = useState<string | null>(null)
  const [capturedDataUrl, setCapturedDataUrl] = useState<string | null>(null)
  const [errorMsg, setErrorMsg]   = useState<string | null>(null)

  const L = (key: LabelKey) => LABELS[key][langParam] ?? LABELS[key]['ja']

  // ── カメラ起動 ───────────────────────────────────────────────────────────────

  const initCamera = useCallback(async () => {
    if (!videoRef.current) return
    if (!navigator.mediaDevices?.getUserMedia) {
      setErrorMsg(L('cameraErr'))
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
        : L('cameraErr')
      setErrorMsg(msg)
      setPhase('error')
    }
  }, [langParam]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (phase === 'camera') initCamera()
    return () => {
      if (streamRef.current) stopCamera(streamRef.current)
    }
  }, [phase, initCamera])

  // ── 撮影 ─────────────────────────────────────────────────────────────────────

  const handleCapture = useCallback(() => {
    if (!videoRef.current || !streamRef.current) return
    const blob = captureFrame(videoRef.current)
    if (!blob) return

    setCapturedUrl(URL.createObjectURL(blob))

    // DataURL に変換 (API 送信用)
    const reader = new FileReader()
    reader.onload = () => setCapturedDataUrl(reader.result as string)
    reader.readAsDataURL(blob)

    stopCamera(streamRef.current)
    streamRef.current = null
    setPhase('preview')
  }, [])

  // ── 顔登録送信 ───────────────────────────────────────────────────────────────

  const handleRegister = async () => {
    if (!capturedDataUrl) return
    setPhase('uploading')

    const body: Record<string, string> = { facePhotoDataUrl: capturedDataUrl }
    if (visitId)   body.visitId   = visitId
    if (visitorId) body.visitorId = visitorId

    try {
      const res = await fetch('/api/v1/visitors/face-register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      const data = await res.json()

      if (!res.ok) {
        if (res.status === 422) {
          setErrorMsg(L('noFace'))
          setPhase('error')
          return
        }
        setErrorMsg(data.error || 'エラーが発生しました')
        setPhase('error')
        return
      }

      setPhase('done')
    } catch {
      setErrorMsg('ネットワークエラーが発生しました')
      setPhase('error')
    }
  }

  // ── レンダリング ─────────────────────────────────────────────────────────────

  const topUrl = `/r/${params.token}`

  return (
    <div className="min-h-screen bg-[#f0f2f5] flex flex-col">
      {/* ── ヘッダー ─────────────────────────────────────────────────── */}
      <div className="bg-gradient-to-br from-[#1e3a5f] to-[#2c4f7c] px-6 pt-12 pb-8 text-white text-center relative">
        <div className="w-12 h-12 bg-white/10 rounded-full flex items-center justify-center mx-auto mb-3">
          <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17.982 18.725A7.488 7.488 0 0012 15.75a7.488 7.488 0 00-5.982 2.975m11.963 0a9 9 0 10-11.963 0m11.963 0A8.966 8.966 0 0112 21a8.966 8.966 0 01-5.982-2.275M15 9.75a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </div>
        <h1 className="text-lg font-semibold">{L('title')}</h1>
        {phase === 'camera' && (
          <p className="text-sm text-white/60 mt-1">{L('subtitle')}</p>
        )}
        <div className="absolute bottom-0 left-0 right-0 h-5 bg-[#f0f2f5] rounded-t-[20px]" />
      </div>

      <div className="px-5 -mt-1 flex-1 pb-10">
        {/* ── カメラ ───────────────────────────────────────────────────── */}
        {phase === 'camera' && (
          <div className="flex flex-col items-center gap-4">
            <div className="w-full bg-black rounded-2xl overflow-hidden relative" style={{ aspectRatio: '3/4' }}>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover scale-x-[-1]"
              />
              {/* オーバーレイ: 顔ガイド（楕円） */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ paddingTop: '8%' }}>
                <div style={{
                  width: '60%', paddingTop: '75%',
                  border: '2px solid rgba(255,255,255,0.5)',
                  borderRadius: '50%',
                  boxShadow: '0 0 0 9999px rgba(0,0,0,0.35)',
                }} />
              </div>
              {/* 上部ガイドテキスト */}
              <div className="absolute top-3 left-0 right-0 flex justify-center pointer-events-none">
                <span className="bg-black/40 text-white text-xs px-3 py-1 rounded-full">
                  顔を枠に合わせてください
                </span>
              </div>
            </div>
            <button
              onClick={handleCapture}
              className="w-full py-4 bg-[#1e3a5f] text-white text-sm font-semibold rounded-2xl shadow-sm"
            >
              {L('capture')}
            </button>
            <a
              href={topUrl}
              className="text-sm text-gray-400 underline underline-offset-2"
            >
              {L('skip')}
            </a>
          </div>
        )}

        {/* ── プレビュー ───────────────────────────────────────────────── */}
        {phase === 'preview' && capturedUrl && (
          <div className="flex flex-col items-center gap-4">
            <div className="w-full bg-black rounded-2xl overflow-hidden" style={{ aspectRatio: '3/4' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={capturedUrl}
                alt="captured"
                className="w-full h-full object-cover scale-x-[-1]"
              />
            </div>
            <button
              onClick={handleRegister}
              className="w-full py-4 bg-[#1e3a5f] text-white text-sm font-semibold rounded-2xl shadow-sm"
            >
              {L('register')}
            </button>
            <button
              onClick={() => setPhase('camera')}
              className="w-full py-3 border border-gray-200 bg-white text-gray-600 text-sm font-medium rounded-2xl"
            >
              {L('retake')}
            </button>
          </div>
        )}

        {/* ── アップロード中 ────────────────────────────────────────────── */}
        {phase === 'uploading' && (
          <div className="flex flex-col items-center justify-center gap-4 py-16">
            <div className="w-10 h-10 border-2 border-[#1e3a5f] border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-gray-500">{L('uploading')}</p>
          </div>
        )}

        {/* ── 完了 ─────────────────────────────────────────────────────── */}
        {phase === 'done' && (
          <div className="flex flex-col items-center gap-5 pt-8">
            <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center">
              <svg className="w-10 h-10 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div className="text-center">
              <p className="text-lg font-semibold text-[#1e3a5f]">{L('doneTitle')}</p>
              <p className="text-sm text-gray-500 mt-1">{L('doneMsg')}</p>
            </div>
            <a
              href={topUrl}
              className="block w-full py-4 bg-[#1e3a5f] text-white text-center text-sm font-semibold rounded-2xl shadow-sm mt-4"
            >
              {L('backTop')}
            </a>
          </div>
        )}

        {/* ── エラー ───────────────────────────────────────────────────── */}
        {phase === 'error' && (
          <div className="flex flex-col items-center gap-5 pt-8">
            <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center">
              <svg className="w-10 h-10 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
            </div>
            <div className="text-center">
              <p className="text-base font-semibold text-gray-700">{L('errorTitle')}</p>
              {errorMsg && <p className="text-sm text-red-500 mt-1">{errorMsg}</p>}
            </div>
            <button
              onClick={() => { setErrorMsg(null); setPhase('camera') }}
              className="w-full py-4 bg-[#1e3a5f] text-white text-sm font-semibold rounded-2xl"
            >
              {L('retry')}
            </button>
            <a href={topUrl} className="text-sm text-gray-400 underline underline-offset-2">
              {L('skip')}
            </a>
          </div>
        )}
      </div>
    </div>
  )
}
