-- Phase2 グランドファザリング: 既存店舗の opt_* を「現在の稼働状態」に合わせて埋める。
--
-- Phase2 では stores.opt_*（巡回/発報/検査）を各機能の **外側ゲート**として実行時に
-- 参照する。ところが opt_* は #214 で DEFAULT false 追加＝既存店舗は全て false のため、
-- バックフィルせずにゲートを有効化すると稼働中の機能が全店で一斉停止してしまう。
-- 本 migration で「今まさに動いている店舗」だけ opt_* = true にし、挙動を変えない。
-- 新規店舗は引き続き既定 false（オプトイン運用）。
--
-- マッピング（現状維持）:
--   opt_patrol  = 巡回設定が有効な店舗（security_settings.enabled = true）
--   opt_baggage = 検査設定が有効な店舗（inspection_settings.enabled = true）
--   opt_alarm   = エッジ端末を持つ店舗（＝現在 /api/alarms/ingest で発報を記録し得る店舗）
--
-- 冪等: true への UPDATE のみ・IS DISTINCT FROM で再実行安全。対象テーブルが無い
-- 環境でも to_regclass ガードで失敗しない。

DO $$
BEGIN
  IF to_regclass('public.security_settings') IS NOT NULL THEN
    UPDATE public.stores s SET opt_patrol = true
      WHERE s.opt_patrol IS DISTINCT FROM true
        AND EXISTS (SELECT 1 FROM public.security_settings x WHERE x.store_id = s.id AND x.enabled);
  END IF;

  IF to_regclass('public.inspection_settings') IS NOT NULL THEN
    UPDATE public.stores s SET opt_baggage = true
      WHERE s.opt_baggage IS DISTINCT FROM true
        AND EXISTS (SELECT 1 FROM public.inspection_settings x WHERE x.store_id = s.id AND x.enabled);
  END IF;

  IF to_regclass('public.edge_devices') IS NOT NULL THEN
    UPDATE public.stores s SET opt_alarm = true
      WHERE s.opt_alarm IS DISTINCT FROM true
        AND EXISTS (SELECT 1 FROM public.edge_devices x WHERE x.store_id = s.id);
  END IF;
END $$;
