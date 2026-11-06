/**
 * 拠点の OS に「緊急」の脆弱性が新しく出たときの知らせ（GVMS_CLOUD_SPEC §13.2・WBS F-7）。
 *
 * heartbeat の os_vuln で緊急の組み合わせ（サーバ × CVE）が**新しく**出たときに 1 回だけ、
 * 運営（ALERT_EMAILS）とその拠点のテナント管理者へメールで知らせる。
 *  - 記録は alarm_events（source='nvms'・event_type='os_vuln_urgent'）。dedup_key に組み合わせの
 *    指紋を入れ、同じ組み合わせが未処理（status='new'）で残っていれば送らない（heartbeat ごとに送らない）
 *  - 緊急が消えたら（直った・申告が消えた）、未処理の記録を閉じる。次に出たらまた知らせる
 *  - **失敗しても heartbeat は落とさない**（呼び出し側で握る）
 * 当てる作業は担当の販売パートナーが行う（G・VMS 側 docs/OS_VULN_RESPONSE.md §1）。
 */
import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/email/send'
import type { OsVulnStatus } from './os-vuln'

export const OS_VULN_EVENT = 'os_vuln_urgent'
const KEY_PREFIX = `nvms:${OS_VULN_EVENT}:`

/** 緊急の組み合わせ（サーバ × CVE）の指紋。無ければ null。 */
export function urgentKey(st: OsVulnStatus | null): string | null {
  if (!st || st.urgent === 0) return null
  const pairs = [...new Set(st.servers.flatMap((s) => s.findings
    .filter((f) => f.level === 'urgent' && !f.needs_reboot)
    .map((f) => `${s.node}|${f.cve}`)))].sort()
  // 再起動だけで直るもの（修正版は入っている）は知らせない — 当てる作業は済んでいる
  if (pairs.length === 0) return null
  return createHash('sha256').update(pairs.join('\n')).digest('hex').slice(0, 24)
}

const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** 知らせのメールの本文。 */
export function osVulnMailHtml(storeName: string, edgeName: string, st: OsVulnStatus): string {
  const rows = st.servers.flatMap((s) => s.findings
    .filter((f) => f.level === 'urgent' && !f.needs_reboot)
    .map((f) => `<tr><td style="padding:2px 12px 2px 0">${esc(s.node)}</td><td style="padding:2px 12px 2px 0;font-family:monospace">${esc([f.id, f.cve].filter(Boolean).join(' '))}</td><td style="padding:2px 12px 2px 0">${esc(f.package)}</td><td style="font-family:monospace">${esc(f.installed)} → ${esc(f.fixed)} 以上</td></tr>`))
  return `<p>拠点「${esc(storeName)}」（${esc(edgeName)}）のサーバの OS に、緊急の脆弱性が残っています。</p>`
    + '<table style="border-collapse:collapse"><tr style="color:#5B5B5F"><td>サーバ</td><td>お知らせ・CVE</td><td>部品</td><td>版</td></tr>'
    + rows.join('') + '</table>'
    + '<p>担当の販売パートナーへ連絡し、セキュリティのお知らせ（https://g-vms.com/security）の手順で更新してください。'
    + '一時の守りは 72 時間以内、部品の更新は 14 日以内が目安です。拠点稼働の一覧（設定 → 拠点の G・VMS）でも確かめられます。</p>'
}

/**
 * heartbeat のあとに呼ぶ。新しい緊急なら知らせて記録し、緊急が消えていれば記録を閉じる。
 * 戻り値は知らせたか（試験用）。
 */
export async function notifyOsVulnUrgent(
  svc: SupabaseClient, edge: { id: string; store_id: string }, st: OsVulnStatus | null,
): Promise<boolean> {
  const key = urgentKey(st)
  const { data: open } = await svc.from('alarm_events').select('id, dedup_key')
    .eq('store_id', edge.store_id).eq('event_type', OS_VULN_EVENT).eq('status', 'new')
  const openRows = (open ?? []) as { id: string; dedup_key: string }[]
  const stale = openRows.filter((r) => r.dedup_key !== KEY_PREFIX + key).map((r) => r.id)
  if (stale.length > 0) await svc.from('alarm_events').update({ status: 'closed' }).in('id', stale)
  if (!key || !st || openRows.some((r) => r.dedup_key === KEY_PREFIX + key)) return false

  const { data: ev } = await svc.from('alarm_events').insert({
    store_id: edge.store_id, camera_id: null, source: 'nvms', event_type: OS_VULN_EVENT,
    occurred_at: new Date().toISOString(), status: 'new', dedup_key: KEY_PREFIX + key,
  }).select('id').single()

  const [{ data: store }, { data: ed }] = await Promise.all([
    svc.from('stores').select('name, tenant_id').eq('id', edge.store_id).maybeSingle(),
    svc.from('edge_devices').select('name').eq('id', edge.id).maybeSingle(),
  ])
  const storeName = (store?.name as string | undefined) ?? '(拠点未設定)'
  const edgeName = (ed?.name as string | undefined) ?? edge.id
  const to = new Set((process.env.ALERT_EMAILS ?? '').split(',').map((s) => s.trim()).filter(Boolean))
  if (store?.tenant_id) {
    const { data: admins } = await svc.from('admin_users').select('email')
      .eq('tenant_id', store.tenant_id as string).eq('role', 'tenant_admin')
    for (const a of admins ?? []) if (typeof a.email === 'string' && a.email) to.add(a.email)
  }
  if (to.size > 0) {
    await sendEmail([...to], `【G・VMS 緊急】${storeName}: OS の緊急の更新が必要です`, osVulnMailHtml(storeName, edgeName, st))
  }
  if (ev) await svc.from('alarm_events').update({ notified_at: new Date().toISOString() }).eq('id', ev.id)
  return true
}
