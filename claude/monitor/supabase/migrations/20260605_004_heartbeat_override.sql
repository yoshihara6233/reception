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
