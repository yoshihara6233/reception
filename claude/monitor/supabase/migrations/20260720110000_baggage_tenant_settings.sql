-- 手荷物検査の共通設定をテナント単位に集約（全店舗同一運用のため）
--
-- 保持日数・NVR保持・STEP無操作タイムアウト・端末モード・音声・検査STEP文言は
-- テナント（企業）で全店舗共通にする。店舗固有なのは「有効化」と「検査台カメラ」の
-- みで、それらは従来どおり inspection_settings に残す。
-- inspection_settings の共通列は後方互換のため残置（今後キオスク/バッチは
-- baggage_tenant_settings を参照する）。

CREATE TABLE public.baggage_tenant_settings (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  retention_days INTEGER NOT NULL DEFAULT 60,
  nvr_retention_days INTEGER NOT NULL DEFAULT 14,
  inspection_timeout_sec INTEGER NOT NULL DEFAULT 120,
  terminal_mode TEXT NOT NULL DEFAULT 'both'
    CHECK (terminal_mode IN ('both', 'entry_only', 'exit_only')),
  audio_enabled BOOLEAN NOT NULL DEFAULT true,
  audio_volume NUMERIC NOT NULL DEFAULT 1.0,
  announce_steps JSONB NOT NULL DEFAULT '[
    {"order": 1, "text": "カバンの中身を出してください"},
    {"order": 2, "text": "カバンの中身を撮影してください"}
  ]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.baggage_tenant_settings IS
  '手荷物検査のテナント共通設定（全店舗同一運用。店舗固有は inspection_settings の enabled/camera_ids のみ）';

ALTER TABLE public.baggage_tenant_settings ENABLE ROW LEVEL SECURITY;

-- SELECT: super_admin 全件 / それ以外は自テナント（admin_users.tenant_id 一致）
CREATE POLICY "baggage_tenant_settings_select" ON public.baggage_tenant_settings
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM admin_users u
      WHERE u.auth_user_id = auth.uid()
        AND (u.role = 'super_admin' OR u.tenant_id = baggage_tenant_settings.tenant_id)
    )
  );
-- 書き込みはサーバ側 service role のみ（ポリシー無し=deny）

-- 既存 inspection_settings の設定をテナント共通へ引き継ぐ（テナント毎に最新1件）。
INSERT INTO public.baggage_tenant_settings (
  tenant_id, retention_days, nvr_retention_days, inspection_timeout_sec,
  terminal_mode, audio_enabled, audio_volume, announce_steps
)
SELECT DISTINCT ON (tenant_id)
  tenant_id, retention_days, nvr_retention_days, inspection_timeout_sec,
  terminal_mode, audio_enabled, audio_volume, announce_steps
FROM public.inspection_settings
ORDER BY tenant_id, updated_at DESC
ON CONFLICT (tenant_id) DO NOTHING;
