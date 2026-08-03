-- 関数の search_path を固定する（DR復旧の障害 ＋ 権限昇格リスクの同時解消）。
--
-- 【発見の経緯】2026-08-03 の DR 復旧訓練（データ復旧編）で、本番ダンプの
-- リストアが public.stores の COPY で必ず失敗した:
--     ERROR: relation "nvr_models" does not exist
--     CONTEXT: PL/pgSQL function public.sync_store_nvr_lifecycle() line 9
-- pg_restore は安全のため `SET search_path = ''`（空）で実行するため、関数本体の
-- 非修飾参照（FROM nvr_models）が解決できない。**本番を復旧するときも必ず同じ場所で
-- 止まる**＝実運用の DR ブロッカーだった。
--
-- 【もう一つの問題】public の SECURITY DEFINER 関数 5 本が search_path 未固定だった。
-- 呼び出し側が search_path を細工すると、definer（postgres）権限で意図しない
-- テーブル/関数を掴ませられる（権限昇格）。Supabase の linter でも
-- function_search_path_mutable として指摘される類。
--
-- 【対処】本体は書き換えず ALTER FUNCTION で search_path を固定する（挙動不変・低リスク）。
--   - public     … 非修飾参照の解決先
--   - extensions … Supabase が拡張を置くスキーマ（取りこぼし防止の保険）
--   - pg_temp    … **必ず最後**。先頭にあると一時テーブルで本物を隠せてしまうため
--
-- 事前確認済み: 対象関数が使う net.http_post / vault.decrypted_secrets は
-- スキーマ修飾済み、jsonb_build_object / now は組み込み（pg_catalog）＝固定しても壊れない。

-- 引数付きの関数があるためシグネチャは厳密に書く（名前だけでは特定できない）。
-- 途中で失敗しても半端に適用されないようトランザクションで囲む。
begin;

-- ── トリガー関数（リストア時に発火する＝DR ブロッカー） ──────────────────
alter function public.sync_store_nvr_lifecycle()    set search_path = public, extensions, pg_temp;
alter function public.bcp_check_clips_complete()    set search_path = public, extensions, pg_temp;
alter function public.touch_updated_at()            set search_path = public, extensions, pg_temp;
alter function public.touch_nvr_models_updated_at() set search_path = public, extensions, pg_temp;

-- ── SECURITY DEFINER 関数（権限昇格リスク） ─────────────────────────────
alter function public.trigger_analyze_inspection()             set search_path = public, extensions, pg_temp;
alter function public.invoke_bcp_report(p_event_id uuid)       set search_path = public, extensions, pg_temp;
alter function public.invoke_jalert_poller()                   set search_path = public, extensions, pg_temp;
alter function public.bcp_sweep_pending_reports()              set search_path = public, extensions, pg_temp;
alter function public.detect_unmatched_entries(target_date date) set search_path = public, extensions, pg_temp;

commit;
