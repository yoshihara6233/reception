/**
 * 手荷物検査 日次バッチの純ロジック（M2 → M6 が使用）
 *
 * I/O なし。アンマッチ検出・保持カットオフ・JST日付・店長メール生成を担う。
 * 設計: ワイヤーフレーム v3 D8（毎朝の前日アンマッチ店長メール）。
 */

const DAY_MS = 86_400_000
const JST_OFFSET_MS = 9 * 60 * 60 * 1000

/** JST での日付文字列（YYYY-MM-DD）。dayOffset=-1 で前日。 */
export function jstDateStr(now: Date, dayOffset = 0): string {
  return new Date(now.getTime() + JST_OFFSET_MS + dayOffset * DAY_MS).toISOString().slice(0, 10)
}

export interface SessionLite {
  id: string
  entry_at: string | null
  exit_at: string | null
  status: string
}

/**
 * 入室あり×退出なし（entered のまま暦日を終えた）セッションID。
 * → status を unmatched_exit に更新する対象。
 * （退出あり×入室なしは退出時に unmatched_entry 記録済みのためここでは扱わない）
 */
export function computeUnmatchedExits(sessions: SessionLite[]): string[] {
  return sessions
    .filter((s) => s.status === 'entered' && s.entry_at && !s.exit_at)
    .map((s) => s.id)
}

/** 保持日数から削除カットオフ（これより前に作成 = 削除対象）。 */
export function retentionCutoffIso(retentionDays: number, now: Date): string {
  return new Date(now.getTime() - Math.max(0, retentionDays) * DAY_MS).toISOString()
}

export interface UnmatchItem {
  personLabel: string
  kind: string           // 'unmatched_exit' | 'unmatched_entry'
  at: string | null
}

/** HTML特殊文字のエスケープ（氏名・店舗名などDB由来テキストのメール差し込み用）。 */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** 店長宛メール（前日のアンマッチ一覧）。 */
export function buildUnmatchEmail(storeName: string, date: string, items: UnmatchItem[]): { subject: string; html: string } {
  const label = (k: string) => (k === 'unmatched_exit' ? '退出なし' : k === 'unmatched_entry' ? '入室記録なし' : k)
  const store = esc(storeName)
  const rows = items
    .map((i) => `<tr><td style="padding:6px 12px;border-bottom:1px solid #eee">${esc(label(i.kind))}</td>`
      + `<td style="padding:6px 12px;border-bottom:1px solid #eee">${esc(i.personLabel)}</td>`
      + `<td style="padding:6px 12px;border-bottom:1px solid #eee">${i.at ? esc(i.at) : '—'}</td></tr>`)
    .join('')
  const subject = `[手荷物検査] ${date} アンマッチ ${items.length}件（${storeName}）`
  const html = items.length === 0
    ? `<p>${date} の${store}に未処理のアンマッチはありませんでした。</p>`
    : `<p>${date} の${store}のアンマッチ ${items.length}件です。映像を再生してご確認ください。</p>`
      + `<table style="border-collapse:collapse;font-size:14px"><thead><tr>`
      + `<th style="text-align:left;padding:6px 12px;border-bottom:2px solid #ccc">種別</th>`
      + `<th style="text-align:left;padding:6px 12px;border-bottom:2px solid #ccc">人物</th>`
      + `<th style="text-align:left;padding:6px 12px;border-bottom:2px solid #ccc">時刻</th>`
      + `</tr></thead><tbody>${rows}</tbody></table>`
  return { subject, html }
}
