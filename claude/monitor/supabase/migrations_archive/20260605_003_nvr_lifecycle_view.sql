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
