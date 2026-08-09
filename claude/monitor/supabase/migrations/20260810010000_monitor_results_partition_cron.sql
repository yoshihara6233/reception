-- monitor_results の月次パーティション生成ジョブを migration に載せる。
--
-- ── 見つかり方 ──────────────────────────────────────────────────────────
-- partition_health()（20260810000000）を入れて実行したところ:
--
--   "jobs": { "live_sessions_partition": true,
--             "monitor_results_partition": false }
--
-- 20260803150000 のコメントには「monitor_results には cron
-- monitor_results_partition がある」と書いてあるが、それは**当時の本番に
-- 手で作られていた**という話で、migration には入っていなかった。
-- つまり migration から組み立て直した DB（ローカル・DR 復旧・別環境）には
-- **存在しない**。
--
-- これは 2026-08-01 に BCP の自動 PDF を沈黙させたのと同じ形。
-- pg_cron のジョブは DB を移行しても引き継がれない。**「本番に手で作った」は
-- 資産ではない**——migration に書いていないものは、次に建て直したときに消える。
--
-- 影響: パーティションが尽きた月に monitor_results への INSERT が失敗する
-- （死活監視の測定結果が全て落ちる）。live_sessions ほど即座に目立たない分、
-- 気づくのが遅れる。
--
-- 生成ロジックそのものは既存の monitor_results_ensure_partition() を使う
-- （こちらは内部で date_trunc するので、月初以外を渡しても境界が崩れない）。

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('monitor_results_partition')
      where exists (select 1 from cron.job where jobname = 'monitor_results_partition');

    -- live_sessions 側と同じ形: 毎月25日に翌月・翌々月。2ヶ月先まで作るのは、
    -- 1回失敗しても月替わりで即停止しないようにするため。
    perform cron.schedule(
      'monitor_results_partition',
      '0 0 25 * *',
      $cron$
        select public.monitor_results_ensure_partition(date_trunc('month', now() + interval '1 month')::date);
        select public.monitor_results_ensure_partition(date_trunc('month', now() + interval '2 month')::date);
      $cron$
    );
  else
    raise notice 'pg_cron 未導入のため monitor_results_partition ジョブの登録をスキップ';
  end if;
end $$;
