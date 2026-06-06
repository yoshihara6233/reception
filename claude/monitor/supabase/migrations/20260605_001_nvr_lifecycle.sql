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
