-- BCP 自動録画の発動条件（店舗ごと個別）
--
-- これまで J-Alert 連動 BCP は「店舗エリアに一致した地震・津波」で無条件に起動していた。
-- 実運用では震度2〜4の地震まで毎回録画すると過剰なため、店舗ごとに発動条件を持たせる:
--   - quake_min_intensity : この震度以上の地震でのみ起動（既定 5強）
--   - tsunami_enabled     : 津波発令で起動するか（既定 ON）
--   - missile_enabled     : 国民保護(弾道ミサイル等)で起動するか（既定 ON）
-- 条件未満でも jalert_receipts への受信記録は従来どおり残る（録画を起動しないだけ）。
--
-- Idempotent: ADD COLUMN IF NOT EXISTS。

ALTER TABLE bcp_settings
  ADD COLUMN IF NOT EXISTS quake_min_intensity text    NOT NULL DEFAULT '5+',
  ADD COLUMN IF NOT EXISTS tsunami_enabled     boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS missile_enabled     boolean NOT NULL DEFAULT true;

-- 震度しきい値は JMA MaxInt の表記（'1'..'4','5-','5+','6-','6+','7'）のみ許可。
ALTER TABLE bcp_settings
  DROP CONSTRAINT IF EXISTS bcp_settings_quake_min_intensity_check;
ALTER TABLE bcp_settings
  ADD CONSTRAINT bcp_settings_quake_min_intensity_check
    CHECK (quake_min_intensity IN ('1','2','3','4','5-','5+','6-','6+','7'));
