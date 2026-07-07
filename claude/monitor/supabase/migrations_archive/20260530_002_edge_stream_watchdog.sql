-- C8: 無人ストリーム ウォッチドッグ（unattended-stream watchdog）
--
-- 目的: ビューア(ブラウザ)が stop_stream を送らずに離脱した／エッジが配信中に
--       落ちた場合に、エッジが LiveKit へ無期限に publish し続ける（コスト・
--       プライバシー上の問題）のを防ぐ。クラウド側の掃引で能動的に止める。
--
-- 前提（スキーマ事実）:
--   * edge_devices.status ∈ (offline,idle,grid,live,vod,error,bcp)
--   * heartbeat() は status + last_seen_at を HEARTBEAT_INTERVAL_MS(=60s) 毎に更新。
--     → last_seen_at の鮮度は約60秒粒度。閾値は十分上に取る。
--   * クラウドの commands API が pending_command(jsonb) + pending_command_at を書く。
--     エッジは消費後 pending_command を null にするが pending_command_at は残す。
--     → pending_command_at ≒「現セッションが最後にコマンドされた時刻」。VODシークの
--       度に新しい start_vod が書かれ pending_command_at が更新されるため、操作中の
--       ビューアはこの時計をリセットし続け、放置されたセッションだけが老朽化する。
--   * エッジは pending_command を request_id でデデュープし、2秒毎にポーリング。
--
-- 既存の monitor_sweep_edges() は offline インシデントを起票するだけで status の
-- リセットも stop_stream 送出も行わない。本ウォッチドッグがその穴を埋める。
--
-- Idempotent: CREATE OR REPLACE / DROP ... IF EXISTS / ON CONFLICT DO NOTHING。

-- ---------------------------------------------------------------------------
-- monitor_sweep_unattended_streams()
--   Case 1: 配信中(grid/live/vod/bcp) かつ heartbeat 失効 → エッジ死亡。
--           DB の status を真実(offline)へ戻す。stop_stream は送らない
--           （死んだエッジはポーリングしないので無意味）。offline 警報は
--           monitor_sweep_edges() の edge_offline が担う。
--   Case 2: 配信中(grid/live/vod) かつ heartbeat 健在 だが セッションが上限超過
--           → ビューア放置の疑い。stop_stream を pending_command に書いて
--           エッジに idle へ戻させる（生存・ポーリング中なので2秒以内に消費）。
--           bcp は固定長の自己終了ジョブなので対象外（中断しない）。
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION monitor_sweep_unattended_streams() RETURNS void
LANGUAGE plpgsql AS $$
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

-- pg_cron 登録（拡張があれば毎分）。無い環境ではスキップ
-- （外部cron/手動 SELECT monitor_sweep_unattended_streams() で代替）。
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'monitor_sweep_unattended_streams', '* * * * *',
      'SELECT monitor_sweep_unattended_streams();');
  END IF;
END $$;
