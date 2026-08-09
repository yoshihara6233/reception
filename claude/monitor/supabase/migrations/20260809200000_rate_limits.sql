-- 無認証で叩ける受け口のためのレート制限。
--
-- ガード棚卸し（PR #282）で、認証を掛けずに公開しているルートは 3 本と確定した。
-- そのうち /api/auth/reset-link は**メールを送る**ので、無制限だと
--   1. 特定ユーザーへのメール爆撃（受信箱を埋める嫌がらせ）
--   2. Resend の送信枠の消費
-- が誰にでもできる。パスワード再設定は認証の入口そのものなので閉じられない＝
-- 回数で縛るしかない。
--
-- Vercel の関数はインスタンスを跨ぐので、プロセス内カウンタでは効かない。
-- DB に持たせる。判定は 1 文の UPSERT で完結させ、read→write の競合で
-- すり抜けが起きないようにする。

create table if not exists public.rate_limits (
  key          text        primary key,
  window_start timestamptz not null default now(),
  count        int         not null default 0
);

comment on table public.rate_limits is
  '無認証エンドポイントのレート制限カウンタ。key は "用途:識別子"（例 reset-link:email:foo@example.com）。'
  ' 古い行は日次クリーンアップ（/api/admin/vod/cleanup）で削除する。';

create index if not exists rate_limits_window_idx on public.rate_limits (window_start);

-- RLS 有効・ポリシー無し ＝ service_role からのみ触れる。
alter table public.rate_limits enable row level security;

/**
 * 1 回分を計上し、上限内なら true を返す。
 *
 * window_start が窓を過ぎていれば窓ごとリセットして 1 から数え直す。
 * INSERT ... ON CONFLICT DO UPDATE の 1 文なので、同時到達しても
 * カウントが飛んだり二重に許可されたりしない。
 *
 * search_path を固定しているのは、未固定の SECURITY DEFINER 関数が
 * リストアを失敗させた実績があるため（DR 訓練で判明）。
 */
create or replace function public.rate_limit_hit(
  p_key    text,
  p_limit  int,
  p_window interval
) returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_count int;
begin
  insert into public.rate_limits as rl (key, window_start, count)
  values (p_key, now(), 1)
  on conflict (key) do update
    set count = case when rl.window_start < now() - p_window then 1
                     else rl.count + 1 end,
        window_start = case when rl.window_start < now() - p_window then now()
                            else rl.window_start end
  returning rl.count into v_count;

  return v_count <= p_limit;
end;
$$;

comment on function public.rate_limit_hit(text, int, interval) is
  '1回分を計上し上限内なら true。窓を過ぎていればリセット。service_role からのみ呼ぶ。';

-- Supabase 固有のロールは素の Postgres（ローカル検証・authz テスト用DB）に無い。
-- 存在するときだけ触る＝どちらの環境でも同じ SQL が通る。
revoke all on function public.rate_limit_hit(text, int, interval) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.rate_limit_hit(text, int, interval) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.rate_limit_hit(text, int, interval) from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.rate_limit_hit(text, int, interval) to service_role';
  end if;
end $$;
