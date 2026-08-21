'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * BCP スナップショット 1 枚のタイル。**右クリックで 5 分の動画を取り出せる。**
 *
 * ── なぜ右クリックなのか ────────────────────────────────────────────────
 * 8 枚のタイルそれぞれにボタンを足すと、1 カメラあたり 8 個・2 カメラで 16 個の
 * ボタンが並び、肝心のコマが読めなくなる。操作は隠すが、タイトル属性と
 * カード見出しの注記で入口を示す。
 *
 * ⚠ **ブラウザ標準の「画像を保存」を潰さない。** 右クリックを乗っ取る実装は、
 *   それまで出来ていたことを黙って奪う。独自メニューに「画像を保存」を残し、
 *   標準と同じことができるようにしてある。
 *
 * ── 何を取り出すのか ────────────────────────────────────────────────────
 * そのコマの時刻から 5 分間。次のコマまでの間隔が 5 分なので、
 * 「コマとコマの間に何があったか」がちょうど埋まる。
 * 録画からの切り出しなので、**レコーダが VOD 対応でないと取れない**
 * （その場合はメニュー項目を無効にし、理由を出す）。
 *
 * 経路は既存の VOD をそのまま使う:
 *   POST /api/vod            → clip 作成（同一区間は再利用される）
 *   GET  /api/vod/<id>/status→ ready になるまで待つ
 *   GET  /api/vod/<id>       → 取得
 */

/** 切り出す長さ。スナップの間隔と同じ 5 分。 */
const CLIP_MINUTES = 5
/** 状態確認の間隔。エッジが NVR から落として上げるまで数十秒かかる。 */
const POLL_MS = 3_000
/** 待ち切りの上限。これを過ぎたら諦めて理由を出す。 */
const POLL_TIMEOUT_MS = 5 * 60_000
/** メニューの実寸（画面外にはみ出さないための計算に使う）。 */
const MENU_W = 248
const MENU_H = 168

type Phase = 'idle' | 'working' | 'done' | 'error'

/**
 * 取得中の区間。**コンポーネントの外に置く。**
 * 画面を移動しても処理は続くので、戻ってきて同じコマをもう一度押したときに
 * 二重に走らせないための目印。ページを再読み込みすれば消えるが、そのときは
 * 同一区間の再利用が効くので実害が無い。
 */
const inFlight = new Set<string>()

export function SnapshotTile({
  clipId, cameraId, cameraName, label, clockLabel, shotAtIso, isCenterpiece, vodOk,
}: {
  /** bcp_clips.id（JPEG 側）。画像の取得と保存に使う。 */
  clipId: string | null
  cameraId: string
  cameraName: string
  /** 「5分前」「発生時」など。 */
  label: string
  /** 「(07:12)」など。 */
  clockLabel: string
  /** このコマの撮影時刻。ここを起点に 5 分を切り出す。 */
  shotAtIso: string | null
  isCenterpiece: boolean
  vodOk: boolean
}) {
  const [menu, setMenu]   = useState<{ x: number; y: number } | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [note, setNote]   = useState<string>('')
  /**
   * **アンマウントで取得を打ち切らない。**
   * 切り出しは数十秒かかる。以前はここで abort していたため、待っている間に
   * 別の画面へ移るとダウンロードが始まらなかった。映像は出来上がっている
   * （vod_clips は ready になる）のに受け取れない、という最悪の形だった。
   * 画面から消えた後も処理は続け、**UI の更新だけ止める。**
   */
  const alive = useRef(true)

  // メニューは外側クリック・Esc・スクロールで閉じる。
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null) }
    window.addEventListener('click', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  useEffect(() => () => { alive.current = false }, [])

  /** 画面から消えた後は状態を触らない（React の警告と、無意味な再描画を避ける）。 */
  const show = (p: Phase, n: string) => {
    if (!alive.current) return
    setPhase(p); setNote(n)
  }

  const onContextMenu = (e: React.MouseEvent) => {
    if (!clipId) return                     // 未取得のコマにメニューは出さない
    e.preventDefault()
    e.stopPropagation()
    // 右端・下端で画面外に出さない。8 枚を横並びにしているので、
    // 「30分後」のタイルは必ず画面の右端寄りに来る。
    const pad = 8
    const x = Math.min(e.clientX, window.innerWidth  - MENU_W - pad)
    const y = Math.min(e.clientY, window.innerHeight - MENU_H - pad)
    setMenu({ x: Math.max(pad, x), y: Math.max(pad, y) })
  }

  const fetchVideo = useCallback(async () => {
    setMenu(null)
    if (!shotAtIso) { show('error', 'このコマの時刻が分かりません'); return }
    show('working', '録画を切り出しています（画面を移動しても続きます）')

    const from = new Date(shotAtIso)
    const to   = new Date(from.getTime() + CLIP_MINUTES * 60_000)
    // 同じ区間を二重に走らせない。戻ってきてもう一度押したときの重複を防ぐ。
    const key = `${cameraId}|${from.toISOString()}`
    if (inFlight.has(key)) return
    inFlight.add(key)

    try {
      const res = await fetch('/api/vod', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          camera_id: cameraId,
          from_iso:  from.toISOString(),
          to_iso:    to.toISOString(),
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({} as { error?: string; message?: string }))
        throw new Error(body.message ?? body.error ?? `作成に失敗しました (${res.status})`)
      }
      // ⚠ 応答は { clip_id }。`id` ではない（同じ区間の再利用時も同じ形）。
      const created = await res.json() as { clip_id: string; status?: string; reused?: boolean }
      const id = created.clip_id
      if (!id) throw new Error('clip_id が返りませんでした')
      if (created.reused) show('working', '取得済みの動画を再利用しています')

      // 同じ区間が既に ready なら待たない（再利用のとき無駄に 3 秒待つのを避ける）。
      if (created.status !== 'ready') {
        // ready になるまで待つ。**失敗を「まだ準備中」と読まない**ように
        // status を必ず見る（黙って待ち続けるのが一番困る）。
        const deadline = Date.now() + POLL_TIMEOUT_MS
        for (;;) {
          if (Date.now() > deadline) throw new Error('時間内に用意できませんでした')
          await new Promise((r) => setTimeout(r, POLL_MS))
          const st = await fetch(`/api/vod/${id}/status`)
          if (!st.ok) throw new Error(`状態を確認できません (${st.status})`)
          const s = await st.json() as { status?: string; error?: string | null }
          if (s.status === 'ready')  break
          if (s.status === 'failed') throw new Error(s.error ?? '録画の切り出しに失敗しました')
        }
      }

      // ダウンロードを開始する。**この呼び出しは画面から消えていても効く**
      // （document は生きている）ので、別画面に移っていても受け取れる。
      const a = document.createElement('a')
      a.href = `/api/vod/${id}`
      a.download = `${cameraName}_${clockLabel.replace(/[()：:]/g, '')}_${CLIP_MINUTES}min.mp4`
      document.body.appendChild(a); a.click(); a.remove()
      show('done', `${CLIP_MINUTES} 分の動画を取得しました`)
      setTimeout(() => { if (alive.current) setPhase('idle') }, 4_000)
    } catch (e) {
      show('error', (e as Error).message)
    } finally {
      inFlight.delete(key)
    }
  }, [cameraId, cameraName, clockLabel, shotAtIso])

  const href = clipId ? `/api/bcp/clip/${clipId}` : null

  return (
    <div
      className={
        'group relative overflow-hidden rounded border ' +
        (isCenterpiece ? 'border-red-300 ring-2 ring-red-200' : 'border-slate-200')
      }
      onContextMenu={onContextMenu}
    >
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="block aspect-[4/3] bg-slate-900"
          title={`${label} — クリックで原寸表示 / 右クリックで ${CLIP_MINUTES} 分の動画・画像の保存`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={href}
            alt={`${cameraName} ${label}`}
            className="h-full w-full object-cover transition-transform group-hover:scale-105"
          />
        </a>
      ) : (
        <div className="flex aspect-[4/3] items-center justify-center bg-slate-100 text-[10px] text-slate-400">
          未取得
        </div>
      )}

      <div
        className={
          'absolute bottom-0 left-0 right-0 px-1.5 py-0.5 text-center text-[10px] font-semibold ' +
          (isCenterpiece ? 'bg-red-600/80 text-white' : 'bg-black/55 text-white')
        }
      >
        {label}
        <span className="ml-1 font-normal opacity-90">{clockLabel}</span>
      </div>

      {/* 進行中・結果の帯。押した後に何も起きないように見えるのを防ぐ。 */}
      {phase !== 'idle' && (
        <div
          role="status"
          className={
            'absolute inset-x-0 top-0 px-1.5 py-1 text-[10px] leading-tight text-white ' +
            (phase === 'error' ? 'bg-red-700/90'
              : phase === 'done' ? 'bg-emerald-700/90' : 'bg-slate-900/80')
          }
        >
          {phase === 'working' && (
            <span className="mr-1 inline-block h-2 w-2 animate-pulse rounded-full bg-white align-middle" />
          )}
          {note}
        </div>
      )}

      {menu && (
        <ul
          className="fixed z-50 overflow-hidden rounded border border-slate-200 bg-white py-1 text-[12px] shadow-lg"
          style={{ left: menu.x, top: menu.y, width: MENU_W }}
          onClick={(e) => e.stopPropagation()}
        >
          <li>
            <button
              type="button"
              onClick={fetchVideo}
              disabled={!vodOk || phase === 'working'}
              className="block w-full px-3 py-2 text-left hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
            >
              この時刻から {CLIP_MINUTES} 分の動画を取得
              <span className="mt-0.5 block text-[10px] text-slate-500">
                {vodOk
                  ? `${label} ${clockLabel} から ${CLIP_MINUTES} 分間`
                  : 'このカメラのレコーダは録画の切り出しに対応していません'}
              </span>
            </button>
          </li>
          <li>
            <a
              href={href ?? '#'}
              download={`${cameraName}_${label}.jpg`}
              className="block px-3 py-2 hover:bg-slate-100"
              onClick={() => setMenu(null)}
            >
              画像を保存（JPEG）
            </a>
          </li>
          <li>
            <a
              href={href ?? '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="block px-3 py-2 hover:bg-slate-100"
              onClick={() => setMenu(null)}
            >
              原寸で開く
            </a>
          </li>
        </ul>
      )}
    </div>
  )
}
