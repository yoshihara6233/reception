-- 旧プロジェクト（ムンバイ）の Edge Function を叩く legacy トリガを撤去する。
--
-- 経緯: 20260707090000_remote_baseline.sql は旧プロジェクト jmlviywilxzavjbmlpnf
-- （ap-south-1・ムンバイ）から db pull した baseline で、その中に旧世代の手荷物検査
-- （QR+写真+AI方式）用トリガがそのまま入っていた。東京へ移行したあとも
-- **旧プロジェクトの URL を直書きしたまま**残っている:
--
--   trigger_analyze_inspection()
--     edge_url := 'https://jmlviywilxzavjbmlpnf.supabase.co/functions/v1/analyze-inspection'
--     Vault の service_role_key を付けて net.http_post する
--   after_inspection_insert : AFTER INSERT ON public.inspections FOR EACH ROW
--
-- 東京DBの Vault には service_role_key が実在するため、`inspections` に 1 行でも
-- INSERT が入れば、その行の全内容が別リージョンの別プロジェクトへ POST される。
--
-- 実害は出ていない。2026-08-09 時点で public.inspections は 0 行、アプリ側にも
-- このテーブルへの書き手は 1 箇所も無い（現行モジュールは inspection_sessions 系）。
-- つまり一度も発火していない。**発火していないだけで、仕掛けは生きている**ので外す。
--
-- 旧世代テーブル本体（inspections / entry_exit_logs / unmatch_logs・いずれも 0 行）は
-- ここでは消さない。トリガの撤去とテーブルの廃止は別判断にする。

drop trigger if exists after_inspection_insert on public.inspections;
drop function if exists public.trigger_analyze_inspection();
