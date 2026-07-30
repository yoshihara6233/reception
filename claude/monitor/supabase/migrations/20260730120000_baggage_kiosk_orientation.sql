-- 手荷物検査キオスクの画面向き（店舗別）
--
-- 背景: 既設 iPad をそのまま流用する案件で、端末が縦向き（ポートレート）に据え付けられ
-- カメラも縦向き前提のため、横向き固定だったキオスク UI が成立しない。店舗ごとに設置形態が
-- 異なる（横置きの店舗と縦置きの店舗が混在する）ため、テナント共通ではなく**店舗別**に持つ。
--
-- 配置の判断: inspection_settings（店舗別）に置く。baggage_tenant_settings（テナント共通）
-- には置かない — 端末の物理的な据え付けは店舗ごとの事情であってテナントの方針ではない。
--
-- 既定は 'landscape'（既存店舗の挙動を変えない）。

ALTER TABLE public.inspection_settings
  ADD COLUMN IF NOT EXISTS kiosk_orientation TEXT NOT NULL DEFAULT 'landscape';

-- CHECK は列追加と分ける（IF NOT EXISTS 再実行時に重複追加しないため）。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.inspection_settings'::regclass
      AND conname = 'inspection_settings_kiosk_orientation_check'
  ) THEN
    ALTER TABLE public.inspection_settings
      ADD CONSTRAINT inspection_settings_kiosk_orientation_check
      CHECK (kiosk_orientation IN ('landscape', 'portrait'));
  END IF;
END $$;

COMMENT ON COLUMN public.inspection_settings.kiosk_orientation IS
  'キオスク iPad の据え付け向き（landscape=横置き / portrait=縦置き）。UI のレイアウトと PWA manifest の orientation を切り替える。店舗ごとに設定する。';
