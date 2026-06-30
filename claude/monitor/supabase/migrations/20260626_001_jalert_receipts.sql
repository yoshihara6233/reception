-- J-Alert 受信履歴 (jalert_receipts) + ポーラーの定期実行修復
--
-- 背景 / なぜ必要か:
--   既存の jalert-poller は「店舗エリアに一致した発令」だけを bcp_events に記録し、
--   一致しなければ何も残さず return していた（functions/jalert-poller/index.ts）。
--   PoC 店舗は東北外のため、東北の震度6強を受信しても痕跡が残らず「動いていない」
--   ように見えた。本テーブルは **店舗マッチに関係なく、受信した本番 J-Alert を全件**
--   記録する受信ログ。テスト発令(bcp/test)は通らないので自然に「J-Alertのみ」になる。
--
--   加えて、ポーラーを毎分起動する pg_cron スケジュールがリポジトリに存在しなかった
--   （他機能は cron.schedule を持つが jalert-poller だけ欠落）。本 migration で
--   Edge Function を net.http_post で叩く定期実行も復旧する。
--
-- Idempotent: IF NOT EXISTS / DROP ... IF EXISTS / CREATE OR REPLACE で再適用可。

-- ---------------------------------------------------------------------------
-- 1. jalert_receipts : 受信した J-Alert を 1 発令 1 行で記録（全件・店舗非依存）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS jalert_receipts (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_source        text        NOT NULL UNIQUE,          -- JMA Atom entry id（重複判定キー）
  alert_type          text,                                  -- 'earthquake' | 'tsunami' | 'missile' | その他生タイトル
  title               text,                                  -- JMA エントリ title（生）
  area_codes          text[],                                -- 詳細XMLから抽出した市区町村コード群
  max_intensity       text,                                  -- 最大震度（JMA MaxInt 生値: '6+','5-' 等。無ければ NULL）
  alert_issued_at     timestamptz,                           -- 発令時刻（entry.updated）
  received_at         timestamptz NOT NULL DEFAULT now(),    -- 当システムが受信した時刻
  matched_store_count int         NOT NULL DEFAULT 0,        -- この発令で BCP 録画を起動した店舗数
  detail_url          text,                                  -- 詳細XMLのURL（監査・再取得用）
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jalert_receipts_received ON jalert_receipts(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_jalert_receipts_type     ON jalert_receipts(alert_type);

-- ---------------------------------------------------------------------------
-- 2. RLS — 全国アラートの受信ログは店舗非依存。ログイン中の管理ユーザは全員閲覧可。
--    書き込みは service_role（ポーラー）のみ＝ポリシー無し → RLS により一般ユーザは不可。
-- ---------------------------------------------------------------------------
ALTER TABLE jalert_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "jalert_receipts_select" ON jalert_receipts;
CREATE POLICY "jalert_receipts_select" ON jalert_receipts
  FOR SELECT USING (
    -- ⚠ admin_users の自己判定は auth_user_id（=auth.uid()）で行う。
    --   id はアプリ側PKであり auth.uid() とは一致しない（BCP の u.id 誤用と同型バグ）。
    EXISTS (SELECT 1 FROM admin_users u WHERE u.auth_user_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- 3. ポーラー定期実行の復旧（pg_cron → net.http_post で Edge Function を起動）
--
--    ⚠ 一度だけ SQL Editor で実行（シークレットはリポジトリに置かない・Vault管理）:
--        select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
--        select vault.create_secret('<SERVICE_ROLE_KEY>',                 'service_role_key');
--    Vault 未設定の間は invoke_jalert_poller() は no-op（raise notice）で安全に空振り。
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION invoke_jalert_poller() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_url text;
  v_key text;
BEGIN
  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'project_url';
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'service_role_key';

  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE NOTICE 'invoke_jalert_poller: project_url / service_role_key が Vault に未設定のためスキップ';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url     := v_url || '/functions/v1/jalert-poller',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || v_key
               ),
    body    := '{}'::jsonb
  );
END $$;

-- 一般ロールからの実行を禁止（cron からのみ起動する）
REVOKE ALL ON FUNCTION invoke_jalert_poller() FROM PUBLIC;

-- pg_cron + pg_net が有る環境でのみ毎分スケジュール。無ければスキップ
-- （その場合は Supabase ダッシュボードの Cron / Scheduled Functions で登録）。
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    -- 既存登録があれば一度解除してから再登録（idempotent）
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'jalert_poll') THEN
      PERFORM cron.unschedule('jalert_poll');
    END IF;
    PERFORM cron.schedule('jalert_poll', '* * * * *', 'SELECT invoke_jalert_poller();');
  ELSE
    RAISE NOTICE 'pg_cron / pg_net 拡張が無いため jalert_poll は未登録（ダッシュボードCronで設定してください）';
  END IF;
END $$;
