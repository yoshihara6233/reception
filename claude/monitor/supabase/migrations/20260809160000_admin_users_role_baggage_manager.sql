-- admin_users.role の CHECK 制約に baggage_manager（手荷物検査店長）を追加する。
--
-- 経緯: 手荷物検査モジュール（20260719090000）で baggage_manager ロールを導入し、
-- アプリ側は middleware / guard.ts / users API / ユーザ編集フォームまで一通り実装した
-- （BAGGAGE_ROLES・STORE_SCOPED_ROLES・zod enum・ロール選択肢）が、**DB の CHECK 制約
-- だけ更新し忘れていた**。制約は remote_baseline 時点の 4 値のまま:
--
--   CHECK (role = ANY (ARRAY['super_admin','tenant_admin','store_manager','viewer']))
--
-- そのため管理画面で「手荷物検査店長 (baggage_manager)」を選んで保存すると
-- admin_users への INSERT/UPDATE が制約違反で落ち、API は 500 profile_insert_failed を
-- 返していた（作成時は auth ユーザをロールバックするので、画面上は「保存できない」
-- だけに見える）。**このロールは本番で一度も作成できていない。**
--
-- RLS 側の変更は不要。店舗スコープ系ポリシーは super_admin / tenant_admin を明示し、
-- 残りを admin_users.store_ids で判定する形（20260719090000 の規約）なので、
-- baggage_manager は既に「その他＝担当店舗のみ」として正しく扱われる。

alter table public.admin_users
  drop constraint if exists admin_users_role_check;

alter table public.admin_users
  add constraint admin_users_role_check
  check (role in ('super_admin', 'tenant_admin', 'store_manager', 'baggage_manager', 'viewer'));

comment on column public.admin_users.role is
  'super_admin=全社 / tenant_admin=自テナント全体 / store_manager・baggage_manager・viewer='
  '担当店舗(store_ids)のみ。baggage_manager は /baggage 系だけに入れる店長ロール（middleware.ts）。'
  '値を増やすときは本制約・users API の zod enum・UserForm の選択肢・STORE_SCOPED_ROLES を同時に更新すること。';
