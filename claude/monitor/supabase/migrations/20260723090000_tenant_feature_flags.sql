-- テナント単位のオプション機能フラグ（巡回 / 発報 / 手荷物検査）。
-- Monitor + BCP は基本パック（常時ON）。以下3つは有料オプション＝テナント契約で個別ON。
-- フラグOFF のテナントでは対応メニュー（/security・/alarms・/baggage・/admin/baggage）を非表示にする。
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS opt_patrol  boolean NOT NULL DEFAULT false,  -- 巡回 (/security)
  ADD COLUMN IF NOT EXISTS opt_alarm   boolean NOT NULL DEFAULT false,  -- 発報 (/alarms)
  ADD COLUMN IF NOT EXISTS opt_baggage boolean NOT NULL DEFAULT false;  -- 手荷物検査 (/baggage)

-- 既存テナントは現行の利用を壊さないよう全オプションを有効化する
-- （新規テナントは既定 OFF ＝ 契約に応じて本部が個別に有効化）。
UPDATE public.tenants SET opt_patrol = true, opt_alarm = true, opt_baggage = true;

COMMENT ON COLUMN public.tenants.opt_patrol  IS 'オプション: AI巡回 (/security) を有効化';
COMMENT ON COLUMN public.tenants.opt_alarm   IS 'オプション: 発報 (/alarms) を有効化';
COMMENT ON COLUMN public.tenants.opt_baggage IS 'オプション: 手荷物検査 (/baggage) を有効化';
