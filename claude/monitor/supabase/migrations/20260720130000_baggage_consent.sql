-- 手荷物検査 個人情報取扱いの同意（顔情報の取得・照合の同意）
--
-- 設計A: 専用ログテーブルは作らず、既存マスタ/履歴に同意記録を統合する。
--   - 同意文言はテナント共通（baggage_tenant_settings）で /admin/baggage から編集。
--     文言を変えると consent_version を +1（アプリ側）して過去同意と区別できるようにする。
--   - 従業員: 顔登録時に同意 → employees に同意日時・版を記録（従業員マスタで表示）。
--   - 来訪者: 入室（毎回）に同意 → inspection_sessions に同意日時・版を記録（履歴で表示）。

-- テナント共通の同意文言＋版
ALTER TABLE public.baggage_tenant_settings
  ADD COLUMN IF NOT EXISTS consent_text    TEXT,
  ADD COLUMN IF NOT EXISTS consent_version INT NOT NULL DEFAULT 1;

COMMENT ON COLUMN public.baggage_tenant_settings.consent_text IS
  '個人情報取扱い同意の表示文言（iPadキオスクで表示）。空なら同意画面を出さない。';
COMMENT ON COLUMN public.baggage_tenant_settings.consent_version IS
  '同意文言の版。文言変更のたびに +1（過去同意との区別用）。';

-- 従業員の同意（顔登録時）
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS consent_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS consent_version INT;

COMMENT ON COLUMN public.employees.consent_at IS '顔情報取扱いに同意した日時（顔登録時）。';

-- 来訪者セッションの同意（入室時・毎回）
ALTER TABLE public.inspection_sessions
  ADD COLUMN IF NOT EXISTS consent_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS consent_version INT;

COMMENT ON COLUMN public.inspection_sessions.consent_at IS '来訪者が個人情報取扱いに同意した日時（入室時）。';
