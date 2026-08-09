import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * テナント/ロールのスコープ解決の契約テスト。
 *
 * ここは monitor で最もバグが出ている層（過去3ヶ月の権限系 fix 19件のうち
 * #207 #209 #211 #228 #232 #277 がこの解決結果のずれに起因）なのに、
 * これまでテストが 1 本も無かった。RLS 側は tests/authz/ が 63 テストで
 * 守っているが、**createSupabaseService は RLS を迂回する**ため、
 * アプリ層がここで返す tenantId / storeIds が唯一の防波堤になる。
 *
 * 方針: リーフの依存（admin_users 行・tenants 行・cookie・service client）だけを
 * 差し替え、resolveAdminContext → resolveMonitorScope の実ロジックは本物を通す。
 * acting をモックすると「2つを繋いだときの挙動」が検証できなくなるため。
 */

const h = vi.hoisted(() => ({
  cookie: undefined as string | undefined,
  me: null as { role: string; tenant_id: string | null; store_ids: string[] | null } | null,
  tenants: new Map<string, { id: string; name: string | null; opt_patrol: boolean | null; opt_alarm: boolean | null; opt_baggage: boolean | null }>(),
  storesByTenant: new Map<string, string[]>(),
  /** stores を service client で引いた回数（店舗限定ロールでは引かないことの確認用） */
  storeQueries: 0,
}))

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (_name: string) => (h.cookie === undefined ? undefined : { value: h.cookie }),
  }),
}))

vi.mock('@/lib/tenant/session', () => ({
  getAdminUserRow: async () => h.me,
  getTenantRow: async (id: string) => h.tenants.get(id) ?? null,
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: async () => ({}),
  createSupabaseService: () => ({
    from: () => ({
      select: () => ({
        eq: (_col: string, tenantId: string) => ({
          limit: () => {
            h.storeQueries += 1
            return Promise.resolve({
              data: (h.storesByTenant.get(tenantId) ?? []).map((id) => ({ id })),
              error: null,
            })
          },
        }),
      }),
    }),
  }),
}))

const { resolveAdminContext } = await import('./acting')
const { resolveMonitorScope } = await import('./monitor-scope')
const { resolveTenantFeatures, ALL_FEATURES_ON } = await import('./features')

const T_A = 'tenant-a'
const T_B = 'tenant-b'
const S_A1 = 'store-a1'
const S_A2 = 'store-a2'

const tenant = (id: string, name: string, opts: Partial<{ patrol: boolean; alarm: boolean; baggage: boolean }> = {}) => ({
  id,
  name,
  opt_patrol: opts.patrol ?? true,
  opt_alarm: opts.alarm ?? true,
  opt_baggage: opts.baggage ?? true,
})

beforeEach(() => {
  h.cookie = undefined
  h.me = null
  h.storeQueries = 0
  h.tenants = new Map([
    [T_A, tenant(T_A, 'テナントA')],
    [T_B, tenant(T_B, 'テナントB')],
  ])
  h.storesByTenant = new Map([
    [T_A, [S_A1, S_A2]],
    [T_B, ['store-b1']],
  ])
})

// 店舗限定ロール（acting.ts の STORE_SCOPED_ROLES と同じ集合）。
const STORE_SCOPED = ['store_manager', 'viewer', 'baggage_manager'] as const

describe('resolveAdminContext', () => {
  it('未ログイン・admin_users 未登録は一切の文脈を持たない', async () => {
    h.me = null
    expect(await resolveAdminContext()).toEqual({
      role: null, isSuper: false, tenantId: null, tenantName: null, acting: false, storeIds: null,
    })
  })

  it('tenant_admin は自テナント固定・店舗制限なし', async () => {
    h.me = { role: 'tenant_admin', tenant_id: T_A, store_ids: [] }
    expect(await resolveAdminContext()).toEqual({
      role: 'tenant_admin', isSuper: false, tenantId: T_A, tenantName: 'テナントA', acting: false, storeIds: null,
    })
  })

  it('tenant_admin は cookie で他テナントへ乗り換えられない（操作中テナントは super 専用）', async () => {
    h.me = { role: 'tenant_admin', tenant_id: T_A, store_ids: [] }
    h.cookie = T_B
    const ctx = await resolveAdminContext()
    expect(ctx.tenantId).toBe(T_A)
    expect(ctx.acting).toBe(false)
  })

  it.each(STORE_SCOPED)('%s は担当店舗の配列を持つ（storeIds !== null）', async (role) => {
    h.me = { role, tenant_id: T_A, store_ids: [S_A1] }
    const ctx = await resolveAdminContext()
    expect(ctx.storeIds).toEqual([S_A1])
    expect(ctx.tenantId).toBe(T_A)
    expect(ctx.isSuper).toBe(false)
  })

  it('店舗限定ロールで store_ids が NULL でも空配列になる（null と混同しない）', async () => {
    // storeIds===null は「店舗制限なし＝テナント全体」を意味する。ここを null に
    // すると担当店舗ゼロのユーザーがテナント全体を見てしまう。
    h.me = { role: 'store_manager', tenant_id: T_A, store_ids: null }
    expect((await resolveAdminContext()).storeIds).toEqual([])
  })

  it('tenant_admin の tenant_id が NULL の不整合行では tenantId を確定させない', async () => {
    // 既知の未処理データ（tenant_id=NULL のまま運用されている行）。テナントを
    // 確定できない以上、作成系を通してはいけないので tenantId は null のまま。
    h.me = { role: 'tenant_admin', tenant_id: null, store_ids: [] }
    const ctx = await resolveAdminContext()
    expect(ctx.role).toBe('tenant_admin')
    expect(ctx.tenantId).toBeNull()
    expect(ctx.storeIds).toBeNull()
  })

  it('store_manager の tenant_id が NULL でも担当店舗は保持する', async () => {
    h.me = { role: 'store_manager', tenant_id: null, store_ids: [S_A1] }
    const ctx = await resolveAdminContext()
    expect(ctx.tenantId).toBeNull()
    expect(ctx.storeIds).toEqual([S_A1])
  })

  it('super_admin は操作中テナント未選択なら tenantId=null・acting=false', async () => {
    h.me = { role: 'super_admin', tenant_id: null, store_ids: [] }
    expect(await resolveAdminContext()).toEqual({
      role: 'super_admin', isSuper: true, tenantId: null, tenantName: null, acting: false, storeIds: null,
    })
  })

  it('super_admin が操作中テナントを選ぶとそのテナントに固定される', async () => {
    h.me = { role: 'super_admin', tenant_id: null, store_ids: [] }
    h.cookie = T_B
    expect(await resolveAdminContext()).toEqual({
      role: 'super_admin', isSuper: true, tenantId: T_B, tenantName: 'テナントB', acting: true, storeIds: null,
    })
  })

  it('存在しないテナントIDの cookie は無視する（cookie を信用しない）', async () => {
    // cookie は httpOnly だが、消したテナントのIDが残る/細工される経路を想定し、
    // 必ず tenants の実在確認を通してから採用すること。
    h.me = { role: 'super_admin', tenant_id: null, store_ids: [] }
    h.cookie = 'does-not-exist'
    const ctx = await resolveAdminContext()
    expect(ctx.tenantId).toBeNull()
    expect(ctx.acting).toBe(false)
  })

  it('super_admin には店舗制限を掛けない（store_ids が入っていても null）', async () => {
    h.me = { role: 'super_admin', tenant_id: null, store_ids: [S_A1] }
    expect((await resolveAdminContext()).storeIds).toBeNull()
  })
})

describe('resolveMonitorScope', () => {
  const supa = {} as never

  it('super_admin が操作中テナント未選択ならデータを出さない（TenantGate）', async () => {
    // ここが false になると /stores や /bcp で全テナント合算が見える（PR #229 の回帰）。
    h.me = { role: 'super_admin', tenant_id: null, store_ids: [] }
    const scope = await resolveMonitorScope(supa)
    expect(scope.needsTenant).toBe(true)
    expect(scope.tenantId).toBeNull()
    expect(scope.storeIds).toEqual([])
  })

  it('super_admin が操作中テナントを選ぶとそのテナントの店舗だけになる', async () => {
    h.me = { role: 'super_admin', tenant_id: null, store_ids: [] }
    h.cookie = T_A
    const scope = await resolveMonitorScope(supa)
    expect(scope.needsTenant).toBe(false)
    expect(scope.tenantId).toBe(T_A)
    expect(scope.storeIds).toEqual([S_A1, S_A2])
  })

  it('tenant_admin は自テナントの全店舗', async () => {
    h.me = { role: 'tenant_admin', tenant_id: T_B, store_ids: [] }
    const scope = await resolveMonitorScope(supa)
    expect(scope.storeIds).toEqual(['store-b1'])
    expect(scope.needsTenant).toBe(false)
  })

  it.each(STORE_SCOPED)('%s は担当店舗のみで、stores を引きに行かない', async (role) => {
    h.me = { role, tenant_id: T_A, store_ids: [S_A1] }
    const scope = await resolveMonitorScope(supa)
    expect(scope.storeIds).toEqual([S_A1])
    expect(scope.needsTenant).toBe(false)
    // テナント全店舗の取得へ落ちたら、担当外の店舗まで見えてしまう。
    expect(h.storeQueries).toBe(0)
  })

  it('担当店舗ゼロの店舗限定ロールは「何も見えない」であって「ゲート表示」ではない', async () => {
    // storeIds=[] は falsy ではない。ここを長さで判定すると空配列がテナント全体へ
    // フォールバックする（越権）。needsTenant も立てない（設定漏れは別問題）。
    h.me = { role: 'viewer', tenant_id: T_A, store_ids: [] }
    const scope = await resolveMonitorScope(supa)
    expect(scope.storeIds).toEqual([])
    expect(scope.needsTenant).toBe(false)
    expect(h.storeQueries).toBe(0)
  })

  it('tenant_id が NULL の tenant_admin はゲート表示（テナントを特定できない）', async () => {
    h.me = { role: 'tenant_admin', tenant_id: null, store_ids: [] }
    const scope = await resolveMonitorScope(supa)
    expect(scope.needsTenant).toBe(true)
    expect(scope.storeIds).toEqual([])
  })

  it('未ログインもゲート表示（データは出さない）', async () => {
    h.me = null
    expect((await resolveMonitorScope(supa)).needsTenant).toBe(true)
  })
})

describe('resolveTenantFeatures', () => {
  it('admin_users 未登録は全ON（メニューを消さない＝フェイルオープン）', async () => {
    h.me = null
    expect(await resolveTenantFeatures()).toEqual(ALL_FEATURES_ON)
  })

  it('テナント配下ユーザーは所属テナントの opt_* に従う', async () => {
    h.tenants.set(T_A, tenant(T_A, 'テナントA', { patrol: false, alarm: true, baggage: false }))
    h.me = { role: 'tenant_admin', tenant_id: T_A, store_ids: [] }
    expect(await resolveTenantFeatures()).toEqual({ patrol: false, alarm: true, baggage: false })
  })

  it('tenants 行が引けないときは全ON（列未適用・取得失敗で機能を消さない）', async () => {
    h.me = { role: 'tenant_admin', tenant_id: 'missing-tenant', store_ids: [] }
    expect(await resolveTenantFeatures()).toEqual(ALL_FEATURES_ON)
  })

  it('super_admin は操作中テナント未選択なら全ON', async () => {
    h.me = { role: 'super_admin', tenant_id: null, store_ids: [] }
    expect(await resolveTenantFeatures()).toEqual(ALL_FEATURES_ON)
  })

  it('super_admin は操作中テナントの視点で出し分ける', async () => {
    h.tenants.set(T_B, tenant(T_B, 'テナントB', { patrol: false, alarm: false, baggage: true }))
    h.me = { role: 'super_admin', tenant_id: null, store_ids: [] }
    h.cookie = T_B
    expect(await resolveTenantFeatures()).toEqual({ patrol: false, alarm: false, baggage: true })
  })

  it('存在しないテナントIDの cookie では全ON（隠し過ぎない）', async () => {
    h.me = { role: 'super_admin', tenant_id: null, store_ids: [] }
    h.cookie = 'does-not-exist'
    expect(await resolveTenantFeatures()).toEqual(ALL_FEATURES_ON)
  })

  it('opt_* が NULL の行は OFF 扱い（列は NOT NULL DEFAULT false なので実際には起きない）', async () => {
    // 型上は boolean|null。null が来たら安全側ではなく OFF に倒れる、という
    // 事実の固定。行そのものが引けない場合（上のケース）だけが全ON。
    h.tenants.set(T_A, { id: T_A, name: 'A', opt_patrol: null, opt_alarm: null, opt_baggage: null })
    h.me = { role: 'tenant_admin', tenant_id: T_A, store_ids: [] }
    expect(await resolveTenantFeatures()).toEqual({ patrol: false, alarm: false, baggage: false })
  })
})
