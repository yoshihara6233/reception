-- NVMS 連携 Phase 2b: BCP 証跡の大規模カメラ対応（NVMS/docs/UPLINK_CLIPS_SPEC.md）。
--
-- ① recorders.bcp_folder_paths — BCP 対象フォルダ（NVMS レコーダ用）。
--    null = 全フォルダ対象。値は recorder_cameras.folder_path と同じ表示名。
-- ② recorders.bcp_capture_mode — 収集方式。'grid' = フォルダページ（16台）単位の
--    合成静止画（既定・1,000台級でも約500枚に収まる）/ 'per_camera' = 従来どおり
--    カメラ1台8枚（対象フォルダを絞った運用向け。この場合は既存 bcp_clips を使い、
--    既存の詳細画面・PDF が無改修で効く）。nvms 以外のベンダでは読まれない。
-- ③ bcp_grid_shots — 合成モードの証跡（1行 = 1ページ×1オフセットの合成JPEG）。
--    発令側（jalert-poller）が計画行を pending で先置きし、nvmsd のアップロードが
--    completed/failed で決着させる。「期待した枚数」が先に決まるので、
--    全行決着 = イベント完了（clips_uploaded → PDF sweep）を判定できる。

alter table public.recorders
  add column if not exists bcp_folder_paths text[],
  add column if not exists bcp_capture_mode text not null default 'grid';

alter table public.recorders drop constraint if exists recorders_bcp_capture_mode_check;
alter table public.recorders add constraint recorders_bcp_capture_mode_check
  check (bcp_capture_mode in ('grid', 'per_camera'));

comment on column public.recorders.bcp_folder_paths is
  'BCP 証跡の対象フォルダ（nvms 用・表示名）。null = 全フォルダ。';
comment on column public.recorders.bcp_capture_mode is
  'BCP 収集方式（nvms 用）: grid = 16分割合成（既定）/ per_camera = カメラ個別8枚。';

create table if not exists public.bcp_grid_shots (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references public.bcp_events(id) on delete cascade,
  recorder_id   uuid not null references public.recorders(id) on delete cascade,
  folder_path   text,
  -- ページ番号はイベント内で通し（レコーダを跨いでも重複しない）。
  page_no       int  not null,
  -- タイル順の NVMS カメラID（コマンドの channels と同値。PDF の脚注用）。
  channels      integer[] not null,
  offset_min    int  not null,
  storage_path  text,
  upload_status text not null default 'pending'
                check (upload_status in ('pending', 'completed', 'failed')),
  bytes         int,
  -- フレームを載せられなかったカメラID（nvmsd 申告）。PDF の欠落注記用。
  dark_channels integer[] not null default '{}',
  error         text,
  uploaded_at   timestamptz,
  created_at    timestamptz not null default now(),
  unique (event_id, page_no, offset_min)
);

create index if not exists bcp_grid_shots_event_idx on public.bcp_grid_shots (event_id);

alter table public.bcp_grid_shots enable row level security;

-- 閲覧: 親イベントが見える人に見える（bcp_clips_select と同じ考え方 —
-- bcp_events 側の店舗可視性 RLS に委譲する）。
drop policy if exists bcp_grid_shots_select on public.bcp_grid_shots;
create policy bcp_grid_shots_select on public.bcp_grid_shots
  for select using (
    exists (select 1 from public.bcp_events e where e.id = bcp_grid_shots.event_id)
  );

-- 変更: 管理ロールのみ（bcp_clips_modify と同型）。書き込みの実体は
-- service（poller / アップロード受け口）で、利用者からの変更は想定しない。
drop policy if exists bcp_grid_shots_modify on public.bcp_grid_shots;
create policy bcp_grid_shots_modify on public.bcp_grid_shots
  using (
    exists (
      select 1 from public.admin_users u
      where u.auth_user_id = auth.uid()
        and u.role in ('super_admin', 'tenant_admin', 'store_manager')
    )
  );

-- ④ 完了トリガの拡張: bcp_clips が全部決着しても、同じイベントに未決着の
--    合成ショット（bcp_grid_shots）が残っていれば進めない。
--    （店舗に従来エッジと nvms アップリンクが同居した場合の早発火防止。
--      逆方向 = 合成側の最後の決着は、受け口 bcp-grid-complete が両テーブルを
--      数えて進める — トリガは bcp_clips にしか無いため。）
CREATE OR REPLACE FUNCTION public.bcp_check_clips_complete()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_pending_count int;
  v_event_status  text;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.upload_status = NEW.upload_status THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*)
    INTO v_pending_count
    FROM bcp_clips
   WHERE event_id = NEW.event_id
     AND upload_status NOT IN ('completed','failed','skipped_ipro');

  IF v_pending_count = 0 THEN
    -- Phase 2b: 合成ショットの残数も見る
    SELECT COUNT(*)
      INTO v_pending_count
      FROM bcp_grid_shots
     WHERE event_id = NEW.event_id
       AND upload_status = 'pending';
  END IF;

  IF v_pending_count = 0 THEN
    SELECT status INTO v_event_status FROM bcp_events WHERE id = NEW.event_id;
    IF v_event_status NOT IN ('failed','completed') THEN
      UPDATE bcp_events
         SET status = 'clips_uploaded'
       WHERE id = NEW.event_id;
    END IF;
  END IF;

  RETURN NEW;
END $function$;
