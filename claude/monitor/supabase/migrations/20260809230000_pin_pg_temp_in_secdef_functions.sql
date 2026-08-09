-- SECURITY DEFINER 関数の search_path に pg_temp を明示する。
--
-- `SET search_path = public` だけでは足りない。**pg_temp を列挙しないと、
-- Postgres は一時スキーマを検索順の先頭に置く**（明示した場合のみその位置に
-- なる）。つまり同名の一時テーブルを作られると、関数が参照する先を
-- すり替えられる余地が残る。
--
-- ここに並ぶ 9 本のうち auth_user_role / auth_user_tenant_id /
-- auth_user_store_ids は **RLS ポリシーそのものが呼んでいる**。参照先が
-- ぶれると権限判定がぶれる。
--
-- ── 到達可能性（正直に書いておく）────────────────────────────────────
-- 現状 anon / authenticated は NOLOGIN で、PostgREST 経由では DDL を実行
-- できないため、**この経路が実際に踏まれることは無い**。多層防御としての
-- 固定であって、いま漏れているという話ではない。
-- ただし search_path 未固定の SECURITY DEFINER 関数は、DR 訓練で
-- **リストアを実際に失敗させた**前科がある（docs/dr-runbook.md）。
-- 「今は踏めない」と「固定しなくてよい」は別。
--
-- 検査は tests/rls-meta/rls-meta.test.ts が毎回行う。

alter function public.auth_user_role()                    set search_path to 'public', 'pg_temp';
alter function public.auth_user_store_ids()               set search_path to 'public', 'pg_temp';
alter function public.auth_user_tenant_id()               set search_path to 'public', 'pg_temp';
alter function public.baggage_kiosk_pin_fail(p_store uuid) set search_path to 'public', 'pg_temp';
alter function public.baggage_store_access(p_store uuid)   set search_path to 'public', 'pg_temp';
alter function public.refresh_usage_daily(p_from date, p_to date) set search_path to 'public', 'pg_temp';
alter function public.usage_summary(p_from date, p_to date, p_tenant uuid, p_store_ids uuid[]) set search_path to 'public', 'pg_temp';
alter function public.usage_trend  (p_from date, p_to date, p_tenant uuid, p_store_ids uuid[]) set search_path to 'public', 'pg_temp';
alter function public.usage_weekday(p_from date, p_to date, p_tenant uuid, p_store_ids uuid[]) set search_path to 'public', 'pg_temp';
