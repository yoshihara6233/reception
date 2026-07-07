-- 映像閲覧アクセスログ（データガバナンス G3）— 証跡静止画のアクセス記録。
--
-- ライブ/グリッド/VOD の閲覧は既存 live_sessions で記録済み。本テーブルは未記録だった
-- 「証跡の静止画アクセス」= 発報スナップ / 発報前後フレーム / 巡回スナップ / BCPエクスポート
-- を記録する。ポーリングやギャラリー再描画での重複を避けるため 5分バケットで dedup。

create table if not exists footage_access_log (
  id            uuid        primary key default gen_random_uuid(),
  actor_user_id uuid        not null,
  store_id      uuid        references stores(id) on delete set null,
  access_type   text        not null check (access_type in (
                  'alarm_snapshot','alarm_frame','patrol_snapshot','bcp_export')),
  resource_id   text,                       -- event_id / frame_id / run_id:camera_id / bcp_event_id
  camera_id     uuid,
  bucket        timestamptz not null,        -- accessed_at を5分床にした重複排除キー
  accessed_at   timestamptz not null default now(),
  -- 同一ユーザ×種別×対象×5分枠は1行に集約（ポーリング/再描画の膨張防止）
  unique (actor_user_id, access_type, resource_id, bucket)
);

create index if not exists footage_access_log_time_idx  on footage_access_log (accessed_at desc);
create index if not exists footage_access_log_store_idx on footage_access_log (store_id, accessed_at desc);

alter table footage_access_log enable row level security;

-- 読み取り: super_admin=全件 / tenant_admin=自テナントの店舗由来のみ。
-- （書き込みは service client でバイパスするため INSERT ポリシーは置かない）
drop policy if exists footage_access_log_select on footage_access_log;
create policy footage_access_log_select on footage_access_log
  for select using (
    exists (
      select 1 from admin_users u
      where u.auth_user_id = auth.uid()
        and (
          u.role = 'super_admin'
          or (u.role = 'tenant_admin' and exists (
                select 1 from stores s
                where s.id = footage_access_log.store_id
                  and s.tenant_id = u.tenant_id))
        )
    )
  );

comment on table footage_access_log is 'データガバナンスG3: 証跡静止画の閲覧アクセス記録（5分バケットdedup）。ライブ/VODは live_sessions。';
