/**
 * 役割ごとに「押すと断られる入口」を出さないための判定 (2026-11-04・シナリオ試験の所見)。
 *
 * 以前は左メニュー・上のタブ・右上の設定の歯車が役割を見ずに全部出ていて、閲覧者 (viewer) が
 * 設定の画面へ入って断られる・手荷物検査店長 (baggage_manager) が MONITOR を押して /baggage へ
 * 戻される、ということが起きていた。
 *
 * **ここは表示だけを決める。** 守りはサーバ側 (lib/admin/guard.ts の requireAdmin・
 * 各ページの判定・RLS の can_manage_store・middleware の手荷物検査店長の境界) のままで、
 * 条件はそれと同じにしてある。条件を変えるときは、必ずサーバ側と一緒に変えること。
 *
 * 役割が分からない (null) ときは従来どおり全部出す (読めなかっただけで入口を消さない)。
 */

/** 書き込みの担当を持つ役割。requireAdmin の ADMIN_ROLES・RLS の can_manage_store・
 *  テスト発令の TRIGGER_ROLES と同じ。 */
export const MANAGE_ROLES = ['super_admin', 'tenant_admin', 'store_manager'] as const

/** テナント全体を扱う役割。/admin/stores/new・/admin/baggage・/admin/users/new などの判定と同じ。 */
export const TENANT_ADMIN_ROLES = ['super_admin', 'tenant_admin'] as const

export function canManage(role: string | null | undefined): boolean {
  return role == null || (MANAGE_ROLES as readonly string[]).includes(role)
}

export function isTenantAdminOrSuper(role: string | null | undefined): boolean {
  return role == null || (TENANT_ADMIN_ROLES as readonly string[]).includes(role)
}

/** 手荷物検査店長か。middleware が /baggage 系 (と認証まわり) 以外を止める役割。 */
export function isBaggageOnly(role: string | null | undefined): boolean {
  return role === 'baggage_manager'
}

/**
 * 左メニューの項目ごとに、開ける役割の条件。ここに無い項目は役割で隠さない。
 * 値はサーバ側の判定の写し (src/test/admin-page-guard-inventory.test.ts の EXPECTED と同じ区分)。
 */
const NAV_RULES: Record<string, (role: string | null | undefined) => boolean> = {
  // ①設定。requireAdmin (super_admin / tenant_admin / store_manager) の画面
  '/admin/stores':   canManage,
  '/admin/users':    canManage,
  '/admin/fleet':    canManage,
  '/admin/bcp':      canManage,
  '/admin/audit':    canManage,
  // テナント管理者以上の画面
  '/admin/baggage':  isTenantAdminOrSuper,
  // CSV 一括投入。受け口 (/api/admin/import/*) と画面は requireTenantAdminOrSuper (2026-11-05)
  '/admin/import':   isTenantAdminOrSuper,
  // 各機能の設定。保存は RLS の can_manage_store・テスト発令は TRIGGER_ROLES で断られる
  '/security/settings': canManage,
  '/alarms/settings':   canManage,
  '/bcp/test':          canManage,
}

/** 役割で開けない項目を除く。見出し (heading) は、下に項目が 1 つも残らなければ除く。 */
export function filterNavForRole<T extends { href: string; heading?: boolean }>(
  items: T[],
  role: string | null | undefined,
): T[] {
  const kept = items.filter((n) => n.heading || (NAV_RULES[n.href]?.(role) ?? true))
  return kept.filter((n, i) => {
    if (!n.heading) return true
    const next = kept[i + 1]
    return !!next && !next.heading
  })
}

/** 上のタブ (モジュール) のうち、その役割で開けるものか。手荷物検査店長は /baggage だけ。 */
export function canOpenModule(href: string, role: string | null | undefined): boolean {
  if (!isBaggageOnly(role)) return true
  return href === '/baggage' || href.startsWith('/baggage/')
}
