'use client'

/**
 * ライブの画面に最初から並べる録画再生の操作（2026-09-26 利用者の要望）。
 *
 * 押したら同じカメラの録画再生の画面へ移る。ライブの視聴は LivePlayer が外れるときに
 * 閉じる（endSession・遠隔の視聴セッションは各モードの後始末）ので、ここでは何もしない。
 */
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PlaybackBar } from '@/components/video/PlaybackBar'
import { fromJstInput, isLiveEdge, LIVE_DEFAULT_BACK_SEC, toJstInput, vodHref } from '@/lib/video/playback-nav'

/** 入力欄を触っていない間、既定の「今の 1 分前」を追いかける間隔 */
const DEFAULT_REFRESH_MS = 15_000

interface Props {
  storeId: string
  cameraId: string
  /** 録画再生で切り出す長さ（分）。開始時刻だけで開けるカメラは null */
  rangeMin: number | null
}

export default function LivePlaybackBar({ storeId, cameraId, rangeMin }: Props) {
  const router = useRouter()
  // 時刻はサーバで描いた値と食い違わないよう、読み込んだあとに入れる
  const [input, setInput] = useState('')
  const touched = useRef(false)

  useEffect(() => {
    const fill = () => {
      if (!touched.current) setInput(toJstInput(new Date(Date.now() - LIVE_DEFAULT_BACK_SEC * 1000).toISOString()))
    }
    fill()
    const t = setInterval(fill, DEFAULT_REFRESH_MS)
    return () => clearInterval(t)
  }, [])

  // 今（か今より先）を指定されたら、いま見ているライブのままにする
  const open = (iso: string) => { if (!isLiveEdge(iso)) router.push(vodHref(storeId, cameraId, iso, rangeMin)) }

  return (
    <PlaybackBar
      input={input}
      onInput={(v) => { touched.current = true; setInput(v) }}
      onPlayFromInput={() => { const iso = fromJstInput(input); if (iso) open(iso) }}
      onJump={(d) => open(new Date(Date.now() + d * 1000).toISOString())}
      forwardDisabled
    />
  )
}
