// エッジ (G・VMS) からの即時の知らせのメールの本文
/** 事象ごとに、受け取った人が次にすることの一文 (2026-11-04・シナリオ試験 S-5 の所見)。 */
const NEXT_STEP: Record<string, string> = {
  node_down: '担当のカメラは残りの録画サーバが自動で引き継ぎます（予備の録画先があるカメラは録画が欠けません）。止まったサーバの電源と LAN を確かめてください。',
  node_up: 'サーバが戻りました。引き継いだカメラは自動で元のサーバへ戻ります。',
  recording_stopped: '該当のカメラの映像と録画の設定を、拠点の G・VMS の画面で確かめてください。',
  recording_resumed: '録画が戻りました。',
  disk_low: '録画の保存先の空きが少なくなっています。保持日数か保存先を見直してください。',
  disk_ok: '保存先の空きが戻りました。',
  disk_failing: 'ディスクの故障の兆候があります。早めに交換の手配をしてください。',
  disk_healthy: 'ディスクの兆候が消えました。',
}

const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * 知らせのメールの本文。**件名のくり返しにしない** (2026-11-04・シナリオ試験 S-5 の所見)。
 * 以前は本文が件名と同じ 1 行で、いつ・どのノードで・次に何をするかが読めなかった。
 */
export function edgeEventMailHtml(a: {
  storeName: string, edgeName: string, label: string, eventType: string,
  node: number | null, occurredAt: string, message: string | null,
}): string {
  const at = new Date(a.occurredAt)
  const when = isNaN(at.getTime()) ? a.occurredAt
    : at.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const rows: [string, string][] = [
    ['拠点', a.storeName], ['エッジ', a.edgeName], ['事象', a.label], ['発生時刻', when],
  ]
  if (a.node != null) rows.push(['ノード', `node${a.node}`])
  if (a.message) rows.push(['内容', a.message])
  const next = NEXT_STEP[a.eventType]
  return '<table style="border-collapse:collapse">'
    + rows.map(([k, v]) => `<tr><td style="padding:2px 12px 2px 0;color:#5B5B5F">${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')
    + '</table>'
    + (next ? `<p>${esc(next)}</p>` : '')
}
