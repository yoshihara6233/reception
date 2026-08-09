-- partition_health() が返す cron ジョブを「期待する 2 本」から「実在する全部」へ広げる。
--
-- 旧版は live_sessions_partition / monitor_results_partition の 2 本だけを
-- 名指しで見ていた。20260810020000 で中核 4 本（jalert_poll・bcp_report_sweep・
-- monitor_sweep_edges・monitor_sweep_unattended_streams）も migration 管理に
-- なったので、監視もそこまで広げる。
--
-- 名前を SQL 側に持たせず**実在するジョブをそのまま返す**形にした。
-- 「何が居るべきか」はアプリ側（src/lib/ops/partition-health.ts）が持つ。
-- 期待リストを増やすたびに migration を書くのは割に合わないし、
-- **事実と判断は分けておくほうが後から動かしやすい**。

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
           -- 「今月を 0 として、あと何か月ぶんの受け皿があるか」。
           -- 当月ぶんしか無ければ 0＝来月頭に落ちる。
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
    -- 実在するジョブを name → true で返す。cron スキーマが無い環境では空。
    'jobs', coalesce((
      select jsonb_object_agg(jobname, true) from cron.job where active
    ), '{}'::jsonb)
  );
$$;

comment on function public.partition_health() is
  '月次パーティションの残余と、登録されている cron ジョブ一覧。'
  ' 「何が居るべきか」の判断は /api/cron/partition-health 側が持つ。';

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
