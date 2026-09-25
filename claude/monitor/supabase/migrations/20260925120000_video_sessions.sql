-- 遠隔視聴（G・VMS-Cloud 接続仕様 v1 §2・§5。NVMS/docs/GVMS_CLOUD_SPEC.md）。
--
-- ① edge_devices に「版と使える機能の名乗り」（§2）と遠隔視聴の状況（§5.5 の
--    heartbeat.video）を持たせる。名乗りの無い拠点（nvmsd 0.1.67 以前）は
--    capabilities = null とし、アプリ側で既定の機能一覧として扱う。
--
-- ② video_sessions — 1 回の視聴 = 1 行（§5.1）。id がそのまま拠点へ渡す session_id。
--    開始・生存の合図（refresh_video）・停止の指示は pending_command の 1 枠に載せず、
--    GET /api/edge/commands/next がこの表から**その場で組み立てて**返す。
--      - 30 秒ごとの合図を複数セッションぶん流しても、既存の指示と枠を奪い合わない。
--      - 署名付き URL を DB に置かない（払い出すたびに作る。§6）。
--    送り先（R2）の実体はセッションの終了後に cron が消す（purged_at）。

alter table public.edge_devices
  add column if not exists spec_version       int,
  add column if not exists capabilities       text[],
  add column if not exists video_sessions_now int,
  add column if not exists video_kbps         int,
  add column if not exists video_reported_at  timestamptz;

comment on column public.edge_devices.spec_version is
  'GVMS_CLOUD_SPEC の版（heartbeat の名乗り・§2）。null=名乗り無し。';
comment on column public.edge_devices.capabilities is
  '拠点が名乗った使える機能（§2）。null=名乗り無し（0.1.67 以前の既定の一覧として扱う）。';
comment on column public.edge_devices.video_sessions_now is
  '遠隔視聴の同時本数（heartbeat.video.sessions・§5.5）。送っていなければ 0。';
comment on column public.edge_devices.video_kbps is
  '遠隔視聴の上りの送信量 kbps（heartbeat.video.kbps・§5.5）。';

create table if not exists public.video_sessions (
  id                uuid primary key default gen_random_uuid(),
  edge_id           uuid not null references public.edge_devices(id) on delete cascade,
  camera_id         uuid not null references public.recorder_cameras(id) on delete cascade,
  store_id          uuid not null references public.stores(id) on delete cascade,
  user_id           uuid not null,
  viewer_name       text not null,
  kind              text not null check (kind in ('hls_live', 'hls_vod', 'sfu')),
  stream            text not null default 'sub' check (stream in ('sub', 'main')),
  vod_from          timestamptz,
  vod_to            timestamptz,
  -- requested → dispatched（開始の指示を渡した）→ started（ok:true）→ 終わり
  -- 終わり: ended（録画再生の終わり）/ stopped（止めた・合図切れ）/ error（失敗）
  state             text not null default 'requested'
                    check (state in ('requested', 'dispatched', 'started', 'ended', 'stopped', 'error')),
  error             text,
  start_request_id  uuid unique,
  -- 視聴画面の生存（画面が 10 秒ごとに更新）。途切れたら止める
  viewer_seen_at    timestamptz not null default now(),
  stop_requested_at timestamptz,
  refresh_sent_at   timestamptz,
  playlist_ready_at timestamptz,
  created_at        timestamptz not null default now(),
  dispatched_at     timestamptz,
  started_at        timestamptz,
  ended_at          timestamptz,
  purged_at         timestamptz,
  constraint video_sessions_vod_range check (
    kind <> 'hls_vod' or (vod_from is not null and vod_to is not null and vod_to > vod_from)
  )
);

comment on table public.video_sessions is
  '遠隔視聴のセッション（GVMS_CLOUD_SPEC §5.1）。id = 拠点へ渡す session_id。使用量（本数・時間）の記録も兼ねる。';

-- commands/next が毎秒引く「この拠点の動いているセッション」
create index if not exists video_sessions_edge_active_idx
  on public.video_sessions (edge_id)
  where state in ('requested', 'dispatched', 'started');

-- cron の片付け（終わったのに置き場を消していないもの）
create index if not exists video_sessions_purge_idx
  on public.video_sessions (ended_at)
  where purged_at is null;

create index if not exists video_sessions_store_created_idx
  on public.video_sessions (store_id, created_at desc);

alter table public.video_sessions enable row level security;

-- 読み取り: 本人のセッションと super_admin（使用量の集計）。
-- 書き込みは API（service role）だけ — 利用者は開始・停止を API 経由でしか行わない。
drop policy if exists video_sessions_select on public.video_sessions;
create policy video_sessions_select on public.video_sessions
  for select using (
    user_id = auth.uid()
    or exists (
      select 1 from public.admin_users u
      where u.auth_user_id = auth.uid() and u.role = 'super_admin'
    )
  );
