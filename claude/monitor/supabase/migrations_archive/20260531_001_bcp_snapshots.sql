-- F40: BCP を「30 分動画クリップ」→「8 枚 JPEG スナップショット」に変更。
--
-- 既存の bcp_clips テーブルを再利用する: 1 行 = 1 スナップショット。
--   - offset_min:  発令時刻からの分オフセット (-5, 0, 5, 10, 15, 20, 25, 30)
--                  既存行 (legacy 動画クリップ) は null のまま
--   - clip_url:    スナップショット JPEG の URL (旧 MP4 から流用)
--   - thumbnail_url: 同じく JPEG URL (JPEG 自身がサムネ)
--   - duration_sec: 0 (静止画なので)
--
-- 既存データは互換性のため残置。新しいキャプチャは新仕様で作られる。

ALTER TABLE bcp_clips
  ADD COLUMN IF NOT EXISTS offset_min int;

COMMENT ON COLUMN bcp_clips.offset_min IS
  'F40: snapshot offset in minutes from alert_issued_at. '
  'NULL for legacy video clips. '
  'New rows: -5, 0, 5, 10, 15, 20, 25, 30.';

-- Helpful index for the "timeline" UI on the event-detail page:
-- fetch all snapshots for an event sorted by camera × offset.
CREATE INDEX IF NOT EXISTS idx_bcp_clips_event_camera_offset
  ON bcp_clips(event_id, camera_id, offset_min);
