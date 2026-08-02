-- エッジが実測した「NVR 時計と実時刻の差」（handbook ギャップ #5 の解消）。
-- BCP・発報前コマ・検査クリップは NVR タイムラインから切り出すため、NVR の
-- 時計ズレはそのまま証跡の時刻ズレになる（実例: NTP 未設定で +3 分）。
-- エッジが 30 分毎に HTTP Date ヘッダで実測して報告し、/infra と
-- /admin/edges/[id] が閾値超過（±10 秒）を警告する。

alter table public.edge_devices
  add column if not exists nvr_clock_offset_sec integer,
  add column if not exists nvr_clock_checked_at timestamptz;

comment on column public.edge_devices.nvr_clock_offset_sec is
  'エッジ実測の NVR 時計差（秒・正=NVR が進んでいる）。null=未実測/レコーダなし';
comment on column public.edge_devices.nvr_clock_checked_at is
  'nvr_clock_offset_sec の実測時刻';
