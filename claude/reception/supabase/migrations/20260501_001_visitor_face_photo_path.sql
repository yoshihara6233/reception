-- visitors テーブルに顔写真パスカラムを追加
ALTER TABLE visitors
  ADD COLUMN IF NOT EXISTS face_photo_path TEXT;

COMMENT ON COLUMN visitors.face_photo_path IS '顔写真の Supabase Storage パス (visit-photos バケット)';
