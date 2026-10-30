/**
 * 拠点 (G・VMS) へのサインインの許可 (OAuth の同意・grant) の期限と一覧
 * (2026-10-30・自主診断 ASVS 10.4.9・10.7.2・GVMS_CLOUD_SPEC §9.5)。
 *
 * Supabase の OAuth 2.1 Server は、利用者が一度承認した拠点 (クライアント) を覚え、次からは
 * 同意の画面を出さずに戻す。その許可には**期限が無く**、利用者が取り消す画面も無かった。
 * ここで次の 2 つを足す:
 *   1. 許可の期限: **最後に使ってから** GRANT_MAX_AGE_DAYS 日 (2026-10-30 発注者の決定 案 B)。
 *      使っている間は切れず、最後に使ってから 90 日使わなかった許可だけが切れる。
 *      期限 = max(承認の時刻, 最後に使った時刻) + GRANT_MAX_AGE_DAYS 日。
 *      「最後に使った時刻」は、拠点で SSO のサインインをするたびにできる拠点向けのセッションを、
 *      DB の定期の処理 (record_oauth_client_use・15 分ごと・migration 20261030153000) が
 *      oauth_client_last_used に写したもの。まだ写していない許可 (#428 より前からの許可を含む) は
 *      承認の時刻から数える。
 *      過ぎた許可は、同意の画面とアカウントの画面を開いたときに本人の接続で取り消す (revokeGrant)。
 *      次のサインインで同意の画面がもう一度出る。Supabase には許可の期限の設定が無いため、
 *      アプリで行う。拠点へのサインインは必ず同意の画面 (/oauth/consent) を通るので、そこで
 *      確かめれば漏れない。
 *   2. 一覧と取り消し: /account/sites が listGrants と revokeGrant を使う。取り消すと Supabase が
 *      その拠点向けのセッション (と refresh トークン) を消す。
 */
import type { OAuthGrant, SupabaseClient } from '@supabase/supabase-js'

/** 許可の期限 (日)。最後に使ってから (使っていなければ承認から) この日数で切れる。 */
export const GRANT_MAX_AGE_DAYS = 90
const DAY_MS = 24 * 60 * 60 * 1000

function parseTime(v: string | null | undefined): number {
  return v ? Date.parse(v) : NaN
}

/**
 * 許可の期限 = max(承認の時刻, 最後に使った時刻) + GRANT_MAX_AGE_DAYS 日。
 * 承認の時刻が読めなければ null (期限切れとして扱う)。最後に使った時刻が読めなければ、
 * 承認の時刻だけで数える (期限が早まる側に倒す)。
 */
export function grantExpiresAt(
  grantedAt: string | null | undefined, lastUsedAt?: string | null,
): Date | null {
  const granted = parseTime(grantedAt)
  if (!Number.isFinite(granted)) return null
  const used = parseTime(lastUsedAt)
  const base = Number.isFinite(used) ? Math.max(granted, used) : granted
  return new Date(base + GRANT_MAX_AGE_DAYS * DAY_MS)
}

/** 期限が過ぎたか。日時の読めない許可も過ぎたものとして扱う (取り消して確かめ直す)。 */
export function grantExpired(
  grantedAt: string | null | undefined, lastUsedAt: string | null | undefined, now: Date = new Date(),
): boolean {
  const exp = grantExpiresAt(grantedAt, lastUsedAt)
  return exp === null || exp.getTime() <= now.getTime()
}

/** OAuth のクライアント ID の形 (Supabase は UUID)。 */
export function validClientId(id: unknown): id is string {
  return typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
}

type GrantApi = Pick<SupabaseClient['auth']['oauth'], 'listGrants' | 'revokeGrant'>

/** 表が無い (migration 20261030153000 を当てる前) ときの PostgREST・Postgres のエラーの番号 */
const TABLE_MISSING = new Set(['PGRST205', '42P01'])

/**
 * 本人の「最後に使った時刻」をクライアント ID ごとに読む (表 oauth_client_last_used・本人の接続で読む。
 * RLS も本人の行だけを通す)。読めなければ null (呼び出し側は取り消しへ進まずに止める。
 * 一時の読み損ないで、使っている許可を取り消さないため)。
 * 表がまだ無いときだけは空 (= 承認から数える・#428 と同じ) にする。migration より先に画面が
 * 出ても、拠点へのサインインを全部止めないため。
 */
export async function readLastUsed(
  db: Pick<SupabaseClient, 'from'>, userId: string,
): Promise<Map<string, string> | null> {
  const { data, error } = await db.from('oauth_client_last_used')
    .select('client_id, last_used_at').eq('user_id', userId)
  if (error && TABLE_MISSING.has((error as { code?: string }).code ?? '')) return new Map()
  if (error || !data) return null
  const out = new Map<string, string>()
  for (const r of data as { client_id: string; last_used_at: string }[]) out.set(r.client_id, r.last_used_at)
  return out
}

export interface ActiveGrant {
  grant: OAuthGrant
  /** 期限が過ぎたのに取り消せなかった */
  expired: boolean
  /** 最後に使った時刻 (記録が無ければ null) */
  lastUsedAt: string | null
  /** 期限 (承認の時刻が読めなければ null) */
  expiresAt: Date | null
}

/**
 * 本人の許可を読み、期限の過ぎたものを取り消して、残りを返す。
 * lastUsed は readLastUsed の結果 (クライアント ID → 最後に使った時刻)。
 * 読めなければ null (OAuth 2.1 Server が無効なプロジェクトなど)。取り消しに失敗した許可は、
 * 期限切れのまま残さないよう一覧から外さずに返す (呼び出し側は expired で見分ける)。
 */
export async function activeGrants(
  oauth: GrantApi, lastUsed: ReadonlyMap<string, string>, now: Date = new Date(),
): Promise<ActiveGrant[] | null> {
  const { data, error } = await oauth.listGrants()
  if (error || !data) return null
  const out: ActiveGrant[] = []
  for (const g of data) {
    const lastUsedAt = lastUsed.get(g.client.id) ?? null
    const expiresAt = grantExpiresAt(g.granted_at, lastUsedAt)
    if (!grantExpired(g.granted_at, lastUsedAt, now)) { out.push({ grant: g, expired: false, lastUsedAt, expiresAt }); continue }
    const { error: revokeErr } = await oauth.revokeGrant({ clientId: g.client.id })
    if (revokeErr) out.push({ grant: g, expired: true, lastUsedAt, expiresAt })
  }
  return out
}

export interface GrantSite {
  /** 登録した G・VMS の拠点のクライアントか */
  known: boolean
  edgeId: string | null
  storeId: string | null
  /** 画面に出すサインイン先 (店舗・機器の名前) */
  label: string
}

/** クライアント ID からサインイン先 (店舗と機器の名前) を引く。サービスの接続で読む。 */
export async function grantSites(svc: SupabaseClient, clientIds: string[]): Promise<Map<string, GrantSite>> {
  const out = new Map<string, GrantSite>()
  const ids = clientIds.filter(validClientId)
  if (ids.length === 0) return out
  const { data: clients } = await svc.from('gvms_oidc_clients').select('client_id, edge_id').in('client_id', ids)
  const edgeIds = (clients ?? []).map((c) => c.edge_id as string)
  const { data: edges } = edgeIds.length
    ? await svc.from('edge_devices').select('id, name, store_id, stores(name)').in('id', edgeIds)
    : { data: [] as never[] }
  const edgeById = new Map((edges ?? []).map((e) => [e.id as string, e]))
  for (const c of clients ?? []) {
    const e = edgeById.get(c.edge_id as string) as
      { name?: string | null; store_id?: string | null; stores?: { name?: string | null } | null } | undefined
    const label = [e?.stores?.name, e?.name].filter(Boolean).join('・') || '拠点'
    out.set(c.client_id as string, {
      known: true, edgeId: c.edge_id as string, storeId: e?.store_id ?? null, label,
    })
  }
  return out
}

/** 今の日時 (ISO)。画面の描画の中で Date を直に作らないための小さな部品。 */
export function nowIso(): string {
  return new Date().toISOString()
}

/** 日時を日本時間の「2026/10/30 09:00」の形にする。 */
export function formatJst(d: Date | string | null): string {
  if (!d) return '—'
  const t = typeof d === 'string' ? new Date(d) : d
  if (!Number.isFinite(t.getTime())) return '—'
  return t.toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}
