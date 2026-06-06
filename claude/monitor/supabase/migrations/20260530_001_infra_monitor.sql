-- インフラ管理（機器ヘルス監視）— Phase 1 データモデル
-- テナント管理者が自テナントのエッジ/レコーダ/カメラの健全性を監視する。
--
-- 設計: ~/.gstack/projects/.../*-design-*-infra.md（Approach A）
-- RLS は admin_users.auth_user_id = auth.uid() パターン（security と同一）。
-- monitor_results は月次パーティション（live_sessions の前例に倣う）。
-- Idempotent: IF NOT EXISTS / DROP ... IF EXISTS。

-- ---------------------------------------------------------------------------
-- 1. monitor_settings : 店舗別 監視設定
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS monitor_settings (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id                 uuid        UNIQUE REFERENCES stores(id),
  edge_offline_threshold_min int       NOT NULL DEFAULT 5  CHECK (edge_offline_threshold_min BETWEEN 1 AND 1440),
  check_interval_min       int         NOT NULL DEFAULT 5  CHECK (check_interval_min BETWEEN 1 AND 1440),
  business_hours           jsonb,                                  -- {start,end,days[]} 省略時=常時
  fail_threshold           int         NOT NULL DEFAULT 3  CHECK (fail_threshold  BETWEEN 1 AND 20),  -- 連続N回失敗でopen
  ok_threshold             int         NOT NULL DEFAULT 2  CHECK (ok_threshold    BETWEEN 1 AND 20),  -- 連続M回OKでresolve
  fail_minutes_cap         int         NOT NULL DEFAULT 15,        -- 実時間上限(cadenceドリフト対策)
  notify_emails            text[],
  maintenance_until        timestamptz,                            -- メンテ窓(これ以前はアラート抑制)
  enabled                  boolean     NOT NULL DEFAULT true,
  last_swept_at            timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_monitor_settings_store ON monitor_settings(store_id);
DROP TRIGGER IF EXISTS trg_monitor_settings_updated_at ON monitor_settings;
CREATE TRIGGER trg_monitor_settings_updated_at
  BEFORE UPDATE ON monitor_settings FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---------------------------------------------------------------------------
-- 2. monitor_checks : チェック定義（対象×種別×間隔）＋デバウンスカウンタ
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS monitor_checks (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id      uuid        REFERENCES stores(id),
  target_type   text        NOT NULL CHECK (target_type IN ('edge','recorder','camera')),
  target_id     uuid        NOT NULL,
  check_type    text        NOT NULL CHECK (check_type IN
                              ('heartbeat','ping','probe_camera','storage','recording_gap','ntp','tamper','version')),
  interval_min  int         NOT NULL DEFAULT 5,
  enabled       boolean     NOT NULL DEFAULT true,
  consec_fail   int         NOT NULL DEFAULT 0,                    -- デバウンス: 連続失敗数
  consec_ok     int         NOT NULL DEFAULT 0,                    -- デバウンス: 連続OK数
  first_failed_at timestamptz,                                     -- 実時間上限判定用
  last_run_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_monitor_checks_store  ON monitor_checks(store_id);
CREATE INDEX IF NOT EXISTS idx_monitor_checks_target ON monitor_checks(target_type, target_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_monitor_checks_target_type
  ON monitor_checks(target_type, target_id, check_type);

-- ---------------------------------------------------------------------------
-- 3. monitor_results : チェック結果の履歴（月次パーティション）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS monitor_results (
  id           uuid        DEFAULT gen_random_uuid(),
  check_id     uuid,
  store_id     uuid,
  target_type  text,
  target_id    uuid,
  status       text        NOT NULL CHECK (status IN ('ok','warn','fail')),
  latency_ms   int,
  detail       jsonb,
  measured_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, measured_at)
) PARTITION BY RANGE (measured_at);
CREATE INDEX IF NOT EXISTS idx_monitor_results_store   ON monitor_results(store_id, measured_at);
CREATE INDEX IF NOT EXISTS idx_monitor_results_check   ON monitor_results(check_id, measured_at);

-- パーティション作成関数（指定月＝月初を含む月のパーティションを作る）
CREATE OR REPLACE FUNCTION monitor_results_ensure_partition(p_month date) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_start date := date_trunc('month', p_month)::date;
  v_end   date := (date_trunc('month', p_month) + interval '1 month')::date;
  v_name  text := 'monitor_results_' || to_char(v_start, 'YYYYMM');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = v_name) THEN
    EXECUTE format(
      'CREATE TABLE %I PARTITION OF monitor_results FOR VALUES FROM (%L) TO (%L);',
      v_name, v_start, v_end);
  END IF;
END $$;

-- 当月＋翌月を先回り作成（#6: 生成自動化）
SELECT monitor_results_ensure_partition(now()::date);
SELECT monitor_results_ensure_partition((now() + interval '1 month')::date);

-- ---------------------------------------------------------------------------
-- 4. monitor_daily_stats : 日次ロールアップ（レポート用）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS monitor_daily_stats (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    uuid        REFERENCES stores(id),
  target_type text,
  target_id   uuid,
  day         date        NOT NULL,
  checks      int         NOT NULL DEFAULT 0,
  fail_count  int         NOT NULL DEFAULT 0,
  uptime_pct  numeric,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_monitor_daily_stats
  ON monitor_daily_stats(store_id, target_type, target_id, day);
CREATE INDEX IF NOT EXISTS idx_monitor_daily_stats_store_day ON monitor_daily_stats(store_id, day);

-- ---------------------------------------------------------------------------
-- 5. monitor_incidents : 障害ライフサイクル
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS monitor_incidents (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    uuid        REFERENCES stores(id),
  target_type text        NOT NULL CHECK (target_type IN ('edge','recorder','camera','tenant')),
  target_id   uuid,
  kind        text        NOT NULL,                               -- 'edge_offline' | 'camera_down' | 'network_outage' ...
  severity    text        NOT NULL DEFAULT 'warn' CHECK (severity IN ('info','warn','danger')),
  status      text        NOT NULL DEFAULT 'open' CHECK (status IN ('open','ack','resolved')),
  detail      text,
  opened_at   timestamptz NOT NULL DEFAULT now(),
  acked_by    uuid,
  acked_at    timestamptz,
  resolved_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_monitor_incidents_store  ON monitor_incidents(store_id);
CREATE INDEX IF NOT EXISTS idx_monitor_incidents_status ON monitor_incidents(status);
-- 同一対象の未解決インシデントは1件（重複抑制）
CREATE UNIQUE INDEX IF NOT EXISTS uq_monitor_incidents_open
  ON monitor_incidents(target_type, target_id, kind)
  WHERE status IN ('open','ack');

-- ---------------------------------------------------------------------------
-- 6. monitor_reports : 稼働率レポート
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS monitor_reports (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id       uuid        REFERENCES stores(id),
  kind           text        NOT NULL CHECK (kind IN ('daily','weekly','monthly')),
  period_from    timestamptz NOT NULL,
  period_to      timestamptz NOT NULL,
  pdf_url        text,
  generated_at   timestamptz,
  sent_to_emails text[],
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_monitor_reports_store ON monitor_reports(store_id);

-- ---------------------------------------------------------------------------
-- 7. edge死活掃引 (P1): last_seen_at 鮮度で offline を検知し incident を生成
--    一斉stale(#4)抑制: テナント内の enabled 店舗の大半(>=60%)が同時 stale なら
--    個別 edge_offline ではなく tenant 単位 network_outage を1件起票。
--    pg_cron で毎分実行（拡張があれば登録、無ければ手動/外部cronから呼ぶ）。
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION monitor_sweep_edges() RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_tenant   uuid;
  v_total    int;
  v_stale    int;
BEGIN
  -- テナント単位で評価
  FOR v_tenant IN
    SELECT DISTINCT s.tenant_id
      FROM stores s
      JOIN monitor_settings ms ON ms.store_id = s.id AND ms.enabled
  LOOP
    SELECT count(*),
           count(*) FILTER (
             WHERE e.last_seen_at IS NULL
                OR e.last_seen_at < now() - make_interval(mins => ms.edge_offline_threshold_min))
      INTO v_total, v_stale
      FROM stores s
      JOIN monitor_settings ms ON ms.store_id = s.id AND ms.enabled
      LEFT JOIN edge_devices e ON e.store_id = s.id
     WHERE s.tenant_id = v_tenant
       AND (ms.maintenance_until IS NULL OR ms.maintenance_until < now());

    IF v_total > 0 AND v_stale::numeric / v_total >= 0.6 AND v_stale >= 3 THEN
      -- 一斉stale → network_outage 1件（重複は uq で抑制）
      INSERT INTO monitor_incidents(store_id, target_type, target_id, kind, severity, detail)
      VALUES (NULL, 'tenant', v_tenant, 'network_outage', 'danger',
              format('%s/%s 拠点が同時に無応答。ネットワーク/接続障害の疑い。', v_stale, v_total))
      ON CONFLICT DO NOTHING;
    ELSE
      -- 個別 edge_offline
      INSERT INTO monitor_incidents(store_id, target_type, target_id, kind, severity, detail)
      SELECT s.id, 'edge', e.id, 'edge_offline', 'danger',
             format('エッジ %s が %s 分以上 無応答。', e.name, ms.edge_offline_threshold_min)
        FROM stores s
        JOIN monitor_settings ms ON ms.store_id = s.id AND ms.enabled
        JOIN edge_devices e ON e.store_id = s.id
       WHERE s.tenant_id = v_tenant
         AND (ms.maintenance_until IS NULL OR ms.maintenance_until < now())
         AND (e.last_seen_at IS NULL
              OR e.last_seen_at < now() - make_interval(mins => ms.edge_offline_threshold_min))
      ON CONFLICT DO NOTHING;

      -- 復帰 → open/ack を resolve
      UPDATE monitor_incidents mi
         SET status = 'resolved', resolved_at = now()
        FROM edge_devices e
       WHERE mi.target_type = 'edge' AND mi.target_id = e.id
         AND mi.kind = 'edge_offline' AND mi.status IN ('open','ack')
         AND e.last_seen_at >= now() - make_interval(
               mins => (SELECT edge_offline_threshold_min FROM monitor_settings WHERE store_id = e.store_id));
    END IF;
  END LOOP;

  UPDATE monitor_settings SET last_swept_at = now() WHERE enabled;
END $$;

-- pg_cron 登録（拡張があれば）。無い環境ではスキップ（外部cron/手動 SELECT monitor_sweep_edges()）。
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('monitor_sweep_edges', '* * * * *', 'SELECT monitor_sweep_edges();');
    PERFORM cron.schedule('monitor_results_partition', '0 0 25 * *',
            'SELECT monitor_results_ensure_partition((now() + interval ''1 month'')::date);');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 8. RLS — 全テーブル テナントスコープ（auth_user_id パターン）
-- ---------------------------------------------------------------------------
ALTER TABLE monitor_settings    ENABLE ROW LEVEL SECURITY;
ALTER TABLE monitor_checks      ENABLE ROW LEVEL SECURITY;
ALTER TABLE monitor_results     ENABLE ROW LEVEL SECURITY;
ALTER TABLE monitor_daily_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE monitor_incidents   ENABLE ROW LEVEL SECURITY;
ALTER TABLE monitor_reports     ENABLE ROW LEVEL SECURITY;

-- store-scoped SELECT ポリシーの共通形を各テーブルへ
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['monitor_settings','monitor_checks','monitor_daily_stats','monitor_incidents','monitor_reports']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I;', t||'_select', t);
    EXECUTE format($f$
      CREATE POLICY %I ON %I FOR SELECT USING (
        EXISTS (
          SELECT 1 FROM admin_users u
          WHERE u.auth_user_id = auth.uid()
            AND (
              u.role = 'super_admin'
              OR EXISTS (
                SELECT 1 FROM stores s
                WHERE s.id = %I.store_id
                  AND (
                    (u.role = 'tenant_admin' AND s.tenant_id IN (
                      SELECT tenant_id FROM admin_users WHERE auth_user_id = auth.uid()))
                    OR %I.store_id = ANY(u.store_ids)
                  )
              )
            )
        )
      );$f$, t||'_select', t, t, t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON %I;', t||'_modify', t);
    EXECUTE format($f$
      CREATE POLICY %I ON %I FOR ALL USING (
        EXISTS (SELECT 1 FROM admin_users u
                WHERE u.auth_user_id = auth.uid()
                  AND u.role IN ('super_admin','tenant_admin','store_manager'))
      );$f$, t||'_modify', t);
  END LOOP;
END $$;

-- monitor_results は store_id 列で同様（パーティション親に付与）
DROP POLICY IF EXISTS "monitor_results_select" ON monitor_results;
CREATE POLICY "monitor_results_select" ON monitor_results FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM admin_users u
    WHERE u.auth_user_id = auth.uid()
      AND (u.role = 'super_admin'
        OR EXISTS (SELECT 1 FROM stores s WHERE s.id = monitor_results.store_id
              AND ((u.role='tenant_admin' AND s.tenant_id IN (SELECT tenant_id FROM admin_users WHERE auth_user_id = auth.uid()))
                   OR monitor_results.store_id = ANY(u.store_ids))))
  )
);
DROP POLICY IF EXISTS "monitor_results_modify" ON monitor_results;
CREATE POLICY "monitor_results_modify" ON monitor_results FOR ALL USING (
  EXISTS (SELECT 1 FROM admin_users u WHERE u.auth_user_id = auth.uid()
            AND u.role IN ('super_admin','tenant_admin','store_manager'))
);
