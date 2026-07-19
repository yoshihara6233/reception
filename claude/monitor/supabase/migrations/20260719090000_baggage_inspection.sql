-- 手荷物検査モジュール（M1）— monitor へ BCP と同方式で追加
-- 設計: ワイヤーフレーム v3（baggage-ipad-exit-20260718・D17）/ 旧 reception 1a 設計の monitor 適合版
--
-- monitor 規約への適合:
--   - 店舗 = stores / カメラ = recorder_cameras / エッジ = edge_devices を共有（二重マスタ禁止）
--   - 従業員は既存 employees を拡張（QR 世代のテーブルに顔認証系の列を追加）
--   - 設定は alarm_settings / bcp_settings と同じ「ドメイン別 settings テーブル」方式
--   - エッジ認証は edge_devices.device_token（Bearer）を流用 — 専用トークンテーブルは作らない
--   - RLS は bcp_events_select と同じ店舗スコープ（super_admin=全件 / tenant_admin=自テナント /
--     その他=admin_users.store_ids）。書き込みはサーバ側 service role のみ（ポリシー無し＝deny）
--   - 機微データ（顔・映像）のため RLS は初回から有効化する
--
-- 旧世代テーブル（inspections / entry_exit_logs / unmatch_logs = QR+写真+AI方式）とは独立・不干渉。

-- ============================================================
-- 0. 店舗スコープ判定ヘルパ（bcp_events_select の規約を DRY 化）
-- ============================================================
CREATE OR REPLACE FUNCTION public.baggage_store_access(p_store UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM admin_users u
    WHERE u.auth_user_id = auth.uid()
      AND (
        u.role = 'super_admin'
        OR (
          u.role = 'tenant_admin'
          AND EXISTS (
            SELECT 1 FROM stores s
            WHERE s.id = p_store AND s.tenant_id = u.tenant_id
          )
        )
        OR p_store = ANY (COALESCE(u.store_ids, ARRAY[]::UUID[]))
      )
  );
$$;

COMMENT ON FUNCTION public.baggage_store_access IS
  '手荷物検査系テーブルの店舗スコープSELECT判定（super_admin=全件 / tenant_admin=自テナント / 他=store_ids）';

-- ============================================================
-- 1. employees 拡張 — 顔認証世代の列を追加（既存 QR 世代と共存）
-- ============================================================
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS employee_code TEXT,          -- シフトCSV突合キー（T8）
  ADD COLUMN IF NOT EXISTS face_photo_path TEXT,        -- baggage-photos バケット内パス
  ADD COLUMN IF NOT EXISTS rekognition_face_id TEXT;    -- 常設コレクション（baggage-emp-<store>）の FaceId

-- 社員コードは店舗内で一意（未設定 NULL は許容）
CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_store_code
  ON public.employees(store_id, employee_code)
  WHERE employee_code IS NOT NULL;

COMMENT ON COLUMN public.employees.rekognition_face_id IS
  'AWS Rekognition 常設コレクション baggage-emp-<store_id> の FaceId（退職時は顔もコレクションから削除）';

-- ============================================================
-- 2. inspection_settings — 店舗毎の手荷物検査設定（ドメイン別settings方式）
-- ============================================================
CREATE TABLE public.inspection_settings (
  store_id UUID PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT false,
  camera_ids UUID[] NOT NULL DEFAULT '{}',              -- recorder_cameras.id（検査台の2カメラ）
  retention_days INTEGER NOT NULL DEFAULT 60,           -- クラウドクリップ保持
  nvr_retention_days INTEGER NOT NULL DEFAULT 14,       -- NVR録画保持（clip job の deadline 算出）
  inspection_timeout_sec INTEGER NOT NULL DEFAULT 120,  -- STEP無操作タイムアウト
  terminal_mode TEXT NOT NULL DEFAULT 'both'
    CHECK (terminal_mode IN ('both', 'entry_only', 'exit_only')),
  audio_enabled BOOLEAN NOT NULL DEFAULT true,          -- 音声TTS読み上げ 既定ON（D5）
  audio_volume NUMERIC NOT NULL DEFAULT 1.0,
  announce_steps JSONB NOT NULL DEFAULT '[
    {"order": 1, "text": "カバンの中身を出してください"},
    {"order": 2, "text": "カバンの中身を撮影してください"}
  ]'::jsonb,                                            -- STEP文言（全角40字上限・D13）
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_inspection_settings_tenant ON public.inspection_settings(tenant_id);

COMMENT ON TABLE public.inspection_settings IS
  '手荷物検査の店舗別設定（alarm_settings 等と同じドメイン別settings方式）';

ALTER TABLE public.inspection_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "inspection_settings_select" ON public.inspection_settings
  FOR SELECT USING (public.baggage_store_access(store_id));

-- ============================================================
-- 3. inspection_sessions — 入退のペア・検査セッション
-- ============================================================
CREATE TABLE public.inspection_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  store_id UUID REFERENCES stores(id) ON DELETE CASCADE NOT NULL,
  inspection_date DATE NOT NULL,                        -- JST暦日（日跨ぎ勤務なし前提）
  person_kind TEXT NOT NULL CHECK (person_kind IN ('staff', 'visitor')),
  employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,  -- staff時
  visitor_name TEXT,                                    -- 来訪者: 名刺OCR/手入力（任意）
  visitor_company TEXT,
  card_photo_path TEXT,                                 -- 来訪者: 名刺画像
  entry_at TIMESTAMPTZ,
  entry_face_path TEXT,
  exit_at TIMESTAMPTZ,
  exit_face_path TEXT,
  inspection_started_at TIMESTAMPTZ,                    -- 検査窓 開始（STEP1開始 − バッファ）
  inspection_ended_at TIMESTAMPTZ,                      -- 検査窓 終了（最終「次へ」＋ バッファ）
  status TEXT NOT NULL DEFAULT 'entered'
    CHECK (status IN ('entered', 'completed', 'interrupted', 'unmatched_entry', 'unmatched_exit')),
  auth_skipped BOOLEAN NOT NULL DEFAULT false,          -- 顔照合スキップ（直交フラグ）
  confirmed_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,  -- 店長の再生確認（D8）
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_inspection_sessions_store_date ON public.inspection_sessions(store_id, inspection_date DESC);
CREATE INDEX idx_inspection_sessions_tenant ON public.inspection_sessions(tenant_id);
CREATE INDEX idx_inspection_sessions_status ON public.inspection_sessions(store_id, status);
CREATE INDEX idx_inspection_sessions_employee ON public.inspection_sessions(employee_id) WHERE employee_id IS NOT NULL;
-- 未確認フィルタ（店長の再生確認が未了の行を拾う）
CREATE INDEX idx_inspection_sessions_unconfirmed ON public.inspection_sessions(store_id, inspection_date DESC)
  WHERE confirmed_at IS NULL;
-- 退出時の「未退出の最新 entry」紐付け高速化
CREATE INDEX idx_inspection_sessions_open_entry ON public.inspection_sessions(store_id, person_kind, entry_at DESC)
  WHERE exit_at IS NULL;

COMMENT ON TABLE public.inspection_sessions IS '手荷物検査セッション（入退ペア・状態・店長確認）';
COMMENT ON COLUMN public.inspection_sessions.status IS
  'entered=入室のみ / completed=検査完了 / interrupted=中断 / unmatched_entry=入室記録なし退出 / unmatched_exit=退出なし';

ALTER TABLE public.inspection_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "inspection_sessions_select" ON public.inspection_sessions
  FOR SELECT USING (public.baggage_store_access(store_id));

-- ============================================================
-- 4. inspection_session_events — 途中退室 / 途中入室（D17・顔認証のみの軽量記録）
-- ============================================================
CREATE TABLE public.inspection_session_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  store_id UUID REFERENCES stores(id) ON DELETE CASCADE NOT NULL,
  session_id UUID REFERENCES inspection_sessions(id) ON DELETE CASCADE,  -- 未退出セッションへ（無ければ孤立記録）
  person_kind TEXT NOT NULL CHECK (person_kind IN ('staff', 'visitor')),
  employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('temp_exit', 'temp_return')),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  face_path TEXT,
  auth_skipped BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_inspection_events_session ON public.inspection_session_events(session_id);
CREATE INDEX idx_inspection_events_store ON public.inspection_session_events(store_id, occurred_at DESC);
CREATE INDEX idx_inspection_events_tenant ON public.inspection_session_events(tenant_id);

COMMENT ON TABLE public.inspection_session_events IS '途中退室/途中入室の軽量イベント（検査・クリップなし・D17）';

ALTER TABLE public.inspection_session_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "inspection_session_events_select" ON public.inspection_session_events
  FOR SELECT USING (public.baggage_store_access(store_id));

-- ============================================================
-- 5. inspection_clip_jobs — クリップ切り出しジョブ（エッジが device_token で poll）
-- ============================================================
-- edge_jobs（onvif_discovery/connection_test の即時ジョブ）とは寿命・リトライ・期限の
-- セマンティクスが異なるため別テーブル。poll 認証は edge_devices.device_token。
CREATE TABLE public.inspection_clip_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  store_id UUID REFERENCES stores(id) ON DELETE CASCADE NOT NULL,
  session_id UUID REFERENCES inspection_sessions(id) ON DELETE CASCADE NOT NULL,
  camera_id UUID REFERENCES recorder_cameras(id) ON DELETE SET NULL,
  window_from TIMESTAMPTZ NOT NULL,
  window_to TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'done', 'failed')),
  retry_count INTEGER NOT NULL DEFAULT 0,
  not_before TIMESTAMPTZ NOT NULL,      -- window_to + N分（未確定録画での誤報防止）
  deadline_at TIMESTAMPTZ NOT NULL,     -- 検査時刻 + NVR保持日数 − 2日（超過で失敗確定→通知）
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_inspection_clip_jobs_session ON public.inspection_clip_jobs(session_id);
CREATE INDEX idx_inspection_clip_jobs_tenant ON public.inspection_clip_jobs(tenant_id);
-- エッジ poll: 店舗単位で「not_before 経過済みの pending」
CREATE INDEX idx_inspection_clip_jobs_poll ON public.inspection_clip_jobs(store_id, status, not_before);

COMMENT ON TABLE public.inspection_clip_jobs IS
  'クリップ切り出しジョブ（エッジが edge_devices.device_token 認証で poll・not_before/deadline）';

ALTER TABLE public.inspection_clip_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "inspection_clip_jobs_select" ON public.inspection_clip_jobs
  FOR SELECT USING (public.baggage_store_access(store_id));

-- ============================================================
-- 6. inspection_clips — 保存済みクリップ
-- ============================================================
CREATE TABLE public.inspection_clips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  store_id UUID REFERENCES stores(id) ON DELETE CASCADE NOT NULL,
  session_id UUID REFERENCES inspection_sessions(id) ON DELETE CASCADE NOT NULL,
  camera_id UUID REFERENCES recorder_cameras(id) ON DELETE SET NULL,
  storage_path TEXT NOT NULL,           -- baggage-clips/<sessionId>/<cameraId>.mp4
  duration_sec NUMERIC,
  clock_offset_sec NUMERIC,             -- NVR時刻とサーバ時刻の差（時計ズレ検知・詳細画面メタ）
  upload_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (upload_status IN ('pending', 'uploading', 'done', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_inspection_clips_session ON public.inspection_clips(session_id);
CREATE INDEX idx_inspection_clips_tenant ON public.inspection_clips(tenant_id);
CREATE UNIQUE INDEX idx_inspection_clips_session_camera ON public.inspection_clips(session_id, camera_id);

COMMENT ON TABLE public.inspection_clips IS '保存済み検査クリップ（署名URL再生・retention_days で purge）';

ALTER TABLE public.inspection_clips ENABLE ROW LEVEL SECURITY;
CREATE POLICY "inspection_clips_select" ON public.inspection_clips
  FOR SELECT USING (public.baggage_store_access(store_id));

-- ============================================================
-- 7. ストレージバケット（非公開・署名URL配信のみ）
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'baggage-clips', 'baggage-clips', false,
  104857600,  -- 100MB（1Mbps ストリームコピーで通常25〜80MB）
  ARRAY['video/mp4']
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'baggage-photos', 'baggage-photos', false,
  10485760,   -- 10MB（顔・名刺静止画）
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- 読み書きはサーバ側 service role のみ（storage.objects へのセッション用ポリシーは作らない）
