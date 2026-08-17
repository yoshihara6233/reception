-- 鮮度アラートの文面を直す。
--
-- 旧: array['日次点検が ' || coalesce(v_last::text, '一度も') || ' 以降走っていません']
--     → 記録が 1 件も無いとき「日次点検が 一度も 以降走っていません」になっていた。
--     coalesce で穴を埋めると、埋めた値が文の途中に落ちて日本語が壊れる。
--
-- 本番に実物が残っている（ops_check_runs / alert:partition-health / 2026-08-12 08:26）。
-- **これは障害のときに人が最初に読む一文**で、しかも普段は誰の目にも触れないため、
-- 壊れていても気づく機会が無い。TypeScript 側の staleMessage() は分岐を分けて
-- 正しく書けており、DB 側だけがずれていた。
--
-- 併せて、いつ以降が無いのかを JST で出す（UTC のままだと現場が読み替える必要がある）。

create or replace function public.claim_stale_check_alert(
  p_check    text,
  p_max_age  interval default '26 hours',
  p_cooldown interval default '6 hours'
)
returns table (stale boolean, last_ran_at timestamptz, should_alert boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_last   timestamptz;
  v_stale  boolean;
  v_alert  boolean := false;
  v_msg    text;
begin
  select max(r.ran_at) into v_last
    from public.ops_check_runs r
   where r.check_name = p_check;

  -- 記録が 1 件も無い＝導入直後か、一度も走っていない。**どちらも「古い」扱い。**
  v_stale := v_last is null or v_last < now() - p_max_age;

  if v_stale then
    -- 文を分岐で作る。穴埋めではなく、2 通りの完成した文のどちらかを選ぶ。
    v_msg := case
      when v_last is null
        then '日次点検（' || p_check || '）は一度も走っていません'
      else '日次点検（' || p_check || '）が '
           || to_char(v_last at time zone 'Asia/Tokyo', 'YYYY-MM-DD HH24:MI')
           || ' (JST) 以降走っていません'
    end;

    -- 直近 p_cooldown に通知していなければ、通知の記録を立てて true を返す。
    -- ここが 1 文なので、同時に来ても通知は 1 本。
    insert into public.ops_check_runs (check_name, severity, problems)
    select 'alert:' || p_check, 'critical', array[v_msg]
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
  '日次点検の鮮度を判定し、通知すべきなら通知記録を立てて返す（判定と記録を1文に畳んで二重通知を防ぐ）。';

revoke all on function public.claim_stale_check_alert(text, interval, interval) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.claim_stale_check_alert(text, interval, interval) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.claim_stale_check_alert(text, interval, interval) from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.claim_stale_check_alert(text, interval, interval) to service_role';
  end if;
end $$;
