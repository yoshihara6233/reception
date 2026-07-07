-- BCPレポートの撮影枚数を店舗ごとに選択可能にする。
--
-- 既存は固定8枚（-5,0,5,10,15,20,25,30 分）。容量・帯域・NVR負荷が高いため、
-- 店舗ごとに撮影するオフセット（分）を選べるようにする。既定は「5分前・5分後」の
-- 2枚（= {-5,5}）。許可値は固定8オフセットの部分集合。
--
-- 選択値は発令時の start_bcp_capture コマンドに載せてエッジへ渡す
-- （jalert-poller / retrieve route → edge_devices.pending_command.offsets）。

ALTER TABLE bcp_settings
  ADD COLUMN IF NOT EXISTS snapshot_offsets smallint[] NOT NULL DEFAULT '{-5,5}';

-- 1件以上、かつ固定オフセット集合の部分集合のみ許可。
ALTER TABLE bcp_settings DROP CONSTRAINT IF EXISTS bcp_settings_snapshot_offsets_chk;
ALTER TABLE bcp_settings ADD CONSTRAINT bcp_settings_snapshot_offsets_chk
  CHECK (
    array_length(snapshot_offsets, 1) >= 1
    AND snapshot_offsets <@ ARRAY[-5, 0, 5, 10, 15, 20, 25, 30]::smallint[]
  );

COMMENT ON COLUMN bcp_settings.snapshot_offsets IS
  'BCPレポートで撮影するオフセット（発令からの分）。既定 {-5,5}。許可値 {-5,0,5,10,15,20,25,30} の部分集合。';
