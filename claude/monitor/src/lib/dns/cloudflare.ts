/**
 * Cloudflare の DNS（genesis-edge.com のゾーン）を書く薄い口（GVMS_CLOUD_SPEC §10・D-2-20）。
 *
 * 使うのは 2 つだけ:
 *   - 拠点の名前の A レコード（<ラベル>.sites.genesis-edge.com → 拠点の LAN の IP・プロキシなし）
 *   - 拠点が証明書を取るときの _acme-challenge の TXT（拠点の名前の分だけ）
 *
 * API トークンは Vercel の秘密の設定（CLOUDFLARE_API_TOKEN・ゾーンの DNS 編集だけの権限）。
 * **拠点には渡さない。** 拠点は /api/edge/tls/txt を通して自分の名前の TXT しか書けない。
 */

const API = 'https://api.cloudflare.com/client/v4'

export function cloudflareDnsConfigured(): boolean {
  return !!process.env.CLOUDFLARE_API_TOKEN?.trim() && !!process.env.CLOUDFLARE_ZONE_ID?.trim()
}

/** 拠点の名前を付けるドメイン（例 sites.genesis-edge.com）。 */
export function siteDomain(): string {
  return (process.env.GVMS_SITE_DOMAIN ?? 'sites.genesis-edge.com').trim().toLowerCase().replace(/^\.+|\.+$/g, '')
}

interface DnsRecord { id: string; type: string; name: string; content: string }

async function cf(path: string, init?: RequestInit): Promise<{ success: boolean; result: unknown; errors?: { message: string }[] }> {
  const token = process.env.CLOUDFLARE_API_TOKEN?.trim()
  const zone = process.env.CLOUDFLARE_ZONE_ID?.trim()
  if (!token || !zone) throw new Error('dns_not_configured')
  const res = await fetch(`${API}/zones/${zone}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    cache: 'no-store',
  })
  const j = (await res.json().catch(() => ({ success: false, result: null, errors: [{ message: `http ${res.status}` }] }))) as
    { success: boolean; result: unknown; errors?: { message: string }[] }
  if (!res.ok || !j.success) {
    // トークンは載せない。Cloudflare の誤りの文言だけ
    throw new Error(`cloudflare: ${(j.errors ?? []).map((e) => e.message).join('; ') || `http ${res.status}`}`)
  }
  return j
}

async function list(type: 'A' | 'TXT', name: string): Promise<DnsRecord[]> {
  const j = await cf(`/dns_records?type=${type}&name=${encodeURIComponent(name)}&per_page=100`)
  return (j.result as DnsRecord[]) ?? []
}

/** A レコードを 1 本にそろえる（無ければ作る・違えば書き換える・余分は消す）。 */
export async function upsertA(name: string, ip: string): Promise<void> {
  const cur = await list('A', name)
  const keep = cur.find((r) => r.content === ip)
  for (const r of cur) {
    if (r !== keep) await cf(`/dns_records/${r.id}`, { method: 'DELETE' })
  }
  if (!keep) {
    await cf('/dns_records', { method: 'POST', body: JSON.stringify({ type: 'A', name, content: ip, ttl: 300, proxied: false }) })
  }
}

/** 名前の A レコードをすべて消す（無ければ何もしない）。 */
export async function deleteA(name: string): Promise<void> {
  for (const r of await list('A', name)) await cf(`/dns_records/${r.id}`, { method: 'DELETE' })
}

/** 検証用の TXT を足す。同じ名前は MAX_TXT 件までにし、古いものから消す（取得の失敗が続いても汚れないように）。 */
export const MAX_TXT_PER_NAME = 5
export async function addTXT(name: string, value: string): Promise<void> {
  const cur = await list('TXT', name)
  if (cur.some((r) => stripQuotes(r.content) === value)) return
  const extra = cur.length - (MAX_TXT_PER_NAME - 1)
  for (const r of cur.slice(0, Math.max(0, extra))) await cf(`/dns_records/${r.id}`, { method: 'DELETE' })
  await cf('/dns_records', { method: 'POST', body: JSON.stringify({ type: 'TXT', name, content: value, ttl: 60 }) })
}

/** 値の一致する TXT を消す（無ければ何もしない）。 */
export async function deleteTXT(name: string, value: string): Promise<void> {
  for (const r of await list('TXT', name)) {
    if (stripQuotes(r.content) === value) await cf(`/dns_records/${r.id}`, { method: 'DELETE' })
  }
}

function stripQuotes(s: string): string {
  return s.replace(/^"+|"+$/g, '')
}
