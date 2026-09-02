-- パーティション生成を「翌月〜3ヶ月先」に広げ、日次点検との食い違いを直す。
--
-- ── 見つかり方 ──────────────────────────────────────────────────────────
-- 2026-09-01 の日次点検が warn を出した:
--
--   live_sessions: 残り 1 ヶ月（最終 202610） — 生成ジョブが失敗している可能性
--
-- 調べるとジョブは失敗していない。8/25 の実行は設計どおり「翌月・翌々月」を
-- 確保して成功している（両方既存＝冪等）。問題は設計同士の食い違い:
--
--   生成側: 毎月25日に +1・+2 を作る → 月が替わった直後の残余は 1 ヶ月
--   点検側: WARN_MONTHS_AHEAD = 2（常に 2 ヶ月先まで要求）
--
-- つまり**毎月 1〜24 日は正常なのに warn が毎日鳴る**。8 月に鳴らなかったのは
-- 移行時（20260803150000 の①）が +2 まで作り置きしていたためで、9 月に入って
-- 初めて表に出た。放置すると毎月 24 日間メールが鳴り続け、本物の失敗が埋もれる。
--
-- ── 直し方 ──────────────────────────────────────────────────────────────
-- 生成側を +1〜+3 に広げる。月替わり直後でも残余 2 ヶ月＝点検は沈黙し、
-- warn が鳴る＝本当にジョブが 1 回失敗した時だけ、になる。メールの文言
-- 「生成ジョブが失敗している可能性」と実態が一致する。
--
-- 点検側を緩める案（WARN を 1 に下げる）は取らない。そちらだと 1 回の失敗で
-- 月替わりに残余 0（critical）まで一気に落ち、余裕を持って直せない。
--
-- 【関数の落とし穴・再掲】create_live_sessions_partition(p_start) は p_start を
-- そのまま FROM 境界に使う。必ず date_trunc('month', ...) してから渡すこと
-- （monitor_results_ensure_partition は内部で date_trunc するので崩れない）。

begin;

-- ① 今すぐ +3 まで確保（冪等）。適用した瞬間に点検が沈黙する状態を作る。
select public.create_live_sessions_partition(date_trunc('month', now())::date);
select public.create_live_sessions_partition(date_trunc('month', now() + interval '1 month')::date);
select public.create_live_sessions_partition(date_trunc('month', now() + interval '2 month')::date);
select public.create_live_sessions_partition(date_trunc('month', now() + interval '3 month')::date);

select public.monitor_results_ensure_partition(date_trunc('month', now())::date);
select public.monitor_results_ensure_partition(date_trunc('month', now() + interval '1 month')::date);
select public.monitor_results_ensure_partition(date_trunc('month', now() + interval '2 month')::date);
select public.monitor_results_ensure_partition(date_trunc('month', now() + interval '3 month')::date);

-- ② 両ジョブを +1〜+3 に張り替える（毎月25日・名前は据え置き＝点検の
--    PARTITION_JOBS 台帳と一致したまま）。
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
        select public.create_live_sessions_partition(date_trunc('month', now() + interval '3 month')::date);
      $cron$
    );

    perform cron.unschedule('monitor_results_partition')
      where exists (select 1 from cron.job where jobname = 'monitor_results_partition');
    perform cron.schedule(
      'monitor_results_partition',
      '0 0 25 * *',
      $cron$
        select public.monitor_results_ensure_partition(date_trunc('month', now() + interval '1 month')::date);
        select public.monitor_results_ensure_partition(date_trunc('month', now() + interval '2 month')::date);
        select public.monitor_results_ensure_partition(date_trunc('month', now() + interval '3 month')::date);
      $cron$
    );
  else
    raise notice 'pg_cron 未導入のためジョブ張り替えをスキップ（ローカル等）';
  end if;
end $$;

commit;
