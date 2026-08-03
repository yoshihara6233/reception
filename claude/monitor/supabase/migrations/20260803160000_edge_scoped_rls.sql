-- エッジ専用スコープ鍵化 Phase B2: エッジが触る残りのテーブル/Storage に
-- 「1エッジ・1店舗」スコープの RLS を敷く。
--
-- 【背景】エッジは今も SUPABASE_SERVICE_ROLE_KEY（全RLSバイパスの万能鍵）で
-- Supabase を直接叩いており、bootstrap がその鍵をそのまま返している。
-- device_token が漏れれば全テナント・全店舗の読み書きが取れる（docs/security-assessment.md §4.1）。
-- Phase B1 で edge_jobs だけをエッジ専用の短命トークン(app_metadata.edge_id)へ移した。
-- 本 migration はその他 8 テーブル + Storage 4 バケットに同じスコープを与え、
-- B3（エッジ側の切替）→ B4（bootstrap から service_role 返却を撤廃）を可能にする。
--
-- 【スコープの粒度】
--   - edge_id を持つ表（edge_devices / recorders / edge_jobs）… edge_id 一致
--   - 店舗単位の証跡（inspection_* / bcp_*）……………………… 自エッジの store_id 一致
--   - カメラ単位（vod_clips / recorder_cameras）………………… 自エッジ配下のカメラ
--   同一店舗に複数エッジがある構成では、店舗内の証跡は相互に見える。
--   「全テナント → 1店舗」まで縮めるのが本フェーズの目標。
--
-- 【重要】store_id / tenant_id は **JWT の app_metadata ではなく DB から引く**。
-- 機器入替で edge_devices.store_id を付け替えると app_metadata は古いままになり、
-- 旧店舗の証跡を書ける状態が残るため。JWT から信じるのは edge_id だけ。
--
-- 既存の管理UI向けポリシーは permissive で OR されるだけなので影響しない
-- （エッジ用 auth ユーザは admin_users に居ない＝既存ポリシーには一切マッチしない）。

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. ヘルパ関数
--    search_path は必ず固定する（DR訓練 2026-08-03 の教訓。pg_restore は
--    search_path='' で走るため、非修飾参照があるとリストアがそこで必ず止まる）。
--    pg_temp は必ず最後（先頭だと一時テーブルで本物を隠せる）。
-- ─────────────────────────────────────────────────────────────────────────────

-- 不正な文字列を uuid にキャストすると例外で落ちるため、失敗を NULL に潰す。
-- Storage のオブジェクト名（任意の値が入り得る）をパースするのに使う。
create or replace function public.safe_uuid(p text)
returns uuid
language plpgsql
immutable
set search_path = public, pg_temp
as $$
begin
  return p::uuid;
exception when others then
  return null;
end;
$$;
comment on function public.safe_uuid(text) is 'text→uuid の安全キャスト（不正値は NULL）。Storage パスのパース用。';

-- 現在のトークンが持つ edge_id。エッジ用トークン以外（管理UI・service_role）は NULL。
-- app_metadata は service_role でしか書けないため利用者が詐称することはできない。
create or replace function public.jwt_edge_id()
returns uuid
language sql
stable
set search_path = public, pg_temp
as $$
  select public.safe_uuid(nullif(((auth.jwt() -> 'app_metadata') ->> 'edge_id'), ''))
$$;
comment on function public.jwt_edge_id() is 'エッジ専用トークンの app_metadata.edge_id。それ以外は NULL。';

-- 自エッジの store_id / tenant_id は **DBが正**。
-- SECURITY DEFINER: 参照先の RLS を経由しない（ポリシーからの再帰と権限不足を避ける）。
create or replace function public.jwt_edge_store_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select e.store_id from public.edge_devices e where e.id = public.jwt_edge_id()
$$;
comment on function public.jwt_edge_store_id() is '自エッジの store_id（DB由来。JWTの値は機器入替で陳腐化するため使わない）。';

create or replace function public.jwt_edge_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.tenant_id
  from public.edge_devices e
  join public.stores s on s.id = e.store_id
  where e.id = public.jwt_edge_id()
$$;
comment on function public.jwt_edge_tenant_id() is '自エッジの tenant_id（DB由来）。';

create or replace function public.edge_owns_camera(p_camera_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.recorder_cameras rc
    join public.recorders r on r.id = rc.recorder_id
    where rc.id = p_camera_id
      and r.edge_id = public.jwt_edge_id()
  )
$$;
comment on function public.edge_owns_camera(uuid) is '当該カメラが自エッジ配下のレコーダに属するか。';

create or replace function public.edge_owns_bcp_event(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.bcp_events e
    where e.id = p_event_id
      and e.store_id = public.jwt_edge_store_id()
  )
$$;
comment on function public.edge_owns_bcp_event(uuid) is '当該BCPイベントが自エッジの店舗のものか。';

create or replace function public.edge_owns_inspection_session(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.inspection_sessions s
    where s.id = p_session_id
      and s.store_id = public.jwt_edge_store_id()
  )
$$;
comment on function public.edge_owns_inspection_session(uuid) is '当該検査セッションが自エッジの店舗のものか。';

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. edge_devices — 自分の行のみ SELECT / UPDATE
--    UPDATE ポリシーは列を絞れないため、書き換えてよい列を **ホワイトリスト**で
--    トリガに強制させる（store_id の付け替え＝他店舗への昇格を塞ぐのが主目的）。
--    新しい列は既定で「保護対象」になる（＝安全側に倒れる）。
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists edge_devices_edge_select on public.edge_devices;
create policy edge_devices_edge_select on public.edge_devices
  for select to authenticated
  using (id = public.jwt_edge_id());

drop policy if exists edge_devices_edge_update on public.edge_devices;
create policy edge_devices_edge_update on public.edge_devices
  for update to authenticated
  using      (id = public.jwt_edge_id())
  with check (id = public.jwt_edge_id());

create or replace function public.edge_devices_guard_edge_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  -- エッジが自己申告してよい列だけ。updated_at は touch_updated_at トリガが動かす。
  allowed text[] := array[
    'status', 'last_seen_at', 'agent_version', 'ota_status',
    'pending_command', 'nvr_clock_offset_sec', 'nvr_clock_checked_at', 'updated_at'
  ];
begin
  -- エッジ用トークン以外（service_role / 管理UI）は対象外。
  if public.jwt_edge_id() is null then return new; end if;
  if (to_jsonb(old) - allowed) is distinct from (to_jsonb(new) - allowed) then
    raise exception 'edge token may only update: %', array_to_string(allowed, ', ')
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
comment on function public.edge_devices_guard_edge_update() is
  'エッジ専用トークンでの edge_devices 更新を自己申告列だけに制限（store_id 付け替え等を禁止）。';

drop trigger if exists trg_edges_edge_token_guard on public.edge_devices;
create trigger trg_edges_edge_token_guard
  before update on public.edge_devices
  for each row execute function public.edge_devices_guard_edge_update();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. recorders / recorder_cameras — 自エッジ配下のみ SELECT
--    （既存ポリシーの連鎖でも通るが、明示しておかないと上流を締めた瞬間に
--      エッジが黙って止まる。意図を policy として残す。）
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists recorders_edge_select on public.recorders;
create policy recorders_edge_select on public.recorders
  for select to authenticated
  using (edge_id = public.jwt_edge_id());

drop policy if exists cameras_edge_select on public.recorder_cameras;
create policy cameras_edge_select on public.recorder_cameras
  for select to authenticated
  using (public.edge_owns_camera(id));

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. stores — 自店舗のみ SELECT（クリップ行の tenant_id 解決に使う）
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists stores_edge_select on public.stores;
create policy stores_edge_select on public.stores
  for select to authenticated
  using (id = public.jwt_edge_store_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. 手荷物検査クリップ — 自店舗のジョブを拾って結果を書く
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists inspection_clip_jobs_edge_select on public.inspection_clip_jobs;
create policy inspection_clip_jobs_edge_select on public.inspection_clip_jobs
  for select to authenticated
  using (store_id = public.jwt_edge_store_id());

-- status / retry_count / not_before の書き戻し。店舗を跨いで動かすことはできない。
drop policy if exists inspection_clip_jobs_edge_update on public.inspection_clip_jobs;
create policy inspection_clip_jobs_edge_update on public.inspection_clip_jobs
  for update to authenticated
  using      (store_id = public.jwt_edge_store_id())
  with check (store_id = public.jwt_edge_store_id());

drop policy if exists inspection_clips_edge_select on public.inspection_clips;
create policy inspection_clips_edge_select on public.inspection_clips
  for select to authenticated
  using (store_id = public.jwt_edge_store_id());

-- upsert(onConflict) は INSERT + UPDATE の両方を通る。tenant_id はDB由来の値と一致必須
-- （エッジが任意の tenant_id を載せて他テナントの行を作れないようにする）。
drop policy if exists inspection_clips_edge_insert on public.inspection_clips;
create policy inspection_clips_edge_insert on public.inspection_clips
  for insert to authenticated
  with check (store_id = public.jwt_edge_store_id() and tenant_id = public.jwt_edge_tenant_id());

drop policy if exists inspection_clips_edge_update on public.inspection_clips;
create policy inspection_clips_edge_update on public.inspection_clips
  for update to authenticated
  using      (store_id = public.jwt_edge_store_id())
  with check (store_id = public.jwt_edge_store_id() and tenant_id = public.jwt_edge_tenant_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. vod_clips — 自エッジ配下カメラの行のみ（行の作成は monitor 側）
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists vod_clips_edge_select on public.vod_clips;
create policy vod_clips_edge_select on public.vod_clips
  for select to authenticated
  using (public.edge_owns_camera(camera_id));

drop policy if exists vod_clips_edge_update on public.vod_clips;
create policy vod_clips_edge_update on public.vod_clips
  for update to authenticated
  using      (public.edge_owns_camera(camera_id))
  with check (public.edge_owns_camera(camera_id));

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. BCP — 自店舗のイベントを finalize し、そのイベントのクリップ行を書く
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists bcp_events_edge_select on public.bcp_events;
create policy bcp_events_edge_select on public.bcp_events
  for select to authenticated
  using (store_id = public.jwt_edge_store_id());

drop policy if exists bcp_events_edge_update on public.bcp_events;
create policy bcp_events_edge_update on public.bcp_events
  for update to authenticated
  using      (store_id = public.jwt_edge_store_id())
  with check (store_id = public.jwt_edge_store_id());

drop policy if exists bcp_clips_edge_select on public.bcp_clips;
create policy bcp_clips_edge_select on public.bcp_clips
  for select to authenticated
  using (public.edge_owns_bcp_event(event_id));

drop policy if exists bcp_clips_edge_insert on public.bcp_clips;
create policy bcp_clips_edge_insert on public.bcp_clips
  for insert to authenticated
  with check (public.edge_owns_bcp_event(event_id));

-- プレースホルダ行の後片付け（offset_min IS NULL）。自店舗イベント配下のみ。
drop policy if exists bcp_clips_edge_delete on public.bcp_clips;
create policy bcp_clips_edge_delete on public.bcp_clips
  for delete to authenticated
  using (public.edge_owns_bcp_event(event_id));

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Storage — エッジが書く4バケットをパスでスコープ
--    upsert は INSERT と UPDATE の両方を通るため両方に付ける。DELETE は与えない。
--    storage スキーマが無い環境（authz契約テスト用の素のPostgres）では黙ってスキップ。
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_tables where schemaname = 'storage' and tablename = 'objects'
  ) then
    raise notice 'storage.objects が無いため Storage ポリシーをスキップ（ローカル/テストDB）';
    return;
  end if;

  -- バケットごとのパス規約を1箇所に集約する（storage.foldername に依存するため
  -- storage スキーマがある環境でだけ作る）。パスは各アップロード実装と対で保守する:
  --   edge-grids    edges/<edge_id>/grid.jpg, edges/<edge_id>/cam/<camera_id>/snapshot.jpg
  --   baggage-clips <session_id>/<camera_id>.mp4
  --   bcp-clips     <event_id>/<camera_id>/<offset>_<ts>.jpg
  --   vod-clips     cam_<camera_id>/<from>_<to>.mp4
  execute $p$
    create or replace function public.edge_owns_storage_object(p_bucket text, p_name text)
    returns boolean
    language sql
    stable
    set search_path = public, storage, pg_temp
    as $fn$
      select case p_bucket
        when 'edge-grids' then
          (storage.foldername(p_name))[1] = 'edges'
          and public.safe_uuid((storage.foldername(p_name))[2]) = public.jwt_edge_id()
        when 'baggage-clips' then
          public.edge_owns_inspection_session(
            public.safe_uuid((storage.foldername(p_name))[1]))
        when 'bcp-clips' then
          public.edge_owns_bcp_event(
            public.safe_uuid((storage.foldername(p_name))[1]))
        when 'vod-clips' then
          public.edge_owns_camera(
            public.safe_uuid(substring((storage.foldername(p_name))[1] from 5)))
        else false
      end
    $fn$
  $p$;
  execute $p$
    comment on function public.edge_owns_storage_object(text, text) is
      'エッジが書いてよい Storage オブジェクトか（バケット別のパス規約でスコープ判定）。'
  $p$;

  -- DELETE は与えない（証跡の削除をエッジにできてしまうため）。upsert は
  -- INSERT と UPDATE の両方を通るので、この2つと SELECT だけを許可する。
  execute $p$drop policy if exists edge_objects_select on storage.objects$p$;
  execute $p$
    create policy edge_objects_select on storage.objects
      for select to authenticated
      using (public.edge_owns_storage_object(bucket_id, name))
  $p$;

  execute $p$drop policy if exists edge_objects_insert on storage.objects$p$;
  execute $p$
    create policy edge_objects_insert on storage.objects
      for insert to authenticated
      with check (public.edge_owns_storage_object(bucket_id, name))
  $p$;

  execute $p$drop policy if exists edge_objects_update on storage.objects$p$;
  execute $p$
    create policy edge_objects_update on storage.objects
      for update to authenticated
      using      (public.edge_owns_storage_object(bucket_id, name))
      with check (public.edge_owns_storage_object(bucket_id, name))
  $p$;
end $$;

commit;
