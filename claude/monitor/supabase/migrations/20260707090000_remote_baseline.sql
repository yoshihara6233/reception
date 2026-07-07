


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "cube" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "earthdistance" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."auth_role"() RETURNS "text"
    LANGUAGE "sql" STABLE
    AS $$
  SELECT (auth.jwt()->'raw_app_meta_data'->>'role')
$$;


ALTER FUNCTION "public"."auth_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."auth_tenant_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE
    AS $$
  SELECT ((auth.jwt()->'raw_app_meta_data'->>'tenant_id')::uuid)
$$;


ALTER FUNCTION "public"."auth_tenant_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."auth_user_role"() RETURNS "text"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT role FROM public.admin_users WHERE auth_user_id = auth.uid() LIMIT 1
$$;


ALTER FUNCTION "public"."auth_user_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."auth_user_store_ids"() RETURNS "uuid"[]
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT coalesce(store_ids, '{}'::uuid[]) FROM public.admin_users WHERE auth_user_id = auth.uid() LIMIT 1
$$;


ALTER FUNCTION "public"."auth_user_store_ids"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."auth_user_tenant_id"() RETURNS "uuid"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT tenant_id FROM public.admin_users WHERE auth_user_id = auth.uid() LIMIT 1
$$;


ALTER FUNCTION "public"."auth_user_tenant_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."bcp_check_clips_complete"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_pending_count int;
  v_event_status  text;
BEGIN
  -- Only act when upload_status actually changed
  IF TG_OP = 'UPDATE' AND OLD.upload_status = NEW.upload_status THEN
    RETURN NEW;
  END IF;

  -- Check if any clip for this event is still in a non-terminal state
  SELECT COUNT(*)
    INTO v_pending_count
    FROM bcp_clips
   WHERE event_id = NEW.event_id
     AND upload_status NOT IN ('completed','failed','skipped_ipro');

  IF v_pending_count = 0 THEN
    SELECT status INTO v_event_status FROM bcp_events WHERE id = NEW.event_id;

    -- Only advance if not already in a terminal state
    IF v_event_status NOT IN ('failed','completed') THEN
      UPDATE bcp_events
         SET status = 'clips_uploaded'
       WHERE id = NEW.event_id;
    END IF;
  END IF;

  RETURN NEW;
END $$;


ALTER FUNCTION "public"."bcp_check_clips_complete"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."bcp_sweep_pending_reports"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    WITH claimed AS (
      UPDATE bcp_events
         SET report_dispatched_at = now()
       WHERE status = 'clips_uploaded'
         AND (report_dispatched_at IS NULL
              OR report_dispatched_at < now() - interval '5 minutes')
      RETURNING id
    )
    SELECT id FROM claimed
  LOOP
    PERFORM invoke_bcp_report(r.id);
  END LOOP;
END $$;


ALTER FUNCTION "public"."bcp_sweep_pending_reports"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_live_sessions_partition"("p_start" "date") RETURNS "text"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  p_end     date := (p_start + interval '1 month')::date;
  part_name text := 'live_sessions_' || to_char(p_start, 'YYYYMM');
BEGIN
  -- (a) パーティション作成 (既存ならスキップ)
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.live_sessions ' ||
    'FOR VALUES FROM (%L) TO (%L)',
    part_name, p_start, p_end
  );

  -- (b) RLS を ON (Supabase advisor 対策)
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', part_name);

  RAISE NOTICE '[F56] Created partition % with RLS enabled', part_name;
  RETURN part_name;
END;
$$;


ALTER FUNCTION "public"."create_live_sessions_partition"("p_start" "date") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."create_live_sessions_partition"("p_start" "date") IS 'F56: live_sessions の月次パーティションを RLS 有効化付きで作成。';



CREATE OR REPLACE FUNCTION "public"."daily_session_minutes"("p_user_id" "uuid") RETURNS integer
    LANGUAGE "sql" STABLE
    AS $$
  SELECT COALESCE(
    SUM(
      EXTRACT(EPOCH FROM (COALESCE(ended_at, now()) - started_at)) / 60
    )::int,
    0
  )
  FROM live_sessions
  WHERE user_id = p_user_id
    AND started_at >= date_trunc('day', now())
$$;


ALTER FUNCTION "public"."daily_session_minutes"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."detect_unmatched_entries"("target_date" "date") RETURNS TABLE("tenant_id" "uuid", "store_id" "uuid", "subject_type" "text", "subject_id" "uuid")
    LANGUAGE "sql" SECURITY DEFINER
    AS $$
  SELECT DISTINCT
    eel_entry.tenant_id,
    eel_entry.store_id,
    eel_entry.subject_type,
    eel_entry.subject_id
  FROM entry_exit_logs eel_entry
  WHERE eel_entry.event_type = 'entry'
    AND eel_entry.work_date = target_date
    AND NOT EXISTS (
      SELECT 1
      FROM inspections i
      JOIN entry_exit_logs eel_exit
        ON i.exit_log_id = eel_exit.id
      WHERE eel_exit.subject_id   = eel_entry.subject_id
        AND eel_exit.subject_type = eel_entry.subject_type
        AND eel_exit.event_type   = 'exit'
        AND eel_exit.work_date    = target_date
    );
$$;


ALTER FUNCTION "public"."detect_unmatched_entries"("target_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."invoke_bcp_report"("p_event_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_url    text;
  v_secret text;
BEGIN
  SELECT decrypted_secret INTO v_url    FROM vault.decrypted_secrets WHERE name = 'app_url';
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'bcp_webhook_secret';

  IF v_url IS NULL OR v_secret IS NULL THEN
    RAISE NOTICE 'invoke_bcp_report: app_url / bcp_webhook_secret が Vault に未設定のためスキップ';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url     := v_url || '/api/bcp-webhook',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || v_secret
               ),
    body    := jsonb_build_object('eventId', p_event_id::text)
  );
END $$;


ALTER FUNCTION "public"."invoke_bcp_report"("p_event_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."invoke_jalert_poller"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_url text;
  v_key text;
BEGIN
  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'project_url';
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'service_role_key';

  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE NOTICE 'invoke_jalert_poller: project_url / service_role_key が Vault に未設定のためスキップ';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url     := v_url || '/functions/v1/jalert-poller',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || v_key
               ),
    body    := '{}'::jsonb
  );
END $$;


ALTER FUNCTION "public"."invoke_jalert_poller"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."monitor_results_ensure_partition"("p_month" "date") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_start date := date_trunc('month', p_month)::date;
  v_end   date := (date_trunc('month', p_month) + interval '1 month')::date;
  v_name  text := 'monitor_results_' || to_char(v_start, 'YYYYMM');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = v_name) THEN
    EXECUTE format(
      'CREATE TABLE public.%I PARTITION OF public.monitor_results FOR VALUES FROM (%L) TO (%L);',
      v_name, v_start, v_end);
  END IF;
  -- F56: 既存パーティションでも安全に ON にできる (冪等)
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', v_name);
END $$;


ALTER FUNCTION "public"."monitor_results_ensure_partition"("p_month" "date") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."monitor_results_ensure_partition"("p_month" "date") IS 'F56: monitor_results の月次パーティションを RLS 有効化付きで作成 (冪等)。';



CREATE OR REPLACE FUNCTION "public"."monitor_sweep_edges"() RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
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


ALTER FUNCTION "public"."monitor_sweep_edges"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."monitor_sweep_unattended_streams"() RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  -- heartbeat=60s。2拍の取りこぼしを許容して3分を失効閾値とする。
  v_stale_interval   interval := interval '3 minutes';
  -- LiveKit トークン TTL の上限(MAX_TTL_SECONDS=90分)＝配信の事実上の天井。
  -- これを超えると publish 自体が失効するので、それに合わせてセッションを打ち切る。
  v_max_session      interval := interval '90 minutes';
BEGIN
  -- Case 1: 死亡したエッジが配信状態のまま固着 → status を offline へ補正。
  UPDATE edge_devices
     SET status = 'offline',
         current_mode = NULL
   WHERE status IN ('grid','live','vod','bcp')
     AND (last_seen_at IS NULL OR last_seen_at < now() - v_stale_interval);

  -- Case 2: 生存中だが上限超過のセッション → stop_stream を発行し、停止した
  -- 行だけを監査記録する。データ変更CTE(RETURNING)で UPDATE 対象と監査行を
  -- 1対1に厳密対応させ、「直近にコマンドされた別の健全セッション」を誤って
  -- 自動停止扱いにしない。
  -- pending_command IS NULL ガードで未消費コマンドの上書きと再発行ループを防止。
  WITH stopped AS (
    UPDATE edge_devices
       SET pending_command = jsonb_build_object(
             'action',     'stop_stream',
             'request_id', gen_random_uuid()::text),
           pending_command_at = now()
     WHERE status IN ('grid','live','vod')
       AND last_seen_at >= now() - v_stale_interval          -- エッジは健在
       AND pending_command IS NULL                            -- 未消費コマンドなし
       AND pending_command_at IS NOT NULL
       AND pending_command_at < now() - v_max_session         -- セッション老朽化
    RETURNING id, store_id, status
  )
  -- 監査記録（情報レベル、即解決）。active 一覧を汚さないよう resolved で残す。
  -- uq_monitor_incidents_open は open/ack のみ対象なので resolved は重複しても可。
  INSERT INTO monitor_incidents(
    store_id, target_type, target_id, kind, severity, status, detail, resolved_at)
  SELECT store_id, 'edge', id, 'stream_autostopped', 'info', 'resolved',
         format('無人配信(%s)を自動停止（セッション上限%s分超過）。', status, 90),
         now()
    FROM stopped;
END $$;


ALTER FUNCTION "public"."monitor_sweep_unattended_streams"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_store_nvr_lifecycle"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF NEW.nvr_model IS NOT NULL AND (
       OLD.nvr_model IS DISTINCT FROM NEW.nvr_model
       OR NEW.nvr_eol_date IS NULL
       OR NEW.nvr_eos_date IS NULL
     ) THEN
    -- nvr_models から EOL/EOS を引いてくる (見つからなければ NULL のまま)
    SELECT eol_date, eos_date
      INTO NEW.nvr_eol_date, NEW.nvr_eos_date
      FROM nvr_models
     WHERE model_number = NEW.nvr_model
     LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."sync_store_nvr_lifecycle"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."touch_nvr_models_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."touch_nvr_models_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."touch_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;


ALTER FUNCTION "public"."touch_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trigger_analyze_inspection"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  edge_url TEXT := 'https://jmlviywilxzavjbmlpnf.supabase.co/functions/v1/analyze-inspection';
  svc_key  TEXT;
BEGIN
  IF NEW.ai_result <> 'pending' THEN
    RETURN NEW;
  END IF;

  -- Vault からサービスロールキーを取得
  SELECT decrypted_secret
    INTO svc_key
    FROM vault.decrypted_secrets
   WHERE name = 'service_role_key'
   LIMIT 1;

  IF svc_key IS NULL THEN
    RAISE WARNING 'Vault secret "service_role_key" not found — skipping Edge Function call';
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url     := edge_url,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || svc_key
    ),
    body    := jsonb_build_object('record', row_to_json(NEW))
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'analyze-inspection trigger error: %', SQLERRM;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."trigger_analyze_inspection"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."admin_audit_log" (
    "id" bigint NOT NULL,
    "ts" timestamp with time zone DEFAULT "now"() NOT NULL,
    "actor_user_id" "uuid",
    "action" "text" NOT NULL,
    "target_type" "text" NOT NULL,
    "target_id" "uuid",
    "store_id" "uuid",
    "changes" "jsonb"
);


ALTER TABLE "public"."admin_audit_log" OWNER TO "postgres";


ALTER TABLE "public"."admin_audit_log" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."admin_audit_log_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."admin_users" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "auth_user_id" "uuid" NOT NULL,
    "tenant_id" "uuid",
    "role" "text" DEFAULT 'viewer'::"text" NOT NULL,
    "store_ids" "uuid"[] DEFAULT '{}'::"uuid"[],
    "email" "text",
    "display_name" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "admin_users_role_check" CHECK (("role" = ANY (ARRAY['super_admin'::"text", 'tenant_admin'::"text", 'store_manager'::"text", 'viewer'::"text"])))
);


ALTER TABLE "public"."admin_users" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."alarm_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "store_id" "uuid",
    "camera_id" "uuid",
    "source" "text" NOT NULL,
    "event_type" "text",
    "occurred_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "snapshot_url" "text",
    "clip_url" "text",
    "status" "text" DEFAULT 'new'::"text" NOT NULL,
    "dedup_key" "text",
    "notified_at" timestamp with time zone,
    "reviewed_by" "uuid",
    "reviewed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "timeline_dispatched_at" timestamp with time zone,
    CONSTRAINT "alarm_events_status_check" CHECK (("status" = ANY (ARRAY['new'::"text", 'ack'::"text", 'closed'::"text"])))
);


ALTER TABLE "public"."alarm_events" OWNER TO "postgres";


COMMENT ON COLUMN "public"."alarm_events"."timeline_dispatched_at" IS 'capture_alarm_timeline をエッジへディスパッチできた時刻。NULL＝未ディスパッチ（cron が直近分を再送）';



CREATE TABLE IF NOT EXISTS "public"."alarm_frames" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "alarm_event_id" "uuid" NOT NULL,
    "camera_id" "uuid",
    "offset_sec" integer NOT NULL,
    "storage_path" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "source" "text",
    "captured_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "alarm_frames_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'completed'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."alarm_frames" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."alarm_settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "store_id" "uuid",
    "enabled" boolean DEFAULT false NOT NULL,
    "sources" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "event_types" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "debounce_sec" integer DEFAULT 30 NOT NULL,
    "dedup_window_sec" integer DEFAULT 120 NOT NULL,
    "quiet_from" "text",
    "quiet_to" "text",
    "notify_emails" "text"[],
    "notify_webhook_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "alarm_settings_debounce_sec_check" CHECK (("debounce_sec" >= 0)),
    CONSTRAINT "alarm_settings_dedup_window_sec_check" CHECK (("dedup_window_sec" >= 0))
);


ALTER TABLE "public"."alarm_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."alert_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "inspection_id" "uuid" NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "store_id" "uuid" NOT NULL,
    "channel" "text" NOT NULL,
    "sent_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "payload" "jsonb",
    CONSTRAINT "alert_logs_channel_check" CHECK (("channel" = ANY (ARRAY['line'::"text", 'email'::"text"])))
);


ALTER TABLE "public"."alert_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bcp_clips" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_id" "uuid",
    "camera_id" "uuid",
    "clip_from" timestamp with time zone NOT NULL,
    "clip_to" timestamp with time zone NOT NULL,
    "clip_url" "text",
    "thumbnail_url" "text",
    "duration_sec" integer,
    "upload_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "offset_min" integer,
    "storage_path" "text",
    CONSTRAINT "bcp_clips_upload_status_check" CHECK (("upload_status" = ANY (ARRAY['pending'::"text", 'uploading'::"text", 'completed'::"text", 'failed'::"text", 'skipped_ipro'::"text"])))
);


ALTER TABLE "public"."bcp_clips" OWNER TO "postgres";


COMMENT ON COLUMN "public"."bcp_clips"."offset_min" IS 'F40: snapshot offset in minutes from alert_issued_at. NULL for legacy video clips. New rows: -5, 0, 5, 10, 15, 20, 25, 30.';



COMMENT ON COLUMN "public"."bcp_clips"."storage_path" IS 'F76: Storage object key inside the bcp-clips bucket (e.g. "<eventId>/<cameraId>/+05_20260606_073012.jpg"). The signed-URL workflow reads this; clip_url / thumbnail_url remain as legacy fallbacks.';



CREATE TABLE IF NOT EXISTS "public"."bcp_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "store_id" "uuid",
    "alert_source" "text",
    "alert_type" "text",
    "alert_issued_at" timestamp with time zone NOT NULL,
    "area_code" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "is_test" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "report_dispatched_at" timestamp with time zone,
    CONSTRAINT "bcp_events_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'recording'::"text", 'clips_uploaded'::"text", 'report_generated'::"text", 'completed'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."bcp_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bcp_reports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_id" "uuid",
    "pdf_url" "text",
    "generated_at" timestamp with time zone,
    "sent_to_emails" "text"[],
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."bcp_reports" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bcp_settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "store_id" "uuid",
    "pre_minutes" integer DEFAULT 3 NOT NULL,
    "post_minutes" integer DEFAULT 5 NOT NULL,
    "notify_emails" "text"[],
    "enabled" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "quake_min_intensity" "text" DEFAULT '5+'::"text" NOT NULL,
    "tsunami_enabled" boolean DEFAULT true NOT NULL,
    "missile_enabled" boolean DEFAULT true NOT NULL,
    "snapshot_offsets" smallint[] DEFAULT '{-5,5}'::smallint[] NOT NULL,
    CONSTRAINT "bcp_settings_post_minutes_check" CHECK ((("post_minutes" >= 1) AND ("post_minutes" <= 30))),
    CONSTRAINT "bcp_settings_pre_minutes_check" CHECK ((("pre_minutes" >= 1) AND ("pre_minutes" <= 10))),
    CONSTRAINT "bcp_settings_quake_min_intensity_check" CHECK (("quake_min_intensity" = ANY (ARRAY['1'::"text", '2'::"text", '3'::"text", '4'::"text", '5-'::"text", '5+'::"text", '6-'::"text", '6+'::"text", '7'::"text"]))),
    CONSTRAINT "bcp_settings_snapshot_offsets_chk" CHECK ((("array_length"("snapshot_offsets", 1) >= 1) AND ("snapshot_offsets" <@ ARRAY[('-5'::integer)::smallint, (0)::smallint, (5)::smallint, (10)::smallint, (15)::smallint, (20)::smallint, (25)::smallint, (30)::smallint])))
);


ALTER TABLE "public"."bcp_settings" OWNER TO "postgres";


COMMENT ON COLUMN "public"."bcp_settings"."snapshot_offsets" IS 'BCPレポートで撮影するオフセット（発令からの分）。既定 {-5,5}。許可値 {-5,0,5,10,15,20,25,30} の部分集合。';



CREATE TABLE IF NOT EXISTS "public"."central_nodes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "hostname" "text" NOT NULL,
    "region" "text",
    "capacity_stores" integer DEFAULT 5000 NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "lease_held_until" timestamp with time zone,
    "last_heartbeat" timestamp with time zone,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "central_nodes_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'draining'::"text", 'down'::"text"])))
);


ALTER TABLE "public"."central_nodes" OWNER TO "postgres";


COMMENT ON TABLE "public"."central_nodes" IS '中央集約モードで稼働中のエージェントノード。HA (active-active) 時は複数行';



CREATE TABLE IF NOT EXISTS "public"."consent_documents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "store_id" "uuid",
    "version" integer NOT NULL,
    "text" "text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."consent_documents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."edge_devices" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "store_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "device_token" "text" NOT NULL,
    "agent_version" "text",
    "status" "text" DEFAULT 'offline'::"text" NOT NULL,
    "current_mode" "text",
    "last_seen_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "pending_command" "jsonb",
    "pending_command_at" timestamp with time zone,
    "go2rtc_host" "text",
    "alerted_at" timestamp with time zone,
    "camera_tier" integer DEFAULT 16 NOT NULL,
    "auth_user_id" "uuid",
    "auth_password_enc" "text",
    "cloudflared_version" "text",
    "desired_agent_version" "text",
    "desired_cloudflared_version" "text",
    "ota_status" "text",
    "ota_updated_at" timestamp with time zone,
    "ota_last_error" "text",
    CONSTRAINT "edge_devices_camera_tier_check" CHECK (("camera_tier" = ANY (ARRAY[16, 32, 48]))),
    CONSTRAINT "edge_devices_status_check" CHECK (("status" = ANY (ARRAY['offline'::"text", 'idle'::"text", 'grid'::"text", 'live'::"text", 'vod'::"text", 'error'::"text", 'bcp'::"text", 'security'::"text", 'alarm'::"text"])))
);


ALTER TABLE "public"."edge_devices" OWNER TO "postgres";


COMMENT ON COLUMN "public"."edge_devices"."auth_user_id" IS 'このエッジ専用 Supabase Auth ユーザの id。bootstrap が signInWithPassword でトークン発行に使う。';



COMMENT ON COLUMN "public"."edge_devices"."auth_password_enc" IS 'エッジ auth ユーザのパスワード(AES-256-GCM 封筒暗号 enc:v1:…)。DBには平文を持たない。';



CREATE TABLE IF NOT EXISTS "public"."edge_jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "edge_id" "uuid" NOT NULL,
    "kind" "text" NOT NULL,
    "params" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "result" "jsonb",
    "error" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "edge_jobs_kind_check" CHECK (("kind" = ANY (ARRAY['onvif_discovery'::"text", 'connection_test'::"text"]))),
    CONSTRAINT "edge_jobs_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'running'::"text", 'done'::"text", 'error'::"text"])))
);


ALTER TABLE "public"."edge_jobs" OWNER TO "postgres";


COMMENT ON TABLE "public"."edge_jobs" IS '本部→エッジ非同期ジョブ(ONVIF探索/接続テスト)。service_role=全可。 authenticated(エッジ scoped トークン)=自分の edge_id 行のみ SELECT/UPDATE(Phase B1)。';



CREATE TABLE IF NOT EXISTS "public"."employees" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "store_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "qr_code" "text" NOT NULL,
    "photo_url" "text",
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "employees_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'inactive'::"text"])))
);


ALTER TABLE "public"."employees" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."enrollment_tokens" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "token_hash" "text" NOT NULL,
    "store_id" "uuid" NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "camera_tier" integer DEFAULT 16 NOT NULL,
    "edge_id" "uuid",
    "expires_at" timestamp with time zone NOT NULL,
    "used_at" timestamp with time zone,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "enrollment_tokens_camera_tier_check" CHECK (("camera_tier" = ANY (ARRAY[16, 32, 48])))
);


ALTER TABLE "public"."enrollment_tokens" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."entry_exit_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "store_id" "uuid" NOT NULL,
    "inspector_id" "uuid" NOT NULL,
    "subject_type" "text" NOT NULL,
    "subject_id" "uuid" NOT NULL,
    "event_type" "text" NOT NULL,
    "work_date" "date" NOT NULL,
    "consent_at" timestamp with time zone,
    "consent_type" "text",
    "consent_document_version_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "entry_exit_logs_consent_type_check" CHECK (("consent_type" = ANY (ARRAY['initial'::"text", 'repeated'::"text", 'visitor_per_visit'::"text"]))),
    CONSTRAINT "entry_exit_logs_event_type_check" CHECK (("event_type" = ANY (ARRAY['entry'::"text", 'exit'::"text"]))),
    CONSTRAINT "entry_exit_logs_subject_type_check" CHECK (("subject_type" = ANY (ARRAY['employee'::"text", 'visitor'::"text"])))
);


ALTER TABLE "public"."entry_exit_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."inspections" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "store_id" "uuid" NOT NULL,
    "inspector_id" "uuid" NOT NULL,
    "exit_log_id" "uuid",
    "subject_type" "text" NOT NULL,
    "subject_id" "uuid" NOT NULL,
    "photo1_url" "text" NOT NULL,
    "photo2_url" "text" NOT NULL,
    "ai_result" "text" DEFAULT 'pending'::"text" NOT NULL,
    "ai_reason" "text",
    "retry_count" integer DEFAULT 0 NOT NULL,
    "alert_sent_at" timestamp with time zone,
    "alert_resolved_at" timestamp with time zone,
    "alert_resolution" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "inspections_ai_result_check" CHECK (("ai_result" = ANY (ARRAY['pass'::"text", 'fail'::"text", 'pending'::"text", 'review_required'::"text"]))),
    CONSTRAINT "inspections_alert_resolution_check" CHECK (("alert_resolution" = ANY (ARRAY['false_positive'::"text", 'reinspected'::"text"]))),
    CONSTRAINT "inspections_subject_type_check" CHECK (("subject_type" = ANY (ARRAY['employee'::"text", 'visitor'::"text"])))
);


ALTER TABLE "public"."inspections" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."jalert_receipts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "alert_source" "text" NOT NULL,
    "alert_type" "text",
    "title" "text",
    "area_codes" "text"[],
    "max_intensity" "text",
    "alert_issued_at" timestamp with time zone,
    "received_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "matched_store_count" integer DEFAULT 0 NOT NULL,
    "detail_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."jalert_receipts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."live_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "store_id" "uuid" NOT NULL,
    "camera_id" "uuid",
    "mode" "text" NOT NULL,
    "livekit_room" "text",
    "vod_from" timestamp with time zone,
    "vod_to" timestamp with time zone,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ended_at" timestamp with time zone,
    "duration_sec" integer,
    CONSTRAINT "live_sessions_mode_check" CHECK (("mode" = ANY (ARRAY['grid'::"text", 'live'::"text", 'vod'::"text"])))
)
PARTITION BY RANGE ("started_at");


ALTER TABLE "public"."live_sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."live_sessions_202606" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "store_id" "uuid" NOT NULL,
    "camera_id" "uuid",
    "mode" "text" NOT NULL,
    "livekit_room" "text",
    "vod_from" timestamp with time zone,
    "vod_to" timestamp with time zone,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ended_at" timestamp with time zone,
    "duration_sec" integer,
    CONSTRAINT "live_sessions_mode_check" CHECK (("mode" = ANY (ARRAY['grid'::"text", 'live'::"text", 'vod'::"text"])))
);


ALTER TABLE "public"."live_sessions_202606" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."live_sessions_202607" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "store_id" "uuid" NOT NULL,
    "camera_id" "uuid",
    "mode" "text" NOT NULL,
    "livekit_room" "text",
    "vod_from" timestamp with time zone,
    "vod_to" timestamp with time zone,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ended_at" timestamp with time zone,
    "duration_sec" integer,
    CONSTRAINT "live_sessions_mode_check" CHECK (("mode" = ANY (ARRAY['grid'::"text", 'live'::"text", 'vod'::"text"])))
);


ALTER TABLE "public"."live_sessions_202607" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."metric_events" (
    "id" bigint NOT NULL,
    "ts" timestamp with time zone DEFAULT "now"() NOT NULL,
    "kind" "text" NOT NULL,
    "store_id" "uuid",
    "edge_id" "uuid",
    "camera_id" "uuid",
    "user_id" "uuid",
    "value" double precision,
    "meta" "jsonb"
);


ALTER TABLE "public"."metric_events" OWNER TO "postgres";


ALTER TABLE "public"."metric_events" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."metric_events_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."monitor_checks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "store_id" "uuid",
    "target_type" "text" NOT NULL,
    "target_id" "uuid" NOT NULL,
    "check_type" "text" NOT NULL,
    "interval_min" integer DEFAULT 5 NOT NULL,
    "enabled" boolean DEFAULT true NOT NULL,
    "consec_fail" integer DEFAULT 0 NOT NULL,
    "consec_ok" integer DEFAULT 0 NOT NULL,
    "first_failed_at" timestamp with time zone,
    "last_run_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "monitor_checks_check_type_check" CHECK (("check_type" = ANY (ARRAY['heartbeat'::"text", 'ping'::"text", 'probe_camera'::"text", 'storage'::"text", 'recording_gap'::"text", 'ntp'::"text", 'tamper'::"text", 'version'::"text"]))),
    CONSTRAINT "monitor_checks_target_type_check" CHECK (("target_type" = ANY (ARRAY['edge'::"text", 'recorder'::"text", 'camera'::"text"])))
);


ALTER TABLE "public"."monitor_checks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."monitor_daily_stats" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "store_id" "uuid",
    "target_type" "text",
    "target_id" "uuid",
    "day" "date" NOT NULL,
    "checks" integer DEFAULT 0 NOT NULL,
    "fail_count" integer DEFAULT 0 NOT NULL,
    "uptime_pct" numeric,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."monitor_daily_stats" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."monitor_incidents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "store_id" "uuid",
    "target_type" "text" NOT NULL,
    "target_id" "uuid",
    "kind" "text" NOT NULL,
    "severity" "text" DEFAULT 'warn'::"text" NOT NULL,
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "detail" "text",
    "opened_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "acked_by" "uuid",
    "acked_at" timestamp with time zone,
    "resolved_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "monitor_incidents_severity_check" CHECK (("severity" = ANY (ARRAY['info'::"text", 'warn'::"text", 'danger'::"text"]))),
    CONSTRAINT "monitor_incidents_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'ack'::"text", 'resolved'::"text"]))),
    CONSTRAINT "monitor_incidents_target_type_check" CHECK (("target_type" = ANY (ARRAY['edge'::"text", 'recorder'::"text", 'camera'::"text", 'tenant'::"text"])))
);


ALTER TABLE "public"."monitor_incidents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."monitor_reports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "store_id" "uuid",
    "kind" "text" NOT NULL,
    "period_from" timestamp with time zone NOT NULL,
    "period_to" timestamp with time zone NOT NULL,
    "pdf_url" "text",
    "generated_at" timestamp with time zone,
    "sent_to_emails" "text"[],
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "monitor_reports_kind_check" CHECK (("kind" = ANY (ARRAY['daily'::"text", 'weekly'::"text", 'monthly'::"text"])))
);


ALTER TABLE "public"."monitor_reports" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."monitor_results" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "check_id" "uuid",
    "store_id" "uuid",
    "target_type" "text",
    "target_id" "uuid",
    "status" "text" NOT NULL,
    "latency_ms" integer,
    "detail" "jsonb",
    "measured_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "monitor_results_status_check" CHECK (("status" = ANY (ARRAY['ok'::"text", 'warn'::"text", 'fail'::"text"])))
)
PARTITION BY RANGE ("measured_at");


ALTER TABLE "public"."monitor_results" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."monitor_results_202606" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "check_id" "uuid",
    "store_id" "uuid",
    "target_type" "text",
    "target_id" "uuid",
    "status" "text" NOT NULL,
    "latency_ms" integer,
    "detail" "jsonb",
    "measured_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "monitor_results_status_check" CHECK (("status" = ANY (ARRAY['ok'::"text", 'warn'::"text", 'fail'::"text"])))
);


ALTER TABLE "public"."monitor_results_202606" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."monitor_results_202607" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "check_id" "uuid",
    "store_id" "uuid",
    "target_type" "text",
    "target_id" "uuid",
    "status" "text" NOT NULL,
    "latency_ms" integer,
    "detail" "jsonb",
    "measured_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "monitor_results_status_check" CHECK (("status" = ANY (ARRAY['ok'::"text", 'warn'::"text", 'fail'::"text"])))
);


ALTER TABLE "public"."monitor_results_202607" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."monitor_settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "store_id" "uuid",
    "edge_offline_threshold_min" integer DEFAULT 5 NOT NULL,
    "check_interval_min" integer DEFAULT 5 NOT NULL,
    "business_hours" "jsonb",
    "fail_threshold" integer DEFAULT 3 NOT NULL,
    "ok_threshold" integer DEFAULT 2 NOT NULL,
    "fail_minutes_cap" integer DEFAULT 15 NOT NULL,
    "notify_emails" "text"[],
    "maintenance_until" timestamp with time zone,
    "enabled" boolean DEFAULT true NOT NULL,
    "last_swept_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "monitor_settings_check_interval_min_check" CHECK ((("check_interval_min" >= 1) AND ("check_interval_min" <= 1440))),
    CONSTRAINT "monitor_settings_edge_offline_threshold_min_check" CHECK ((("edge_offline_threshold_min" >= 1) AND ("edge_offline_threshold_min" <= 1440))),
    CONSTRAINT "monitor_settings_fail_threshold_check" CHECK ((("fail_threshold" >= 1) AND ("fail_threshold" <= 20))),
    CONSTRAINT "monitor_settings_ok_threshold_check" CHECK ((("ok_threshold" >= 1) AND ("ok_threshold" <= 20)))
);


ALTER TABLE "public"."monitor_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."nvr_models" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vendor" "text" NOT NULL,
    "model_family" "text" NOT NULL,
    "model_number" "text" NOT NULL,
    "display_name" "text" NOT NULL,
    "released_at" "date",
    "eol_announced_at" "date",
    "eol_date" "date",
    "eos_date" "date",
    "max_channels" integer,
    "max_resolution" "text",
    "source_url" "text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."nvr_models" OWNER TO "postgres";


COMMENT ON TABLE "public"."nvr_models" IS 'NVR 機種カタログ。stores.nvr_model から EOL/EOS を引いてくる参照ソース';



CREATE TABLE IF NOT EXISTS "public"."patrol_findings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "run_id" "uuid",
    "camera_id" "uuid",
    "snapshot_url" "text",
    "diff_score" numeric,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "ai_status" "text" DEFAULT 'none'::"text" NOT NULL,
    "ai_verdict" "text",
    "ai_reason" "text",
    "ai_confidence" numeric,
    "reviewed_by" "uuid",
    "reviewed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "patrol_findings_ai_status_check" CHECK (("ai_status" = ANY (ARRAY['none'::"text", 'pending'::"text", 'done'::"text", 'error'::"text", 'skipped'::"text"]))),
    CONSTRAINT "patrol_findings_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'normal'::"text", 'anomaly'::"text", 'review'::"text", 'confirmed'::"text", 'false_positive'::"text"])))
);


ALTER TABLE "public"."patrol_findings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."patrol_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "store_id" "uuid",
    "trigger" "text" DEFAULT 'scheduled'::"text" NOT NULL,
    "scheduled_for" timestamp with time zone,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "patrol_runs_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'capturing'::"text", 'analyzing'::"text", 'done'::"text", 'failed'::"text"]))),
    CONSTRAINT "patrol_runs_trigger_check" CHECK (("trigger" = ANY (ARRAY['scheduled'::"text", 'manual'::"text", 'emergency'::"text"])))
);


ALTER TABLE "public"."patrol_runs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."recorder_cameras" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "recorder_id" "uuid" NOT NULL,
    "channel" integer NOT NULL,
    "name" "text" NOT NULL,
    "grid_pos" integer NOT NULL,
    "enabled" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "frigate_camera" "text",
    "hls_url" "text",
    "live_rtsp" "text",
    CONSTRAINT "recorder_cameras_channel_check" CHECK ((("channel" >= 1) AND ("channel" <= 64))),
    CONSTRAINT "recorder_cameras_grid_pos_check" CHECK ((("grid_pos" >= 0) AND ("grid_pos" <= 47)))
);


ALTER TABLE "public"."recorder_cameras" OWNER TO "postgres";


COMMENT ON COLUMN "public"."recorder_cameras"."frigate_camera" IS 'Frigate re-stream name (e.g. "camera_01"). Required when recorder.vendor=''frigate''. If NULL, edge-agent derives name from channel number.';



CREATE TABLE IF NOT EXISTS "public"."recorders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "edge_id" "uuid" NOT NULL,
    "vendor" "text" NOT NULL,
    "model" "text",
    "host" "text" NOT NULL,
    "rtsp_port" integer DEFAULT 554 NOT NULL,
    "onvif_port" integer,
    "username" "text" NOT NULL,
    "password_enc" "text" NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "live_host" "text",
    "vod_host" "text",
    "vod_username" "text",
    "vod_password_enc" "text",
    "vod_channel" integer,
    CONSTRAINT "recorders_vendor_check" CHECK (("vendor" = ANY (ARRAY['ipro'::"text", 'uniview'::"text", 'frigate'::"text", 'onvif-generic'::"text", 'i-pro-nvr'::"text"])))
);


ALTER TABLE "public"."recorders" OWNER TO "postgres";


COMMENT ON COLUMN "public"."recorders"."live_host" IS 'F80: External (LAN) host:port that the BROWSER uses to reach this NVR''s live UI iframe (e.g. "192.168.0.100:5000" for Frigate). Different from `host`, which is the edge-agent''s perspective (often 127.0.0.1). NULL = no iframe mode, browser falls back to JPEG polling (BCP-friendly).';



CREATE TABLE IF NOT EXISTS "public"."security_camera_config" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "camera_id" "uuid",
    "baseline_day_url" "text",
    "baseline_night_url" "text",
    "ai_prompt" "text",
    "sensitivity" numeric DEFAULT 0.30 NOT NULL,
    "patrol_enabled" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "security_camera_config_sensitivity_check" CHECK ((("sensitivity" >= (0)::numeric) AND ("sensitivity" <= (1)::numeric)))
);


ALTER TABLE "public"."security_camera_config" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."security_reports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "store_id" "uuid",
    "period_from" timestamp with time zone NOT NULL,
    "period_to" timestamp with time zone NOT NULL,
    "pdf_url" "text",
    "generated_at" timestamp with time zone,
    "sent_to_emails" "text"[],
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."security_reports" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."security_settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "store_id" "uuid",
    "patrol_interval_min" integer DEFAULT 240 NOT NULL,
    "business_hours" "jsonb",
    "ai_enabled" boolean DEFAULT false NOT NULL,
    "ai_daily_cap" integer DEFAULT 200 NOT NULL,
    "notify_emails" "text"[],
    "report_show_verification" boolean DEFAULT true NOT NULL,
    "enabled" boolean DEFAULT true NOT NULL,
    "last_run_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "schedule_mode" "text" DEFAULT 'interval'::"text" NOT NULL,
    "active_from" "text" DEFAULT '00:00'::"text" NOT NULL,
    "active_to" "text" DEFAULT '24:00'::"text" NOT NULL,
    "active_days" integer[] DEFAULT '{0,1,2,3,4,5,6}'::integer[] NOT NULL,
    "patrol_times" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    CONSTRAINT "security_settings_ai_daily_cap_check" CHECK (("ai_daily_cap" >= 0)),
    CONSTRAINT "security_settings_patrol_interval_min_check" CHECK ((("patrol_interval_min" >= 1) AND ("patrol_interval_min" <= 1440))),
    CONSTRAINT "security_settings_schedule_mode_check" CHECK (("schedule_mode" = ANY (ARRAY['interval'::"text", 'fixed'::"text"])))
);


ALTER TABLE "public"."security_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."session_limits" (
    "tenant_id" "uuid" NOT NULL,
    "max_concurrent" integer DEFAULT 5 NOT NULL,
    "max_daily_min" integer DEFAULT 120 NOT NULL,
    "idle_timeout_s" integer DEFAULT 300 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."session_limits" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."stores" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "line_channel_id" "text",
    "alert_email" "text",
    "default_visitor_mode" "text" DEFAULT 'entry_only'::"text" NOT NULL,
    "ai_inspection_mode" "text" DEFAULT 'every_time'::"text" NOT NULL,
    "ai_inspection_rate" integer DEFAULT 100 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "address" "text",
    "latitude" numeric(9,6),
    "longitude" numeric(9,6),
    "area_code" "text",
    "geocoded_at" timestamp with time zone,
    "deployment_mode" "text" DEFAULT 'per_store_minipc'::"text" NOT NULL,
    "nvr_vendor" "text",
    "nvr_model" "text",
    "nvr_endpoint" "text",
    "nvr_credentials_ref" "uuid",
    "nvr_options" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "central_node_id" "uuid",
    "nvr_installed_at" "date",
    "nvr_fw_version" "text",
    "nvr_fw_detected_at" timestamp with time zone,
    "nvr_eol_date" "date",
    "nvr_eos_date" "date",
    "nvr_replace_by" "date" GENERATED ALWAYS AS (LEAST(COALESCE("nvr_eos_date", '9999-12-31'::"date"), (COALESCE(("nvr_installed_at" + '7 years'::interval), ('9999-12-31'::"date")::timestamp without time zone))::"date")) STORED,
    "heartbeat_override_sec" integer,
    "is_active" boolean DEFAULT true NOT NULL,
    "timezone" "text" DEFAULT 'Asia/Tokyo'::"text",
    CONSTRAINT "stores_ai_inspection_mode_check" CHECK (("ai_inspection_mode" = ANY (ARRAY['every_time'::"text", 'spot_check'::"text", 'monthly_per_person'::"text"]))),
    CONSTRAINT "stores_ai_inspection_rate_check" CHECK ((("ai_inspection_rate" >= 1) AND ("ai_inspection_rate" <= 100))),
    CONSTRAINT "stores_default_visitor_mode_check" CHECK (("default_visitor_mode" = ANY (ARRAY['entry_only'::"text", 'entry_with_inspection'::"text"]))),
    CONSTRAINT "stores_deployment_mode_check" CHECK (("deployment_mode" = ANY (ARRAY['per_store_minipc'::"text", 'central_aggregator'::"text"]))),
    CONSTRAINT "stores_heartbeat_override_sec_check" CHECK ((("heartbeat_override_sec" IS NULL) OR (("heartbeat_override_sec" >= 30) AND ("heartbeat_override_sec" <= 86400))))
);


ALTER TABLE "public"."stores" OWNER TO "postgres";


COMMENT ON COLUMN "public"."stores"."deployment_mode" IS 'per_store_minipc: 各店 Mini PC + Frigate / central_aggregator: 中央サーバが NVR を直接操作';



COMMENT ON COLUMN "public"."stores"."nvr_vendor" IS 'NVR ベンダー識別子。adapter registry の key と一致。frigate は per_store_minipc 互換';



COMMENT ON COLUMN "public"."stores"."nvr_model" IS '機種番号 (例: WJ-NX300K)。nvr_models.model_number から EOL/EOS を引いてくる';



COMMENT ON COLUMN "public"."stores"."nvr_endpoint" IS 'NVR の HTTP/HTTPS エンドポイント (例: https://10.0.1.5:8443)';



COMMENT ON COLUMN "public"."stores"."nvr_credentials_ref" IS 'Supabase Vault または環境変数の認証情報への参照 ID';



COMMENT ON COLUMN "public"."stores"."nvr_options" IS 'ベンダー固有の追加設定 (例: {"cgi_path": "/cgi-bin", "rtsp_transport": "tcp"})';



COMMENT ON COLUMN "public"."stores"."central_node_id" IS 'central_aggregator モード時にこの店舗を担当する central_nodes.id';



COMMENT ON COLUMN "public"."stores"."nvr_installed_at" IS '店舗への NVR 導入日';



COMMENT ON COLUMN "public"."stores"."nvr_fw_version" IS '直近で検出された FW バージョン (例: 3.42-0001)';



COMMENT ON COLUMN "public"."stores"."nvr_eol_date" IS '生産終了 (End of Life) 予定';



COMMENT ON COLUMN "public"."stores"."nvr_eos_date" IS 'サポート終了 (End of Service) 予定';



COMMENT ON COLUMN "public"."stores"."nvr_replace_by" IS 'EOS と「導入 + 7年運用ルール」の早い方。自動計算 (GENERATED ALWAYS)';



COMMENT ON COLUMN "public"."stores"."heartbeat_override_sec" IS 'NULL: deployment_mode のデフォルトを使う / 値あり: 個別に上書き (秒)。30〜86400 の範囲';



CREATE TABLE IF NOT EXISTS "public"."tenants" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "plan" "text" DEFAULT 'trial'::"text" NOT NULL,
    "status" "text" DEFAULT 'trial'::"text" NOT NULL,
    "stripe_customer_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "slug" "text",
    CONSTRAINT "tenants_plan_check" CHECK (("plan" = ANY (ARRAY['starter'::"text", 'standard'::"text", 'enterprise'::"text"]))),
    CONSTRAINT "tenants_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'suspended'::"text", 'trial'::"text"])))
);


ALTER TABLE "public"."tenants" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."unmatch_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "store_id" "uuid" NOT NULL,
    "subject_type" "text" NOT NULL,
    "subject_id" "uuid" NOT NULL,
    "unmatch_type" "text" NOT NULL,
    "target_date" "date" NOT NULL,
    "notified_at" timestamp with time zone,
    "resolved_at" timestamp with time zone,
    "resolved_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "unmatch_logs_subject_type_check" CHECK (("subject_type" = ANY (ARRAY['employee'::"text", 'visitor'::"text"]))),
    CONSTRAINT "unmatch_logs_unmatch_type_check" CHECK (("unmatch_type" = ANY (ARRAY['exit_missing'::"text", 'entry_missing'::"text"])))
);


ALTER TABLE "public"."unmatch_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" "uuid" NOT NULL,
    "tenant_id" "uuid",
    "store_id" "uuid",
    "role" "text" NOT NULL,
    "email" "text" NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "users_role_check" CHECK (("role" = ANY (ARRAY['saas_admin'::"text", 'tenant_admin'::"text", 'store_manager'::"text", 'inspector'::"text"])))
);


ALTER TABLE "public"."users" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_heartbeat_rollout_status" WITH ("security_invoker"='true') AS
 SELECT "deployment_mode",
        CASE
            WHEN ("heartbeat_override_sec" IS NOT NULL) THEN "heartbeat_override_sec"
            WHEN ("deployment_mode" = 'central_aggregator'::"text") THEN 21600
            WHEN ("deployment_mode" = 'per_store_minipc'::"text") THEN 60
            ELSE 60
        END AS "effective_interval_sec",
    ("heartbeat_override_sec" IS NOT NULL) AS "has_override",
    "count"(*) AS "store_count"
   FROM "public"."stores" "s"
  GROUP BY "deployment_mode",
        CASE
            WHEN ("heartbeat_override_sec" IS NOT NULL) THEN "heartbeat_override_sec"
            WHEN ("deployment_mode" = 'central_aggregator'::"text") THEN 21600
            WHEN ("deployment_mode" = 'per_store_minipc'::"text") THEN 60
            ELSE 60
        END, ("heartbeat_override_sec" IS NOT NULL)
  ORDER BY "deployment_mode",
        CASE
            WHEN ("heartbeat_override_sec" IS NOT NULL) THEN "heartbeat_override_sec"
            WHEN ("deployment_mode" = 'central_aggregator'::"text") THEN 21600
            WHEN ("deployment_mode" = 'per_store_minipc'::"text") THEN 60
            ELSE 60
        END;


ALTER VIEW "public"."v_heartbeat_rollout_status" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_heartbeat_rollout_status" IS 'F51.B: ハートビート間隔の分布状況。/infra/slo や rollout CLI から参照 (F57: security_invoker = true)';



CREATE OR REPLACE VIEW "public"."v_store_nvr_lifecycle" WITH ("security_invoker"='true') AS
 SELECT "id" AS "store_id",
    "name" AS "store_name",
    "deployment_mode",
    "nvr_vendor",
    "nvr_model",
    "nvr_fw_version",
    "nvr_fw_detected_at",
    "nvr_installed_at",
    "nvr_eol_date",
    "nvr_eos_date",
    "nvr_replace_by",
        CASE
            WHEN ("nvr_eos_date" IS NOT NULL) THEN (((EXTRACT(year FROM "age"(("nvr_eos_date")::timestamp with time zone, (CURRENT_DATE)::timestamp with time zone)) * (12)::numeric) + EXTRACT(month FROM "age"(("nvr_eos_date")::timestamp with time zone, (CURRENT_DATE)::timestamp with time zone))))::integer
            ELSE NULL::integer
        END AS "months_until_eos",
        CASE
            WHEN ("nvr_installed_at" IS NOT NULL) THEN (EXTRACT(year FROM "age"((CURRENT_DATE)::timestamp with time zone, ("nvr_installed_at")::timestamp with time zone)))::integer
            ELSE NULL::integer
        END AS "years_in_service",
        CASE
            WHEN ("nvr_replace_by" IS NOT NULL) THEN (((EXTRACT(year FROM "age"(("nvr_replace_by")::timestamp with time zone, (CURRENT_DATE)::timestamp with time zone)) * (12)::numeric) + EXTRACT(month FROM "age"(("nvr_replace_by")::timestamp with time zone, (CURRENT_DATE)::timestamp with time zone))))::integer
            ELSE NULL::integer
        END AS "months_until_replace_by",
        CASE
            WHEN (("nvr_installed_at" IS NULL) OR ("nvr_eos_date" IS NULL)) THEN 'nvr_lifecycle_unknown'::"text"
            WHEN (CURRENT_DATE > "nvr_eos_date") THEN 'nvr_lifecycle_eos'::"text"
            WHEN (("nvr_installed_at" + '7 years'::interval) < CURRENT_DATE) THEN 'nvr_lifecycle_overage'::"text"
            WHEN ("nvr_eos_date" <= (CURRENT_DATE + '6 mons'::interval)) THEN 'nvr_lifecycle_urgent'::"text"
            WHEN ("nvr_eos_date" <= (CURRENT_DATE + '1 year'::interval)) THEN 'nvr_lifecycle_replace_planned'::"text"
            WHEN ("nvr_eos_date" <= (CURRENT_DATE + '2 years'::interval)) THEN 'nvr_lifecycle_warning'::"text"
            ELSE 'nvr_lifecycle_ok'::"text"
        END AS "lifecycle_status"
   FROM "public"."stores" "s";


ALTER VIEW "public"."v_store_nvr_lifecycle" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_store_nvr_lifecycle" IS '全店舗の NVR ライフサイクル状態。/infra ダッシュボードのアラートサマリで使用 (F57: security_invoker = true)';



CREATE OR REPLACE VIEW "public"."v_nvr_lifecycle_by_model" WITH ("security_invoker"='true') AS
 SELECT "nvr_vendor",
    "nvr_model",
    "lifecycle_status",
    "count"(*) AS "store_count"
   FROM "public"."v_store_nvr_lifecycle"
  WHERE ("nvr_model" IS NOT NULL)
  GROUP BY "nvr_vendor", "nvr_model", "lifecycle_status"
  ORDER BY "nvr_vendor", "nvr_model", "lifecycle_status";


ALTER VIEW "public"."v_nvr_lifecycle_by_model" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_nvr_lifecycle_by_model" IS '機種別 × ライフサイクル状態の集計。/infra/lifecycle 画面で使用 (F57: security_invoker = true)';



CREATE OR REPLACE VIEW "public"."v_nvr_lifecycle_summary" WITH ("security_invoker"='true') AS
 SELECT "lifecycle_status",
    "count"(*) AS "store_count",
        CASE "lifecycle_status"
            WHEN 'nvr_lifecycle_eos'::"text" THEN 1
            WHEN 'nvr_lifecycle_overage'::"text" THEN 2
            WHEN 'nvr_lifecycle_urgent'::"text" THEN 3
            WHEN 'nvr_lifecycle_replace_planned'::"text" THEN 4
            WHEN 'nvr_lifecycle_warning'::"text" THEN 5
            WHEN 'nvr_lifecycle_ok'::"text" THEN 6
            ELSE 7
        END AS "sort_order"
   FROM "public"."v_store_nvr_lifecycle"
  GROUP BY "lifecycle_status"
  ORDER BY
        CASE "lifecycle_status"
            WHEN 'nvr_lifecycle_eos'::"text" THEN 1
            WHEN 'nvr_lifecycle_overage'::"text" THEN 2
            WHEN 'nvr_lifecycle_urgent'::"text" THEN 3
            WHEN 'nvr_lifecycle_replace_planned'::"text" THEN 4
            WHEN 'nvr_lifecycle_warning'::"text" THEN 5
            WHEN 'nvr_lifecycle_ok'::"text" THEN 6
            ELSE 7
        END;


ALTER VIEW "public"."v_nvr_lifecycle_summary" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_nvr_lifecycle_summary" IS '/infra ダッシュボードのライフサイクルサマリカード用 (F57: security_invoker = true)';



CREATE OR REPLACE VIEW "public"."v_partition_rls_status" WITH ("security_invoker"='true') AS
 SELECT "p"."relname" AS "parent_table",
    "c"."relname" AS "partition_name",
    "c"."relrowsecurity" AS "rls_enabled",
    "c"."relforcerowsecurity" AS "rls_forced",
    "pg_get_expr"("c"."relpartbound", "c"."oid") AS "partition_bound"
   FROM (("pg_class" "c"
     JOIN "pg_inherits" "i" ON (("i"."inhrelid" = "c"."oid")))
     JOIN "pg_class" "p" ON (("p"."oid" = "i"."inhparent")))
  WHERE ("p"."relname" = ANY (ARRAY['live_sessions'::"name", 'monitor_results'::"name"]))
  ORDER BY "p"."relname", "c"."relname";


ALTER VIEW "public"."v_partition_rls_status" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_partition_rls_status" IS 'F56: パーティションテーブルの子ごとの RLS 状態 (F57: security_invoker = true)';



CREATE TABLE IF NOT EXISTS "public"."visitors" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "store_id" "uuid" NOT NULL,
    "company" "text",
    "department" "text",
    "name" "text" NOT NULL,
    "title" "text",
    "phone" "text",
    "mobile" "text",
    "email" "text",
    "address" "text",
    "business_card_url" "text",
    "face_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."visitors" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vod_clips" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "camera_id" "uuid" NOT NULL,
    "edge_device_id" "uuid" NOT NULL,
    "requested_from" timestamp with time zone NOT NULL,
    "requested_to" timestamp with time zone NOT NULL,
    "actual_from" timestamp with time zone,
    "actual_to" timestamp with time zone,
    "duration_sec" numeric,
    "storage_path" "text",
    "bytes" bigint,
    "status" "text" DEFAULT 'queued'::"text" NOT NULL,
    "error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "uploading_at" timestamp with time zone,
    "ready_at" timestamp with time zone,
    "requested_by" "uuid",
    CONSTRAINT "vod_clips_status_check" CHECK (("status" = ANY (ARRAY['queued'::"text", 'uploading'::"text", 'ready'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."vod_clips" OWNER TO "postgres";


COMMENT ON TABLE "public"."vod_clips" IS 'F77 / Phase 8.4-B: Pre-uploaded VOD clips. The edge-agent fetches a recorded segment from the NVR (Frigate clip.mp4 etc.), uploads it to the vod-clips bucket, and flips status to ready. The browser polls and plays via HTML5 <video> + signed URL — no LiveKit/WHIP.';



ALTER TABLE ONLY "public"."live_sessions" ATTACH PARTITION "public"."live_sessions_202606" FOR VALUES FROM ('2026-06-01 00:00:00+09') TO ('2026-07-01 00:00:00+09');



ALTER TABLE ONLY "public"."live_sessions" ATTACH PARTITION "public"."live_sessions_202607" FOR VALUES FROM ('2026-07-01 00:00:00+09') TO ('2026-08-01 00:00:00+09');



ALTER TABLE ONLY "public"."monitor_results" ATTACH PARTITION "public"."monitor_results_202606" FOR VALUES FROM ('2026-06-01 00:00:00+09') TO ('2026-07-01 00:00:00+09');



ALTER TABLE ONLY "public"."monitor_results" ATTACH PARTITION "public"."monitor_results_202607" FOR VALUES FROM ('2026-07-01 00:00:00+09') TO ('2026-08-01 00:00:00+09');



ALTER TABLE ONLY "public"."admin_audit_log"
    ADD CONSTRAINT "admin_audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."admin_users"
    ADD CONSTRAINT "admin_users_auth_user_id_key" UNIQUE ("auth_user_id");



ALTER TABLE ONLY "public"."admin_users"
    ADD CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."alarm_events"
    ADD CONSTRAINT "alarm_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."alarm_frames"
    ADD CONSTRAINT "alarm_frames_alarm_event_id_camera_id_offset_sec_key" UNIQUE ("alarm_event_id", "camera_id", "offset_sec");



ALTER TABLE ONLY "public"."alarm_frames"
    ADD CONSTRAINT "alarm_frames_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."alarm_settings"
    ADD CONSTRAINT "alarm_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."alarm_settings"
    ADD CONSTRAINT "alarm_settings_store_id_key" UNIQUE ("store_id");



ALTER TABLE ONLY "public"."alert_logs"
    ADD CONSTRAINT "alert_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bcp_clips"
    ADD CONSTRAINT "bcp_clips_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bcp_events"
    ADD CONSTRAINT "bcp_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bcp_reports"
    ADD CONSTRAINT "bcp_reports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bcp_settings"
    ADD CONSTRAINT "bcp_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bcp_settings"
    ADD CONSTRAINT "bcp_settings_store_id_key" UNIQUE ("store_id");



ALTER TABLE ONLY "public"."central_nodes"
    ADD CONSTRAINT "central_nodes_hostname_key" UNIQUE ("hostname");



ALTER TABLE ONLY "public"."central_nodes"
    ADD CONSTRAINT "central_nodes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."consent_documents"
    ADD CONSTRAINT "consent_documents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."consent_documents"
    ADD CONSTRAINT "consent_documents_tenant_id_store_id_version_key" UNIQUE ("tenant_id", "store_id", "version");



ALTER TABLE ONLY "public"."edge_devices"
    ADD CONSTRAINT "edge_devices_device_token_key" UNIQUE ("device_token");



ALTER TABLE ONLY "public"."edge_devices"
    ADD CONSTRAINT "edge_devices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."edge_jobs"
    ADD CONSTRAINT "edge_jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."employees"
    ADD CONSTRAINT "employees_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."employees"
    ADD CONSTRAINT "employees_qr_code_key" UNIQUE ("qr_code");



ALTER TABLE ONLY "public"."enrollment_tokens"
    ADD CONSTRAINT "enrollment_tokens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."enrollment_tokens"
    ADD CONSTRAINT "enrollment_tokens_token_hash_key" UNIQUE ("token_hash");



ALTER TABLE ONLY "public"."entry_exit_logs"
    ADD CONSTRAINT "entry_exit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."inspections"
    ADD CONSTRAINT "inspections_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."jalert_receipts"
    ADD CONSTRAINT "jalert_receipts_alert_source_key" UNIQUE ("alert_source");



ALTER TABLE ONLY "public"."jalert_receipts"
    ADD CONSTRAINT "jalert_receipts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."live_sessions"
    ADD CONSTRAINT "live_sessions_pkey" PRIMARY KEY ("id", "started_at");



ALTER TABLE ONLY "public"."live_sessions_202606"
    ADD CONSTRAINT "live_sessions_202606_pkey" PRIMARY KEY ("id", "started_at");



ALTER TABLE ONLY "public"."live_sessions_202607"
    ADD CONSTRAINT "live_sessions_202607_pkey" PRIMARY KEY ("id", "started_at");



ALTER TABLE ONLY "public"."metric_events"
    ADD CONSTRAINT "metric_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."monitor_checks"
    ADD CONSTRAINT "monitor_checks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."monitor_daily_stats"
    ADD CONSTRAINT "monitor_daily_stats_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."monitor_incidents"
    ADD CONSTRAINT "monitor_incidents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."monitor_reports"
    ADD CONSTRAINT "monitor_reports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."monitor_results"
    ADD CONSTRAINT "monitor_results_pkey" PRIMARY KEY ("id", "measured_at");



ALTER TABLE ONLY "public"."monitor_results_202606"
    ADD CONSTRAINT "monitor_results_202606_pkey" PRIMARY KEY ("id", "measured_at");



ALTER TABLE ONLY "public"."monitor_results_202607"
    ADD CONSTRAINT "monitor_results_202607_pkey" PRIMARY KEY ("id", "measured_at");



ALTER TABLE ONLY "public"."monitor_settings"
    ADD CONSTRAINT "monitor_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."monitor_settings"
    ADD CONSTRAINT "monitor_settings_store_id_key" UNIQUE ("store_id");



ALTER TABLE ONLY "public"."nvr_models"
    ADD CONSTRAINT "nvr_models_model_number_key" UNIQUE ("model_number");



ALTER TABLE ONLY "public"."nvr_models"
    ADD CONSTRAINT "nvr_models_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."patrol_findings"
    ADD CONSTRAINT "patrol_findings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."patrol_runs"
    ADD CONSTRAINT "patrol_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."recorder_cameras"
    ADD CONSTRAINT "recorder_cameras_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."recorder_cameras"
    ADD CONSTRAINT "recorder_cameras_recorder_id_channel_key" UNIQUE ("recorder_id", "channel");



ALTER TABLE ONLY "public"."recorders"
    ADD CONSTRAINT "recorders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."security_camera_config"
    ADD CONSTRAINT "security_camera_config_camera_id_key" UNIQUE ("camera_id");



ALTER TABLE ONLY "public"."security_camera_config"
    ADD CONSTRAINT "security_camera_config_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."security_reports"
    ADD CONSTRAINT "security_reports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."security_settings"
    ADD CONSTRAINT "security_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."security_settings"
    ADD CONSTRAINT "security_settings_store_id_key" UNIQUE ("store_id");



ALTER TABLE ONLY "public"."session_limits"
    ADD CONSTRAINT "session_limits_pkey" PRIMARY KEY ("tenant_id");



ALTER TABLE ONLY "public"."stores"
    ADD CONSTRAINT "stores_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tenants"
    ADD CONSTRAINT "tenants_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."unmatch_logs"
    ADD CONSTRAINT "unmatch_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."visitors"
    ADD CONSTRAINT "visitors_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vod_clips"
    ADD CONSTRAINT "vod_clips_pkey" PRIMARY KEY ("id");



CREATE INDEX "alarm_events_timeline_retry_idx" ON "public"."alarm_events" USING "btree" ("occurred_at" DESC) WHERE ("timeline_dispatched_at" IS NULL);



CREATE INDEX "bcp_clips_storage_path_idx" ON "public"."bcp_clips" USING "btree" ("storage_path") WHERE ("storage_path" IS NOT NULL);



CREATE INDEX "employees_tenant_id_store_id_name_idx" ON "public"."employees" USING "btree" ("tenant_id", "store_id", "name");



CREATE INDEX "employees_tenant_id_store_id_qr_code_idx" ON "public"."employees" USING "btree" ("tenant_id", "store_id", "qr_code");



CREATE INDEX "entry_exit_logs_subject_id_subject_type_work_date_idx" ON "public"."entry_exit_logs" USING "btree" ("subject_id", "subject_type", "work_date");



CREATE INDEX "entry_exit_logs_tenant_id_store_id_work_date_event_type_idx" ON "public"."entry_exit_logs" USING "btree" ("tenant_id", "store_id", "work_date", "event_type");



CREATE INDEX "idx_admin_audit_log_actor" ON "public"."admin_audit_log" USING "btree" ("actor_user_id", "ts");



CREATE INDEX "idx_admin_audit_log_store_ts" ON "public"."admin_audit_log" USING "btree" ("store_id", "ts");



CREATE INDEX "idx_admin_audit_log_ts" ON "public"."admin_audit_log" USING "btree" ("ts");



CREATE INDEX "idx_admin_users_auth" ON "public"."admin_users" USING "btree" ("auth_user_id");



CREATE INDEX "idx_admin_users_role" ON "public"."admin_users" USING "btree" ("role");



CREATE INDEX "idx_admin_users_tenant" ON "public"."admin_users" USING "btree" ("tenant_id");



CREATE INDEX "idx_alarm_events_dedup" ON "public"."alarm_events" USING "btree" ("store_id", "dedup_key", "occurred_at");



CREATE INDEX "idx_alarm_events_occurred" ON "public"."alarm_events" USING "btree" ("occurred_at");



CREATE INDEX "idx_alarm_events_status" ON "public"."alarm_events" USING "btree" ("status");



CREATE INDEX "idx_alarm_events_store" ON "public"."alarm_events" USING "btree" ("store_id");



CREATE INDEX "idx_alarm_frames_event" ON "public"."alarm_frames" USING "btree" ("alarm_event_id");



CREATE INDEX "idx_alarm_settings_store" ON "public"."alarm_settings" USING "btree" ("store_id");



CREATE INDEX "idx_bcp_clips_event" ON "public"."bcp_clips" USING "btree" ("event_id");



CREATE INDEX "idx_bcp_clips_event_camera_offset" ON "public"."bcp_clips" USING "btree" ("event_id", "camera_id", "offset_min");



CREATE INDEX "idx_bcp_events_status" ON "public"."bcp_events" USING "btree" ("status");



CREATE INDEX "idx_bcp_events_store" ON "public"."bcp_events" USING "btree" ("store_id");



CREATE INDEX "idx_bcp_settings_store" ON "public"."bcp_settings" USING "btree" ("store_id");



CREATE INDEX "idx_cameras_recorder" ON "public"."recorder_cameras" USING "btree" ("recorder_id");



CREATE INDEX "idx_central_nodes_lease" ON "public"."central_nodes" USING "btree" ("lease_held_until");



CREATE INDEX "idx_central_nodes_status" ON "public"."central_nodes" USING "btree" ("status");



CREATE INDEX "idx_edge_jobs_edge_pending" ON "public"."edge_jobs" USING "btree" ("edge_id", "status") WHERE ("status" = 'pending'::"text");



CREATE INDEX "idx_edges_status" ON "public"."edge_devices" USING "btree" ("status");



CREATE INDEX "idx_edges_store" ON "public"."edge_devices" USING "btree" ("store_id");



CREATE INDEX "idx_enrollment_tokens_store" ON "public"."enrollment_tokens" USING "btree" ("store_id");



CREATE INDEX "idx_jalert_receipts_received" ON "public"."jalert_receipts" USING "btree" ("received_at" DESC);



CREATE INDEX "idx_jalert_receipts_type" ON "public"."jalert_receipts" USING "btree" ("alert_type");



CREATE INDEX "idx_metric_events_kind_ts" ON "public"."metric_events" USING "btree" ("kind", "ts");



CREATE INDEX "idx_metric_events_store_ts" ON "public"."metric_events" USING "btree" ("store_id", "ts");



CREATE INDEX "idx_metric_events_ts" ON "public"."metric_events" USING "btree" ("ts");



CREATE INDEX "idx_monitor_checks_store" ON "public"."monitor_checks" USING "btree" ("store_id");



CREATE INDEX "idx_monitor_checks_target" ON "public"."monitor_checks" USING "btree" ("target_type", "target_id");



CREATE INDEX "idx_monitor_daily_stats_store_day" ON "public"."monitor_daily_stats" USING "btree" ("store_id", "day");



CREATE INDEX "idx_monitor_incidents_status" ON "public"."monitor_incidents" USING "btree" ("status");



CREATE INDEX "idx_monitor_incidents_store" ON "public"."monitor_incidents" USING "btree" ("store_id");



CREATE INDEX "idx_monitor_reports_store" ON "public"."monitor_reports" USING "btree" ("store_id");



CREATE INDEX "idx_monitor_results_check" ON ONLY "public"."monitor_results" USING "btree" ("check_id", "measured_at");



CREATE INDEX "idx_monitor_results_store" ON ONLY "public"."monitor_results" USING "btree" ("store_id", "measured_at");



CREATE INDEX "idx_monitor_settings_store" ON "public"."monitor_settings" USING "btree" ("store_id");



CREATE INDEX "idx_nvr_models_eos_date" ON "public"."nvr_models" USING "btree" ("eos_date");



CREATE INDEX "idx_nvr_models_family" ON "public"."nvr_models" USING "btree" ("vendor", "model_family");



CREATE INDEX "idx_nvr_models_vendor" ON "public"."nvr_models" USING "btree" ("vendor");



CREATE INDEX "idx_patrol_findings_ai" ON "public"."patrol_findings" USING "btree" ("ai_status");



CREATE INDEX "idx_patrol_findings_run" ON "public"."patrol_findings" USING "btree" ("run_id");



CREATE INDEX "idx_patrol_findings_status" ON "public"."patrol_findings" USING "btree" ("status");



CREATE INDEX "idx_patrol_runs_started_at" ON "public"."patrol_runs" USING "btree" ("started_at");



CREATE INDEX "idx_patrol_runs_status" ON "public"."patrol_runs" USING "btree" ("status");



CREATE INDEX "idx_patrol_runs_store" ON "public"."patrol_runs" USING "btree" ("store_id");



CREATE INDEX "idx_recorders_edge" ON "public"."recorders" USING "btree" ("edge_id");



CREATE INDEX "idx_security_camera_config_camera" ON "public"."security_camera_config" USING "btree" ("camera_id");



CREATE INDEX "idx_security_reports_store" ON "public"."security_reports" USING "btree" ("store_id");



CREATE INDEX "idx_security_settings_store" ON "public"."security_settings" USING "btree" ("store_id");



CREATE INDEX "idx_sessions_store_started" ON ONLY "public"."live_sessions" USING "btree" ("store_id", "started_at" DESC);



CREATE INDEX "idx_sessions_user_started" ON ONLY "public"."live_sessions" USING "btree" ("user_id", "started_at" DESC);



CREATE INDEX "idx_stores_area" ON "public"."stores" USING "btree" ("area_code");



CREATE INDEX "idx_stores_central_node_id" ON "public"."stores" USING "btree" ("central_node_id") WHERE ("central_node_id" IS NOT NULL);



CREATE INDEX "idx_stores_deployment_mode" ON "public"."stores" USING "btree" ("deployment_mode");



CREATE INDEX "idx_stores_geo" ON "public"."stores" USING "gist" ("public"."ll_to_earth"(("latitude")::double precision, ("longitude")::double precision)) WHERE (("latitude" IS NOT NULL) AND ("longitude" IS NOT NULL));



CREATE INDEX "idx_stores_heartbeat_override" ON "public"."stores" USING "btree" ("heartbeat_override_sec") WHERE ("heartbeat_override_sec" IS NOT NULL);



CREATE INDEX "idx_stores_is_active" ON "public"."stores" USING "btree" ("is_active");



CREATE INDEX "idx_stores_nvr_replace_by" ON "public"."stores" USING "btree" ("nvr_replace_by");



CREATE INDEX "idx_stores_nvr_vendor" ON "public"."stores" USING "btree" ("nvr_vendor");



CREATE UNIQUE INDEX "idx_tenants_slug" ON "public"."tenants" USING "btree" ("slug") WHERE ("slug" IS NOT NULL);



CREATE INDEX "inspections_exit_log_id_idx" ON "public"."inspections" USING "btree" ("exit_log_id");



CREATE INDEX "inspections_tenant_id_store_id_ai_result_idx" ON "public"."inspections" USING "btree" ("tenant_id", "store_id", "ai_result");



CREATE INDEX "live_sessions_202606_store_id_started_at_idx" ON "public"."live_sessions_202606" USING "btree" ("store_id", "started_at" DESC);



CREATE INDEX "live_sessions_202606_user_id_started_at_idx" ON "public"."live_sessions_202606" USING "btree" ("user_id", "started_at" DESC);



CREATE INDEX "live_sessions_202607_store_id_started_at_idx" ON "public"."live_sessions_202607" USING "btree" ("store_id", "started_at" DESC);



CREATE INDEX "live_sessions_202607_user_id_started_at_idx" ON "public"."live_sessions_202607" USING "btree" ("user_id", "started_at" DESC);



CREATE INDEX "monitor_results_202606_check_id_measured_at_idx" ON "public"."monitor_results_202606" USING "btree" ("check_id", "measured_at");



CREATE INDEX "monitor_results_202606_store_id_measured_at_idx" ON "public"."monitor_results_202606" USING "btree" ("store_id", "measured_at");



CREATE INDEX "monitor_results_202607_check_id_measured_at_idx" ON "public"."monitor_results_202607" USING "btree" ("check_id", "measured_at");



CREATE INDEX "monitor_results_202607_store_id_measured_at_idx" ON "public"."monitor_results_202607" USING "btree" ("store_id", "measured_at");



CREATE INDEX "unmatch_logs_tenant_id_store_id_target_date_resolved_at_idx" ON "public"."unmatch_logs" USING "btree" ("tenant_id", "store_id", "target_date", "resolved_at");



CREATE UNIQUE INDEX "uq_monitor_checks_target_type" ON "public"."monitor_checks" USING "btree" ("target_type", "target_id", "check_type");



CREATE UNIQUE INDEX "uq_monitor_daily_stats" ON "public"."monitor_daily_stats" USING "btree" ("store_id", "target_type", "target_id", "day");



CREATE UNIQUE INDEX "uq_monitor_incidents_open" ON "public"."monitor_incidents" USING "btree" ("target_type", "target_id", "kind") WHERE ("status" = ANY (ARRAY['open'::"text", 'ack'::"text"]));



CREATE UNIQUE INDEX "uq_patrol_runs_scheduled" ON "public"."patrol_runs" USING "btree" ("store_id", "scheduled_for") WHERE (("trigger" = 'scheduled'::"text") AND ("scheduled_for" IS NOT NULL));



CREATE INDEX "visitors_tenant_id_store_id_name_created_at_idx" ON "public"."visitors" USING "btree" ("tenant_id", "store_id", "name", "created_at");



CREATE INDEX "vod_clips_camera_idx" ON "public"."vod_clips" USING "btree" ("camera_id", "requested_from" DESC);



CREATE INDEX "vod_clips_status_idx" ON "public"."vod_clips" USING "btree" ("status") WHERE ("status" = ANY (ARRAY['queued'::"text", 'uploading'::"text"]));



ALTER INDEX "public"."live_sessions_pkey" ATTACH PARTITION "public"."live_sessions_202606_pkey";



ALTER INDEX "public"."idx_sessions_store_started" ATTACH PARTITION "public"."live_sessions_202606_store_id_started_at_idx";



ALTER INDEX "public"."idx_sessions_user_started" ATTACH PARTITION "public"."live_sessions_202606_user_id_started_at_idx";



ALTER INDEX "public"."live_sessions_pkey" ATTACH PARTITION "public"."live_sessions_202607_pkey";



ALTER INDEX "public"."idx_sessions_store_started" ATTACH PARTITION "public"."live_sessions_202607_store_id_started_at_idx";



ALTER INDEX "public"."idx_sessions_user_started" ATTACH PARTITION "public"."live_sessions_202607_user_id_started_at_idx";



ALTER INDEX "public"."idx_monitor_results_check" ATTACH PARTITION "public"."monitor_results_202606_check_id_measured_at_idx";



ALTER INDEX "public"."monitor_results_pkey" ATTACH PARTITION "public"."monitor_results_202606_pkey";



ALTER INDEX "public"."idx_monitor_results_store" ATTACH PARTITION "public"."monitor_results_202606_store_id_measured_at_idx";



ALTER INDEX "public"."idx_monitor_results_check" ATTACH PARTITION "public"."monitor_results_202607_check_id_measured_at_idx";



ALTER INDEX "public"."monitor_results_pkey" ATTACH PARTITION "public"."monitor_results_202607_pkey";



ALTER INDEX "public"."idx_monitor_results_store" ATTACH PARTITION "public"."monitor_results_202607_store_id_measured_at_idx";



CREATE OR REPLACE TRIGGER "admin_users_touch" BEFORE UPDATE ON "public"."admin_users" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "after_inspection_insert" AFTER INSERT ON "public"."inspections" FOR EACH ROW EXECUTE FUNCTION "public"."trigger_analyze_inspection"();



CREATE OR REPLACE TRIGGER "trg_alarm_settings_updated_at" BEFORE UPDATE ON "public"."alarm_settings" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "trg_bcp_clips_complete" AFTER INSERT OR UPDATE ON "public"."bcp_clips" FOR EACH ROW EXECUTE FUNCTION "public"."bcp_check_clips_complete"();



CREATE OR REPLACE TRIGGER "trg_bcp_settings_updated_at" BEFORE UPDATE ON "public"."bcp_settings" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "trg_edges_updated_at" BEFORE UPDATE ON "public"."edge_devices" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "trg_limits_updated_at" BEFORE UPDATE ON "public"."session_limits" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "trg_monitor_settings_updated_at" BEFORE UPDATE ON "public"."monitor_settings" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "trg_recorders_updated_at" BEFORE UPDATE ON "public"."recorders" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "trg_security_camera_config_updated_at" BEFORE UPDATE ON "public"."security_camera_config" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "trg_security_settings_updated_at" BEFORE UPDATE ON "public"."security_settings" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "trg_sync_store_nvr_lifecycle" BEFORE INSERT OR UPDATE OF "nvr_model" ON "public"."stores" FOR EACH ROW EXECUTE FUNCTION "public"."sync_store_nvr_lifecycle"();



CREATE OR REPLACE TRIGGER "trg_touch_nvr_models" BEFORE UPDATE ON "public"."nvr_models" FOR EACH ROW EXECUTE FUNCTION "public"."touch_nvr_models_updated_at"();



ALTER TABLE ONLY "public"."admin_audit_log"
    ADD CONSTRAINT "admin_audit_log_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."admin_users"
    ADD CONSTRAINT "admin_users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."alarm_events"
    ADD CONSTRAINT "alarm_events_camera_id_fkey" FOREIGN KEY ("camera_id") REFERENCES "public"."recorder_cameras"("id");



ALTER TABLE ONLY "public"."alarm_events"
    ADD CONSTRAINT "alarm_events_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id");



ALTER TABLE ONLY "public"."alarm_frames"
    ADD CONSTRAINT "alarm_frames_alarm_event_id_fkey" FOREIGN KEY ("alarm_event_id") REFERENCES "public"."alarm_events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."alarm_frames"
    ADD CONSTRAINT "alarm_frames_camera_id_fkey" FOREIGN KEY ("camera_id") REFERENCES "public"."recorder_cameras"("id");



ALTER TABLE ONLY "public"."alarm_settings"
    ADD CONSTRAINT "alarm_settings_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id");



ALTER TABLE ONLY "public"."alert_logs"
    ADD CONSTRAINT "alert_logs_inspection_id_fkey" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."alert_logs"
    ADD CONSTRAINT "alert_logs_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."alert_logs"
    ADD CONSTRAINT "alert_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bcp_clips"
    ADD CONSTRAINT "bcp_clips_camera_id_fkey" FOREIGN KEY ("camera_id") REFERENCES "public"."recorder_cameras"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."bcp_clips"
    ADD CONSTRAINT "bcp_clips_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."bcp_events"("id");



ALTER TABLE ONLY "public"."bcp_events"
    ADD CONSTRAINT "bcp_events_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id");



ALTER TABLE ONLY "public"."bcp_reports"
    ADD CONSTRAINT "bcp_reports_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."bcp_events"("id");



ALTER TABLE ONLY "public"."bcp_settings"
    ADD CONSTRAINT "bcp_settings_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id");



ALTER TABLE ONLY "public"."consent_documents"
    ADD CONSTRAINT "consent_documents_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."consent_documents"
    ADD CONSTRAINT "consent_documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."edge_devices"
    ADD CONSTRAINT "edge_devices_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."edge_jobs"
    ADD CONSTRAINT "edge_jobs_edge_id_fkey" FOREIGN KEY ("edge_id") REFERENCES "public"."edge_devices"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."employees"
    ADD CONSTRAINT "employees_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."employees"
    ADD CONSTRAINT "employees_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."enrollment_tokens"
    ADD CONSTRAINT "enrollment_tokens_edge_id_fkey" FOREIGN KEY ("edge_id") REFERENCES "public"."edge_devices"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."enrollment_tokens"
    ADD CONSTRAINT "enrollment_tokens_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."entry_exit_logs"
    ADD CONSTRAINT "entry_exit_logs_consent_document_version_id_fkey" FOREIGN KEY ("consent_document_version_id") REFERENCES "public"."consent_documents"("id");



ALTER TABLE ONLY "public"."entry_exit_logs"
    ADD CONSTRAINT "entry_exit_logs_inspector_id_fkey" FOREIGN KEY ("inspector_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."entry_exit_logs"
    ADD CONSTRAINT "entry_exit_logs_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."entry_exit_logs"
    ADD CONSTRAINT "entry_exit_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."stores"
    ADD CONSTRAINT "fk_stores_central_node" FOREIGN KEY ("central_node_id") REFERENCES "public"."central_nodes"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."inspections"
    ADD CONSTRAINT "inspections_exit_log_id_fkey" FOREIGN KEY ("exit_log_id") REFERENCES "public"."entry_exit_logs"("id");



ALTER TABLE ONLY "public"."inspections"
    ADD CONSTRAINT "inspections_inspector_id_fkey" FOREIGN KEY ("inspector_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."inspections"
    ADD CONSTRAINT "inspections_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."inspections"
    ADD CONSTRAINT "inspections_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."metric_events"
    ADD CONSTRAINT "metric_events_camera_id_fkey" FOREIGN KEY ("camera_id") REFERENCES "public"."recorder_cameras"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."metric_events"
    ADD CONSTRAINT "metric_events_edge_id_fkey" FOREIGN KEY ("edge_id") REFERENCES "public"."edge_devices"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."metric_events"
    ADD CONSTRAINT "metric_events_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."monitor_checks"
    ADD CONSTRAINT "monitor_checks_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id");



ALTER TABLE ONLY "public"."monitor_daily_stats"
    ADD CONSTRAINT "monitor_daily_stats_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id");



ALTER TABLE ONLY "public"."monitor_incidents"
    ADD CONSTRAINT "monitor_incidents_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id");



ALTER TABLE ONLY "public"."monitor_reports"
    ADD CONSTRAINT "monitor_reports_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id");



ALTER TABLE ONLY "public"."monitor_settings"
    ADD CONSTRAINT "monitor_settings_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id");



ALTER TABLE ONLY "public"."patrol_findings"
    ADD CONSTRAINT "patrol_findings_camera_id_fkey" FOREIGN KEY ("camera_id") REFERENCES "public"."recorder_cameras"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."patrol_findings"
    ADD CONSTRAINT "patrol_findings_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "public"."patrol_runs"("id");



ALTER TABLE ONLY "public"."patrol_runs"
    ADD CONSTRAINT "patrol_runs_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id");



ALTER TABLE ONLY "public"."recorder_cameras"
    ADD CONSTRAINT "recorder_cameras_recorder_id_fkey" FOREIGN KEY ("recorder_id") REFERENCES "public"."recorders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."recorders"
    ADD CONSTRAINT "recorders_edge_id_fkey" FOREIGN KEY ("edge_id") REFERENCES "public"."edge_devices"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."security_camera_config"
    ADD CONSTRAINT "security_camera_config_camera_id_fkey" FOREIGN KEY ("camera_id") REFERENCES "public"."recorder_cameras"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."security_reports"
    ADD CONSTRAINT "security_reports_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id");



ALTER TABLE ONLY "public"."security_settings"
    ADD CONSTRAINT "security_settings_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id");



ALTER TABLE ONLY "public"."session_limits"
    ADD CONSTRAINT "session_limits_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."stores"
    ADD CONSTRAINT "stores_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."unmatch_logs"
    ADD CONSTRAINT "unmatch_logs_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."unmatch_logs"
    ADD CONSTRAINT "unmatch_logs_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."unmatch_logs"
    ADD CONSTRAINT "unmatch_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."visitors"
    ADD CONSTRAINT "visitors_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."visitors"
    ADD CONSTRAINT "visitors_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vod_clips"
    ADD CONSTRAINT "vod_clips_camera_id_fkey" FOREIGN KEY ("camera_id") REFERENCES "public"."recorder_cameras"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vod_clips"
    ADD CONSTRAINT "vod_clips_edge_device_id_fkey" FOREIGN KEY ("edge_device_id") REFERENCES "public"."edge_devices"("id") ON DELETE CASCADE;



ALTER TABLE "public"."admin_audit_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "admin_audit_log_insert" ON "public"."admin_audit_log" FOR INSERT WITH CHECK ((("actor_user_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."admin_users" "u"
  WHERE ("u"."auth_user_id" = "auth"."uid"())))));



CREATE POLICY "admin_audit_log_select" ON "public"."admin_audit_log" FOR SELECT USING (((EXISTS ( SELECT 1
   FROM "public"."admin_users" "u"
  WHERE (("u"."auth_user_id" = "auth"."uid"()) AND ("u"."role" = 'super_admin'::"text")))) OR (("store_id" IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM ("public"."admin_users" "u"
     JOIN "public"."stores" "s" ON (("s"."id" = "admin_audit_log"."store_id")))
  WHERE (("u"."auth_user_id" = "auth"."uid"()) AND ((("u"."role" = 'tenant_admin'::"text") AND ("s"."tenant_id" = "u"."tenant_id")) OR (("u"."role" = 'store_manager'::"text") AND ("s"."id" = ANY ("u"."store_ids"))))))))));



ALTER TABLE "public"."admin_users" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "admin_users_self_select" ON "public"."admin_users" FOR SELECT TO "authenticated" USING (("auth_user_id" = "auth"."uid"()));



ALTER TABLE "public"."alarm_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "alarm_events_modify" ON "public"."alarm_events" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "u"
  WHERE (("u"."auth_user_id" = "auth"."uid"()) AND ("u"."role" = ANY (ARRAY['super_admin'::"text", 'tenant_admin'::"text", 'store_manager'::"text"]))))));



CREATE POLICY "alarm_events_select" ON "public"."alarm_events" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "u"
  WHERE (("u"."auth_user_id" = "auth"."uid"()) AND (("u"."role" = 'super_admin'::"text") OR (EXISTS ( SELECT 1
           FROM "public"."stores" "s"
          WHERE (("s"."id" = "alarm_events"."store_id") AND ((("u"."role" = 'tenant_admin'::"text") AND ("s"."tenant_id" IN ( SELECT "admin_users"."tenant_id"
                   FROM "public"."admin_users"
                  WHERE ("admin_users"."auth_user_id" = "auth"."uid"())))) OR ("alarm_events"."store_id" = ANY ("u"."store_ids")))))))))));



ALTER TABLE "public"."alarm_frames" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "alarm_frames_modify" ON "public"."alarm_frames" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "u"
  WHERE (("u"."auth_user_id" = "auth"."uid"()) AND ("u"."role" = ANY (ARRAY['super_admin'::"text", 'tenant_admin'::"text", 'store_manager'::"text"]))))));



CREATE POLICY "alarm_frames_select" ON "public"."alarm_frames" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ("public"."alarm_events" "e"
     JOIN "public"."admin_users" "u" ON (("u"."auth_user_id" = "auth"."uid"())))
  WHERE (("e"."id" = "alarm_frames"."alarm_event_id") AND (("u"."role" = 'super_admin'::"text") OR (EXISTS ( SELECT 1
           FROM "public"."stores" "s"
          WHERE (("s"."id" = "e"."store_id") AND ((("u"."role" = 'tenant_admin'::"text") AND ("s"."tenant_id" IN ( SELECT "admin_users"."tenant_id"
                   FROM "public"."admin_users"
                  WHERE ("admin_users"."auth_user_id" = "auth"."uid"())))) OR ("e"."store_id" = ANY ("u"."store_ids")))))))))));



ALTER TABLE "public"."alarm_settings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "alarm_settings_modify" ON "public"."alarm_settings" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "u"
  WHERE (("u"."auth_user_id" = "auth"."uid"()) AND ("u"."role" = ANY (ARRAY['super_admin'::"text", 'tenant_admin'::"text", 'store_manager'::"text"]))))));



CREATE POLICY "alarm_settings_select" ON "public"."alarm_settings" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "u"
  WHERE (("u"."auth_user_id" = "auth"."uid"()) AND (("u"."role" = 'super_admin'::"text") OR (EXISTS ( SELECT 1
           FROM "public"."stores" "s"
          WHERE (("s"."id" = "alarm_settings"."store_id") AND ((("u"."role" = 'tenant_admin'::"text") AND ("s"."tenant_id" IN ( SELECT "admin_users"."tenant_id"
                   FROM "public"."admin_users"
                  WHERE ("admin_users"."auth_user_id" = "auth"."uid"())))) OR ("alarm_settings"."store_id" = ANY ("u"."store_ids")))))))))));



CREATE POLICY "alert_log_isolation" ON "public"."alert_logs" USING ((("public"."auth_role"() = 'saas_admin'::"text") OR ("tenant_id" = "public"."auth_tenant_id"())));



ALTER TABLE "public"."alert_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."bcp_clips" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "bcp_clips_modify" ON "public"."bcp_clips" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "u"
  WHERE (("u"."auth_user_id" = "auth"."uid"()) AND ("u"."role" = ANY (ARRAY['super_admin'::"text", 'tenant_admin'::"text", 'store_manager'::"text"]))))));



CREATE POLICY "bcp_clips_select" ON "public"."bcp_clips" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."bcp_events" "e"
  WHERE ("e"."id" = "bcp_clips"."event_id"))));



ALTER TABLE "public"."bcp_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "bcp_events_modify" ON "public"."bcp_events" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "u"
  WHERE (("u"."auth_user_id" = "auth"."uid"()) AND ("u"."role" = ANY (ARRAY['super_admin'::"text", 'tenant_admin'::"text", 'store_manager'::"text"]))))));



CREATE POLICY "bcp_events_select" ON "public"."bcp_events" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "u"
  WHERE (("u"."auth_user_id" = "auth"."uid"()) AND (("u"."role" = 'super_admin'::"text") OR (EXISTS ( SELECT 1
           FROM "public"."stores" "s"
          WHERE (("s"."id" = "bcp_events"."store_id") AND ((("u"."role" = 'tenant_admin'::"text") AND ("s"."tenant_id" IN ( SELECT "admin_users"."tenant_id"
                   FROM "public"."admin_users"
                  WHERE ("admin_users"."auth_user_id" = "auth"."uid"())))) OR ("bcp_events"."store_id" = ANY ("u"."store_ids")))))))))));



ALTER TABLE "public"."bcp_reports" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "bcp_reports_modify" ON "public"."bcp_reports" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "u"
  WHERE (("u"."auth_user_id" = "auth"."uid"()) AND ("u"."role" = ANY (ARRAY['super_admin'::"text", 'tenant_admin'::"text", 'store_manager'::"text"]))))));



CREATE POLICY "bcp_reports_select" ON "public"."bcp_reports" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."bcp_events" "e"
  WHERE ("e"."id" = "bcp_reports"."event_id"))));



ALTER TABLE "public"."bcp_settings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "bcp_settings_modify" ON "public"."bcp_settings" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "u"
  WHERE (("u"."auth_user_id" = "auth"."uid"()) AND ("u"."role" = ANY (ARRAY['super_admin'::"text", 'tenant_admin'::"text", 'store_manager'::"text"]))))));



CREATE POLICY "bcp_settings_select" ON "public"."bcp_settings" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "u"
  WHERE (("u"."auth_user_id" = "auth"."uid"()) AND (("u"."role" = 'super_admin'::"text") OR (EXISTS ( SELECT 1
           FROM "public"."stores" "s"
          WHERE (("s"."id" = "bcp_settings"."store_id") AND ((("u"."role" = 'tenant_admin'::"text") AND ("s"."tenant_id" IN ( SELECT "admin_users"."tenant_id"
                   FROM "public"."admin_users"
                  WHERE ("admin_users"."auth_user_id" = "auth"."uid"())))) OR ("bcp_settings"."store_id" = ANY ("u"."store_ids")))))))))));



CREATE POLICY "cameras_modify" ON "public"."recorder_cameras" USING ((EXISTS ( SELECT 1
   FROM "public"."recorders" "r"
  WHERE ("r"."id" = "recorder_cameras"."recorder_id")))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."recorders" "r"
  WHERE ("r"."id" = "recorder_cameras"."recorder_id"))));



CREATE POLICY "cameras_select" ON "public"."recorder_cameras" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."recorders" "r"
  WHERE ("r"."id" = "recorder_cameras"."recorder_id"))));



ALTER TABLE "public"."central_nodes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "central_nodes_select" ON "public"."central_nodes" FOR SELECT USING (true);



CREATE POLICY "central_nodes_write" ON "public"."central_nodes" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "consent_doc_isolation" ON "public"."consent_documents" USING ((("public"."auth_role"() = 'saas_admin'::"text") OR ("tenant_id" = "public"."auth_tenant_id"())));



ALTER TABLE "public"."consent_documents" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."edge_devices" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."edge_jobs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "edge_jobs_edge_select" ON "public"."edge_jobs" FOR SELECT TO "authenticated" USING ((((("auth"."jwt"() -> 'app_metadata'::"text") ->> 'edge_id'::"text"))::"uuid" = "edge_id"));



CREATE POLICY "edge_jobs_edge_update" ON "public"."edge_jobs" FOR UPDATE TO "authenticated" USING ((((("auth"."jwt"() -> 'app_metadata'::"text") ->> 'edge_id'::"text"))::"uuid" = "edge_id")) WITH CHECK ((((("auth"."jwt"() -> 'app_metadata'::"text") ->> 'edge_id'::"text"))::"uuid" = "edge_id"));



CREATE POLICY "edges_modify" ON "public"."edge_devices" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "u"
  WHERE (("u"."auth_user_id" = "auth"."uid"()) AND (("u"."role" = 'super_admin'::"text") OR (EXISTS ( SELECT 1
           FROM "public"."stores" "s"
          WHERE ((("s"."id" = "edge_devices"."store_id") AND (("u"."role" = 'tenant_admin'::"text") AND ("s"."tenant_id" IN ( SELECT "admin_users"."tenant_id"
                   FROM "public"."admin_users"
                  WHERE ("admin_users"."auth_user_id" = "auth"."uid"()))))) OR ("edge_devices"."store_id" = ANY ("u"."store_ids")))))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "u"
  WHERE (("u"."auth_user_id" = "auth"."uid"()) AND (("u"."role" = 'super_admin'::"text") OR (EXISTS ( SELECT 1
           FROM "public"."stores" "s"
          WHERE ((("s"."id" = "edge_devices"."store_id") AND (("u"."role" = 'tenant_admin'::"text") AND ("s"."tenant_id" IN ( SELECT "admin_users"."tenant_id"
                   FROM "public"."admin_users"
                  WHERE ("admin_users"."auth_user_id" = "auth"."uid"()))))) OR ("edge_devices"."store_id" = ANY ("u"."store_ids"))))))))));



CREATE POLICY "edges_select" ON "public"."edge_devices" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "u"
  WHERE (("u"."auth_user_id" = "auth"."uid"()) AND (("u"."role" = 'super_admin'::"text") OR (EXISTS ( SELECT 1
           FROM "public"."stores" "s"
          WHERE ((("s"."id" = "edge_devices"."store_id") AND (("u"."role" = 'tenant_admin'::"text") AND ("s"."tenant_id" IN ( SELECT "admin_users"."tenant_id"
                   FROM "public"."admin_users"
                  WHERE ("admin_users"."auth_user_id" = "auth"."uid"()))))) OR ("edge_devices"."store_id" = ANY ("u"."store_ids"))))))))));



CREATE POLICY "employee_isolation" ON "public"."employees" USING ((("public"."auth_role"() = 'saas_admin'::"text") OR ("tenant_id" = "public"."auth_tenant_id"())));



ALTER TABLE "public"."employees" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."enrollment_tokens" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "entry_exit_log_insert" ON "public"."entry_exit_logs" FOR INSERT WITH CHECK ((("public"."auth_role"() = ANY (ARRAY['saas_admin'::"text", 'tenant_admin'::"text", 'store_manager'::"text", 'inspector'::"text"])) AND (("public"."auth_role"() = 'saas_admin'::"text") OR ("tenant_id" = "public"."auth_tenant_id"()))));



CREATE POLICY "entry_exit_log_read" ON "public"."entry_exit_logs" FOR SELECT USING ((("public"."auth_role"() = ANY (ARRAY['saas_admin'::"text", 'tenant_admin'::"text", 'store_manager'::"text"])) AND (("public"."auth_role"() = 'saas_admin'::"text") OR ("tenant_id" = "public"."auth_tenant_id"()))));



ALTER TABLE "public"."entry_exit_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "inspection_insert" ON "public"."inspections" FOR INSERT WITH CHECK ((("public"."auth_role"() = ANY (ARRAY['saas_admin'::"text", 'tenant_admin'::"text", 'store_manager'::"text", 'inspector'::"text"])) AND (("public"."auth_role"() = 'saas_admin'::"text") OR ("tenant_id" = "public"."auth_tenant_id"()))));



CREATE POLICY "inspection_read" ON "public"."inspections" FOR SELECT USING ((("public"."auth_role"() = ANY (ARRAY['saas_admin'::"text", 'tenant_admin'::"text", 'store_manager'::"text"])) AND (("public"."auth_role"() = 'saas_admin'::"text") OR ("tenant_id" = "public"."auth_tenant_id"()))));



CREATE POLICY "inspection_update" ON "public"."inspections" FOR UPDATE USING ((("public"."auth_role"() = ANY (ARRAY['saas_admin'::"text", 'tenant_admin'::"text", 'store_manager'::"text"])) AND (("public"."auth_role"() = 'saas_admin'::"text") OR ("tenant_id" = "public"."auth_tenant_id"()))));



ALTER TABLE "public"."inspections" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."jalert_receipts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "jalert_receipts_select" ON "public"."jalert_receipts" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "u"
  WHERE ("u"."auth_user_id" = "auth"."uid"()))));



CREATE POLICY "limits_modify" ON "public"."session_limits" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "u"
  WHERE (("u"."auth_user_id" = "auth"."uid"()) AND (("u"."role" = 'super_admin'::"text") OR (("u"."role" = 'tenant_admin'::"text") AND ("u"."tenant_id" = "session_limits"."tenant_id"))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "u"
  WHERE (("u"."auth_user_id" = "auth"."uid"()) AND (("u"."role" = 'super_admin'::"text") OR (("u"."role" = 'tenant_admin'::"text") AND ("u"."tenant_id" = "session_limits"."tenant_id")))))));



CREATE POLICY "limits_select" ON "public"."session_limits" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "u"
  WHERE (("u"."auth_user_id" = "auth"."uid"()) AND (("u"."role" = 'super_admin'::"text") OR ("u"."tenant_id" = "session_limits"."tenant_id"))))));



ALTER TABLE "public"."live_sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."live_sessions_202606" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."live_sessions_202607" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."metric_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "metric_events_insert" ON "public"."metric_events" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "u"
  WHERE ("u"."auth_user_id" = "auth"."uid"()))));



CREATE POLICY "metric_events_select" ON "public"."metric_events" FOR SELECT USING (((EXISTS ( SELECT 1
   FROM "public"."admin_users" "u"
  WHERE (("u"."auth_user_id" = "auth"."uid"()) AND ("u"."role" = 'super_admin'::"text")))) OR (("store_id" IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM ("public"."admin_users" "u"
     JOIN "public"."stores" "s" ON (("s"."id" = "metric_events"."store_id")))
  WHERE (("u"."auth_user_id" = "auth"."uid"()) AND ((("u"."role" = 'tenant_admin'::"text") AND ("s"."tenant_id" = "u"."tenant_id")) OR (("u"."role" = 'store_manager'::"text") AND ("s"."id" = ANY ("u"."store_ids"))))))))));



ALTER TABLE "public"."monitor_checks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "monitor_checks_modify" ON "public"."monitor_checks" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "u"
  WHERE (("u"."auth_user_id" = "auth"."uid"()) AND ("u"."role" = ANY (ARRAY['super_admin'::"text", 'tenant_admin'::"text", 'store_manager'::"text"]))))));



CREATE POLICY "monitor_checks_select" ON "public"."monitor_checks" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "u"
  WHERE (("u"."auth_user_id" = "auth"."uid"()) AND (("u"."role" = 'super_admin'::"text") OR (EXISTS ( SELECT 1
           FROM "public"."stores" "s"
          WHERE (("s"."id" = "monitor_checks"."store_id") AND ((("u"."role" = 'tenant_admin'::"text") AND ("s"."tenant_id" IN ( SELECT "admin_users"."tenant_id"
                   FROM "public"."admin_users"
                  WHERE ("admin_users"."auth_user_id" = "auth"."uid"())))) OR ("monitor_checks"."store_id" = ANY ("u"."store_ids")))))))))));



ALTER TABLE "public"."monitor_daily_stats" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "monitor_daily_stats_modify" ON "public"."monitor_daily_stats" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "u"
  WHERE (("u"."auth_user_id" = "auth"."uid"()) AND ("u"."role" = ANY (ARRAY['super_admin'::"text", 'tenant_admin'::"text", 'store_manager'::"text"]))))));



CREATE POLICY "monitor_daily_stats_select" ON "public"."monitor_daily_stats" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "u"
  WHERE (("u"."auth_user_id" = "auth"."uid"()) AND (("u"."role" = 'super_admin'::"text") OR (EXISTS ( SELECT 1
           FROM "public"."stores" "s"
          WHERE (("s"."id" = "monitor_daily_stats"."store_id") AND ((("u"."role" = 'tenant_admin'::"text") AND ("s"."tenant_id" IN ( SELECT "admin_users"."tenant_id"
                   FROM "public"."admin_users"
                  WHERE ("admin_users"."auth_user_id" = "auth"."uid"())))) OR ("monitor_daily_stats"."store_id" = ANY ("u"."store_ids")))))))))));



ALTER TABLE "public"."monitor_incidents" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "monitor_incidents_modify" ON "public"."monitor_incidents" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "u"
  WHERE (("u"."auth_user_id" = "auth"."uid"()) AND ("u"."role" = ANY (ARRAY['super_admin'::"text", 'tenant_admin'::"text", 'store_manager'::"text"]))))));



CREATE POLICY "monitor_incidents_select" ON "public"."monitor_incidents" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "u"
  WHERE (("u"."auth_user_id" = "auth"."uid"()) AND (("u"."role" = 'super_admin'::"text") OR (EXISTS ( SELECT 1
           FROM "public"."stores" "s"
          WHERE (("s"."id" = "monitor_incidents"."store_id") AND ((("u"."role" = 'tenant_admin'::"text") AND ("s"."tenant_id" IN ( SELECT "admin_users"."tenant_id"
                   FROM "public"."admin_users"
                  WHERE ("admin_users"."auth_user_id" = "auth"."uid"())))) OR ("monitor_incidents"."store_id" = ANY ("u"."store_ids")))))))))));



ALTER TABLE "public"."monitor_reports" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "monitor_reports_modify" ON "public"."monitor_reports" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "u"
  WHERE (("u"."auth_user_id" = "auth"."uid"()) AND ("u"."role" = ANY (ARRAY['super_admin'::"text", 'tenant_admin'::"text", 'store_manager'::"text"]))))));



CREATE POLICY "monitor_reports_select" ON "public"."monitor_reports" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "u"
  WHERE (("u"."auth_user_id" = "auth"."uid"()) AND (("u"."role" = 'super_admin'::"text") OR (EXISTS ( SELECT 1
           FROM "public"."stores" "s"
          WHERE (("s"."id" = "monitor_reports"."store_id") AND ((("u"."role" = 'tenant_admin'::"text") AND ("s"."tenant_id" IN ( SELECT "admin_users"."tenant_id"
                   FROM "public"."admin_users"
                  WHERE ("admin_users"."auth_user_id" = "auth"."uid"())))) OR ("monitor_reports"."store_id" = ANY ("u"."store_ids")))))))))));



ALTER TABLE "public"."monitor_results" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."monitor_results_202606" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."monitor_results_202607" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "monitor_results_modify" ON "public"."monitor_results" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "u"
  WHERE (("u"."auth_user_id" = "auth"."uid"()) AND ("u"."role" = ANY (ARRAY['super_admin'::"text", 'tenant_admin'::"text", 'store_manager'::"text"]))))));



CREATE POLICY "monitor_results_select" ON "public"."monitor_results" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "u"
  WHERE (("u"."auth_user_id" = "auth"."uid"()) AND (("u"."role" = 'super_admin'::"text") OR (EXISTS ( SELECT 1
           FROM "public"."stores" "s"
          WHERE (("s"."id" = "monitor_results"."store_id") AND ((("u"."role" = 'tenant_admin'::"text") AND ("s"."tenant_id" IN ( SELECT "admin_users"."tenant_id"
                   FROM "public"."admin_users"
                  WHERE ("admin_users"."auth_user_id" = "auth"."uid"())))) OR ("monitor_results"."store_id" = ANY ("u"."store_ids")))))))))));



ALTER TABLE "public"."monitor_settings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "monitor_settings_modify" ON "public"."monitor_settings" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "u"
  WHERE (("u"."auth_user_id" = "auth"."uid"()) AND ("u"."role" = ANY (ARRAY['super_admin'::"text", 'tenant_admin'::"text", 'store_manager'::"text"]))))));



CREATE POLICY "monitor_settings_select" ON "public"."monitor_settings" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "u"
  WHERE (("u"."auth_user_id" = "auth"."uid"()) AND (("u"."role" = 'super_admin'::"text") OR (EXISTS ( SELECT 1
           FROM "public"."stores" "s"
          WHERE (("s"."id" = "monitor_settings"."store_id") AND ((("u"."role" = 'tenant_admin'::"text") AND ("s"."tenant_id" IN ( SELECT "admin_users"."tenant_id"
                   FROM "public"."admin_users"
                  WHERE ("admin_users"."auth_user_id" = "auth"."uid"())))) OR ("monitor_settings"."store_id" = ANY ("u"."store_ids")))))))))));



ALTER TABLE "public"."nvr_models" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "nvr_models_select" ON "public"."nvr_models" FOR SELECT USING (true);



CREATE POLICY "nvr_models_write" ON "public"."nvr_models" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."patrol_findings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "patrol_findings_modify" ON "public"."patrol_findings" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "u"
  WHERE (("u"."auth_user_id" = "auth"."uid"()) AND ("u"."role" = ANY (ARRAY['super_admin'::"text", 'tenant_admin'::"text", 'store_manager'::"text"]))))));



CREATE POLICY "patrol_findings_select" ON "public"."patrol_findings" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."patrol_runs" "r"
  WHERE ("r"."id" = "patrol_findings"."run_id"))));



ALTER TABLE "public"."patrol_runs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "patrol_runs_modify" ON "public"."patrol_runs" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "u"
  WHERE (("u"."auth_user_id" = "auth"."uid"()) AND ("u"."role" = ANY (ARRAY['super_admin'::"text", 'tenant_admin'::"text", 'store_manager'::"text"]))))));



CREATE POLICY "patrol_runs_select" ON "public"."patrol_runs" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "u"
  WHERE (("u"."auth_user_id" = "auth"."uid"()) AND (("u"."role" = 'super_admin'::"text") OR (EXISTS ( SELECT 1
           FROM "public"."stores" "s"
          WHERE (("s"."id" = "patrol_runs"."store_id") AND ((("u"."role" = 'tenant_admin'::"text") AND ("s"."tenant_id" IN ( SELECT "admin_users"."tenant_id"
                   FROM "public"."admin_users"
                  WHERE ("admin_users"."auth_user_id" = "auth"."uid"())))) OR ("patrol_runs"."store_id" = ANY ("u"."store_ids")))))))))));



ALTER TABLE "public"."recorder_cameras" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."recorders" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "recorders_modify" ON "public"."recorders" USING ((EXISTS ( SELECT 1
   FROM "public"."edge_devices" "e"
  WHERE ("e"."id" = "recorders"."edge_id")))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."edge_devices" "e"
  WHERE ("e"."id" = "recorders"."edge_id"))));



CREATE POLICY "recorders_select" ON "public"."recorders" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."edge_devices" "e"
  WHERE ("e"."id" = "recorders"."edge_id"))));



ALTER TABLE "public"."security_camera_config" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "security_camera_config_modify" ON "public"."security_camera_config" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "u"
  WHERE (("u"."auth_user_id" = "auth"."uid"()) AND ("u"."role" = ANY (ARRAY['super_admin'::"text", 'tenant_admin'::"text", 'store_manager'::"text"]))))));



CREATE POLICY "security_camera_config_select" ON "public"."security_camera_config" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "u"
  WHERE ("u"."auth_user_id" = "auth"."uid"()))));



ALTER TABLE "public"."security_reports" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "security_reports_modify" ON "public"."security_reports" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "u"
  WHERE (("u"."auth_user_id" = "auth"."uid"()) AND ("u"."role" = ANY (ARRAY['super_admin'::"text", 'tenant_admin'::"text", 'store_manager'::"text"]))))));



CREATE POLICY "security_reports_select" ON "public"."security_reports" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "u"
  WHERE (("u"."auth_user_id" = "auth"."uid"()) AND (("u"."role" = 'super_admin'::"text") OR (EXISTS ( SELECT 1
           FROM "public"."stores" "s"
          WHERE (("s"."id" = "security_reports"."store_id") AND ((("u"."role" = 'tenant_admin'::"text") AND ("s"."tenant_id" IN ( SELECT "admin_users"."tenant_id"
                   FROM "public"."admin_users"
                  WHERE ("admin_users"."auth_user_id" = "auth"."uid"())))) OR ("security_reports"."store_id" = ANY ("u"."store_ids")))))))))));



ALTER TABLE "public"."security_settings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "security_settings_modify" ON "public"."security_settings" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "u"
  WHERE (("u"."auth_user_id" = "auth"."uid"()) AND ("u"."role" = ANY (ARRAY['super_admin'::"text", 'tenant_admin'::"text", 'store_manager'::"text"]))))));



CREATE POLICY "security_settings_select" ON "public"."security_settings" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "u"
  WHERE (("u"."auth_user_id" = "auth"."uid"()) AND (("u"."role" = 'super_admin'::"text") OR (EXISTS ( SELECT 1
           FROM "public"."stores" "s"
          WHERE (("s"."id" = "security_settings"."store_id") AND ((("u"."role" = 'tenant_admin'::"text") AND ("s"."tenant_id" IN ( SELECT "admin_users"."tenant_id"
                   FROM "public"."admin_users"
                  WHERE ("admin_users"."auth_user_id" = "auth"."uid"())))) OR ("security_settings"."store_id" = ANY ("u"."store_ids")))))))))));



ALTER TABLE "public"."session_limits" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sessions_insert" ON "public"."live_sessions" FOR INSERT WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "sessions_select" ON "public"."live_sessions" FOR SELECT USING ((("user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."admin_users" "u"
  WHERE (("u"."auth_user_id" = "auth"."uid"()) AND ("u"."role" = 'super_admin'::"text")))) OR (EXISTS ( SELECT 1
   FROM ("public"."admin_users" "u"
     JOIN "public"."stores" "s" ON (("s"."id" = "live_sessions"."store_id")))
  WHERE (("u"."auth_user_id" = "auth"."uid"()) AND ((("u"."role" = 'tenant_admin'::"text") AND ("s"."tenant_id" = "u"."tenant_id")) OR (("u"."role" = 'store_manager'::"text") AND ("s"."id" = ANY ("u"."store_ids")))))))));



CREATE POLICY "store_isolation" ON "public"."stores" USING ((("public"."auth_role"() = 'saas_admin'::"text") OR ("tenant_id" = "public"."auth_tenant_id"())));



ALTER TABLE "public"."stores" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "stores_delete" ON "public"."stores" FOR DELETE TO "authenticated" USING ((("public"."auth_user_role"() = 'super_admin'::"text") OR (("public"."auth_user_role"() = 'tenant_admin'::"text") AND ("public"."auth_user_tenant_id"() = "tenant_id"))));



CREATE POLICY "stores_insert" ON "public"."stores" FOR INSERT TO "authenticated" WITH CHECK ((("public"."auth_user_role"() = 'super_admin'::"text") OR (("public"."auth_user_role"() = 'tenant_admin'::"text") AND ("public"."auth_user_tenant_id"() = "tenant_id"))));



CREATE POLICY "stores_select" ON "public"."stores" FOR SELECT TO "authenticated" USING ((("public"."auth_user_role"() = 'super_admin'::"text") OR ("public"."auth_user_tenant_id"() = "tenant_id") OR ("id" = ANY ("public"."auth_user_store_ids"()))));



CREATE POLICY "stores_update" ON "public"."stores" FOR UPDATE TO "authenticated" USING ((("public"."auth_user_role"() = 'super_admin'::"text") OR (("public"."auth_user_role"() = ANY (ARRAY['tenant_admin'::"text", 'store_manager'::"text"])) AND ("public"."auth_user_tenant_id"() = "tenant_id")))) WITH CHECK ((("public"."auth_user_role"() = 'super_admin'::"text") OR (("public"."auth_user_role"() = ANY (ARRAY['tenant_admin'::"text", 'store_manager'::"text"])) AND ("public"."auth_user_tenant_id"() = "tenant_id"))));



CREATE POLICY "tenant_isolation" ON "public"."tenants" USING ((("public"."auth_role"() = 'saas_admin'::"text") OR ("id" = "public"."auth_tenant_id"())));



ALTER TABLE "public"."tenants" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "unmatch_log_isolation" ON "public"."unmatch_logs" USING ((("public"."auth_role"() = 'saas_admin'::"text") OR ("tenant_id" = "public"."auth_tenant_id"())));



ALTER TABLE "public"."unmatch_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_isolation" ON "public"."users" USING ((("public"."auth_role"() = 'saas_admin'::"text") OR ("tenant_id" = "public"."auth_tenant_id"())));



ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "visitor_isolation" ON "public"."visitors" USING ((("public"."auth_role"() = 'saas_admin'::"text") OR ("tenant_id" = "public"."auth_tenant_id"())));



ALTER TABLE "public"."visitors" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."vod_clips" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "vod_clips_insert_authed" ON "public"."vod_clips" FOR INSERT TO "authenticated" WITH CHECK (false);



CREATE POLICY "vod_clips_select" ON "public"."vod_clips" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ((("public"."recorder_cameras" "rc"
     JOIN "public"."recorders" "r" ON (("r"."id" = "rc"."recorder_id")))
     JOIN "public"."edge_devices" "ed" ON (("ed"."id" = "r"."edge_id")))
     JOIN "public"."stores" "s" ON (("s"."id" = "ed"."store_id")))
  WHERE ("rc"."id" = "vod_clips"."camera_id"))));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";








GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."cube_in"("cstring") TO "postgres";
GRANT ALL ON FUNCTION "public"."cube_in"("cstring") TO "anon";
GRANT ALL ON FUNCTION "public"."cube_in"("cstring") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cube_in"("cstring") TO "service_role";



GRANT ALL ON FUNCTION "public"."cube_out"("public"."cube") TO "postgres";
GRANT ALL ON FUNCTION "public"."cube_out"("public"."cube") TO "anon";
GRANT ALL ON FUNCTION "public"."cube_out"("public"."cube") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cube_out"("public"."cube") TO "service_role";



GRANT ALL ON FUNCTION "public"."cube_recv"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."cube_recv"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."cube_recv"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cube_recv"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."cube_send"("public"."cube") TO "postgres";
GRANT ALL ON FUNCTION "public"."cube_send"("public"."cube") TO "anon";
GRANT ALL ON FUNCTION "public"."cube_send"("public"."cube") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cube_send"("public"."cube") TO "service_role";











































































































































































GRANT ALL ON FUNCTION "public"."auth_role"() TO "anon";
GRANT ALL ON FUNCTION "public"."auth_role"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."auth_role"() TO "service_role";



GRANT ALL ON FUNCTION "public"."auth_tenant_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."auth_tenant_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."auth_tenant_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."auth_user_role"() TO "anon";
GRANT ALL ON FUNCTION "public"."auth_user_role"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."auth_user_role"() TO "service_role";



GRANT ALL ON FUNCTION "public"."auth_user_store_ids"() TO "anon";
GRANT ALL ON FUNCTION "public"."auth_user_store_ids"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."auth_user_store_ids"() TO "service_role";



GRANT ALL ON FUNCTION "public"."auth_user_tenant_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."auth_user_tenant_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."auth_user_tenant_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."bcp_check_clips_complete"() TO "anon";
GRANT ALL ON FUNCTION "public"."bcp_check_clips_complete"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."bcp_check_clips_complete"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."bcp_sweep_pending_reports"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."bcp_sweep_pending_reports"() TO "anon";
GRANT ALL ON FUNCTION "public"."bcp_sweep_pending_reports"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."bcp_sweep_pending_reports"() TO "service_role";



GRANT ALL ON FUNCTION "public"."create_live_sessions_partition"("p_start" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."create_live_sessions_partition"("p_start" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_live_sessions_partition"("p_start" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."cube"(double precision[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."cube"(double precision[]) TO "anon";
GRANT ALL ON FUNCTION "public"."cube"(double precision[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."cube"(double precision[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."cube"(double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."cube"(double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."cube"(double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."cube"(double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."cube"(double precision[], double precision[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."cube"(double precision[], double precision[]) TO "anon";
GRANT ALL ON FUNCTION "public"."cube"(double precision[], double precision[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."cube"(double precision[], double precision[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."cube"(double precision, double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."cube"(double precision, double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."cube"(double precision, double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."cube"(double precision, double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."cube"("public"."cube", double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."cube"("public"."cube", double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."cube"("public"."cube", double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."cube"("public"."cube", double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."cube"("public"."cube", double precision, double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."cube"("public"."cube", double precision, double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."cube"("public"."cube", double precision, double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."cube"("public"."cube", double precision, double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."cube_cmp"("public"."cube", "public"."cube") TO "postgres";
GRANT ALL ON FUNCTION "public"."cube_cmp"("public"."cube", "public"."cube") TO "anon";
GRANT ALL ON FUNCTION "public"."cube_cmp"("public"."cube", "public"."cube") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cube_cmp"("public"."cube", "public"."cube") TO "service_role";



GRANT ALL ON FUNCTION "public"."cube_contained"("public"."cube", "public"."cube") TO "postgres";
GRANT ALL ON FUNCTION "public"."cube_contained"("public"."cube", "public"."cube") TO "anon";
GRANT ALL ON FUNCTION "public"."cube_contained"("public"."cube", "public"."cube") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cube_contained"("public"."cube", "public"."cube") TO "service_role";



GRANT ALL ON FUNCTION "public"."cube_contains"("public"."cube", "public"."cube") TO "postgres";
GRANT ALL ON FUNCTION "public"."cube_contains"("public"."cube", "public"."cube") TO "anon";
GRANT ALL ON FUNCTION "public"."cube_contains"("public"."cube", "public"."cube") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cube_contains"("public"."cube", "public"."cube") TO "service_role";



GRANT ALL ON FUNCTION "public"."cube_coord"("public"."cube", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."cube_coord"("public"."cube", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."cube_coord"("public"."cube", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."cube_coord"("public"."cube", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."cube_coord_llur"("public"."cube", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."cube_coord_llur"("public"."cube", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."cube_coord_llur"("public"."cube", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."cube_coord_llur"("public"."cube", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."cube_dim"("public"."cube") TO "postgres";
GRANT ALL ON FUNCTION "public"."cube_dim"("public"."cube") TO "anon";
GRANT ALL ON FUNCTION "public"."cube_dim"("public"."cube") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cube_dim"("public"."cube") TO "service_role";



GRANT ALL ON FUNCTION "public"."cube_distance"("public"."cube", "public"."cube") TO "postgres";
GRANT ALL ON FUNCTION "public"."cube_distance"("public"."cube", "public"."cube") TO "anon";
GRANT ALL ON FUNCTION "public"."cube_distance"("public"."cube", "public"."cube") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cube_distance"("public"."cube", "public"."cube") TO "service_role";



GRANT ALL ON FUNCTION "public"."cube_enlarge"("public"."cube", double precision, integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."cube_enlarge"("public"."cube", double precision, integer) TO "anon";
GRANT ALL ON FUNCTION "public"."cube_enlarge"("public"."cube", double precision, integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."cube_enlarge"("public"."cube", double precision, integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."cube_eq"("public"."cube", "public"."cube") TO "postgres";
GRANT ALL ON FUNCTION "public"."cube_eq"("public"."cube", "public"."cube") TO "anon";
GRANT ALL ON FUNCTION "public"."cube_eq"("public"."cube", "public"."cube") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cube_eq"("public"."cube", "public"."cube") TO "service_role";



GRANT ALL ON FUNCTION "public"."cube_ge"("public"."cube", "public"."cube") TO "postgres";
GRANT ALL ON FUNCTION "public"."cube_ge"("public"."cube", "public"."cube") TO "anon";
GRANT ALL ON FUNCTION "public"."cube_ge"("public"."cube", "public"."cube") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cube_ge"("public"."cube", "public"."cube") TO "service_role";



GRANT ALL ON FUNCTION "public"."cube_gt"("public"."cube", "public"."cube") TO "postgres";
GRANT ALL ON FUNCTION "public"."cube_gt"("public"."cube", "public"."cube") TO "anon";
GRANT ALL ON FUNCTION "public"."cube_gt"("public"."cube", "public"."cube") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cube_gt"("public"."cube", "public"."cube") TO "service_role";



GRANT ALL ON FUNCTION "public"."cube_inter"("public"."cube", "public"."cube") TO "postgres";
GRANT ALL ON FUNCTION "public"."cube_inter"("public"."cube", "public"."cube") TO "anon";
GRANT ALL ON FUNCTION "public"."cube_inter"("public"."cube", "public"."cube") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cube_inter"("public"."cube", "public"."cube") TO "service_role";



GRANT ALL ON FUNCTION "public"."cube_is_point"("public"."cube") TO "postgres";
GRANT ALL ON FUNCTION "public"."cube_is_point"("public"."cube") TO "anon";
GRANT ALL ON FUNCTION "public"."cube_is_point"("public"."cube") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cube_is_point"("public"."cube") TO "service_role";



GRANT ALL ON FUNCTION "public"."cube_le"("public"."cube", "public"."cube") TO "postgres";
GRANT ALL ON FUNCTION "public"."cube_le"("public"."cube", "public"."cube") TO "anon";
GRANT ALL ON FUNCTION "public"."cube_le"("public"."cube", "public"."cube") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cube_le"("public"."cube", "public"."cube") TO "service_role";



GRANT ALL ON FUNCTION "public"."cube_ll_coord"("public"."cube", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."cube_ll_coord"("public"."cube", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."cube_ll_coord"("public"."cube", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."cube_ll_coord"("public"."cube", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."cube_lt"("public"."cube", "public"."cube") TO "postgres";
GRANT ALL ON FUNCTION "public"."cube_lt"("public"."cube", "public"."cube") TO "anon";
GRANT ALL ON FUNCTION "public"."cube_lt"("public"."cube", "public"."cube") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cube_lt"("public"."cube", "public"."cube") TO "service_role";



GRANT ALL ON FUNCTION "public"."cube_ne"("public"."cube", "public"."cube") TO "postgres";
GRANT ALL ON FUNCTION "public"."cube_ne"("public"."cube", "public"."cube") TO "anon";
GRANT ALL ON FUNCTION "public"."cube_ne"("public"."cube", "public"."cube") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cube_ne"("public"."cube", "public"."cube") TO "service_role";



GRANT ALL ON FUNCTION "public"."cube_overlap"("public"."cube", "public"."cube") TO "postgres";
GRANT ALL ON FUNCTION "public"."cube_overlap"("public"."cube", "public"."cube") TO "anon";
GRANT ALL ON FUNCTION "public"."cube_overlap"("public"."cube", "public"."cube") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cube_overlap"("public"."cube", "public"."cube") TO "service_role";



GRANT ALL ON FUNCTION "public"."cube_size"("public"."cube") TO "postgres";
GRANT ALL ON FUNCTION "public"."cube_size"("public"."cube") TO "anon";
GRANT ALL ON FUNCTION "public"."cube_size"("public"."cube") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cube_size"("public"."cube") TO "service_role";



GRANT ALL ON FUNCTION "public"."cube_subset"("public"."cube", integer[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."cube_subset"("public"."cube", integer[]) TO "anon";
GRANT ALL ON FUNCTION "public"."cube_subset"("public"."cube", integer[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."cube_subset"("public"."cube", integer[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."cube_union"("public"."cube", "public"."cube") TO "postgres";
GRANT ALL ON FUNCTION "public"."cube_union"("public"."cube", "public"."cube") TO "anon";
GRANT ALL ON FUNCTION "public"."cube_union"("public"."cube", "public"."cube") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cube_union"("public"."cube", "public"."cube") TO "service_role";



GRANT ALL ON FUNCTION "public"."cube_ur_coord"("public"."cube", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."cube_ur_coord"("public"."cube", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."cube_ur_coord"("public"."cube", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."cube_ur_coord"("public"."cube", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."daily_session_minutes"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."daily_session_minutes"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."daily_session_minutes"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."detect_unmatched_entries"("target_date" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."detect_unmatched_entries"("target_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."detect_unmatched_entries"("target_date" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."distance_chebyshev"("public"."cube", "public"."cube") TO "postgres";
GRANT ALL ON FUNCTION "public"."distance_chebyshev"("public"."cube", "public"."cube") TO "anon";
GRANT ALL ON FUNCTION "public"."distance_chebyshev"("public"."cube", "public"."cube") TO "authenticated";
GRANT ALL ON FUNCTION "public"."distance_chebyshev"("public"."cube", "public"."cube") TO "service_role";



GRANT ALL ON FUNCTION "public"."distance_taxicab"("public"."cube", "public"."cube") TO "postgres";
GRANT ALL ON FUNCTION "public"."distance_taxicab"("public"."cube", "public"."cube") TO "anon";
GRANT ALL ON FUNCTION "public"."distance_taxicab"("public"."cube", "public"."cube") TO "authenticated";
GRANT ALL ON FUNCTION "public"."distance_taxicab"("public"."cube", "public"."cube") TO "service_role";



GRANT ALL ON FUNCTION "public"."earth"() TO "postgres";
GRANT ALL ON FUNCTION "public"."earth"() TO "anon";
GRANT ALL ON FUNCTION "public"."earth"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."earth"() TO "service_role";



GRANT ALL ON FUNCTION "public"."gc_to_sec"(double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."gc_to_sec"(double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."gc_to_sec"(double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."gc_to_sec"(double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."earth_box"("public"."earth", double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."earth_box"("public"."earth", double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."earth_box"("public"."earth", double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."earth_box"("public"."earth", double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."sec_to_gc"(double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."sec_to_gc"(double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."sec_to_gc"(double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."sec_to_gc"(double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."earth_distance"("public"."earth", "public"."earth") TO "postgres";
GRANT ALL ON FUNCTION "public"."earth_distance"("public"."earth", "public"."earth") TO "anon";
GRANT ALL ON FUNCTION "public"."earth_distance"("public"."earth", "public"."earth") TO "authenticated";
GRANT ALL ON FUNCTION "public"."earth_distance"("public"."earth", "public"."earth") TO "service_role";



GRANT ALL ON FUNCTION "public"."g_cube_consistent"("internal", "public"."cube", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."g_cube_consistent"("internal", "public"."cube", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."g_cube_consistent"("internal", "public"."cube", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."g_cube_consistent"("internal", "public"."cube", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."g_cube_distance"("internal", "public"."cube", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."g_cube_distance"("internal", "public"."cube", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."g_cube_distance"("internal", "public"."cube", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."g_cube_distance"("internal", "public"."cube", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."g_cube_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."g_cube_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."g_cube_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."g_cube_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."g_cube_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."g_cube_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."g_cube_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."g_cube_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."g_cube_same"("public"."cube", "public"."cube", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."g_cube_same"("public"."cube", "public"."cube", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."g_cube_same"("public"."cube", "public"."cube", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."g_cube_same"("public"."cube", "public"."cube", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."g_cube_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."g_cube_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."g_cube_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."g_cube_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."geo_distance"("point", "point") TO "postgres";
GRANT ALL ON FUNCTION "public"."geo_distance"("point", "point") TO "anon";
GRANT ALL ON FUNCTION "public"."geo_distance"("point", "point") TO "authenticated";
GRANT ALL ON FUNCTION "public"."geo_distance"("point", "point") TO "service_role";



REVOKE ALL ON FUNCTION "public"."invoke_bcp_report"("p_event_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."invoke_bcp_report"("p_event_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."invoke_bcp_report"("p_event_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."invoke_bcp_report"("p_event_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."invoke_jalert_poller"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."invoke_jalert_poller"() TO "anon";
GRANT ALL ON FUNCTION "public"."invoke_jalert_poller"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."invoke_jalert_poller"() TO "service_role";



GRANT ALL ON FUNCTION "public"."latitude"("public"."earth") TO "postgres";
GRANT ALL ON FUNCTION "public"."latitude"("public"."earth") TO "anon";
GRANT ALL ON FUNCTION "public"."latitude"("public"."earth") TO "authenticated";
GRANT ALL ON FUNCTION "public"."latitude"("public"."earth") TO "service_role";



GRANT ALL ON FUNCTION "public"."ll_to_earth"(double precision, double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."ll_to_earth"(double precision, double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."ll_to_earth"(double precision, double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."ll_to_earth"(double precision, double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."longitude"("public"."earth") TO "postgres";
GRANT ALL ON FUNCTION "public"."longitude"("public"."earth") TO "anon";
GRANT ALL ON FUNCTION "public"."longitude"("public"."earth") TO "authenticated";
GRANT ALL ON FUNCTION "public"."longitude"("public"."earth") TO "service_role";



GRANT ALL ON FUNCTION "public"."monitor_results_ensure_partition"("p_month" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."monitor_results_ensure_partition"("p_month" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."monitor_results_ensure_partition"("p_month" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."monitor_sweep_edges"() TO "anon";
GRANT ALL ON FUNCTION "public"."monitor_sweep_edges"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."monitor_sweep_edges"() TO "service_role";



GRANT ALL ON FUNCTION "public"."monitor_sweep_unattended_streams"() TO "anon";
GRANT ALL ON FUNCTION "public"."monitor_sweep_unattended_streams"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."monitor_sweep_unattended_streams"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_store_nvr_lifecycle"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_store_nvr_lifecycle"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_store_nvr_lifecycle"() TO "service_role";



GRANT ALL ON FUNCTION "public"."touch_nvr_models_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."touch_nvr_models_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."touch_nvr_models_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."touch_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."touch_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."touch_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trigger_analyze_inspection"() TO "anon";
GRANT ALL ON FUNCTION "public"."trigger_analyze_inspection"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trigger_analyze_inspection"() TO "service_role";
























GRANT ALL ON TABLE "public"."admin_audit_log" TO "anon";
GRANT ALL ON TABLE "public"."admin_audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_audit_log" TO "service_role";



GRANT ALL ON SEQUENCE "public"."admin_audit_log_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."admin_audit_log_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."admin_audit_log_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."admin_users" TO "anon";
GRANT ALL ON TABLE "public"."admin_users" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_users" TO "service_role";



GRANT ALL ON TABLE "public"."alarm_events" TO "anon";
GRANT ALL ON TABLE "public"."alarm_events" TO "authenticated";
GRANT ALL ON TABLE "public"."alarm_events" TO "service_role";



GRANT ALL ON TABLE "public"."alarm_frames" TO "anon";
GRANT ALL ON TABLE "public"."alarm_frames" TO "authenticated";
GRANT ALL ON TABLE "public"."alarm_frames" TO "service_role";



GRANT ALL ON TABLE "public"."alarm_settings" TO "anon";
GRANT ALL ON TABLE "public"."alarm_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."alarm_settings" TO "service_role";



GRANT ALL ON TABLE "public"."alert_logs" TO "anon";
GRANT ALL ON TABLE "public"."alert_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."alert_logs" TO "service_role";



GRANT ALL ON TABLE "public"."bcp_clips" TO "anon";
GRANT ALL ON TABLE "public"."bcp_clips" TO "authenticated";
GRANT ALL ON TABLE "public"."bcp_clips" TO "service_role";



GRANT ALL ON TABLE "public"."bcp_events" TO "anon";
GRANT ALL ON TABLE "public"."bcp_events" TO "authenticated";
GRANT ALL ON TABLE "public"."bcp_events" TO "service_role";



GRANT ALL ON TABLE "public"."bcp_reports" TO "anon";
GRANT ALL ON TABLE "public"."bcp_reports" TO "authenticated";
GRANT ALL ON TABLE "public"."bcp_reports" TO "service_role";



GRANT ALL ON TABLE "public"."bcp_settings" TO "anon";
GRANT ALL ON TABLE "public"."bcp_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."bcp_settings" TO "service_role";



GRANT ALL ON TABLE "public"."central_nodes" TO "anon";
GRANT ALL ON TABLE "public"."central_nodes" TO "authenticated";
GRANT ALL ON TABLE "public"."central_nodes" TO "service_role";



GRANT ALL ON TABLE "public"."consent_documents" TO "anon";
GRANT ALL ON TABLE "public"."consent_documents" TO "authenticated";
GRANT ALL ON TABLE "public"."consent_documents" TO "service_role";



GRANT ALL ON TABLE "public"."edge_devices" TO "anon";
GRANT ALL ON TABLE "public"."edge_devices" TO "authenticated";
GRANT ALL ON TABLE "public"."edge_devices" TO "service_role";



GRANT ALL ON TABLE "public"."edge_jobs" TO "anon";
GRANT ALL ON TABLE "public"."edge_jobs" TO "authenticated";
GRANT ALL ON TABLE "public"."edge_jobs" TO "service_role";



GRANT ALL ON TABLE "public"."employees" TO "anon";
GRANT ALL ON TABLE "public"."employees" TO "authenticated";
GRANT ALL ON TABLE "public"."employees" TO "service_role";



GRANT ALL ON TABLE "public"."enrollment_tokens" TO "anon";
GRANT ALL ON TABLE "public"."enrollment_tokens" TO "authenticated";
GRANT ALL ON TABLE "public"."enrollment_tokens" TO "service_role";



GRANT ALL ON TABLE "public"."entry_exit_logs" TO "anon";
GRANT ALL ON TABLE "public"."entry_exit_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."entry_exit_logs" TO "service_role";



GRANT ALL ON TABLE "public"."inspections" TO "anon";
GRANT ALL ON TABLE "public"."inspections" TO "authenticated";
GRANT ALL ON TABLE "public"."inspections" TO "service_role";



GRANT ALL ON TABLE "public"."jalert_receipts" TO "anon";
GRANT ALL ON TABLE "public"."jalert_receipts" TO "authenticated";
GRANT ALL ON TABLE "public"."jalert_receipts" TO "service_role";



GRANT ALL ON TABLE "public"."live_sessions" TO "anon";
GRANT ALL ON TABLE "public"."live_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."live_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."live_sessions_202606" TO "anon";
GRANT ALL ON TABLE "public"."live_sessions_202606" TO "authenticated";
GRANT ALL ON TABLE "public"."live_sessions_202606" TO "service_role";



GRANT ALL ON TABLE "public"."live_sessions_202607" TO "anon";
GRANT ALL ON TABLE "public"."live_sessions_202607" TO "authenticated";
GRANT ALL ON TABLE "public"."live_sessions_202607" TO "service_role";



GRANT ALL ON TABLE "public"."metric_events" TO "anon";
GRANT ALL ON TABLE "public"."metric_events" TO "authenticated";
GRANT ALL ON TABLE "public"."metric_events" TO "service_role";



GRANT ALL ON SEQUENCE "public"."metric_events_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."metric_events_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."metric_events_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."monitor_checks" TO "anon";
GRANT ALL ON TABLE "public"."monitor_checks" TO "authenticated";
GRANT ALL ON TABLE "public"."monitor_checks" TO "service_role";



GRANT ALL ON TABLE "public"."monitor_daily_stats" TO "anon";
GRANT ALL ON TABLE "public"."monitor_daily_stats" TO "authenticated";
GRANT ALL ON TABLE "public"."monitor_daily_stats" TO "service_role";



GRANT ALL ON TABLE "public"."monitor_incidents" TO "anon";
GRANT ALL ON TABLE "public"."monitor_incidents" TO "authenticated";
GRANT ALL ON TABLE "public"."monitor_incidents" TO "service_role";



GRANT ALL ON TABLE "public"."monitor_reports" TO "anon";
GRANT ALL ON TABLE "public"."monitor_reports" TO "authenticated";
GRANT ALL ON TABLE "public"."monitor_reports" TO "service_role";



GRANT ALL ON TABLE "public"."monitor_results" TO "anon";
GRANT ALL ON TABLE "public"."monitor_results" TO "authenticated";
GRANT ALL ON TABLE "public"."monitor_results" TO "service_role";



GRANT ALL ON TABLE "public"."monitor_results_202606" TO "anon";
GRANT ALL ON TABLE "public"."monitor_results_202606" TO "authenticated";
GRANT ALL ON TABLE "public"."monitor_results_202606" TO "service_role";



GRANT ALL ON TABLE "public"."monitor_results_202607" TO "anon";
GRANT ALL ON TABLE "public"."monitor_results_202607" TO "authenticated";
GRANT ALL ON TABLE "public"."monitor_results_202607" TO "service_role";



GRANT ALL ON TABLE "public"."monitor_settings" TO "anon";
GRANT ALL ON TABLE "public"."monitor_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."monitor_settings" TO "service_role";



GRANT ALL ON TABLE "public"."nvr_models" TO "anon";
GRANT ALL ON TABLE "public"."nvr_models" TO "authenticated";
GRANT ALL ON TABLE "public"."nvr_models" TO "service_role";



GRANT ALL ON TABLE "public"."patrol_findings" TO "anon";
GRANT ALL ON TABLE "public"."patrol_findings" TO "authenticated";
GRANT ALL ON TABLE "public"."patrol_findings" TO "service_role";



GRANT ALL ON TABLE "public"."patrol_runs" TO "anon";
GRANT ALL ON TABLE "public"."patrol_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."patrol_runs" TO "service_role";



GRANT ALL ON TABLE "public"."recorder_cameras" TO "anon";
GRANT ALL ON TABLE "public"."recorder_cameras" TO "authenticated";
GRANT ALL ON TABLE "public"."recorder_cameras" TO "service_role";



GRANT ALL ON TABLE "public"."recorders" TO "anon";
GRANT ALL ON TABLE "public"."recorders" TO "authenticated";
GRANT ALL ON TABLE "public"."recorders" TO "service_role";



GRANT ALL ON TABLE "public"."security_camera_config" TO "anon";
GRANT ALL ON TABLE "public"."security_camera_config" TO "authenticated";
GRANT ALL ON TABLE "public"."security_camera_config" TO "service_role";



GRANT ALL ON TABLE "public"."security_reports" TO "anon";
GRANT ALL ON TABLE "public"."security_reports" TO "authenticated";
GRANT ALL ON TABLE "public"."security_reports" TO "service_role";



GRANT ALL ON TABLE "public"."security_settings" TO "anon";
GRANT ALL ON TABLE "public"."security_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."security_settings" TO "service_role";



GRANT ALL ON TABLE "public"."session_limits" TO "anon";
GRANT ALL ON TABLE "public"."session_limits" TO "authenticated";
GRANT ALL ON TABLE "public"."session_limits" TO "service_role";



GRANT ALL ON TABLE "public"."stores" TO "anon";
GRANT ALL ON TABLE "public"."stores" TO "authenticated";
GRANT ALL ON TABLE "public"."stores" TO "service_role";



GRANT ALL ON TABLE "public"."tenants" TO "anon";
GRANT ALL ON TABLE "public"."tenants" TO "authenticated";
GRANT ALL ON TABLE "public"."tenants" TO "service_role";



GRANT ALL ON TABLE "public"."unmatch_logs" TO "anon";
GRANT ALL ON TABLE "public"."unmatch_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."unmatch_logs" TO "service_role";



GRANT ALL ON TABLE "public"."users" TO "anon";
GRANT ALL ON TABLE "public"."users" TO "authenticated";
GRANT ALL ON TABLE "public"."users" TO "service_role";



GRANT ALL ON TABLE "public"."v_heartbeat_rollout_status" TO "anon";
GRANT ALL ON TABLE "public"."v_heartbeat_rollout_status" TO "authenticated";
GRANT ALL ON TABLE "public"."v_heartbeat_rollout_status" TO "service_role";



GRANT ALL ON TABLE "public"."v_store_nvr_lifecycle" TO "anon";
GRANT ALL ON TABLE "public"."v_store_nvr_lifecycle" TO "authenticated";
GRANT ALL ON TABLE "public"."v_store_nvr_lifecycle" TO "service_role";



GRANT ALL ON TABLE "public"."v_nvr_lifecycle_by_model" TO "anon";
GRANT ALL ON TABLE "public"."v_nvr_lifecycle_by_model" TO "authenticated";
GRANT ALL ON TABLE "public"."v_nvr_lifecycle_by_model" TO "service_role";



GRANT ALL ON TABLE "public"."v_nvr_lifecycle_summary" TO "anon";
GRANT ALL ON TABLE "public"."v_nvr_lifecycle_summary" TO "authenticated";
GRANT ALL ON TABLE "public"."v_nvr_lifecycle_summary" TO "service_role";



GRANT ALL ON TABLE "public"."v_partition_rls_status" TO "anon";
GRANT ALL ON TABLE "public"."v_partition_rls_status" TO "authenticated";
GRANT ALL ON TABLE "public"."v_partition_rls_status" TO "service_role";



GRANT ALL ON TABLE "public"."visitors" TO "anon";
GRANT ALL ON TABLE "public"."visitors" TO "authenticated";
GRANT ALL ON TABLE "public"."visitors" TO "service_role";



GRANT ALL ON TABLE "public"."vod_clips" TO "anon";
GRANT ALL ON TABLE "public"."vod_clips" TO "authenticated";
GRANT ALL ON TABLE "public"."vod_clips" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































