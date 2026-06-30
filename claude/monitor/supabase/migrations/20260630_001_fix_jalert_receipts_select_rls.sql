-- Fix: jalert_receipts の SELECT ポリシーが行を返さない（/bcp/jalerts が常にゼロ表示）
--
-- 症状:
--   jalert_receipts には受信データが入っている（service_role / SQL Editor では見える）のに、
--   /bcp/jalerts（RLS セッションクライアント読み）が常に「受信ゼロ」表示になっていた。
--
-- 根本原因:
--   20260626_001_jalert_receipts.sql の SELECT ポリシーが
--     EXISTS (SELECT 1 FROM admin_users u WHERE u.id = auth.uid())
--   と書かれていた。admin_users.id はアプリ側 PK であり、auth.uid()（Supabase Auth
--   ユーザID）とは一致しない。正しくは u.auth_user_id = auth.uid()。
--   結果、どの管理ユーザも EXISTS を満たさず、RLS が全行を拒否していた。
--   （20260528_001_bcp.sql の u.id 誤用と同型。20260529_002_security.sql で警告済みの既知パターン。）
--
-- 修正方針:
--   全国 J-Alert 受信ログは店舗非依存＝ログイン中の管理ユーザは全員閲覧可（設計意図のまま）。
--   判定列のみ auth_user_id へ修正する。書込は service_role のみ（ポリシー無し）で従来どおり。
--
-- Idempotent: DROP ... IF EXISTS → CREATE で再適用可。

DROP POLICY IF EXISTS "jalert_receipts_select" ON jalert_receipts;
CREATE POLICY "jalert_receipts_select" ON jalert_receipts
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM admin_users u WHERE u.auth_user_id = auth.uid())
  );
