/**
 * **本番スキーマの不変条件**を毎日見る。
 *
 * ── なぜ要るのか ────────────────────────────────────────────────────────
 * これらの条件は CI（tests/schema-meta/）が見ているが、**見ているのは
 * ローカルの DB** ——migration を当て直した直後の、綺麗な状態。
 * 本番はそこからずれる:
 *
 *   ・ダッシュボードから手で表を足す（RLS を有効にし忘れる）
 *   ・DR で建て直したときに一部が落ちる
 *   ・migration の適用が途中で止まる
 *
 * そして 2026-08-10 に分かったとおり、**ローカルと本番が同じように壊れて
 * いる**こともある。live_sessions → stores の外部キーは両方に無く、
 * 同時視聴上限は本番で一度も発動していなかった。CI は「ローカルと同じ」を
 * 保証するだけで、「正しい」を保証しない。だから本番そのものに毎日聞く。
 *
 * ── 役割分担 ────────────────────────────────────────────────────────────
 * 事実の取り出しは DB の `schema_invariants()`、**判断はここ**
 * （partition-health.ts と同じ分け方）。台帳をここに置くことで、
 * CI のテストと日次監視が**同じ台帳を見る**ようになる。
 */

/** 埋め込み（`親!inner(...)`）が要求する外部キーの組。src の実物と 1 対 1。 */
export interface EmbedPair {
  /** src からの相対パス（どこを直せばよいか分かるように） */
  file: string
  /** 埋め込む側 */
  from: string
  /** 埋め込まれる側 */
  to: string
}

/**
 * 埋め込みの棚卸し。**tests/schema-meta/embed-inventory.test.ts と
 * この日次監視の両方がここを見る。**
 *
 * PostgREST は埋め込みの相手を外部キーから探す。無いと 400 を返すが、
 * 呼び出し側が `const { count } = ...` と error を捨てていると
 * **count は null → 0 として素通りする**。2026-08-10 に判明した
 * 同時視聴上限の不発動がこれ（live_sessions は月次パーティション化した
 * 時点で stores への外部キーを失っていた）。
 */
export const EMBED_PAIRS: EmbedPair[] = [
  { file: 'app/stores/page.tsx',                   from: 'patrol_findings',     to: 'patrol_runs' },
  { file: 'app/api/cron/baggage-daily/route.ts',   from: 'inspection_settings', to: 'stores' },
  { file: 'app/api/cron/security-patrol/route.ts', from: 'security_settings',   to: 'stores' },
  { file: 'app/api/cron/security-report/route.ts', from: 'security_settings',   to: 'stores' },
  { file: 'app/api/baggage/settings/route.ts',     from: 'recorder_cameras',    to: 'recorders' },
  { file: 'app/api/baggage/settings/route.ts',     from: 'recorders',           to: 'edge_devices' },
  { file: 'app/admin/baggage/page.tsx',            from: 'recorder_cameras',    to: 'recorders' },
  { file: 'app/admin/baggage/page.tsx',            from: 'recorders',           to: 'edge_devices' },
]

/**
 * RLS 有効・ポリシー 0 本が**正しい**テーブルと、その理由。
 * ポリシーが無い＝ service_role 以外は一切触れない、という意味。
 *
 * **ここに足すときは理由を書く。**「とりあえず通す」ために足された行は、
 * 半年後には誰も理由を説明できなくなる。
 */
export const NO_POLICY_OK: Record<string, string> = {
  rate_limits:
    '無認証ルートの回数カウンタ。読み書きは rate_limit_hit()（SECURITY DEFINER）経由のみ。',
  baggage_kiosk_pins:
    'キオスクの PIN。API 側（requireKioskStore）でのみ検証する。利用者に直接引かせない。',
  enrollment_tokens:
    'エッジ端末の登録トークン。bootstrap API だけが service role で扱う。',
}

/**
 * パーティションの子。親のポリシーで守るので、子はポリシー 0 本が正しい。
 * `tests/schema-meta/rls-meta.test.ts` と同じ規則。
 */
export const PARTITION_RE = /^(live_sessions|monitor_results)_\d{6}$/

/** `schema_invariants()` が返す形。 */
export interface SchemaInvariantFacts {
  checked_at?: string
  /** RLS が無効なテーブル */
  rls_disabled?: string[]
  /** RLS 有効だがポリシーが 1 本も無いテーブル（台帳との突き合わせは TS 側） */
  no_policy?: string[]
  /** search_path が未固定、または pg_temp を含まない SECURITY DEFINER 関数 */
  secdef_bad_search_path?: string[]
  /** 埋め込みの組のうち外部キーが実在しないもの（"from→to" 形式） */
  missing_fk?: string[]
  /** 埋め込みに使われているパーティション表（"from→to" 形式） */
  partitioned_embed?: string[]
  /** 台帳に載っているのに実在しない表。**台帳が古い合図。** */
  unknown_embed_tables?: string[]
}

export type Severity = 'ok' | 'warn' | 'critical'

export interface SchemaVerdict {
  severity: Severity
  summary: string
  problems: string[]
}

/** 埋め込みの組を DB に渡す形（SQL 側は file を見ない）。 */
export function embedPairsForSql(): { from: string; to: string }[] {
  const seen = new Set<string>()
  return EMBED_PAIRS.filter((p) => {
    const k = `${p.from}→${p.to}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  }).map((p) => ({ from: p.from, to: p.to }))
}

/** "from→to" から、どのファイルが困るかを引く。 */
function filesFor(pair: string): string {
  const files = EMBED_PAIRS.filter((p) => `${p.from}→${p.to}` === pair).map((p) => p.file)
  return files.length ? `（${[...new Set(files)].join(' / ')}）` : ''
}

export function evaluateSchemaInvariants(facts: SchemaInvariantFacts): SchemaVerdict {
  const problems: string[] = []
  let severity: Severity = 'ok'
  const raise = (s: Severity) => {
    if (s === 'critical' || (s === 'warn' && severity === 'ok')) severity = s
  }

  // 事実が 1 つも取れていない＝関数の想定と実際がずれている。
  // **黙って ok にしない**（監視が死んでいるのに緑、が一番まずい）。
  if (!facts.checked_at) {
    return {
      severity: 'critical',
      summary: 'スキーマ点検の結果が取得できませんでした',
      problems: ['schema_invariants() が想定した形を返していません（migration の適用漏れ？）'],
    }
  }

  for (const t of facts.rls_disabled ?? []) {
    problems.push(`${t}: RLS が無効です — anon キーだけで中身が読めます`)
    raise('critical')
  }

  for (const t of facts.no_policy ?? []) {
    if (t in NO_POLICY_OK || PARTITION_RE.test(t)) continue
    problems.push(`${t}: ポリシーが 1 本もありません — service_role 専用の意図なら台帳へ`)
    raise('critical')
  }

  for (const f of facts.secdef_bad_search_path ?? []) {
    // 未固定の SECURITY DEFINER は**リストアを失敗させた実績がある**。
    problems.push(`${f}: SECURITY DEFINER の search_path が不正です（'public','pg_temp' を明示）`)
    raise('critical')
  }

  for (const p of facts.missing_fk ?? []) {
    // 400 が握り潰されて「0 件」になる形。上限や絞り込みが黙って効かなくなる。
    problems.push(`${p}: 埋め込みに必要な外部キーがありません${filesFor(p)} — 問い合わせが 400 になります`)
    raise('critical')
  }

  for (const p of facts.partitioned_embed ?? []) {
    problems.push(`${p}: パーティション表を埋め込みに使っています${filesFor(p)} — 素の SQL で数えてください`)
    raise('critical')
  }

  for (const t of facts.unknown_embed_tables ?? []) {
    // 台帳に載っているのに実在しない＝**その組は検査対象から静かに外れている**。
    // 今この瞬間に壊れているわけではないので warn。ただし放置すると
    // 「監視しているつもりの範囲」が縮んでいくので、必ず出す。
    problems.push(`${t}: 台帳の表が実在しません — EMBED_PAIRS が古いか、表が消えています`)
    raise('warn')
  }

  return {
    severity,
    summary: severity === 'ok'
      ? 'スキーマ正常（RLS・ポリシー・SECURITY DEFINER・埋め込みの外部キー）'
      : `スキーマ異常: ${problems[0]}`,
    problems,
  }
}
