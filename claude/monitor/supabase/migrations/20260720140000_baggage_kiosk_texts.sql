-- 手荷物検査 iPadキオスクの文言（入室あいさつ・退室メッセージ）を編集可能にする
--
-- 全店舗共通（テナント単位）。/admin/baggage で編集。
--   entry_greeting_text: 従業員の入室で顔認証成功時に表示（{name} を氏名に置換）。
--   exit_message_text:   退室（手荷物検査完了）時に表示・読み上げ。
-- 空なら既定の簡易文言を使う（アプリ側）。

ALTER TABLE public.baggage_tenant_settings
  ADD COLUMN IF NOT EXISTS entry_greeting_text TEXT,
  ADD COLUMN IF NOT EXISTS exit_message_text   TEXT;

COMMENT ON COLUMN public.baggage_tenant_settings.entry_greeting_text IS
  '従業員入室・顔認証成功時の表示文言。{name} を氏名に置換。';
COMMENT ON COLUMN public.baggage_tenant_settings.exit_message_text IS
  '退室（手荷物検査完了）時の表示・読み上げ文言。';
