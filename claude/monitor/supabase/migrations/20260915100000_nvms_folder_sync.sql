-- NVMS 連携 Phase 1.5: フォルダ同期・大規模カメラ・死活サマリ受信の土台。
-- 設計: NVMS/docs/NVMS_RecorderMonitor連携設計.html（M1〜M3）。
--
-- ① channel の上限 64 を撤廃する。
--    Phase 1 で「recorder_cameras.channel = NVMS のカメラ ID」と定めたが、
--    NVMS の ID は連番で 64 を超える（開発機で既に 257 が実在）。従来ベンダは
--    物理チャンネル番号なので 64 で足りていたが、この制約のままだと NVMS の
--    65 台目以降が**同期の段階で挿入エラー**になる。上限だけ広げる（>=1 は維持）。
--
-- ② grid_pos に -1（ページ割付外）を許す。
--    NVMS 同期カメラはフォルダ→16分割ページの自動割付で表示するため、
--    固定スロット grid_pos を持たない。「割付なし」を NULL でなく -1 にするのは
--    NOT NULL を保ち既存コード（>=0 をスロットとして扱う）を壊さないため。
--
-- ③ recorder_cameras.folder_path — NVMS のフォルダ表示名（例: '本社 / 3F / 東'）。
--    グリッドのグループタブとカメラ一覧の絞り込みの供給源。正は NVMS 側で、
--    エッジが同期のたびに上書きする（こちらでの編集は想定しない）。
--
-- ④ recorders.health / health_at — NVMS 報告型の死活サマリ。
--    10万台をクラウドから個別ポーリングしない。エッジが NVMS の
--    health/detail・storage・recordings/gaps を集約して 5 分ごとに書く。
--    形は jsonb（NVMS 側の進化に追従するため）。判定・表示側で必須キーだけ読む。

alter table public.recorder_cameras drop constraint if exists recorder_cameras_channel_check;
alter table public.recorder_cameras add constraint recorder_cameras_channel_check
  check (channel >= 1);

alter table public.recorder_cameras drop constraint if exists recorder_cameras_grid_pos_check;
alter table public.recorder_cameras add constraint recorder_cameras_grid_pos_check
  check (grid_pos >= -1 and grid_pos <= 47);

alter table public.recorder_cameras
  add column if not exists folder_path text;

comment on column public.recorder_cameras.channel is
  'カメラ番号。従来ベンダ=物理CH、nvms=NVMSのカメラID（連番・上限なし）。';
comment on column public.recorder_cameras.grid_pos is
  '固定16分割のスロット(0-47)。-1 = 割付なし（NVMS同期カメラ等。フォルダページで表示）。';
comment on column public.recorder_cameras.folder_path is
  'NVMS フォルダの表示名（例: 本社 / 3F / 東）。正は NVMS・エッジ同期が上書き。NULL=未分類/非NVMS。';

alter table public.recorders
  add column if not exists health jsonb,
  add column if not exists health_at timestamptz;

comment on column public.recorders.health is
  'NVMS 報告型の死活サマリ（cameras_total/online/offline・down 上位・gaps_24h・disk_days_left 等）。エッジが5分毎に更新。';
comment on column public.recorders.health_at is
  'health の受信時刻。古い（>15分）まま止まっていたら、エッジか NVMS のどちらかが沈黙している。';
