/**
 * 要望の新着を運営へ 1 日 1 回まとめて知らせるメール（基本設計 §3.5「新着は運営へメールで知らせる
 * （1 日 1 回のまとめ・業務が止まるはすぐ）」）。
 *
 * 集計の区切りは毎朝 8:30（日本時間）。cron が数分遅れても、区切りは時計の 8:30 に揃えるので、
 * 取りこぼしも二重の載せもない（8:30〜実行までに来た要望は翌朝のまとめに載る）。
 * 「業務が止まる」は受けた時点で別に知らせている（notify.ts）が、まとめにも載せる（一覧で見渡すため）。
 */
import { KIND_LABEL, SOURCE_LABEL, URGENCY_LABEL, type FeedbackKind, type FeedbackSource, type FeedbackUrgency } from './schema'

const HOUR = 60 * 60 * 1000
const JST = 9 * HOUR
/** 区切りの時刻（日本時間の時・分） */
export const DIGEST_CUT_JST = { hour: 8, minute: 30 } as const
/** 1 通に載せる件数の上限（超えた分は件数だけ書いて要望ボードへ誘う） */
export const DIGEST_MAX_ITEMS = 50
/** 本文の抜き出しの長さ */
export const DIGEST_BODY_CHARS = 120

/** now 以前で最も近い 8:30（日本時間）を区切りの終わりとし、その 24 時間前からを返す。 */
export function digestWindow(now: Date): { from: Date; to: Date } {
  const j = new Date(now.getTime() + JST)
  let cut = Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), j.getUTCDate(), DIGEST_CUT_JST.hour, DIGEST_CUT_JST.minute) - JST
  if (cut > now.getTime()) cut -= 24 * HOUR
  return { from: new Date(cut - 24 * HOUR), to: new Date(cut) }
}

export interface DigestItem {
  id: string
  tenant_id: string
  store_id: string | null
  source: FeedbackSource
  kind: FeedbackKind
  urgency: FeedbackUrgency
  body: string
  created_at: string
  page_url: string | null
  attachment_type: string | null
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** 日本時間の「10/06 09:22」 */
function jstShort(iso: string): string {
  const d = new Date(new Date(iso).getTime() + JST)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
}

function excerpt(s: string): string {
  const chars = [...s.replace(/\s+/g, ' ').trim()]
  return chars.slice(0, DIGEST_BODY_CHARS).join('') + (chars.length > DIGEST_BODY_CHARS ? '…' : '')
}

/**
 * まとめのメールを組む。items は新しい順でも古い順でもよい（業務が止まる → 古い順に並べ直す）。
 * untouched = 受け付けたまま返事もしていない要望の総数（この 24 時間に限らない）。
 */
export function renderDigest(p: {
  items: DigestItem[]
  tenantNames: Map<string, string>
  storeNames: Map<string, string>
  untouched: number
  window: { from: Date; to: Date }
  boardUrl: string
  productName: string
}): { subject: string; html: string } {
  const rank: Record<FeedbackUrgency, number> = { blocking: 0, inconvenient: 1, nice_to_have: 2 }
  const sorted = [...p.items].sort((a, b) => rank[a.urgency] - rank[b.urgency] || a.created_at.localeCompare(b.created_at))
  const shown = sorted.slice(0, DIGEST_MAX_ITEMS)
  const blocking = p.items.filter((i) => i.urgency === 'blocking').length
  const n = (v: number) => v.toLocaleString('ja-JP')

  const subject = `[${p.productName}] 要望の新着 ${n(p.items.length)} 件` + (blocking ? `（業務が止まる ${n(blocking)} 件）` : '')

  const cell = 'padding:6px 8px;border-bottom:1px solid #E4E0D8;vertical-align:top;font-size:13px'
  const rows = shown.map((i) => {
    const where = [p.tenantNames.get(i.tenant_id) ?? '(テナント不明)', i.store_id ? p.storeNames.get(i.store_id) : null]
      .filter(Boolean).join(' / ')
    const extras = [i.page_url ? `画面 ${i.page_url}` : null, i.attachment_type ? '画像あり' : null].filter(Boolean).join('・')
    const urg = i.urgency === 'blocking'
      ? `<b style="color:#A3332B">${URGENCY_LABEL[i.urgency]}</b>` : esc(URGENCY_LABEL[i.urgency])
    return `<tr>
<td style="${cell};white-space:nowrap;font-family:monospace">${jstShort(i.created_at)}</td>
<td style="${cell};white-space:nowrap">${esc(KIND_LABEL[i.kind])}・${urg}</td>
<td style="${cell}">${esc(where)}<br><span style="color:#6B6862">${esc(SOURCE_LABEL[i.source])}</span></td>
<td style="${cell}">${esc(excerpt(i.body))}${extras ? `<br><span style="color:#6B6862">${esc(extras)}</span>` : ''}</td>
</tr>`
  }).join('')
  const more = p.items.length > shown.length
    ? `<p style="font-size:13px">ほか ${n(p.items.length - shown.length)} 件は要望ボードで見てください。</p>` : ''

  const html = `<!DOCTYPE html>
<html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:16px;background:#F7F5F1;color:#0F0F10;font-family:'Noto Sans JP',sans-serif">
<p style="font-size:14px">${jstShort(p.window.from.toISOString())} 〜 ${jstShort(p.window.to.toISOString())} に届いた要望は ${n(p.items.length)} 件です。
受け付けたまま返事をしていない要望は、全部で ${n(p.untouched)} 件あります。</p>
<table style="border-collapse:collapse;width:100%;background:#FFFFFF;border:1px solid #E4E0D8">
<thead><tr>
<th style="${cell};text-align:left">受けた時刻</th><th style="${cell};text-align:left">種類・度合い</th>
<th style="${cell};text-align:left">テナント / 拠点</th><th style="${cell};text-align:left">本文</th>
</tr></thead>
<tbody>${rows}</tbody></table>
${more}
<p style="font-size:13px"><a href="${esc(p.boardUrl)}" style="color:#2C4A7E">要望ボードを開く</a></p>
<p style="font-size:12px;color:#6B6862">このメールは毎朝 8:30 に、前の日の 8:30 からの新着をまとめて送っています。新着が無い日は送りません。</p>
</body></html>`
  return { subject, html }
}
