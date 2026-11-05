-- tenants の RLS を直す (2026-11-05・#450 の「判断が要るもの」・発注者の判断で直す)。
--
-- ── 何が起きていたか ────────────────────────────────────────────────────
-- テナント管理者の編集の画面でテナントの選択肢が空 (「指定なし」) になった (#450 の 5)。
-- 利用者の接続で tenants を読むと、自分のテナントも含めて 1 行も返らない。
--
-- ── 原因 ────────────────────────────────────────────────────────────────
-- tenants のポリシー tenant_isolation は auth_role()・auth_tenant_id() で判定するが、
-- この 2 つの関数 (remote baseline 由来) が**誰に対しても NULL を返す**:
--   1. auth.jwt() -> 'raw_app_meta_data' を読んでいる。raw_app_meta_data は auth.users の
--      列の名前で、JWT の claim には無い (JWT にあるのは app_metadata)。
--   2. app_metadata にしても、利用者の役割とテナントは入れていない。役割とテナントの正は
--      admin_users の表 (auth_user_role()・auth_user_tenant_id() が読む)。
--   3. 運営の役割の名前が 'saas_admin' のまま。今の役割は super_admin で、saas_admin は無い。
-- そのため tenant_isolation は常に偽で、利用者の接続では tenants が全拒否になっていた。
-- 今のアプリは tenants をすべてサービスの接続で読んでいる (#450 で残りもそうした) ので
-- 画面には出ないが、利用者の接続で読むと空になる。
--
-- ── 直し方 ──────────────────────────────────────────────────────────────
--   1. tenants: tenant_isolation を消し、tenants_select (読むだけ) を置く。
--      全体管理者 (super_admin) は全テナント・それ以外は自分のテナントだけ。
--      判定は stores_select などと同じ auth_user_role()・auth_user_tenant_id()。
--      tests/authz/schema.sql の「意図するモデル」(tenants_select) と同じ条件。
--      書き込みのポリシーは置かない (これまでどおりサービスの接続だけが書く)。
--   2. auth_role()・auth_tenant_id() を使う残りのポリシー 12 本を消し、2 つの関数も消す。
--      どれも上の理由で**常に偽**なので、消しても今の動き (利用者の接続では通らない) は変わらない。
--      - stores.store_isolation: stores_select・stores_insert・stores_update・stores_delete が別にある
--      - 旧受付の表 (alert_logs・consent_documents・employees・entry_exit_logs・inspections・
--        unmatch_logs・users・visitors): アプリはサービスの接続でしか使っていない (employees は
--        手荷物検査の受け口がサービスの接続で読む)。RESTRICTIVE の 3 本 (first_party_only・
--        mfa_aal2_only・tenant_active_only) は残るので「ポリシーが 0 本の表」にはならない
--   ★ 関数の中身だけを「正しく」直す (admin_users を読む) のは**しない**。store_isolation などは
--      FOR ALL なので、関数が値を返した途端に、テナントの全員 (閲覧者を含む) が拠点や従業員の
--      行を書き換え・削除できるようになる。壊れた関数を残すと、後で誰かが同じ直し方をする罠になる。
--
-- ── 本番への入れ方 ──────────────────────────────────────────────────────
-- `supabase db push` は使わない (手で入れた移行が履歴に無く、14 本が再度流れる)。
-- この 1 本だけを `supabase db query` で入れる (手順は PR の本文)。
-- 1 つの取引で当てる。関数に、ここに書いていない依存 (本番だけのポリシーなど) が残っていると
-- drop function が失敗し、全体が元に戻る (cascade は付けない)。
-- 冪等: drop ... if exists と create policy の前の drop policy if exists で、2 度当てても同じになる。

begin;

-- 1. tenants
drop policy if exists tenant_isolation on public.tenants;
drop policy if exists tenants_select on public.tenants;
create policy tenants_select on public.tenants
  for select to authenticated
  using (
    public.auth_user_role() = 'super_admin'
    or id = public.auth_user_tenant_id()
  );
comment on policy tenants_select on public.tenants is
  '全体管理者は全テナント・それ以外は自分のテナントだけ読める。書き込みはサービスの接続だけ (2026-11-05)。';

-- 2. 壊れた関数を使うポリシー (常に偽だったもの) と関数
drop policy if exists store_isolation       on public.stores;
drop policy if exists alert_log_isolation   on public.alert_logs;
drop policy if exists consent_doc_isolation on public.consent_documents;
drop policy if exists employee_isolation    on public.employees;
drop policy if exists entry_exit_log_insert on public.entry_exit_logs;
drop policy if exists entry_exit_log_read   on public.entry_exit_logs;
drop policy if exists inspection_insert     on public.inspections;
drop policy if exists inspection_read       on public.inspections;
drop policy if exists inspection_update     on public.inspections;
drop policy if exists unmatch_log_isolation on public.unmatch_logs;
drop policy if exists user_isolation        on public.users;
drop policy if exists visitor_isolation     on public.visitors;

drop function if exists public.auth_role();
drop function if exists public.auth_tenant_id();

commit;
