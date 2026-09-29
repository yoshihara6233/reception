/**
 * 拠点の https（GVMS_CLOUD_SPEC §10・D-2-20）。
 *
 * 管理者が拠点にラベル（例 site200）と LAN の IP を決めると、名前
 * `<ラベル>.<GVMS_SITE_DOMAIN>` の A レコードを置き、設定の配送（GET /api/edge/config の
 * `tls`）で名前を拠点へ渡す。拠点は Let's Encrypt から DNS-01 で証明書を取り、その検証用の
 * TXT を /api/edge/tls/txt に頼む（自分の名前の分だけ）。
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { deleteA, siteDomain, upsertA } from '@/lib/dns/cloudflare'

export const SITE_LABEL_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/
export const ACME_VALUE_RE = /^[A-Za-z0-9_-]{1,128}$/
const IPV4_RE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/

/** ラベルを検査して小文字にする。不正なら null。 */
export function normalizeLabel(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const v = raw.trim().toLowerCase()
  return SITE_LABEL_RE.test(v) ? v : null
}

/** 拠点の LAN の IPv4 か（公開 DNS に置くので私設の範囲に限る）。 */
export function isPrivateIPv4(raw: unknown): raw is string {
  if (typeof raw !== 'string' || !IPV4_RE.test(raw.trim())) return false
  const [a, b] = raw.trim().split('.').map(Number)
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
}

/** ラベルから名前を作る。 */
export function hostnameFor(label: string): string {
  return `${label}.${siteDomain()}`
}

/** 拠点が頼んでよい TXT の名前か（自分の名前の _acme-challenge だけ）。 */
export function txtNameAllowed(name: unknown, hostname: string | null): name is string {
  return typeof name === 'string' && !!hostname && name.trim().toLowerCase() === `_acme-challenge.${hostname}`
}

/** 拠点へ配る tls（名前が無ければ null）。 */
export async function tlsConfigFor(svc: SupabaseClient, edgeId: string): Promise<{ hostname: string } | null> {
  const { data } = await svc.from('edge_devices').select('site_hostname').eq('id', edgeId).maybeSingle()
  const h = (data?.site_hostname as string | null) ?? null
  return h ? { hostname: h } : null
}

/** 設定の版を上げる（拠点が配り直しを取りに来るように・gvms-oidc と同じ）。 */
export async function bumpConfigVersion(svc: SupabaseClient, edgeId: string): Promise<void> {
  const { data: rec } = await svc.from('recorders').select('id, config_version')
    .eq('edge_id', edgeId).eq('vendor', 'nvms').order('created_at', { ascending: true }).limit(1).maybeSingle()
  if (!rec) return
  await svc.from('recorders')
    .update({ config_version: (rec.config_version ?? 0) + 1, updated_at: new Date().toISOString() })
    .eq('id', rec.id)
}

/**
 * 拠点の名前と IP を決める。A レコードを置いてから保存し、版を上げる。
 * 名前が変わるときは前の A レコードを消す。
 */
export async function setSiteHost(svc: SupabaseClient, edgeId: string, label: string, ip: string): Promise<{ hostname: string }> {
  const hostname = hostnameFor(label)
  const { data: cur } = await svc.from('edge_devices').select('site_hostname').eq('id', edgeId).maybeSingle()
  const prev = (cur?.site_hostname as string | null) ?? null
  // 同じ名前を別の拠点が使っていないか（列の unique でも守るが、先に分かる誤りにする）
  const { data: dup } = await svc.from('edge_devices').select('id').eq('site_hostname', hostname).neq('id', edgeId).maybeSingle()
  if (dup) throw new Error('hostname_taken')
  await upsertA(hostname, ip)
  if (prev && prev !== hostname) await deleteA(prev)
  const { error } = await svc.from('edge_devices')
    .update({ site_hostname: hostname, site_lan_ip: ip, updated_at: new Date().toISOString() })
    .eq('id', edgeId)
  if (error) throw new Error(error.message)
  await bumpConfigVersion(svc, edgeId)
  return { hostname }
}

/** 名前を外す。A レコードを消し、次の配送で拠点は自動取得を止める。 */
export async function clearSiteHost(svc: SupabaseClient, edgeId: string): Promise<void> {
  const { data: cur } = await svc.from('edge_devices').select('site_hostname').eq('id', edgeId).maybeSingle()
  const prev = (cur?.site_hostname as string | null) ?? null
  if (prev) await deleteA(prev)
  const { error } = await svc.from('edge_devices')
    .update({ site_hostname: null, site_lan_ip: null, updated_at: new Date().toISOString() })
    .eq('id', edgeId)
  if (error) throw new Error(error.message)
  await bumpConfigVersion(svc, edgeId)
}
