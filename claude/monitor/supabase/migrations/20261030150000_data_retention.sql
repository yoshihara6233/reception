-- データの保持期間 (2026-10-30 発注者の決定) を自動で消すための列とトリガ。
-- 削除そのものは日次の cron `/api/cron/data-retention` が行う (docs/data-classification.md §3・§4)。
--
--   従業員の顔 (Rekognition の常設のコレクションの顔と、置き場の顔写真):
--     登録を外したら即時に消す (今どおり・取りこぼしを cron が拾う)。
--     加えて 1 年照合に使っていなければ消す → 最後に照合に使った時刻 face_last_matched_at が要る
--   従業員の氏名: 登録を外してから 1 年で行ごと消す → 登録を外した時刻 deactivated_at が要る
--   BCP の生画像: 90 日 → 消したことを画面に出し、PDF の作り直しで確認済みの PDF を
--     画像の無いもので上書きしないよう、bcp_events.raw_purged_at に印を付ける
--
-- 何度当てても同じ結果になる (列は if not exists・埋めるのは空の行だけ・関数とトリガは作り直す)。

-- ── 1. 列 ─────────────────────────────────────────────────────────────────
alter table public.employees
  add column if not exists face_last_matched_at timestamptz,
  add column if not exists deactivated_at       timestamptz;

comment on column public.employees.face_last_matched_at is
  '顔を登録した時刻か、キオスクの照合で最後に一致した時刻の遅いほう。1 年を過ぎると顔 (Rekognition と写真) を消す (/api/cron/data-retention)。';
comment on column public.employees.deactivated_at is
  '登録を外した (status=inactive にした) 時刻。1 年を過ぎると行ごと消す (氏名・社員番号の保持・/api/cron/data-retention)。';

alter table public.bcp_events
  add column if not exists raw_purged_at timestamptz;

comment on column public.bcp_events.raw_purged_at is
  'BCP の生画像 (bcp-clips の置き場・bcp_clips・bcp_grid_shots) を保持期間 (90 日) で消した時刻。PDF は残す。';

-- ── 2. 今ある行を埋める (トリガを作る前に) ─────────────────────────────────
-- 顔: いつ最後に照合に使ったかの記録が無い (検査の記録は既定 60 日で消えるので、それより前は分からない)。
-- 早く消しすぎないよう、この migration を当てた時刻から数え始める。
update public.employees
   set face_last_matched_at = now()
 where face_last_matched_at is null
   and (rekognition_face_id is not null or face_photo_path is not null);

-- 氏名: 登録を外した操作の記録 (admin_audit_log の baggage.employee.deactivate) があればその時刻、
-- 無ければこの migration を当てた時刻から数える。
update public.employees e
   set deactivated_at = coalesce(
         (select max(a.ts) from public.admin_audit_log a
           where a.action = 'baggage.employee.deactivate' and a.target_id = e.id),
         now())
 where e.status = 'inactive'
   and e.deactivated_at is null;

-- ── 3. 時刻はサーバが書く (トリガ) ─────────────────────────────────────────
-- 登録を外した時刻・顔を登録した時刻を、どの経路で変えても書き漏らさないようにする。
-- 利用者の接続 (authenticated) からは 2 つの列を書き換えさせない (期限を延ばす・早めることを防ぐ)。
-- service_role (サーバの処理・照合のたびの更新) はそのまま書ける。
create or replace function public.employees_retention_stamps()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if coalesce(auth.role(), '') = 'authenticated' then
    if tg_op = 'INSERT' then
      new.face_last_matched_at := null;
      new.deactivated_at := null;
    else
      new.face_last_matched_at := old.face_last_matched_at;
      new.deactivated_at := old.deactivated_at;
    end if;
  end if;

  if tg_op = 'INSERT' then
    if new.status = 'inactive' and new.deactivated_at is null then
      new.deactivated_at := now();
    end if;
    if new.rekognition_face_id is not null and new.face_last_matched_at is null then
      new.face_last_matched_at := now();
    end if;
    return new;
  end if;

  -- 登録を外した時刻 (外したときだけ書く・戻したら消す)
  if new.status = 'inactive' and old.status is distinct from 'inactive' then
    new.deactivated_at := now();
  elsif new.status = 'active' then
    new.deactivated_at := null;
  end if;

  -- 顔を (登録し直して) 新しくしたら、そこから 1 年を数え直す
  if new.rekognition_face_id is not null
     and new.rekognition_face_id is distinct from old.rekognition_face_id then
    new.face_last_matched_at := now();
  end if;
  return new;
end;
$$;

comment on function public.employees_retention_stamps() is
  '従業員の保持期間の時刻 (deactivated_at・face_last_matched_at) をサーバの時計で書く。利用者の接続からは変えさせない。';

drop trigger if exists trg_employees_retention_stamps on public.employees;
create trigger trg_employees_retention_stamps
  before insert or update on public.employees
  for each row execute function public.employees_retention_stamps();

-- BCP の生画像を消した印は、利用者・エッジの接続 (authenticated) からは外させない
-- (bcp_events にはエッジの UPDATE のポリシーがある)。
create or replace function public.bcp_events_keep_raw_purged()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if coalesce(auth.role(), '') = 'authenticated' then
    new.raw_purged_at := old.raw_purged_at;
  end if;
  return new;
end;
$$;

comment on function public.bcp_events_keep_raw_purged() is
  'bcp_events.raw_purged_at (生画像を消した印) を利用者・エッジの接続から書き換えさせない。';

drop trigger if exists trg_bcp_events_keep_raw_purged on public.bcp_events;
create trigger trg_bcp_events_keep_raw_purged
  before update on public.bcp_events
  for each row execute function public.bcp_events_keep_raw_purged();

-- ── 4. cron が引くための索引 (小さい部分索引) ─────────────────────────────
create index if not exists idx_employees_retention_inactive
  on public.employees (deactivated_at) where status = 'inactive';
create index if not exists idx_employees_retention_face
  on public.employees (face_last_matched_at)
  where rekognition_face_id is not null or face_photo_path is not null;
create index if not exists idx_bcp_events_raw_pending
  on public.bcp_events (created_at) where raw_purged_at is null;
create index if not exists idx_video_sessions_created
  on public.video_sessions (created_at);
