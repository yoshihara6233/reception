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
