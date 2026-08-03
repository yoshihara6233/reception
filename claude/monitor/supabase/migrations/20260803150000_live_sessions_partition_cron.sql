-- live_sessions の月次パーティションを自動生成する（本番の時限爆弾の解消）。
--
-- 【発見の経緯】2026-08-03 の DR 復旧訓練の途中で判明。
--   - monitor_results には cron `monitor_results_partition`（毎月25日に翌月分）があるが、
--     **live_sessions には作成ジョブが存在しなかった**（関数はあるのに呼ぶ人がいない）。
--   - パーティションが無い月に書き込むと Postgres は必ず失敗する（ローカルで実測）:
--       ERROR: no partition of relation "live_sessions" found for row
--   - live_sessions はライブ視聴の開始時に必ず INSERT されるため、9月分が無いと
--     **9月1日に全店でライブ視聴が開始できなくなる**（PoC 開始月）。
--   - さらに pg_cron ジョブは DB 移行で引き継がれない（2026-08-01 の BCP 沈黙障害で実証）。
--     migration に入れておけば再構築した DB でも必ず復活する。
--
-- 【関数の落とし穴】create_live_sessions_partition(p_start) は p_start を
--   **そのまま FROM 境界に使う**（monitor_results 側は内部で date_trunc する）。
--   月初以外を渡すと「9/3〜10/3」のような境界になり 9/1〜9/2 が無主状態になるため、
--   呼び出し側で必ず date_trunc('month', ...) してから渡すこと。

begin;

-- ① 当月・翌月・翌々月を今すぐ確保（冪等）。migration 適用時点の穴を埋める。
select public.create_live_sessions_partition(date_trunc('month', now())::date);
select public.create_live_sessions_partition(date_trunc('month', now() + interval '1 month')::date);
select public.create_live_sessions_partition(date_trunc('month', now() + interval '2 month')::date);

select public.monitor_results_ensure_partition(date_trunc('month', now())::date);
select public.monitor_results_ensure_partition(date_trunc('month', now() + interval '1 month')::date);
select public.monitor_results_ensure_partition(date_trunc('month', now() + interval '2 month')::date);

-- ② 毎月25日に「翌月」と「翌々月」を作る cron を登録。
--    2ヶ月先まで作るのは、ジョブが1回失敗しても月替わりで停止しないようにするため
--    （1ヶ月バッファだと1回の失敗が即障害になる）。
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('live_sessions_partition')
      where exists (select 1 from cron.job where jobname = 'live_sessions_partition');

    perform cron.schedule(
      'live_sessions_partition',
      '0 0 25 * *',
      $cron$
        select public.create_live_sessions_partition(date_trunc('month', now() + interval '1 month')::date);
        select public.create_live_sessions_partition(date_trunc('month', now() + interval '2 month')::date);
      $cron$
    );
  else
    raise notice 'pg_cron 未導入のため live_sessions_partition ジョブの登録をスキップ（ローカル等）';
  end if;
end $$;

commit;
