/**
 * テスト用の小さな「メモリ上の Supabase」（要望の収集のルートの試験で使う）。
 *
 * supabase-js の問い合わせの書き方（from().select().eq()….maybeSingle() など）を、
 * 使っている分だけ真似る。本物の PostgREST の代わりではない — RLS・型変換・
 * トリガは無い。updated_at の扱いなど DB 側の決まりは、マイグレーションをローカルの
 * Postgres に当てて別に確かめる（試験の対象は「ルートが何をどの順で書くか」）。
 *
 * 一意の制約は `uniques` に列の組で渡す（違反すると code 23505 を返す）。
 *
 * Storage は使う分だけ（upload・remove・list・createSignedUrl）。置いたものは `objects` に
 * `<bucket>/<path>` で残る。`storageFail` を立てるとその操作が失敗を返す。
 */
import { randomUUID } from 'node:crypto'

type Row = Record<string, unknown>
type Filter = (r: Row) => boolean

export interface FakeDbOptions {
  /** 表ごとの一意の列の組（null を含む行は対象外＝部分一意の索引のつもり） */
  uniques?: Record<string, string[][]>
  /** 表ごとの既定値（insert で足りない列を埋める） */
  defaults?: Record<string, () => Row>
  /** update のときに走らせる（トリガの代わり） */
  onUpdate?: Record<string, (before: Row, after: Row) => Row>
}

const cmp = (a: unknown, b: unknown): number => {
  const ta = typeof a === 'string' ? Date.parse(a) : NaN
  const tb = typeof b === 'string' ? Date.parse(b) : NaN
  if (Number.isFinite(ta) && Number.isFinite(tb) && /\d{4}-\d{2}-\d{2}T/.test(String(a)) && /\d{4}-\d{2}-\d{2}T/.test(String(b))) {
    return ta - tb
  }
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0
}

export function createFakeDb(seed: Record<string, Row[]> = {}, opts: FakeDbOptions = {}) {
  const tables: Record<string, Row[]> = {}
  for (const [k, v] of Object.entries(seed)) tables[k] = v.map((r) => ({ ...r }))
  const calls: { table: string; op: string; payload?: unknown }[] = []

  const table = (name: string) => (tables[name] ??= [])

  function violates(name: string, row: Row, ignore?: Row): boolean {
    for (const cols of opts.uniques?.[name] ?? []) {
      if (cols.some((c) => row[c] == null)) continue
      if (table(name).some((r) => r !== ignore && cols.every((c) => r[c] === row[c]))) return true
    }
    return false
  }

  class Query implements PromiseLike<{ data: unknown; error: unknown; count?: number | null }> {
    private filters: Filter[] = []
    private op: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select'
    private conflict: string[] = []
    private payload: unknown
    private wantCount = false
    private head = false
    private orders: { col: string; asc: boolean }[] = []
    private lim: number | null = null
    private singleMode: 'one' | 'maybe' | null = null
    private returning = false
    constructor(private name: string) {}

    select(_cols?: string, o?: { count?: string; head?: boolean }) {
      if (this.op === 'select') { this.wantCount = !!o?.count; this.head = !!o?.head } else this.returning = true
      return this
    }
    insert(p: unknown) { this.op = 'insert'; this.payload = p; return this }
    update(p: unknown) { this.op = 'update'; this.payload = p; return this }
    delete() { this.op = 'delete'; return this }
    /** onConflict の列が一致する行があれば上書き、無ければ足す */
    upsert(p: unknown, o?: { onConflict?: string }) {
      this.op = 'upsert'; this.payload = p
      this.conflict = (o?.onConflict ?? 'id').split(',').map((c) => c.trim())
      return this
    }
    /**
     * PostgREST の or（使う形だけ: `col.eq.v`・`col.neq.v`・`col.is.null`・`col.not.is.null`）。
     * 値は文字列として比べる。
     */
    or(expr: string) {
      const parts = expr.split(',').map((p) => {
        const [col, ...rest] = p.split('.')
        const op = rest.join('.')
        if (op === 'is.null') return (r: Row) => (r[col] ?? null) === null
        if (op === 'not.is.null') return (r: Row) => (r[col] ?? null) !== null
        if (op.startsWith('neq.')) return (r: Row) => String(r[col]) !== op.slice(4)
        if (op.startsWith('eq.')) return (r: Row) => String(r[col]) === op.slice(3)
        throw new Error(`fake-supabase: or の形を知らない: ${p}`)
      })
      this.filters.push((r) => parts.some((f) => f(r)))
      return this
    }
    eq(c: string, v: unknown) { this.filters.push((r) => r[c] === v); return this }
    neq(c: string, v: unknown) { this.filters.push((r) => r[c] !== v); return this }
    in(c: string, vs: unknown[]) { this.filters.push((r) => vs.includes(r[c])); return this }
    is(c: string, v: unknown) { this.filters.push((r) => (r[c] ?? null) === v); return this }
    not(c: string, op: string, v: unknown) {
      if (op === 'is') this.filters.push((r) => (r[c] ?? null) !== v)
      return this
    }
    gt(c: string, v: unknown) { this.filters.push((r) => r[c] != null && cmp(r[c], v) > 0); return this }
    gte(c: string, v: unknown) { this.filters.push((r) => r[c] != null && cmp(r[c], v) >= 0); return this }
    lt(c: string, v: unknown) { this.filters.push((r) => r[c] != null && cmp(r[c], v) < 0); return this }
    order(col: string, o?: { ascending?: boolean }) { this.orders.push({ col, asc: o?.ascending !== false }); return this }
    limit(n: number) { this.lim = n; return this }
    maybeSingle() { this.singleMode = 'maybe'; return this }
    single() { this.singleMode = 'one'; return this }

    private run(): { data: unknown; error: unknown; count?: number | null } {
      calls.push({ table: this.name, op: this.op, payload: this.payload })
      const rows = table(this.name)
      const match = () => rows.filter((r) => this.filters.every((f) => f(r)))
      let out: Row[] = []
      if (this.op === 'insert') {
        const list = (Array.isArray(this.payload) ? this.payload : [this.payload]) as Row[]
        for (const p of list) {
          const row: Row = { id: randomUUID(), ...(opts.defaults?.[this.name]?.() ?? {}), ...p }
          if (violates(this.name, row)) return { data: null, error: { code: '23505', message: 'duplicate key' } }
          rows.push(row)
          out.push(row)
        }
      } else if (this.op === 'update') {
        for (const r of match()) {
          let next = { ...r, ...(this.payload as Row) }
          if (opts.onUpdate?.[this.name]) next = opts.onUpdate[this.name](r, next)
          Object.assign(r, next)
          out.push(r)
        }
      } else if (this.op === 'upsert') {
        const list = (Array.isArray(this.payload) ? this.payload : [this.payload]) as Row[]
        for (const p of list) {
          const hit = rows.find((r) => this.conflict.every((c) => r[c] === p[c]))
          if (hit) {
            Object.assign(hit, p)
            out.push(hit)
          } else {
            const row: Row = { ...(opts.defaults?.[this.name]?.() ?? {}), ...p }
            rows.push(row)
            out.push(row)
          }
        }
      } else if (this.op === 'delete') {
        out = match()
        tables[this.name] = rows.filter((r) => !out.includes(r))
      } else {
        out = match()
      }
      for (const o of [...this.orders].reverse()) {
        out = [...out].sort((a, b) => (o.asc ? 1 : -1) * cmp(a[o.col], b[o.col]))
      }
      if (this.lim != null) out = out.slice(0, this.lim)
      const count = this.wantCount ? out.length : null
      if (this.op !== 'select' && !this.returning && !this.singleMode) return { data: null, error: null }
      if (this.head) return { data: null, error: null, count }
      const copy = out.map((r) => ({ ...r }))
      if (this.singleMode === 'maybe') return { data: copy[0] ?? null, error: null }
      if (this.singleMode === 'one') {
        return copy.length === 1 ? { data: copy[0], error: null } : { data: null, error: { code: 'PGRST116', message: 'not one row' } }
      }
      return { data: copy, error: null, count }
    }

    then<T1 = { data: unknown; error: unknown; count?: number | null }, T2 = never>(
      ok?: ((v: { data: unknown; error: unknown; count?: number | null }) => T1 | PromiseLike<T1>) | null,
      ng?: ((e: unknown) => T2 | PromiseLike<T2>) | null,
    ): PromiseLike<T1 | T2> {
      return Promise.resolve().then(() => this.run()).then(ok, ng)
    }
  }

  const from = (name: string) => new Query(name)

  const objects = new Map<string, { bytes: Uint8Array; contentType?: string }>()
  const storageFail: { upload?: boolean; remove?: boolean; list?: boolean; sign?: boolean } = {}
  const fail = (op: string) => ({ data: null, error: { message: `storage ${op} failed` } })
  const storage = {
    from: (bucket: string) => ({
      async upload(path: string, bytes: Uint8Array, o?: { contentType?: string; upsert?: boolean }) {
        if (storageFail.upload) return fail('upload')
        const key = `${bucket}/${path}`
        if (objects.has(key) && !o?.upsert) return { data: null, error: { message: 'The resource already exists' } }
        objects.set(key, { bytes, contentType: o?.contentType })
        return { data: { path }, error: null }
      },
      async remove(paths: string[]) {
        if (storageFail.remove) return fail('remove')
        for (const p of paths) objects.delete(`${bucket}/${p}`)
        return { data: paths.map((name) => ({ name })), error: null }
      },
      async list(prefix: string, o?: { limit?: number }) {
        if (storageFail.list) return fail('list')
        const head = `${bucket}/${prefix}/`
        const names = [...objects.keys()]
          .filter((k) => k.startsWith(head) && !k.slice(head.length).includes('/'))
          .map((k) => ({ name: k.slice(head.length) }))
        return { data: names.slice(0, o?.limit ?? 100), error: null }
      },
      async createSignedUrl(path: string, ttl: number) {
        if (storageFail.sign) return fail('sign')
        return { data: { signedUrl: `https://storage.example/${bucket}/${path}?ttl=${ttl}` }, error: null }
      },
    }),
  }

  return {
    client: { from, rpc: async () => ({ data: true, error: null }), storage },
    tables,
    calls,
    objects,
    storageFail,
    rows: (name: string) => table(name),
  }
}
