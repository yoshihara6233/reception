-- 月次パーティションの残余と、それを作る cron ジョブの生存を「外から確認できる」形にする。
--
-- ── 何が足りていなかったか ──────────────────────────────────────────────
-- 生成そのものは 20260803150000 で自動化済み（毎月25日に翌月・翌々月を作る）。
-- 足りないのは**止まったときに気づく仕組み**。
--
--   ・pg_cron のジョブは **DB を移行しても引き継がれない**。2026-08-01 に
--     BCP の自動 PDF が沈黙したのがまさにこれで、誰も気づかないまま数日経った。
--   ・ジョブが失敗しても、エラーは cron.job_run_details に溜まるだけで
--     アプリ側には何も出ない。
--   ・パーティションが尽きた月に入った瞬間、live_sessions への INSERT が
--     全店で失敗する（`no partition of relation ... found for row`）。
--     ライブ視聴の開始時に必ず INSERT されるので、**視聴が全面停止する**。
--
-- つまり「静かに壊れて、月替わりの瞬間に全面障害になる」形。日次で残余を
-- 見張り、尽きる前に鳴らす。判定と通知は /api/cron/partition-health が行う。
--
-- ── なぜ関数にするのか ──────────────────────────────────────────────────
-- PostgREST からは pg_catalog も cron スキーマも引けない。事実の取り出しだけを
-- SECURITY DEFINER 関数に閉じ込め、**判断はアプリ側で持つ**（しきい値を
-- 変えるのに migration を要らなくする）。

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
  ),
  jobs as (
    select jsonb_object_agg(name, present) as j from (
      select x.name,
             exists (
               select 1 from pg_class c
                join pg_namespace n on n.oid = c.relnamespace
               where n.nspname = 'cron' and c.relname = 'job'
             )
             and coalesce((
               select count(*) > 0 from cron.job where jobname = x.name
             ), false) as present
        from (values ('live_sessions_partition'), ('monitor_results_partition')) as x(name)
    ) t
  )
  select jsonb_build_object(
    'checked_at', now(),
    'pg_cron', exists (select 1 from pg_extension where extname = 'pg_cron'),
    'tables', coalesce((
      select jsonb_object_agg(parent, jsonb_build_object(
        'last_partition', last_ym,
        'months_ahead',   months_ahead::int
      )) from runway
    ), '{}'::jsonb),
    'jobs', coalesce((select j from jobs), '{}'::jsonb)
  );
$$;

comment on function public.partition_health() is
  '月次パーティションの残余と生成ジョブの登録状況。判定は /api/cron/partition-health 側で行う。';

-- 呼ぶのは cron ルート（service role）だけ。
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
