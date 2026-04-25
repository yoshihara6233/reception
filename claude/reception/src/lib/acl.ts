// Role-based access helpers shared by server + client.
// Keep the matrix centralized so adding a new menu is a one-line change.

export type Role = 'tenant_admin' | 'super_admin' | 'store_manager' | 'auditor' | 'viewer' | string

export function isFullAdmin(role: Role): boolean {
  return role === 'tenant_admin' || role === 'super_admin'
}

// Menu visibility keyed by href. Undefined key = visible to everyone.
// auditor = all-store read-only + CSV export (no create/modify).
const MENU_ACCESS: Record<string, Role[]> = {
  '/admin/dashboard':              ['tenant_admin', 'super_admin', 'store_manager', 'auditor', 'viewer'],
  '/admin/visits':                 ['tenant_admin', 'super_admin', 'store_manager', 'auditor', 'viewer'],
  '/admin/analytics':              ['tenant_admin', 'super_admin', 'store_manager', 'auditor'],
  '/admin/stores':                 ['tenant_admin', 'super_admin', 'store_manager', 'auditor'],
  '/admin/persons':                ['tenant_admin', 'super_admin', 'store_manager'],
  '/admin/pre-registrations':      ['tenant_admin', 'super_admin', 'store_manager'],
  '/admin/settings':               ['tenant_admin', 'super_admin'],
  '/admin/settings/consent':       ['tenant_admin', 'super_admin'],
  '/admin/settings/staff':         ['tenant_admin', 'super_admin', 'store_manager'],
  '/admin/settings/notifications': ['tenant_admin', 'super_admin', 'store_manager'],
  '/admin/settings/webhooks':      ['tenant_admin', 'super_admin', 'store_manager'],
  '/admin/users':                  ['tenant_admin', 'super_admin'],
  '/admin/logs':                   ['tenant_admin', 'super_admin', 'auditor'],
  '/admin/manual':                 ['tenant_admin', 'super_admin', 'store_manager', 'auditor', 'viewer'],
}

export function canAccess(role: Role, href: string): boolean {
  const allowed = MENU_ACCESS[href]
  if (!allowed) return true
  return allowed.includes(role)
}

// Store scoping for list endpoints.
// tenant_admin / super_admin / auditor: unrestricted (see all stores).
// store_manager / viewer: constrained to their assigned store_ids.
export function storeScope(role: Role, storeIds: string[]): { all: true } | { ids: string[] } {
  if (isFullAdmin(role) || role === 'auditor') return { all: true }
  return { ids: storeIds ?? [] }
}
