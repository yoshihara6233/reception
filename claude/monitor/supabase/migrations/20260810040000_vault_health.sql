-- Vault の秘密情報が「揃っているか」を監視できるようにする。**名前だけ返す。**
--
-- ── なぜ要るのか ────────────────────────────────────────────────────────
-- cron ジョブが登録されていても、Vault の秘密情報が欠けていると
-- invoke_jalert_poller / bcp_sweep_pending_reports は **RAISE NOTICE して
-- RETURN する**。ログに一行出るだけで、外からは何も分からない:
--
--   IF v_url IS NULL OR v_key IS NULL THEN
--     RAISE NOTICE 'invoke_jalert_poller: … 未設定のためスキップ';
--     RETURN;                                   -- ← 静かに終わる
--   END IF;
--
-- 2026-08-01 の東京移行では実際に BCP の自動 PDF が沈黙し、数日誰も気づかな
-- かった。**Vault はバックアップにも migration にも乗らない**（値を書けない）
-- ので、DR Runbook の手作業として残る。せめて**欠けていることに気づける**ようにする。
--
-- 20260810020000 で cron を migration 管理にしたが、それだけでは
-- 「cron はあるのに Vault が無くて動かない」経路が素通りだった。ここを塞ぐ。
--
-- ── 値は絶対に返さない ──────────────────────────────────────────────────
-- 参照するのは `vault.secrets`（暗号化された状態）の **name 列だけ**。
-- 復号ビュー `vault.decrypted_secrets` には触れない。監視に必要なのは
-- 「在るか無いか」だけで、中身を知る必要はまったく無い。
-- 呼べるのは service_role のみ（下の GRANT）。

create or replace function public.vault_secret_names()
returns text[]
language sql
security definer
set search_path to 'public', 'pg_catalog', 'pg_temp'
as $$
  -- ⚠ name のみ。decrypted_secret を足さないこと。
  select coalesce(array_agg(name order by name), array[]::text[]) from vault.secrets;
$$;

comment on function public.vault_secret_names() is
  'Vault に登録されている秘密情報の**名前一覧**（値は返さない）。'
  ' 欠落の検出用。/api/cron/partition-health が日次で確認する。';

revoke all on function public.vault_secret_names() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.vault_secret_names() from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.vault_secret_names() from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.vault_secret_names() to service_role';
  end if;
end $$;

-- partition_health() に vault を足す。監視の入口を 1 つに保つ
-- （日次 cron が 2 回 RPC を打つより、1 回で全部返るほうが扱いやすい）。
create or replace function public.partition_health()
returns jsonb
language sql
security definer
set search_path to 'public', 'pg_catalog', 'pg_temp'
as $$
  with parts as (
    select
      case when c.relname like 'live_sessions_%' then 'live_sessions'
           else 'monitor_results' end                    as parent,
      right(c.relname, 6)                                as ym
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname ~ '^(live_sessions|monitor_results)_[0-9]{6}$'
  ),
  runway as (
    select parent,
           max(ym) as last_ym,
           (extract(year  from to_date(max(ym), 'YYYYMM')) * 12
          + extract(month from to_date(max(ym), 'YYYYMM')))
         - (extract(year from now()) * 12 + extract(month from now())) as months_ahead
      from parts group by parent
  )
  select jsonb_build_object(
    'checked_at', now(),
    'pg_cron', exists (select 1 from pg_extension where extname = 'pg_cron'),
    'pg_net',  exists (select 1 from pg_extension where extname = 'pg_net'),
    'tables', coalesce((
      select jsonb_object_agg(parent, jsonb_build_object(
        'last_partition', last_ym,
        'months_ahead',   months_ahead::int
      )) from runway
    ), '{}'::jsonb),
    'jobs', coalesce((
      select jsonb_object_agg(jobname, true) from cron.job where active
    ), '{}'::jsonb),
    -- **名前だけ**。値は含まない（vault_secret_names() 参照）。
    'vault', coalesce((
      select jsonb_object_agg(n, true) from unnest(public.vault_secret_names()) as n
    ), '{}'::jsonb)
  );
$$;

comment on function public.partition_health() is
  '月次パーティションの残余・登録済み cron ジョブ・Vault の秘密情報名。'
  ' 「何が居るべきか」の判断は /api/cron/partition-health 側が持つ。値は一切返さない。';

revoke all on function public.partition_health() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.partition_health() from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.partition_health() from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.partition_health() to service_role';
  end if;
end $$;
