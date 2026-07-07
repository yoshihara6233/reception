-- edge_jobs: 本部→エッジの非同期ジョブ（ONVIF探索・接続テスト / Phase B Stage 2b）。
-- monitor が pending で作成 → エッジが自分宛を拾って実行し result/status を書き戻す。
-- RLS ポリシー無し=service_role のみ（monitor は requireAdmin 後に service client、
-- エッジは service key）。クレデンシャルは params に入れず recorder_id 参照で解決。

CREATE TABLE IF NOT EXISTS edge_jobs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  edge_id     uuid NOT NULL REFERENCES edge_devices(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('onvif_discovery', 'connection_test')),
  params      jsonb NOT NULL DEFAULT '{}',     -- {recorder_id, channel?}
  status      text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'running', 'done', 'error')),
  result      jsonb,                            -- 探索結果 / テスト結果
  error       text,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- エッジが「自分宛の未処理ジョブ」を引くためのインデックス。
CREATE INDEX IF NOT EXISTS idx_edge_jobs_edge_pending
  ON edge_jobs(edge_id, status) WHERE status = 'pending';

ALTER TABLE edge_jobs ENABLE ROW LEVEL SECURITY;   -- ポリシー無し=service_roleのみ

COMMENT ON TABLE edge_jobs IS
  '本部→エッジ非同期ジョブ(ONVIF探索/接続テスト)。RLSポリシー無し=service_roleのみ。';
