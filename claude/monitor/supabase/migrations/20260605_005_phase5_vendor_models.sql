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
