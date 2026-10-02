-- recorder_cameras.removed_at: G・VMS 側で削除したカメラの印 (2026-10-02)。
--
-- NVMS 同期 (/api/edge/nvms-sync) は、G・VMS から消えたカメラを enabled=false にするだけで
-- 行を残している。行を消すと vod_clips・video_sessions が一緒に消え (on delete cascade)、
-- alarm_events・alarm_frames は削除そのものが失敗し、bcp_clips などはカメラ名を失うため。
--
-- ただし enabled=false は「G・VMS で無効にしただけのカメラ」(登録は残っていてライセンスにも数える) と
-- 区別できず、消したカメラがエッジサーバの一覧・拠点の側の一覧に「無効」で残り続け、
-- ライセンス・拠点稼働・拠点導入・利用状況レポートの台数にも数えられていた
-- (.200 の拠点で G・VMS 81 台に対しクラウド 131 台)。
--
-- 消したカメラはこの列に日時を入れて区別し、画面と台数から外す。行そのものは残す。
-- 既存の行は埋めない — 同期 (10 分ごと) が次の回に G・VMS に無いカメラへ日時を入れる。

alter table public.recorder_cameras
  add column if not exists removed_at timestamptz;

comment on column public.recorder_cameras.removed_at is
  'G・VMS 側で削除された日時 (NVMS 同期が入れる)。null = G・VMS に登録あり。行は過去の証跡の参照のため残す';

-- 台数の集計は「レコーダごとの、削除されていないカメラ」を引く。
create index if not exists idx_cameras_recorder_present
  on public.recorder_cameras (recorder_id)
  where removed_at is null;
