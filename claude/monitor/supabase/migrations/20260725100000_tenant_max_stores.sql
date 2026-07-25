-- テナントの数量クォータ（契約枠）＋ 店舗別オプション ON/OFF。
--
-- 【テナント上限】店舗数・および各オプション（巡回/発報/検査）を「ONにできる
--   店舗数」の上限。super_admin が /admin/tenants で設定。NULL = 無制限（既定）。
-- 【店舗別オプション】どの店舗で巡回/発報/検査を使うか。既定 false（明示的にON）。
--
-- 強制はアプリ層（店舗作成/編集 API・CSV一括）で行う:
--   - 店舗数:   既存店舗数 + 追加 > max_stores → ブロック
--   - 各機能:   その機能が ON の店舗数 + 1 > max_<feat> → ON 不可
--   さらに機能 ON はテナントが当該 opt_<feat> を契約している場合のみ許可。
-- 列未適用でもアプリはフェイルオープン（無制限・機能列は false 扱い）で動く。
--
-- 注: 本 migration は「設定・クォータ層」。巡回スケジューラ/発報取込/キオスク等の
--     実行を店舗別 opt_* で実際にゲートする配線は Phase 2（別 PR）。

-- ── テナント上限（数量クォータ）─────────────────────────────
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS max_stores  integer,
  ADD COLUMN IF NOT EXISTS max_patrol  integer,
  ADD COLUMN IF NOT EXISTS max_alarm   integer,
  ADD COLUMN IF NOT EXISTS max_baggage integer;

COMMENT ON COLUMN public.tenants.max_stores  IS 'テナントが作成できる店舗数の上限。NULL=無制限。強制はアプリ層。';
COMMENT ON COLUMN public.tenants.max_patrol  IS '巡回を ON にできる店舗数の上限。NULL=無制限。';
COMMENT ON COLUMN public.tenants.max_alarm   IS '発報を ON にできる店舗数の上限。NULL=無制限。';
COMMENT ON COLUMN public.tenants.max_baggage IS '手荷物検査を ON にできる店舗数の上限。NULL=無制限。';

ALTER TABLE public.tenants DROP CONSTRAINT IF EXISTS tenants_max_quota_nonneg;
ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_max_quota_nonneg CHECK (
    (max_stores  IS NULL OR max_stores  >= 0) AND
    (max_patrol  IS NULL OR max_patrol  >= 0) AND
    (max_alarm   IS NULL OR max_alarm   >= 0) AND
    (max_baggage IS NULL OR max_baggage >= 0)
  );

-- ── 店舗別オプション ON/OFF ──────────────────────────────
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS opt_patrol  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS opt_alarm   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS opt_baggage boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.stores.opt_patrol  IS 'この店舗で巡回を使うか。ON にはテナント契約＋クォータ内が必要（アプリ層強制）。';
COMMENT ON COLUMN public.stores.opt_alarm   IS 'この店舗で発報を使うか。';
COMMENT ON COLUMN public.stores.opt_baggage IS 'この店舗で手荷物検査を使うか。';

-- ON 店舗数カウントの索引（クォータ判定の count クエリ用）。部分索引で ON のみ。
CREATE INDEX IF NOT EXISTS stores_opt_patrol_on_idx  ON public.stores (tenant_id) WHERE opt_patrol;
CREATE INDEX IF NOT EXISTS stores_opt_alarm_on_idx   ON public.stores (tenant_id) WHERE opt_alarm;
CREATE INDEX IF NOT EXISTS stores_opt_baggage_on_idx ON public.stores (tenant_id) WHERE opt_baggage;
