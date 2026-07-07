-- 是正3: PB7 タイムライン収集のディスパッチ記録とリトライ
--
-- 発報 ingest 時、エッジの pending_command（単一スロット）が巡回/BCP で埋まっていると
-- capture_alarm_timeline が黙って発火しなかった。ディスパッチ成功時刻を記録し、
-- 未ディスパッチの直近発報を cron (/api/cron/alarm-dispatch-retry) が再送する。
--
-- timeline_dispatched_at IS NULL かつ直近30分の行だけが再送対象（既存の過去行は
-- occurred_at 条件で自然に対象外）。

alter table alarm_events
  add column if not exists timeline_dispatched_at timestamptz;

comment on column alarm_events.timeline_dispatched_at is
  'capture_alarm_timeline をエッジへディスパッチできた時刻。NULL＝未ディスパッチ（cron が直近分を再送）';

-- リトライ cron の走査用（未ディスパッチ×時刻）。部分インデックスで小さく保つ。
create index if not exists alarm_events_timeline_retry_idx
  on alarm_events (occurred_at desc)
  where timeline_dispatched_at is null;
