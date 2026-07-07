-- エッジ死活監視: 重複アラート抑止用のタイムスタンプ。
-- 2026-06-21: cron(/api/cron/edge-health)が last_seen_at の古いエッジを検知して
--   メール通知する際、通知済みフラグとして使う。停止中は alerted_at をセット、
--   復旧(last_seen_at が新しくなった)時に NULL に戻す。これで 5分毎に同じ
--   ダウンを繰り返し通知しない。

ALTER TABLE edge_devices ADD COLUMN IF NOT EXISTS alerted_at timestamptz;

COMMENT ON COLUMN edge_devices.alerted_at IS
  'エッジ死活アラートを送信した時刻。停止検知時にセット、復旧時にNULL。重複通知抑止用。';
