-- recorder_cameras を参照する FK を ON DELETE SET NULL に変更
-- 2026-06-19: レコーダ/カメラ削除が、参照先(bcp_clips / security_camera_config /
--   patrol_findings)の FK が RESTRICT のため拒否され、管理UIの🗑削除が500で失敗していた。
--   履歴(BCPクリップ・警備所見等)は残しつつ camera_id だけ NULL 化することで、
--   カメラ/レコーダを安全に削除できるようにする。
--   (vod_clips は既に ON DELETE CASCADE。live_sessions.camera_id は FK 無し。)
--   列はいずれも NULL 可なので SET NULL 可能。
--   制約名はカタログから実名を引いて確実に張り替える（環境差・自動命名対策）。

DO $$
DECLARE
  t   text;
  r   record;
  tables text[] := ARRAY['bcp_clips', 'security_camera_config', 'patrol_findings'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    -- 当該テーブルから recorder_cameras への既存 FK を全て削除
    FOR r IN
      SELECT conname
      FROM pg_constraint
      WHERE conrelid = t::regclass
        AND contype  = 'f'
        AND confrelid = 'recorder_cameras'::regclass
    LOOP
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', t, r.conname);
    END LOOP;
    -- ON DELETE SET NULL で張り直す
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (camera_id) '
      'REFERENCES recorder_cameras(id) ON DELETE SET NULL',
      t, t || '_camera_id_fkey'
    );
  END LOOP;
END $$;
