-- J アラートの取り込み（jalert-poller）の起動を、旧式の service_role の鍵から専用の合言葉へ替える
-- （2026-11-09・ASVS 13.3.2・service_role の鍵の作り直し）。
--
-- 以前は Vault の service_role_key（旧式の鍵・JWT）を Bearer で送り、関数の入口の JWT の確かめで通していた。
-- これでは旧式の鍵を止めると J アラートの取り込みが止まる。関数は専用の合言葉 JALERT_INVOKE_SECRET で
-- 呼び出しを確かめる形にしたので（supabase/functions/jalert-poller/auth.ts）、ここでは Vault の
-- jalert_invoke_secret を送る。
--
-- 切り替えの間だけ、jalert_invoke_secret が無ければ以前どおり service_role_key を送る
-- （Vault に入れる前にこの移行が当たっても止まらない）。旧式の鍵を止める前に Vault の service_role_key を消す。
-- 手順: docs/security-keys.md §5。値は Vault にだけ置き、この移行には書かない。
--
-- CREATE OR REPLACE は所有者と GRANT を保つ。SET search_path は付け直す（20260803140000 と同じ）。

create or replace function public.invoke_jalert_poller()
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_url text;
  v_key text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'jalert_invoke_secret';
  if v_key is null then
    -- 切り替えの間だけ（Vault に jalert_invoke_secret を入れる前）
    select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key';
  end if;

  if v_url is null or v_key is null then
    raise notice 'invoke_jalert_poller: project_url / jalert_invoke_secret が Vault に未設定のためスキップ';
    return;
  end if;

  perform net.http_post(
    url     := v_url || '/functions/v1/jalert-poller',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || v_key
               ),
    body    := '{}'::jsonb
  );
end $$;

comment on function public.invoke_jalert_poller() is
  'cron jalert_poll が毎分呼ぶ。Vault の jalert_invoke_secret（専用の合言葉）を付けて jalert-poller を起動する。'
  ' service_role_key への逃げ道は切り替えの間だけ（docs/security-keys.md §5）。';
