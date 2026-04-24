-- photo_retention_days を 90 日 → 30 日に変更
-- コスト削減: Supabase Storage の定常量を 1.08GB → 360MB に抑え Free プラン内に収める

-- テナントのデフォルト値を 30 日に更新
ALTER TABLE tenants
  ALTER COLUMN settings SET DEFAULT '{
    "require_business_card": "optional",
    "require_face_photo": "optional",
    "require_baggage_inspection_checkin": "none",
    "require_baggage_inspection_checkout": "none",
    "visit_purposes": ["配送", "メンテナンス", "商談", "監査", "その他"],
    "photo_retention_days": 30,
    "visit_retention_days": 365
  }'::jsonb;

-- 既存テナントの設定を 30 日に上書き
UPDATE tenants
SET settings = settings || '{"photo_retention_days": 30}'::jsonb;

-- 既存ストアの設定にも photo_retention_days が含まれていれば 30 日に更新
UPDATE stores
SET settings = settings || '{"photo_retention_days": 30}'::jsonb
WHERE settings ? 'photo_retention_days';
