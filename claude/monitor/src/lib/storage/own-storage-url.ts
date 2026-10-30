/**
 * https で、この Supabase のプロジェクトの保存先 (/storage/v1/object/…) の URL か (自主診断 ASVS 1.3.6)。
 *
 * BCP の古い行の clip_url はエッジの鍵でも書けるので、任意の URL を置かれると、クラウドが
 * その宛先へ取りに行く (SSRF) か、利用者をそこへ転送する口になる。古い公開の保存先の URL
 * だけを扱う (保存先は 2026-10-28 に非公開にしたので、ほかの宛先へ行く理由は無い)。
 */
export function isOwnStorageUrl(raw: string | null | undefined, supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL): boolean {
  if (!raw || !supabaseUrl) return false
  try {
    const u = new URL(raw)
    const own = new URL(supabaseUrl)
    return u.protocol === 'https:' && !u.username && !u.password && u.host === own.host && u.pathname.startsWith('/storage/v1/object/')
  } catch {
    return false
  }
}
