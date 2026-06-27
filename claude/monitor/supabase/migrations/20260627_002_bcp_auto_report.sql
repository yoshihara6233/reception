-- BCP 8枚スナップPDFの自動生成（clips_uploaded → webhook 自動キック）
--
-- 背景:
--   /api/bcp-webhook は eventId を渡すと「PDF生成＋Storage保存＋完了メール（PDF添付）＋
--   status=completed」まで自動で行う実装が既にあるが、これを呼び出す配線が無く、PDFは
--   /bcp/[id] の手動ボタンでしか作られていなかった。
--
--   本 migration は pg_cron（jalert_poll と同方式）で、録画クリップが揃った発令
--   （bcp_events.status='clips_uploaded'）を毎分拾い、net.http_post で webhook を叩いて
--   PDFを自動生成する。これで「8枚スナップPDF＋完了メール」が全自動になる。
--
--   ⚠ 一度だけ SQL Editor で Vault に登録（シークレットはリポジトリに置かない）:
--       select vault.create_secret('https://intereco-monitor.vercel.app', 'app_url');
--       select vault.create_secret('<BCP_WEBHOOK_SECRET>',                 'bcp_webhook_secret');
--     かつ Vercel 側にも同じ BCP_WEBHOOK_SECRET 環境変数が必要（webhook の Bearer 検証用）。
--     未設定の間は invoke_bcp_report() は no-op（raise notice）で安全に空振り。
--
-- Idempotent: ADD COLUMN IF NOT EXISTS / CREATE OR REPLACE / cron 再登録。

-- ---------------------------------------------------------------------------
-- 1. 二重起動防止フラグ。sweep が webhook を叩いた発令に印を付け、毎分の再発火で
--    PDF・メールが重複生成されるのを防ぐ。webhook 失敗時は 5 分後に再試行可。
-- ---------------------------------------------------------------------------
ALTER TABLE bcp_events
  ADD COLUMN IF NOT EXISTS report_dispatched_at timestamptz;

-- ---------------------------------------------------------------------------
-- 2. 1発令分の webhook 呼び出し（Vault の app_url / bcp_webhook_secret を使用）。
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION invoke_bcp_report(p_event_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_url    text;
  v_secret text;
BEGIN
  SELECT decrypted_secret INTO v_url    FROM vault.decrypted_secrets WHERE name = 'app_url';
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'bcp_webhook_secret';

  IF v_url IS NULL OR v_secret IS NULL THEN
    RAISE NOTICE 'invoke_bcp_report: app_url / bcp_webhook_secret が Vault に未設定のためスキップ';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url     := v_url || '/api/bcp-webhook',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || v_secret
               ),
    body    := jsonb_build_object('eventId', p_event_id::text)
  );
END $$;

-- ---------------------------------------------------------------------------
-- 3. sweep — clips_uploaded かつ未ディスパッチ（or 5分超で再試行）の発令を拾って叩く。
--    UPDATE ... RETURNING で「掴んだ」発令だけに印を付け、同時/連続実行での二重起動を防ぐ。
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION bcp_sweep_pending_reports() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    WITH claimed AS (
      UPDATE bcp_events
         SET report_dispatched_at = now()
       WHERE status = 'clips_uploaded'
         AND (report_dispatched_at IS NULL
              OR report_dispatched_at < now() - interval '5 minutes')
      RETURNING id
    )
    SELECT id FROM claimed
  LOOP
    PERFORM invoke_bcp_report(r.id);
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION invoke_bcp_report(uuid)      FROM PUBLIC;
REVOKE ALL ON FUNCTION bcp_sweep_pending_reports()  FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 4. pg_cron 登録（pg_cron + pg_net がある環境のみ）。毎分 sweep。
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'bcp_report_sweep') THEN
      PERFORM cron.unschedule('bcp_report_sweep');
    END IF;
    PERFORM cron.schedule('bcp_report_sweep', '* * * * *', 'SELECT bcp_sweep_pending_reports();');
  ELSE
    RAISE NOTICE 'pg_cron / pg_net 拡張が無いため bcp_report_sweep は未登録（ダッシュボードCronで設定してください）';
  END IF;
END $$;
