-- G・VMS の SFU 遠隔ライブ（GVMS_CLOUD_SPEC §5.4）のために video_sessions へ 2 列を足す。
--
-- ingress_id: セッションごとに作る LiveKit の WHIP 受け口（Ingress）の ID。
--             stop_video のあと・終わったあとの片付けで消すために持つ。
--             **送り先の URL（ストリームキー入り）は秘密なので DB に置かない**（§6）。
-- room:       視聴者がつなぐ LiveKit の部屋（gvms_<session_id>）。
--             従来のエッジ向け SFU（cam_<camera_id>）と分け、その片付け cron に巻き込ませない。
--
-- 列を足すだけで、既存のコードと行には影響しない。
alter table public.video_sessions add column if not exists ingress_id text;
alter table public.video_sessions add column if not exists room text;

-- 片付け（cron）が「終わったのに受け口が残っている SFU」を拾うための索引
create index if not exists video_sessions_sfu_ingress_idx
  on public.video_sessions (ended_at)
  where kind = 'sfu' and ingress_id is not null and purged_at is null;
