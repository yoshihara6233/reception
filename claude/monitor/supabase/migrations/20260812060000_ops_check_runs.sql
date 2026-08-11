-- 日次点検の実行記録。**沈黙を意味のある信号にする。**
--
-- ── なぜ要るのか ──────────────────────────────────────────────────────────
-- /api/cron/partition-health は問題があったときだけ通知する。つまり
-- 「通知が来ない」が **5 通りの意味**を持っていた:
--
--   ① 正常（問題なし）
--   ② CRON_SECRET 未設定 → 503
--   ③ 認証失敗           → 401
--   ④ RPC 失敗           → 500（**通知せずに返っていた**）
--   ⑤ cron が動いていない
--
-- 2026-08-12 に実際に確かめようとしたところ、Vercel のログを人が掘るしか
-- 手が無かった。**2 日かけて潰してきた「壊れているのに正常と区別が付かない」
-- 形を、監視自身が持っていた。**
--
-- ここで毎回の結果を残し、④は通知する側に回し、実行の鮮度を別の cron が
-- 見張る（edge-health・2 分間隔）。3 つ揃って初めて「沈黙＝正常」になる。

create table if not exists public.ops_check_runs (
  id          bigserial primary key,
  /** 点検の種類。'partition-health' など。'alert:*' は通知の送信記録。 */
  check_name  text        not null,
  ran_at      timestamptz not null default now(),
  severity    text        not null check (severity in ('ok', 'warn', 'critical')),
  /** 指摘。ok のときは空配列。**値そのものは入れない**（env のキー名まで）。 */
  problems    text[]      not null default '{}',
  duration_ms integer
);

comment on table public.ops_check_runs is
  '運用点検の実行記録。「通知が無い」を「正常」と読めるようにするための鮮度の根拠。';

create index if not exists ops_check_runs_name_ran_idx
  on public.ops_check_runs (check_name, ran_at desc);

alter table public.ops_check_runs enable row level security;

-- 読めるのは super_admin だけ。中身は本番構成の弱点そのもの。
-- 書き込みポリシーは置かない＝ service_role（下の関数）経由のみ。
drop policy if exists ops_check_runs_select on public.ops_check_runs;
create policy ops_check_runs_select on public.ops_check_runs
  for select to authenticated
  using (public.auth_user_role() = 'super_admin');

-- ── 記録 ──────────────────────────────────────────────────────────────────
create or replace function public.record_check_run(
  p_check       text,
  p_severity    text,
  p_problems    text[] default '{}',
  p_duration_ms integer default null
)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'pg_catalog', 'pg_temp'
as $$
declare
  v_id bigint;
begin
  insert into public.ops_check_runs (check_name, severity, problems, duration_ms)
  values (p_check, p_severity, coalesce(p_problems, '{}'), p_duration_ms)
  returning id into v_id;

  -- 90 日より古い記録は捨てる。日次なので 1 回の削除は数行。
  delete from public.ops_check_runs where ran_at < now() - interval '90 days';

  return v_id;
end;
$$;

comment on function public.record_check_run(text, text, text[], integer) is
  '運用点検の実行を 1 行記録し、90 日より古い記録を掃除する。';

-- ── 鮮度の判定＋通知の重複抑止 ────────────────────────────────────────────
--
-- ⚠ **判定と「通知したことの記録」を 1 文に畳む。** 見張り側の edge-health は
--   2 分間隔なので、「古い → 通知する」を分けて書くと、同時に走った 2 本が
--   両方通知する（今週ずっと直してきた形と同じ）。
create or replace function public.claim_stale_check_alert(
  p_check    text,
  p_max_age  interval default '26 hours',
  p_cooldown interval default '6 hours'
)
returns table (
  stale        boolean,
  last_ran_at  timestamptz,
  should_alert boolean
)
language plpgsql
security definer
set search_path to 'public', 'pg_catalog', 'pg_temp'
as $$
declare
  v_last   timestamptz;
  v_stale  boolean;
  v_alert  boolean := false;
begin
  select max(r.ran_at) into v_last
    from public.ops_check_runs r
   where r.check_name = p_check;

  -- 記録が 1 件も無い＝導入直後か、一度も走っていない。**どちらも「古い」扱い。**
  v_stale := v_last is null or v_last < now() - p_max_age;

  if v_stale then
    -- 直近 p_cooldown に通知していなければ、通知の記録を立てて true を返す。
    -- ここが 1 文なので、同時に来ても通知は 1 本。
    insert into public.ops_check_runs (check_name, severity, problems)
    select 'alert:' || p_check, 'critical',
           array['日次点検が ' || coalesce(v_last::text, '一度も') || ' 以降走っていません']
     where not exists (
       select 1 from public.ops_check_runs a
        where a.check_name = 'alert:' || p_check
          and a.ran_at > now() - p_cooldown);
    v_alert := found;
  end if;

  return query select v_stale, v_last, v_alert;
end;
$$;

comment on function public.claim_stale_check_alert(text, interval, interval) is
  '日次点検の鮮度を見て、通知すべきなら通知記録を立てて true を返す（重複抑止込み）。';

revoke all on function public.record_check_run(text, text, text[], integer) from public;
revoke all on function public.claim_stale_check_alert(text, interval, interval) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.record_check_run(text, text, text[], integer) from anon';
    execute 'revoke all on function public.claim_stale_check_alert(text, interval, interval) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.record_check_run(text, text, text[], integer) from authenticated';
    execute 'revoke all on function public.claim_stale_check_alert(text, interval, interval) from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.record_check_run(text, text, text[], integer) to service_role';
    execute 'grant execute on function public.claim_stale_check_alert(text, interval, interval) to service_role';
  end if;
end $$;
