-- OAuth のクライアント (G・VMS の拠点) 向けのセッションに最長 24 時間の期限を付ける
-- (2026-10-30・自主診断 ASVS 10.4.8・GVMS_CLOUD_SPEC §9.5)。
--
-- ── 何が足りなかったか ──────────────────────────────────────────────────
-- 拠点へ出した refresh トークンに終わりの期限が無かった。
--   - 2026-10-29 (#410) から、拠点のクライアントは authorization_code だけを許し、refresh トークンを
--     使えない (Supabase はクライアントの grant_types に無い grant を token の受け口で断る)。
--     ただし、それより前に作ったクライアントは、拠点の次の heartbeat で直すまで refresh_token を許した
--     ままで、止まっている拠点のクライアントは直らない。
--   - Supabase Auth のセッションの最長 (Time-box・7 日・docs/session-policy.md) は OAuth の
--     クライアントのセッションにも効く (refresh のときに同じ確かめを通る)。しかしダッシュボードの設定
--     (有料のプランの機能) で、設定が外れると期限が無くなる。また OAuth のクライアントだけを短くする
--     設定は Supabase に無い。
--
-- ── 何をするか ──────────────────────────────────────────────────────────
-- 拠点は認可コードで 1 度だけ身元を受け取り、自分のセッションを作る。クラウドのセッションは
-- 受け取った時点で用が済む。そこで、OAuth のクライアント向けのセッション (auth.sessions.oauth_client_id
-- が入っているもの) を、作ってから 24 時間で消す。refresh トークンは外部キーの cascade で一緒に消え、
-- 以後は使えない (セッションを消したトークンは画面・API・DB で使えない・20261030090000)。
--   1. purge_oauth_client_sessions(): 24 時間を過ぎたものを消す (service_role だけ)
--   2. pg_cron で 15 分ごとに呼ぶ (最長は 24 時間 15 分)
--   3. 当てた時点で 1 度呼び、今ある古いもの (#410 より前に出した refresh トークン) を消す
-- クラウドの画面のログイン (oauth_client_id が空) には触れない。
-- 冪等: 関数は create or replace、cron は名前で作り直す。

create or replace function public.purge_oauth_client_sessions(p_max_age interval default interval '24 hours')
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  n integer;
begin
  -- 24 時間より長くは許さない (呼び出しの誤りで期限を延ばせないように)
  if p_max_age is null or p_max_age > interval '24 hours' or p_max_age < interval '0' then
    p_max_age := interval '24 hours';
  end if;
  delete from auth.sessions
   where oauth_client_id is not null
     and created_at < now() - p_max_age;
  get diagnostics n = row_count;
  return n;
end;
$$;
comment on function public.purge_oauth_client_sessions(interval) is
  'OAuth のクライアント (G・VMS の拠点) 向けのセッションを、作ってから 24 時間 (既定・上限) で消す。消した数を返す (ASVS 10.4.8)。';
revoke all on function public.purge_oauth_client_sessions(interval) from public, anon, authenticated;
grant execute on function public.purge_oauth_client_sessions(interval) to service_role;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron 未導入のため oauth_client_session_purge の登録をスキップ（素の Postgres 等）';
    return;
  end if;
  perform cron.unschedule('oauth_client_session_purge')
    where exists (select 1 from cron.job where jobname = 'oauth_client_session_purge');
  perform cron.schedule('oauth_client_session_purge', '*/15 * * * *', 'select public.purge_oauth_client_sessions();');
end $$;

-- 今ある古いものを消す (#410 より前に拠点へ出した refresh トークンを含む)
select public.purge_oauth_client_sessions();
