-- F77 / Phase 8.4-B — Storage Direct VOD
--
-- ライフサイクル
-- ──────────────
--   1. ユーザが /vod ページを開く     → ブラウザが vod_clips 行を作成 (status='queued')
--   2. ブラウザ → edge-agent          → start_vod (clip_id を含む)
--   3. edge-agent                     → Frigate clip.mp4 を fetch + vod-clips バケットに upload
--                                       → status='uploading' → 'ready' (storage_path セット)
--   4. ブラウザは status を polling  → ready 確認後 <video src="/api/vod/<id>"> でネイティブ再生
--
-- 設計判断
--   - "vod_session" ではなく "vod_clip" にしたのは、クリップが Storage に残るため。
--     スクラブのたびに新規 ingress を作っていた旧設計 (LiveKit WHIP) と違い、ファイルは1本。
--   - event_id は持たない: VOD は監視オペレータが任意の範囲を選んで再生する機能で、
--     特定の BCP イベントとは結びつかない。
--   - 既存の live_sessions (mode='vod') は audit ログとして引き続き使う。

create table if not exists public.vod_clips (
  id              uuid primary key default gen_random_uuid(),
  -- 対象 (RLS は camera_id 経由で tenant scope に絞る)
  camera_id       uuid not null references public.recorder_cameras(id) on delete cascade,
  edge_device_id  uuid not null references public.edge_devices(id) on delete cascade,
  -- 要求された時間範囲 (ユーザがピッカーで選んだ window)
  requested_from  timestamptz not null,
  requested_to    timestamptz not null,
  -- 実際にクリップに含まれる範囲。録画が requested 範囲を満たさない場合は短くなる。
  actual_from     timestamptz,
  actual_to       timestamptz,
  duration_sec    numeric,
  -- Storage
  storage_path    text,             -- 'cam_<id>/<startIso>_<endIso>.mp4' 等
  bytes           bigint,
  -- 状態機械
  status          text not null check (status in ('queued','uploading','ready','failed'))
                  default 'queued',
  error           text,             -- status='failed' 時のメッセージ
  -- タイムスタンプ
  created_at      timestamptz not null default now(),
  uploading_at    timestamptz,
  ready_at        timestamptz,
  -- 監査
  requested_by    uuid              -- auth.users.id (nullable for system/edge-initiated)
);

comment on table public.vod_clips is
  'F77 / Phase 8.4-B: Pre-uploaded VOD clips. The edge-agent fetches a recorded segment from the NVR (Frigate clip.mp4 etc.), uploads it to the vod-clips bucket, and flips status to ready. The browser polls and plays via HTML5 <video> + signed URL — no LiveKit/WHIP.';

create index if not exists vod_clips_camera_idx
  on public.vod_clips(camera_id, requested_from desc);
create index if not exists vod_clips_status_idx
  on public.vod_clips(status)
  where status in ('queued','uploading');

alter table public.vod_clips enable row level security;

-- 認証済ユーザは自分のテナントの camera に紐づくクリップだけ読める。
-- camera → recorder → edge_device → store のチェーンを stores の RLS で受ける。
do $$ begin
  create policy vod_clips_select on public.vod_clips
    for select to authenticated
    using (
      exists (
        select 1
          from public.recorder_cameras rc
          join public.recorders        r  on r.id = rc.recorder_id
          join public.edge_devices     ed on ed.id = r.edge_id
          join public.stores           s  on s.id = ed.store_id
         where rc.id = vod_clips.camera_id
      )
    );
exception when duplicate_object then null; end $$;

-- 作成は API route 経由 (Service Role) のみ。ブラウザからの直接 insert は禁止。
do $$ begin
  create policy vod_clips_insert_authed on public.vod_clips
    for insert to authenticated
    with check (false);   -- block direct insert; API uses service role
exception when duplicate_object then null; end $$;
