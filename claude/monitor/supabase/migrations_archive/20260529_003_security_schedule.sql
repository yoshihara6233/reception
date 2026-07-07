-- 警備 巡回スケジュール設定 — security_settings に列追加
--
-- 2モード:
--   schedule_mode = 'interval' : active_from〜active_to の間、patrol_interval_min 毎
--   schedule_mode = 'fixed'    : patrol_times の各時刻ちょうどに巡回
-- active_days: 巡回する曜日 (0=日 .. 6=土)
--
-- Idempotent: ADD COLUMN IF NOT EXISTS。

ALTER TABLE security_settings
  ADD COLUMN IF NOT EXISTS schedule_mode text  NOT NULL DEFAULT 'interval',
  ADD COLUMN IF NOT EXISTS active_from   text  NOT NULL DEFAULT '00:00',   -- HH:MM 窓開始（interval用）
  ADD COLUMN IF NOT EXISTS active_to     text  NOT NULL DEFAULT '24:00',   -- HH:MM 窓終了（24:00=日跨ぎ末尾）
  ADD COLUMN IF NOT EXISTS active_days   int[] NOT NULL DEFAULT '{0,1,2,3,4,5,6}',  -- 0=日..6=土
  ADD COLUMN IF NOT EXISTS patrol_times  text[] NOT NULL DEFAULT '{}';      -- HH:MM 配列（fixed用）

-- schedule_mode の値を制約（既存 CHECK があれば付け替え）
ALTER TABLE security_settings
  DROP CONSTRAINT IF EXISTS security_settings_schedule_mode_check;
ALTER TABLE security_settings
  ADD CONSTRAINT security_settings_schedule_mode_check
    CHECK (schedule_mode IN ('interval','fixed'));
