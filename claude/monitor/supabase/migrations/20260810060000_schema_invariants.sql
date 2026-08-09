-- 本番スキーマの不変条件を**本番自身に聞く**ための事実収集。
--
-- ── なぜ要るのか ──────────────────────────────────────────────────────────
-- これらは CI（tests/schema-meta/）が見ているが、**見ているのはローカルの DB**
-- ——migration を当て直した直後の綺麗な状態。本番はそこからずれる
-- （ダッシュボードから手で表を足す／DR で建て直したときに落ちる／
-- migration の適用が途中で止まる）。
--
-- さらに 2026-08-10 に分かったとおり、**ローカルと本番が同じように壊れている**
-- こともある。live_sessions → stores の外部キーは両方に無く、同時視聴上限は
-- 本番で一度も発動していなかった。CI は「ローカルと同じ」を保証するだけで
-- 「正しい」を保証しない。だから本番そのものに毎日聞く。
--
-- ⚠ **判断はここでしない。** 台帳（ポリシー 0 本を許すテーブル等）は
--   src/lib/ops/schema-invariants.ts に置く。しきい値や例外を変えるのに
--   migration を要らなくするため（partition_health() と同じ分け方）。

create or replace function public.schema_invariants(p_embeds jsonb default '[]'::jsonb)
returns jsonb
language sql
security definer
set search_path to 'public', 'pg_catalog', 'pg_temp'
stable
as $$
  with
  -- ① RLS が無効なテーブル。anon キーだけで中身が読める状態。
  rls_disabled as (
    select c.relname
      from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
  ),
  -- ② RLS 有効だがポリシーが 1 本も無い。**正しい場合もある**ので、
  --    台帳との突き合わせは呼び出し側に任せてそのまま返す。
  no_policy as (
    select c.relname
      from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity
       and not exists (select 1 from pg_policy p where p.polrelid = c.oid)
  ),
  -- ③ SECURITY DEFINER の search_path。未固定はリストアを失敗させた実績があり、
  --    pg_temp を明示しないと一時テーブルで参照先をすり替えられる余地が残る。
  secdef_bad as (
    select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as sig
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.prosecdef
       and (p.proconfig is null
            or not exists (
              select 1 from unnest(p.proconfig) cfg
               where cfg like 'search\_path=%' and cfg like '%pg\_temp%'))
  ),
  -- ④ 埋め込み（PostgREST の `親!inner(...)`）が要求する外部キー。
  --    無いと 400 になるが、呼び出し側が error を捨てていると「0 件」で
  --    素通りする。2026-08-10 の同時視聴上限の不発動がこれ。
  embeds as (
    select e->>'from' as a, e->>'to' as b from jsonb_array_elements(p_embeds) e
  ),
  embed_state as (
    select
      e.a, e.b,
      to_regclass('public.' || quote_ident(e.a)) as oid_a,
      to_regclass('public.' || quote_ident(e.b)) as oid_b
      from embeds e
  ),
  missing_fk as (
    select a || '→' || b as pair
      from embed_state s
     where s.oid_a is not null and s.oid_b is not null
       and not exists (
         select 1 from pg_constraint k
          where k.contype = 'f'
            and ((k.conrelid = s.oid_a and k.confrelid = s.oid_b)
              or (k.conrelid = s.oid_b and k.confrelid = s.oid_a)))
  ),
  -- ⑤ パーティション表を埋め込みに使っていないか。パーティション化すると
  --    外部キーを失いやすく、④ の形に落ちる。素の SQL で数えるべき合図。
  partitioned_embed as (
    select a || '→' || b as pair
      from embed_state s
     where exists (
       select 1 from pg_class c
        where c.oid in (s.oid_a, s.oid_b) and c.relkind = 'p')
  )
  select jsonb_build_object(
    'checked_at',             now(),
    'rls_disabled',           coalesce((select jsonb_agg(relname order by relname) from rls_disabled), '[]'::jsonb),
    'no_policy',              coalesce((select jsonb_agg(relname order by relname) from no_policy), '[]'::jsonb),
    'secdef_bad_search_path', coalesce((select jsonb_agg(sig order by sig) from secdef_bad), '[]'::jsonb),
    'missing_fk',             coalesce((select jsonb_agg(pair order by pair) from missing_fk), '[]'::jsonb),
    'partitioned_embed',      coalesce((select jsonb_agg(pair order by pair) from partitioned_embed), '[]'::jsonb),
    -- 台帳に載っているのに実在しない表は、台帳のほうが古い合図。
    'unknown_embed_tables',   coalesce((select jsonb_agg(distinct t order by t) from (
                                 select a as t from embed_state where oid_a is null
                                 union all
                                 select b from embed_state where oid_b is null) u), '[]'::jsonb)
  );
$$;

comment on function public.schema_invariants(jsonb) is
  '本番スキーマの不変条件（RLS・ポリシー・SECURITY DEFINER・埋め込みの外部キー）の事実。判断は呼び出し側。';

revoke all on function public.schema_invariants(jsonb) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.schema_invariants(jsonb) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.schema_invariants(jsonb) from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.schema_invariants(jsonb) to service_role';
  end if;
end $$;
