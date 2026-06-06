-- F46.6: Tier 3 中央集約モード対応 — stores 拡張 + central_nodes
-- 設計: docs/tier3/eol-eos-data-model.md
-- 関連: F46.7 (nvr_models), F46.8 (v_store_nvr_lifecycle)

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. stores テーブル拡張: デプロイメントモード + NVR 接続情報 + ライフサイクル
-- ─────────────────────────────────────────────────────────────────────────────

-- デプロイメントモード (現行 Mini PC モード vs Tier 3 中央集約モード)
ALTER TABLE stores ADD COLUMN IF NOT EXISTS
  deployment_mode text NOT NULL DEFAULT 'per_store_minipc'
  CHECK (deployment_mode IN ('per_store_minipc', 'central_aggregator'));
COMMENT ON COLUMN stores.deployment_mode IS
  'per_store_minipc: 各店 Mini PC + Frigate / central_aggregator: 中央サーバが NVR を直接操作';

-- NVR ベンダー識別子 (NvrVendor 型と一致)
-- 'i-pro-nx' | 'i-pro-nu' | 'i-pro-gxe500' | 'frigate' | (将来) 'hikvision' 等
ALTER TABLE stores ADD COLUMN IF NOT EXISTS nvr_vendor text;
COMMENT ON COLUMN stores.nvr_vendor IS
  'NVR ベンダー識別子。adapter registry の key と一致。frigate は per_store_minipc 互換';

-- 機種番号 (nvr_models.model_number への参照)
ALTER TABLE stores ADD COLUMN IF NOT EXISTS nvr_model text;
COMMENT ON COLUMN stores.nvr_model IS
  '機種番号 (例: WJ-NX300K)。nvr_models.model_number から EOL/EOS を引いてくる';

-- NVR エンドポイント (HTTP/HTTPS URL)
ALTER TABLE stores ADD COLUMN IF NOT EXISTS nvr_endpoint text;
COMMENT ON COLUMN stores.nvr_endpoint IS
  'NVR の HTTP/HTTPS エンドポイント (例: https://10.0.1.5:8443)';

-- 認証情報の参照 (Vault 経由で resolve、生のパスワードはここに置かない)
ALTER TABLE stores ADD COLUMN IF NOT EXISTS nvr_credentials_ref uuid;
COMMENT ON COLUMN stores.nvr_credentials_ref IS
  'Supabase Vault または環境変数の認証情報への参照 ID';

-- ベンダー固有の追加設定 (CGI パス、AI モード等)
ALTER TABLE stores ADD COLUMN IF NOT EXISTS
  nvr_options jsonb NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN stores.nvr_options IS
  'ベンダー固有の追加設定 (例: {"cgi_path": "/cgi-bin", "rtsp_transport": "tcp"})';

-- 中央集約モード時の担当ノード
ALTER TABLE stores ADD COLUMN IF NOT EXISTS central_node_id uuid;
COMMENT ON COLUMN stores.central_node_id IS
  'central_aggregator モード時にこの店舗を担当する central_nodes.id';

-- ── ライフサイクル管理 ────────────────────────────────────────────────────

-- 導入日 (運用年数の起点)
ALTER TABLE stores ADD COLUMN IF NOT EXISTS nvr_installed_at date;
COMMENT ON COLUMN stores.nvr_installed_at IS '店舗への NVR 導入日';

-- 最後に検出された FW Ver
ALTER TABLE stores ADD COLUMN IF NOT EXISTS nvr_fw_version text;
COMMENT ON COLUMN stores.nvr_fw_version IS '直近で検出された FW バージョン (例: 3.42-0001)';

-- FW Ver を検出した時刻
ALTER TABLE stores ADD COLUMN IF NOT EXISTS nvr_fw_detected_at timestamptz;

-- 公式 EOL/EOS (nvr_models から自動同期、必要に応じて手動上書き)
ALTER TABLE stores ADD COLUMN IF NOT EXISTS nvr_eol_date date;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS nvr_eos_date date;
COMMENT ON COLUMN stores.nvr_eol_date IS '生産終了 (End of Life) 予定';
COMMENT ON COLUMN stores.nvr_eos_date IS 'サポート終了 (End of Service) 予定';

-- 実質的な置換期限 (EOS と「導入 + 7年」の早い方、自動計算)
ALTER TABLE stores ADD COLUMN IF NOT EXISTS nvr_replace_by date
  GENERATED ALWAYS AS (
    LEAST(
      COALESCE(nvr_eos_date, '9999-12-31'::date),
      COALESCE(nvr_installed_at + INTERVAL '7 years', '9999-12-31'::date)::date
    )
  ) STORED;
COMMENT ON COLUMN stores.nvr_replace_by IS
  'EOS と「導入 + 7年運用ルール」の早い方。自動計算 (GENERATED ALWAYS)';

-- ── インデックス ──────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_stores_nvr_vendor       ON stores(nvr_vendor);
CREATE INDEX IF NOT EXISTS idx_stores_nvr_replace_by   ON stores(nvr_replace_by);
CREATE INDEX IF NOT EXISTS idx_stores_deployment_mode  ON stores(deployment_mode);
CREATE INDEX IF NOT EXISTS idx_stores_central_node_id  ON stores(central_node_id)
  WHERE central_node_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. central_nodes テーブル (新規) — 中央集約モードの HA ノードレジストリ
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS central_nodes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hostname         text NOT NULL UNIQUE,         -- 'edge-central-01.intereco.jp'
  region           text,                          -- 'ap-northeast-1' 等
  capacity_stores  int  NOT NULL DEFAULT 5000,    -- このノードの担当上限
  status           text NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active', 'draining', 'down')),
  lease_held_until timestamptz,                   -- HA リース失効時刻
  last_heartbeat   timestamptz,
  metadata         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE central_nodes IS
  '中央集約モードで稼働中のエージェントノード。HA (active-active) 時は複数行';

CREATE INDEX IF NOT EXISTS idx_central_nodes_status ON central_nodes(status);
CREATE INDEX IF NOT EXISTS idx_central_nodes_lease  ON central_nodes(lease_held_until);

-- stores.central_node_id に外部キー制約 (ノード削除時は SET NULL)
ALTER TABLE stores
  DROP CONSTRAINT IF EXISTS fk_stores_central_node;
ALTER TABLE stores
  ADD CONSTRAINT fk_stores_central_node
    FOREIGN KEY (central_node_id) REFERENCES central_nodes(id)
    ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. ハートビート粒度の区別 (60s vs 21600s)
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  -- monitor_heartbeats テーブルが存在する場合のみカラム追加
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_name = 'monitor_heartbeats') THEN
    ALTER TABLE monitor_heartbeats
      ADD COLUMN IF NOT EXISTS heartbeat_interval_sec int NOT NULL DEFAULT 60;
    COMMENT ON COLUMN monitor_heartbeats.heartbeat_interval_sec IS
      '60: per_store_minipc / 21600: central_aggregator (6時間)';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. RLS は既存ポリシー継承 (stores は既に enable 済み)
-- ─────────────────────────────────────────────────────────────────────────────

-- central_nodes の RLS を有効化 — 全テナント横断で参照可、書込は service_role のみ
ALTER TABLE central_nodes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS central_nodes_select ON central_nodes;
CREATE POLICY central_nodes_select ON central_nodes
  FOR SELECT USING (true);  -- 認証済ユーザは全ノード参照可

DROP POLICY IF EXISTS central_nodes_write ON central_nodes;
CREATE POLICY central_nodes_write ON central_nodes
  FOR ALL USING (auth.role() = 'service_role')
            WITH CHECK (auth.role() = 'service_role');

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. 完了通知
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  RAISE NOTICE 'F46.6 complete: stores extended with nvr_* columns, central_nodes table created';
END $$;
-- F46.7: NVR 機種マスタ + 自動同期トリガ + i-PRO 8 機種データ
-- 設計: docs/tier3/eol-eos-data-model.md
-- 前提: 20260605_001_nvr_lifecycle.sql

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. nvr_models マスタテーブル
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS nvr_models (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor            text NOT NULL,
                    -- 'i-pro' | 'hikvision' | 'hanwha' | 'synology' | 'axis'
  model_family      text NOT NULL,
                    -- 'nx' | 'nu' | 'gxe' | 'hd' | 'unknown'
  model_number      text NOT NULL UNIQUE,
                    -- 'WJ-NX300K'
  display_name      text NOT NULL,
                    -- 'i-PRO WJ-NX300K (16ch IP NVR / 高機能)'
  released_at       date,
  eol_announced_at  date,                    -- EOL 公表日 (i-PRO 公式から)
  eol_date          date,                    -- 生産終了予定
  eos_date          date,                    -- サポート終了予定
  max_channels      int,
  max_resolution    text,
                    -- 'D1' | '960H' | '720p' | '1080p' | '4K' | '8K'
  source_url        text,                    -- 公式情報源 URL
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE nvr_models IS
  'NVR 機種カタログ。stores.nvr_model から EOL/EOS を引いてくる参照ソース';

CREATE INDEX IF NOT EXISTS idx_nvr_models_vendor   ON nvr_models(vendor);
CREATE INDEX IF NOT EXISTS idx_nvr_models_eos_date ON nvr_models(eos_date);
CREATE INDEX IF NOT EXISTS idx_nvr_models_family   ON nvr_models(vendor, model_family);

-- updated_at 自動更新トリガ (既存パターンに準拠)
CREATE OR REPLACE FUNCTION touch_nvr_models_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_touch_nvr_models ON nvr_models;
CREATE TRIGGER trg_touch_nvr_models
  BEFORE UPDATE ON nvr_models
  FOR EACH ROW EXECUTE FUNCTION touch_nvr_models_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. RLS — 参照は全認証ユーザ可、書込は service_role のみ
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE nvr_models ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS nvr_models_select ON nvr_models;
CREATE POLICY nvr_models_select ON nvr_models
  FOR SELECT USING (true);

DROP POLICY IF EXISTS nvr_models_write ON nvr_models;
CREATE POLICY nvr_models_write ON nvr_models
  FOR ALL USING (auth.role() = 'service_role')
            WITH CHECK (auth.role() = 'service_role');

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. stores.nvr_model 変更時の EOL/EOS 自動同期トリガ
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION sync_store_nvr_lifecycle() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.nvr_model IS NOT NULL AND (
       OLD.nvr_model IS DISTINCT FROM NEW.nvr_model
       OR NEW.nvr_eol_date IS NULL
       OR NEW.nvr_eos_date IS NULL
     ) THEN
    -- nvr_models から EOL/EOS を引いてくる (見つからなければ NULL のまま)
    SELECT eol_date, eos_date
      INTO NEW.nvr_eol_date, NEW.nvr_eos_date
      FROM nvr_models
     WHERE model_number = NEW.nvr_model
     LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_store_nvr_lifecycle ON stores;
CREATE TRIGGER trg_sync_store_nvr_lifecycle
  BEFORE INSERT OR UPDATE OF nvr_model ON stores
  FOR EACH ROW EXECUTE FUNCTION sync_store_nvr_lifecycle();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. i-PRO 8 機種データ (初期投入)
--
-- NOTE: EOL/EOS の正確な日付は i-PRO 公式に要照会。下記は暫定値 (Phase 0 で
-- 正式値に置換)。released_at は公開情報ベースで近似。
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO nvr_models (
  vendor, model_family, model_number, display_name,
  released_at, eol_date, eos_date,
  max_channels, max_resolution, notes
) VALUES
  -- WJ-NX シリーズ (IP NVR)
  ('i-pro', 'nx', 'WJ-NX200K',
   'i-PRO WJ-NX200K (16ch IP NVR / エントリ)',
   '2018-04-01', '2024-03-31', '2029-03-31',
   16, '1080p', 'TODO: i-PRO 公式の EOL/EOS を要確認'),

  ('i-pro', 'nx', 'WJ-NX300K',
   'i-PRO WJ-NX300K (16ch IP NVR / 高機能)',
   '2018-10-01', '2025-09-30', '2030-09-30',
   16, '4K',   'TODO: i-PRO 公式の EOL/EOS を要確認。PoC 機材その1'),

  ('i-pro', 'nx', 'WJ-NX400K',
   'i-PRO WJ-NX400K (32ch IP NVR)',
   '2019-04-01', '2026-03-31', '2031-03-31',
   32, '4K',   'TODO: i-PRO 公式の EOL/EOS を要確認'),

  ('i-pro', 'nx', 'WJ-NX510K',
   'i-PRO WJ-NX510K (32ch 高機能 NVR)',
   '2020-10-01', '2027-09-30', '2032-09-30',
   32, '4K',   'TODO: i-PRO 公式の EOL/EOS を要確認'),

  -- WJ-NU シリーズ (小規模オフィス向け)
  ('i-pro', 'nu', 'WJ-NU101K',
   'i-PRO WJ-NU101K (4ch 小型 NVR)',
   '2021-04-01', '2028-03-31', '2033-03-31',
   4,  '4K',   'TODO: i-PRO 公式の EOL/EOS を要確認'),

  ('i-pro', 'nu', 'WJ-NU201K',
   'i-PRO WJ-NU201K (8ch 小型 NVR)',
   '2022-04-01', '2029-03-31', '2034-03-31',
   8,  '4K',   'TODO: i-PRO 公式の EOL/EOS を要確認。PoC 機材その2'),

  ('i-pro', 'nu', 'WJ-NU301K',
   'i-PRO WJ-NU301K (16ch 小型 NVR)',
   '2023-04-01', '2030-03-31', '2035-03-31',
   16, '4K',   'TODO: i-PRO 公式の EOL/EOS を要確認'),

  -- WJ-GXE500 (アナログ→IP 変換)
  ('i-pro', 'gxe', 'WJ-GXE500',
   'i-PRO WJ-GXE500 (アナログ→IP 変換 4ch)',
   '2016-04-01', '2024-03-31', '2029-03-31',
   4,  '1080p', '既存アナログカメラ流用パス。録画機能なし')

ON CONFLICT (model_number) DO UPDATE SET
  display_name   = EXCLUDED.display_name,
  released_at    = EXCLUDED.released_at,
  eol_date       = EXCLUDED.eol_date,
  eos_date       = EXCLUDED.eos_date,
  max_channels   = EXCLUDED.max_channels,
  max_resolution = EXCLUDED.max_resolution,
  notes          = EXCLUDED.notes,
  updated_at     = now();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. 既存 Frigate モード用の擬似機種エントリ (per_store_minipc 互換)
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO nvr_models (
  vendor, model_family, model_number, display_name,
  max_channels, max_resolution, notes
) VALUES
  ('frigate', 'docker', 'frigate-docker',
   'Frigate (Docker / 各店 Mini PC モード互換)',
   16, '4K',
   '既存 Mini PC モードの per-store Frigate 配備用 擬似機種。EOL/EOS なし')
ON CONFLICT (model_number) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  notes        = EXCLUDED.notes,
  updated_at   = now();

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. 完了通知
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  model_count int;
BEGIN
  SELECT COUNT(*) INTO model_count FROM nvr_models;
  RAISE NOTICE 'F46.7 complete: % NVR models registered', model_count;
END $$;
-- F46.8: v_store_nvr_lifecycle VIEW
-- 設計: docs/tier3/eol-eos-data-model.md
-- 前提: 20260605_001_nvr_lifecycle.sql, 20260605_002_nvr_models.sql

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. ライフサイクル状態を分類する VIEW
--
-- ステータス分類:
--   nvr_lifecycle_ok              EOS まで 24 ヶ月超
--   nvr_lifecycle_warning         EOS まで 12〜24 ヶ月
--   nvr_lifecycle_replace_planned EOS まで 6〜12 ヶ月
--   nvr_lifecycle_urgent          EOS まで 6 ヶ月以内
--   nvr_lifecycle_eos             EOS 経過
--   nvr_lifecycle_overage         導入 + 7 年経過
--   nvr_lifecycle_unknown         必要情報が NULL
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW v_store_nvr_lifecycle AS
SELECT
  s.id                                                    AS store_id,
  s.name                                                  AS store_name,
  s.deployment_mode,
  s.nvr_vendor,
  s.nvr_model,
  s.nvr_fw_version,
  s.nvr_fw_detected_at,
  s.nvr_installed_at,
  s.nvr_eol_date,
  s.nvr_eos_date,
  s.nvr_replace_by,

  -- 残月数 (EOS まで; 経過時は負)
  CASE
    WHEN s.nvr_eos_date IS NOT NULL THEN
      (EXTRACT(YEAR  FROM age(s.nvr_eos_date, CURRENT_DATE)) * 12
     + EXTRACT(MONTH FROM age(s.nvr_eos_date, CURRENT_DATE)))::int
    ELSE NULL
  END                                                     AS months_until_eos,

  -- 運用年数 (導入からの経過)
  CASE
    WHEN s.nvr_installed_at IS NOT NULL THEN
      EXTRACT(YEAR FROM age(CURRENT_DATE, s.nvr_installed_at))::int
    ELSE NULL
  END                                                     AS years_in_service,

  -- 残月数 (置換期限 = nvr_replace_by まで)
  CASE
    WHEN s.nvr_replace_by IS NOT NULL THEN
      (EXTRACT(YEAR  FROM age(s.nvr_replace_by, CURRENT_DATE)) * 12
     + EXTRACT(MONTH FROM age(s.nvr_replace_by, CURRENT_DATE)))::int
    ELSE NULL
  END                                                     AS months_until_replace_by,

  -- ステータス分類
  CASE
    -- 必須情報なし
    WHEN s.nvr_installed_at IS NULL OR s.nvr_eos_date IS NULL THEN
      'nvr_lifecycle_unknown'
    -- EOS 経過
    WHEN CURRENT_DATE > s.nvr_eos_date THEN
      'nvr_lifecycle_eos'
    -- 7 年運用ルール超過
    WHEN s.nvr_installed_at + INTERVAL '7 years' < CURRENT_DATE THEN
      'nvr_lifecycle_overage'
    -- 緊急 (6 ヶ月以内)
    -- 注: date - date = integer (日数) なので interval と比較できない。
    --     date <= date + interval 形式で比較する。
    WHEN s.nvr_eos_date <= CURRENT_DATE + INTERVAL '6 months' THEN
      'nvr_lifecycle_urgent'
    -- 計画推奨 (6〜12 ヶ月)
    WHEN s.nvr_eos_date <= CURRENT_DATE + INTERVAL '12 months' THEN
      'nvr_lifecycle_replace_planned'
    -- 警告 (12〜24 ヶ月)
    WHEN s.nvr_eos_date <= CURRENT_DATE + INTERVAL '24 months' THEN
      'nvr_lifecycle_warning'
    -- サポート期間中
    ELSE
      'nvr_lifecycle_ok'
  END                                                     AS lifecycle_status

FROM stores s;

COMMENT ON VIEW v_store_nvr_lifecycle IS
  '全店舗の NVR ライフサイクル状態。/infra ダッシュボードのアラートサマリで使用';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. 集計用の補助 VIEW: 状態別店舗数
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW v_nvr_lifecycle_summary AS
SELECT
  lifecycle_status,
  COUNT(*) AS store_count,
  CASE lifecycle_status
    WHEN 'nvr_lifecycle_eos'              THEN 1
    WHEN 'nvr_lifecycle_overage'          THEN 2
    WHEN 'nvr_lifecycle_urgent'           THEN 3
    WHEN 'nvr_lifecycle_replace_planned'  THEN 4
    WHEN 'nvr_lifecycle_warning'          THEN 5
    WHEN 'nvr_lifecycle_ok'               THEN 6
    ELSE 7
  END AS sort_order
FROM v_store_nvr_lifecycle
GROUP BY lifecycle_status
ORDER BY sort_order;

COMMENT ON VIEW v_nvr_lifecycle_summary IS
  '/infra ダッシュボードのライフサイクルサマリカード用';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. 機種別の更新計画ビュー
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW v_nvr_lifecycle_by_model AS
SELECT
  nvr_vendor,
  nvr_model,
  lifecycle_status,
  COUNT(*) AS store_count
FROM v_store_nvr_lifecycle
WHERE nvr_model IS NOT NULL
GROUP BY nvr_vendor, nvr_model, lifecycle_status
ORDER BY nvr_vendor, nvr_model, lifecycle_status;

COMMENT ON VIEW v_nvr_lifecycle_by_model IS
  '機種別 × ライフサイクル状態の集計。/infra/lifecycle 画面で使用';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. パフォーマンス対策
-- ─────────────────────────────────────────────────────────────────────────────

-- VIEW のパフォーマンスは stores.nvr_replace_by に index がある前提 (F46.6 で作成済)
-- 10,000 店舗で 50ms 以下を目標。実測は Phase 0 完了時に検証

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. 完了通知
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  RAISE NOTICE 'F46.8 complete: v_store_nvr_lifecycle, v_nvr_lifecycle_summary, v_nvr_lifecycle_by_model created';
END $$;
-- F51.B: 店舗ごとのハートビート間隔オーバーライド
--
-- deployment_mode が同じでも、特定店舗だけ「短い間隔で監視したい」
-- (例: VIP 旗艦店、重要顧客の事業所) という運用要件に対応する。
--
-- NULL の場合は deployment_mode のデフォルト (per_store=60s / central=21600s) を使う。
-- 値が入っている場合はそれを優先する。
--
-- ロールアウト戦略例:
--   1. 全店舗 60 秒 (Phase 0/1)
--   2. パイロット 5 店舗だけ 21600 秒に切替 (Phase 1 末)
--   3. 100 店舗まで拡大 (Phase 2)
--   4. 1000 店舗 → 10000 店舗段階展開 (Phase 3)
--   5. 全店舗 21600 秒 (override = NULL に戻す or 一括 NULL UPDATE)

ALTER TABLE stores ADD COLUMN IF NOT EXISTS
  heartbeat_override_sec int
  CHECK (heartbeat_override_sec IS NULL OR (heartbeat_override_sec BETWEEN 30 AND 86400));
COMMENT ON COLUMN stores.heartbeat_override_sec IS
  'NULL: deployment_mode のデフォルトを使う / 値あり: 個別に上書き (秒)。30〜86400 の範囲';

-- インデックス (override がある店舗を高速に列挙)
CREATE INDEX IF NOT EXISTS idx_stores_heartbeat_override
  ON stores(heartbeat_override_sec)
  WHERE heartbeat_override_sec IS NOT NULL;

-- ロールアウト状況集計用 VIEW
CREATE OR REPLACE VIEW v_heartbeat_rollout_status AS
SELECT
  s.deployment_mode,
  CASE
    WHEN s.heartbeat_override_sec IS NOT NULL THEN s.heartbeat_override_sec
    WHEN s.deployment_mode = 'central_aggregator'  THEN 21600   -- 6h
    WHEN s.deployment_mode = 'per_store_minipc'    THEN 60      -- 60s
    ELSE 60
  END                                                AS effective_interval_sec,
  s.heartbeat_override_sec IS NOT NULL              AS has_override,
  COUNT(*)                                           AS store_count
FROM stores s
GROUP BY s.deployment_mode, effective_interval_sec, has_override
ORDER BY s.deployment_mode, effective_interval_sec;

COMMENT ON VIEW v_heartbeat_rollout_status IS
  'ハートビート間隔の分布状況。/infra/slo や rollout CLI から参照';

-- 完了通知
DO $$
BEGIN
  RAISE NOTICE 'F51.B complete: heartbeat_override_sec column + v_heartbeat_rollout_status view created';
END $$;
-- F53.F: Phase 5 で追加された 4 ベンダーの主要機種を nvr_models に投入
--
-- Hikvision / Hanwha / Synology / Axis の代表機種を登録。
-- EOL/EOS は暫定値で各メーカー公式サイトでの確認が必要 (TODO コメント記載)。

-- ─────────────────────────────────────────────────────────────────────────────
-- Hikvision
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO nvr_models (
  vendor, model_family, model_number, display_name,
  released_at, eol_date, eos_date,
  max_channels, max_resolution, notes
) VALUES
  ('hikvision', 'nvr_pro', 'DS-7616NI-K2/16P',
   'Hikvision DS-7616NI-K2/16P (16ch / 16PoE / 4K)',
   '2020-04-01', '2027-03-31', '2030-03-31',
   16, '4K', 'TODO: Hikvision 公式の EOL/EOS を要確認'),

  ('hikvision', 'acusense', 'DS-7616NXI-K2/16P',
   'Hikvision DS-7616NXI-K2/16P (16ch / AcuSense AI / 16PoE)',
   '2022-01-01', '2028-12-31', '2031-12-31',
   16, '4K', 'AcuSense モデル (AI 検知内蔵)。TODO: 公式 EOL/EOS 要確認'),

  ('hikvision', 'nvr_value', 'DS-7732NI-K4',
   'Hikvision DS-7732NI-K4 (32ch / 4 HDD)',
   '2021-04-01', '2028-03-31', '2031-03-31',
   32, '4K', 'TODO: 公式 EOL/EOS 要確認'),

  ('hikvision', 'ip_camera', 'DS-2CD2042WD-I',
   'Hikvision DS-2CD2042WD-I (4MP IP カメラ)',
   '2018-04-01', '2024-03-31', '2027-03-31',
   1,  '4MP', '単体 IP カメラ。NVR 経由ではなく直接接続用')

ON CONFLICT (model_number) DO UPDATE SET
  display_name = EXCLUDED.display_name, eol_date = EXCLUDED.eol_date,
  eos_date = EXCLUDED.eos_date, max_channels = EXCLUDED.max_channels,
  max_resolution = EXCLUDED.max_resolution, notes = EXCLUDED.notes,
  updated_at = now();

-- ─────────────────────────────────────────────────────────────────────────────
-- Hanwha Wisenet (旧サムスン)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO nvr_models (
  vendor, model_family, model_number, display_name,
  released_at, eol_date, eos_date,
  max_channels, max_resolution, notes
) VALUES
  ('hanwha', 'nvr_pro', 'PRN-1610S2',
   'Hanwha Wisenet PRN-1610S2 (16ch / Wisenet 7 / 8MP)',
   '2020-04-01', '2027-03-31', '2030-03-31',
   16, '4K', 'TODO: Hanwha 公式の EOL/EOS を要確認'),

  ('hanwha', 'nvr_xrn', 'XRN-1610S2',
   'Hanwha Wisenet XRN-1610S2 (16ch / 8MP)',
   '2021-04-01', '2028-03-31', '2031-03-31',
   16, '4K', 'TODO: 公式 EOL/EOS 要確認'),

  ('hanwha', 'nvr_pro', 'PRN-3210B2',
   'Hanwha Wisenet PRN-3210B2 (32ch / Wisenet 7)',
   '2021-10-01', '2028-09-30', '2031-09-30',
   32, '4K', '大規模向け。TODO: 公式 EOL/EOS 要確認'),

  ('hanwha', 'wisenet_ai', 'PNV-A9081R',
   'Hanwha PNV-A9081R (Wisenet AI / 8MP)',
   '2022-04-01', '2029-03-31', '2032-03-31',
   1,  '8MP', 'AI 内蔵カメラ単体')

ON CONFLICT (model_number) DO UPDATE SET
  display_name = EXCLUDED.display_name, eol_date = EXCLUDED.eol_date,
  eos_date = EXCLUDED.eos_date, max_channels = EXCLUDED.max_channels,
  max_resolution = EXCLUDED.max_resolution, notes = EXCLUDED.notes,
  updated_at = now();

-- ─────────────────────────────────────────────────────────────────────────────
-- Synology (Surveillance Station ホストとして)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO nvr_models (
  vendor, model_family, model_number, display_name,
  released_at, eol_date, eos_date,
  max_channels, max_resolution, notes
) VALUES
  ('synology', 'ds_plus', 'DS423+',
   'Synology DS423+ (4-bay NAS / Surveillance Station)',
   '2023-04-01', '2030-03-31', '2033-03-31',
   16, '4K', 'NAS + Surveillance Station。標準 2 ライセンス内蔵'),

  ('synology', 'ds_plus', 'DS923+',
   'Synology DS923+ (4-bay NAS / DDR4 ECC)',
   '2022-10-01', '2029-09-30', '2032-09-30',
   16, '4K', 'ECC RAM 対応'),

  ('synology', 'dva_ai', 'DVA1622',
   'Synology DVA1622 (Deep Learning NVR / GPU 内蔵)',
   '2022-06-01', '2029-05-31', '2032-05-31',
   16, '4K', 'AI 機能内蔵 NVR。標準 8 ライセンス'),

  ('synology', 'dva_ai', 'DVA3221',
   'Synology DVA3221 (8-bay Deep Learning NVR)',
   '2020-06-01', '2027-05-31', '2030-05-31',
   32, '4K', '大型 AI NVR。標準 8 ライセンス')

ON CONFLICT (model_number) DO UPDATE SET
  display_name = EXCLUDED.display_name, eol_date = EXCLUDED.eol_date,
  eos_date = EXCLUDED.eos_date, max_channels = EXCLUDED.max_channels,
  max_resolution = EXCLUDED.max_resolution, notes = EXCLUDED.notes,
  updated_at = now();

-- ─────────────────────────────────────────────────────────────────────────────
-- ONVIF 汎用 (擬似機種)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO nvr_models (
  vendor, model_family, model_number, display_name,
  max_channels, max_resolution, notes
) VALUES
  ('onvif', 'generic', 'onvif-generic',
   'ONVIF 汎用 (Profile S/T 対応の任意機種)',
   32, '4K', 'fallback adapter 用。実機種は GetDeviceInformation で動的取得')

ON CONFLICT (model_number) DO UPDATE SET
  display_name = EXCLUDED.display_name, notes = EXCLUDED.notes, updated_at = now();

-- 完了通知
DO $$
DECLARE
  model_count int;
BEGIN
  SELECT COUNT(*) INTO model_count FROM nvr_models;
  RAISE NOTICE 'F53.F complete: % NVR models in catalog', model_count;
END $$;
