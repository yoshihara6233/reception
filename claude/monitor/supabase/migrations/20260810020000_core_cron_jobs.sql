-- 本番で動いている中核 cron ジョブ 4 本を migration に載せる。
--
-- ── 何が起きていたか ────────────────────────────────────────────────────
-- 2026-08-09、本番の cron.job を数えたら 6 本あった。一方、当時の active な
-- migration が定義していたのは 2 本（パーティション生成）だけ。差の 4 本は
-- `supabase/migrations_archive/` にあり、**db reset の対象外**だった。
--
--   jalert_poll                       J-Alert 受信（BCP 発令の入口・毎分）
--   bcp_report_sweep                  BCP レポート自動生成（毎分）
--   monitor_sweep_edges               エッジ死活の掃き出し（毎分）
--   monitor_sweep_unattended_streams  見放し配信の停止（毎分）
--
-- archive は 2026-06 の baseline 整理で退避したもの。**本番には適用済みなので
-- 今は動いている**が、migration から建て直した DB（ローカル・DR 復旧・別環境）
-- には存在しない。DR Runbook が「pg_cron ジョブ 5 本はバックアップに乗らないので
-- 手で再構築せよ」と書いているのは、この穴を人力で埋める運用そのもの。
--
-- 2026-08-01 の東京移行では実際に BCP の自動 PDF が沈黙し、数日誰も気づかなかった。
-- **手順書に「忘れずにやること」と書くより、migration に書くほうが確実。**
--
-- ── 何を変えるか ────────────────────────────────────────────────────────
-- 呼ぶ関数は既に baseline に含まれている（monitor_sweep_edges /
-- monitor_sweep_unattended_streams / invoke_jalert_poller /
-- bcp_sweep_pending_reports）。**足りないのは cron への登録だけ**なので、
-- ここでは登録しかしない。
--
-- 本番はすでに同名・同スケジュールで動いており、この migration を当てても
-- **挙動は変わらない**（unschedule → schedule で作り直すだけ）。
--
-- ⚠ cron があっても Vault の秘密情報（project_url / service_role_key / app_url /
--   bcp_webhook_secret）が欠けていると invoke_jalert_poller は静かに失敗する。
--   Vault はここでは扱えない（値を migration に書けない）。DR Runbook の
--   「手で再構築する」項目として残る。

do $$
declare
  has_cron boolean := exists (select 1 from pg_extension where extname = 'pg_cron');
  has_net  boolean := exists (select 1 from pg_extension where extname = 'pg_net');
  j record;
begin
  if not has_cron then
    raise notice 'pg_cron 未導入のため cron 登録をスキップ（素の Postgres 等）';
    return;
  end if;

  for j in
    select * from (values
      -- 名前, スケジュール, 実行SQL, pg_net が要るか
      ('monitor_sweep_edges',              '* * * * *', 'select monitor_sweep_edges();',              false),
      ('monitor_sweep_unattended_streams', '* * * * *', 'select monitor_sweep_unattended_streams();', false),
      -- 下 2 本は Edge Function を HTTP で叩くため pg_net が要る。
      ('jalert_poll',                      '* * * * *', 'select invoke_jalert_poller();',             true),
      ('bcp_report_sweep',                 '* * * * *', 'select bcp_sweep_pending_reports();',        true)
    ) as t(name, sched, cmd, needs_net)
  loop
    if j.needs_net and not has_net then
      raise notice 'pg_net が無いため % の登録をスキップ', j.name;
      continue;
    end if;

    -- 冪等に作り直す。既存があっても無くても同じ結果になる。
    perform cron.unschedule(j.name) where exists (select 1 from cron.job where jobname = j.name);
    perform cron.schedule(j.name, j.sched, j.cmd);
  end loop;
end $$;
