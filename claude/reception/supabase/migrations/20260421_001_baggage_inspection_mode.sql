-- Add inspection_mode to baggage_declarations
ALTER TABLE baggage_declarations
  ADD COLUMN IF NOT EXISTS inspection_mode TEXT DEFAULT 'photo'
    CHECK (inspection_mode IN ('photo', 'video'));

-- Update tenants settings default to use new values
ALTER TABLE tenants
  ALTER COLUMN settings SET DEFAULT '{
    "require_business_card": "optional",
    "require_face_photo": "optional",
    "require_baggage_inspection_checkin": "none",
    "require_baggage_inspection_checkout": "none",
    "visit_purposes": ["配送", "メンテナンス", "商談", "監査", "その他"],
    "photo_retention_days": 90,
    "visit_retention_days": 365
  }'::jsonb;

-- Migrate existing settings: hidden→none, optional/required→photo
UPDATE tenants SET settings = settings
  || jsonb_build_object(
       'require_baggage_inspection_checkin',
       CASE settings->>'require_baggage_inspection_checkin'
         WHEN 'hidden' THEN 'none'
         WHEN 'optional' THEN 'photo'
         WHEN 'required' THEN 'photo'
         ELSE COALESCE(settings->>'require_baggage_inspection_checkin', 'none')
       END,
       'require_baggage_inspection_checkout',
       CASE settings->>'require_baggage_inspection_checkout'
         WHEN 'hidden' THEN 'none'
         WHEN 'optional' THEN 'photo'
         WHEN 'required' THEN 'photo'
         ELSE COALESCE(settings->>'require_baggage_inspection_checkout', 'none')
       END
     );

UPDATE stores SET settings = settings
  || jsonb_build_object(
       'require_baggage_inspection_checkin',
       CASE settings->>'require_baggage_inspection_checkin'
         WHEN 'hidden' THEN 'none'
         WHEN 'optional' THEN 'photo'
         WHEN 'required' THEN 'photo'
         ELSE COALESCE(settings->>'require_baggage_inspection_checkin', 'none')
       END,
       'require_baggage_inspection_checkout',
       CASE settings->>'require_baggage_inspection_checkout'
         WHEN 'hidden' THEN 'none'
         WHEN 'optional' THEN 'photo'
         WHEN 'required' THEN 'photo'
         ELSE COALESCE(settings->>'require_baggage_inspection_checkout', 'none')
       END
     )
WHERE settings ? 'require_baggage_inspection_checkin'
   OR settings ? 'require_baggage_inspection_checkout';
