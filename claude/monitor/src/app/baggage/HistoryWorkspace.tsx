'use client'

/**
 * 手荷物検査 履歴ワークスペース（master-detail）。
 * 左 = 日次の検査一覧（行選択）／右 = 選択中の検査詳細（SessionDetailPane）。
 * 店舗・日付・フィルタの変更はサーバ側ナビゲーション（上部フォーム/チップ）に委ね、
 * ここは「行を次々に選ぶ」体験だけを担う（選択はURLを汚さずクライアント状態）。
 *
 * 店舗の記憶: 現在の店舗を cookie(bg_store) に書き、次回 ?store 無しアクセス時の既定にする。
 */
import { useEffect, useState } from 'react'
import type { BadgeDef } from '@/lib/baggage/status'
import { SessionDetailPane } from './SessionDetailPane'

export interface RowVM {
  id: string
  person: string
  kind: 'staff' | 'visitor'
  entryAt: string | null
  exitAt: string | null
  statusBadge: BadgeDef
  authSkipped: boolean
  unconfirmed: boolean
  clip: BadgeDef | null
}

const toneClass: Record<BadgeDef['tone'], string> = {
  ok:     'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  warn:   'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  bad:    'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  muted:  'bg-slate-200 text-slate-600 dark:bg-gedbg3 dark:text-gedink3',
  accent: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
}

function Badge({ def }: { def: BadgeDef }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-medium ${toneClass[def.tone]}`}>
      {def.label}
    </span>
  )
}

const hm = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' }) : '—'

export function HistoryWorkspace({ rows, storeId }: { rows: RowVM[]; storeId: string | null }) {
  const [picked, setPicked] = useState<string | null>(null)
  // 選択は描画時に検証（一覧が入れ替わったら先頭へ自動フォールバック・effect でのsetState不要）
  const selectedId = picked && rows.some((r) => r.id === picked) ? picked : rows[0]?.id ?? null

  // 選択中の店舗を記憶（次回 ?store 無しアクセスの既定に使う・server が cookie を読む）
  useEffect(() => {
    if (storeId) document.cookie = `bg_store=${encodeURIComponent(storeId)}; path=/; max-age=15552000; samesite=lax`
  }, [storeId])

  if (rows.length === 0) {
    return (
      <div className="rounded border border-slate-200 bg-white px-3 py-8 text-center text-sm text-slate-500 dark:border-gedline dark:bg-gedbg2 dark:text-gedink3">
        該当する検査はありません
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(320px,420px)_1fr]">
      {/* 左: 一覧 */}
      <div className="max-h-[calc(100vh-220px)] overflow-y-auto rounded border border-slate-200 bg-white dark:border-gedline dark:bg-gedbg2">
        <ul>
          {rows.map((r) => {
            const on = r.id === selectedId
            return (
              <li key={r.id}>
                <button
                  onClick={() => setPicked(r.id)}
                  aria-current={on}
                  className={
                    'flex w-full flex-col gap-1 border-b border-slate-100 px-3 py-2.5 text-left last:border-0 dark:border-gedline/50 ' +
                    (on
                      ? 'border-l-2 border-l-blue-700 bg-blue-50 dark:border-l-gedaccent dark:bg-gedbg3'
                      : 'border-l-2 border-l-transparent hover:bg-slate-50 dark:hover:bg-gedbg3')
                  }
                >
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-sm tabular-nums text-slate-800 dark:text-gedink">{hm(r.exitAt ?? r.entryAt)}</span>
                    <span className="truncate text-sm text-slate-900 dark:text-gedink">{r.person}</span>
                    <span className="ml-auto text-[11px] text-slate-500 dark:text-gedink3">{r.kind === 'staff' ? '従業員' : '来訪者'}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    <Badge def={r.statusBadge} />
                    {r.authSkipped && <Badge def={{ label: '認証省略', tone: 'muted', priority: 60 }} />}
                    {r.unconfirmed && <Badge def={{ label: '未確認', tone: 'muted', priority: 30 }} />}
                    {r.clip && <Badge def={r.clip} />}
                  </div>
                  <div className="flex items-center gap-1 font-mono text-[11px] tabular-nums text-slate-500 dark:text-gedink3">
                    <span>入 {hm(r.entryAt)}</span>
                    <span>→</span>
                    <span>出 {hm(r.exitAt)}</span>
                    {r.authSkipped && <span className="ml-1 font-sans text-[10px] text-amber-700 dark:text-amber-400">同一人物 未確認</span>}
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      </div>

      {/* 右: 詳細 */}
      <div>
        <SessionDetailPane sessionId={selectedId} />
      </div>
    </div>
  )
}
