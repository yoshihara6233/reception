-- 警備 自動巡回 MVP（Phase A / A1）— スケジューラ運用向けの既定値とインデックス
--
-- 巡回は /api/cron/security-patrol（Vercel Cron 10分毎）が security_settings を読んで
-- 発火する。ここではスキーマ変更を最小に留める:
--   1. 既定巡回間隔を 4 時間（240 分）に（証跡型・4時間毎の既定に合わせる）
--   2. 30 日 purge を効率化する started_at インデックス
--
-- Idempotent: SET DEFAULT / CREATE INDEX IF NOT EXISTS。既存行の interval は変更しない
-- （店舗別に settings UI で調整）。

ALTER TABLE security_settings
  ALTER COLUMN patrol_interval_min SET DEFAULT 240;

CREATE INDEX IF NOT EXISTS idx_patrol_runs_started_at ON patrol_runs(started_at);
