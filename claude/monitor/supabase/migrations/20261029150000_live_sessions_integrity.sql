-- 視聴記録 (live_sessions) を利用者が書き換えられないようにする (2026-10-29・自主診断 ASVS 16.4.2)。
--
-- 視聴記録は「誰が・いつ・どのカメラを・どれだけ見たか」の証跡で、同時視聴の上限の数え方にも使う。
-- 以前は次の 2 つが利用者の接続から自由にできた (PostgREST を直接呼ぶと):
--   - sessions_insert: 自分の名前の行を好きな中身で作れた (上限の判定を通らない偽の記録)
--   - sessions_update: 自分の行のどの列も書き換えられた (始まりの時刻・カメラ・視聴の長さ)
-- 直し方:
--   1. 利用者向けの INSERT のポリシーを外す。視聴の始まりは start_live_session (SECURITY DEFINER・
--      上限の判定つき) だけが作る。
--   2. 利用者の接続からの UPDATE をトリガで絞る。変えてよいのは「終わり」(1 回だけ) と、SFU の
--      部屋の名前 (自分のカメラのものだけ・1 回だけ) だけ。終わりの時刻と長さはサーバの時計で決め、
--      送られた値は使わない。すでに終わった行をもう一度終えても、最初の終わりのまま変えない。
--   service_role (サーバ側の処理・cron) には影響しない。

drop policy if exists sessions_insert on public.live_sessions;

create or replace function public.live_sessions_guard_user_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  free_cols text[] := array['ended_at', 'duration_sec', 'livekit_room'];
begin
  if coalesce(auth.role(), '') <> 'authenticated' then return new; end if;

  if (to_jsonb(new) - free_cols) is distinct from (to_jsonb(old) - free_cols) then
    raise exception 'live_sessions: users may only end a session'
      using errcode = 'insufficient_privilege';
  end if;

  if new.ended_at is distinct from old.ended_at or new.duration_sec is distinct from old.duration_sec then
    if old.ended_at is not null then
      new.ended_at := old.ended_at;          -- 2 回目の終わりは最初の終わりのまま
      new.duration_sec := old.duration_sec;
    else
      new.ended_at := now();                 -- 終わりの時刻と長さはサーバの時計で決める
      new.duration_sec := greatest(0, round(extract(epoch from (now() - old.started_at))))::int;
    end if;
  end if;

  if new.livekit_room is distinct from old.livekit_room then
    if old.livekit_room is not null or old.camera_id is null
       or new.livekit_room is distinct from ('cam_' || old.camera_id::text) then
      raise exception 'live_sessions: livekit_room may only be set once to the session camera'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;
comment on function public.live_sessions_guard_user_update() is
  '利用者の接続からの視聴記録の UPDATE を「終わり (サーバの時計)」と SFU の部屋の名前だけに絞る。';

drop trigger if exists trg_live_sessions_user_guard on public.live_sessions;
create trigger trg_live_sessions_user_guard
  before update on public.live_sessions
  for each row execute function public.live_sessions_guard_user_update();
