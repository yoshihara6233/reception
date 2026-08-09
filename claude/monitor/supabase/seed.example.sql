-- ローカル開発用 seed のテンプレート（.env.example と同じ位置づけ）。
--
--   cp supabase/seed.example.sql supabase/seed.sql
--
-- でコピーして使う。`supabase db reset` のたびに supabase/seed.sql が自動投入される。
-- **seed.sql 本体は gitignore 済み**＝各自の実験用。共有したい変更はこの
-- example 側に入れること。
--
-- ⚠ 本番の認証情報・実データは絶対に置かない。ここの値はすべてローカル固定の
--    使い捨てで、パスワードも 1 つに揃えてある（覚える対象にしない）。
--
-- ── なぜ 6 ロール分作るのか ────────────────────────────────────────────
-- 権限まわりのバグは「ロールごとに何が見えるか」がずれて起きる。実際に
-- 2026-08-09 の点検では、アプリが 5 ロール前提なのに DB の CHECK が 4 値
-- だったり、他テナントのデータへ到達できるルートが 3 本見つかったりした。
--
-- RLS は tests/authz/（63 テスト）、解決ロジックは src/lib/tenant/（29 ケース）
-- が守っている。**ここが埋めるのは画面の層**。メニューの出し分け、直 URL への
-- 到達、フォームの選択肢といった、ブラウザで触らないと分からない部分を
-- 6 ロールぶん切り替えて確認するための土台。
--
-- ── 作るもの ──────────────────────────────────────────────────────────
--   テナント2つ（A / B）… クロステナント漏れを見るには 2 つ要る
--   店舗3つ  A1・A2（テナントA） / B1（テナントB）
--   ユーザ6人（パスワードは全員 LocalDev!2026）
--
--     super@local.dev      super_admin      全社。tenant_id は null（運営者）
--     admin-a@local.dev    tenant_admin     テナントA 全体
--     admin-b@local.dev    tenant_admin     テナントB 全体（漏れ確認用の相手役）
--     store-a1@local.dev   store_manager    店舗A1 のみ
--     viewer-a1@local.dev  viewer           店舗A1 のみ（閲覧）
--     baggage-a2@local.dev baggage_manager  店舗A2 のみ・/baggage 系だけ
--
--   store_manager と viewer を**同じ店舗**に、baggage_manager を**別の店舗**に
--   割り当ててある。前者で「同じ担当店舗でもロールで出来ることが違う」、
--   後者で「同じテナントでも担当外の店舗は見えない」を 1 セットで確認できる。
--
-- ── 使い方 ────────────────────────────────────────────────────────────
--   bunx supabase start        # ローカルスタック起動（Docker 必要）
--   bunx supabase db reset     # migration 適用 + この seed 投入
--   bun run dev                # http://localhost:3000
--
-- baggage_manager は migration 20260809160000 で CHECK 制約に追加された。
-- それ以前のスキーマだとこの seed は制約違反で落ちる（db reset すれば揃う）。

-- ── 固定 UUID（ローカル固定・0 埋めで衝突回避）────────────────────────
--   tenant A / B : ...b1 / ...b2
--   store A1/A2/B1: ...c1 / ...c2 / ...c3
--   users        : ...a1 〜 ...a6

-- オプション機能（巡回/発報/検査）は tenants と stores の **両方** が true でないと
-- 画面に出ない。既定はどちらも false（新規はオプトイン）なので、seed で明示的に
-- 立てておかないと各モジュールが「有効な店舗がありません」の空表示になり、
-- ロール別の確認ができない。契約＝tenants 側 / 店舗ごとの ON/OFF＝stores 側。
insert into public.tenants (id, name, plan, status, opt_patrol, opt_alarm, opt_baggage) values
  ('00000000-0000-0000-0000-0000000000b1', 'テナントA（ローカル）', 'standard', 'active', true, true, true),
  ('00000000-0000-0000-0000-0000000000b2', 'テナントB（ローカル）', 'standard', 'active', true, true, true)
on conflict (id) do nothing;

-- A1 は巡回・発報のみ / A2 は検査のみ。**ロールと機能が直交している**ことを
-- 確かめられるようにしてある（baggage_manager の担当は A2）。
insert into public.stores (id, tenant_id, name, is_active, opt_patrol, opt_alarm, opt_baggage) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', 'A1 店舗（ローカル）', true, true,  true,  false),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000b1', 'A2 店舗（ローカル）', true, false, false, true),
  ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000b2', 'B1 店舗（ローカル）', true, true,  true,  true)
on conflict (id) do nothing;

-- ユーザ 6 人を 1 ループで作る。auth.users → auth.identities → admin_users の
-- 3 点セットが揃わないとログインできない（identities を忘れると
-- 「メール/パスワードでログインできないユーザ」が出来上がる）。
do $$
declare
  r record;
  v_pw text := 'LocalDev!2026';
begin
  for r in
    select * from (values
      ('00000000-0000-0000-0000-0000000000a1', 'super@local.dev',      'super_admin',     null::uuid,                                     '{}'::uuid[], 'ローカル運営者'),
      ('00000000-0000-0000-0000-0000000000a2', 'admin-a@local.dev',    'tenant_admin',    '00000000-0000-0000-0000-0000000000b1'::uuid,   '{}'::uuid[], 'A テナント管理者'),
      ('00000000-0000-0000-0000-0000000000a3', 'admin-b@local.dev',    'tenant_admin',    '00000000-0000-0000-0000-0000000000b2'::uuid,   '{}'::uuid[], 'B テナント管理者'),
      ('00000000-0000-0000-0000-0000000000a4', 'store-a1@local.dev',   'store_manager',   '00000000-0000-0000-0000-0000000000b1'::uuid,   array['00000000-0000-0000-0000-0000000000c1']::uuid[], 'A1 店長'),
      ('00000000-0000-0000-0000-0000000000a5', 'viewer-a1@local.dev',  'viewer',          '00000000-0000-0000-0000-0000000000b1'::uuid,   array['00000000-0000-0000-0000-0000000000c1']::uuid[], 'A1 閲覧者'),
      ('00000000-0000-0000-0000-0000000000a6', 'baggage-a2@local.dev', 'baggage_manager', '00000000-0000-0000-0000-0000000000b1'::uuid,   array['00000000-0000-0000-0000-0000000000c2']::uuid[], 'A2 検査店長')
    ) as t(uid, email, role, tenant_id, store_ids, display_name)
  loop
    insert into auth.users (
      instance_id, id, aud, role, email,
      encrypted_password, email_confirmed_at,
      created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000',
      r.uid::uuid, 'authenticated', 'authenticated', r.email,
      extensions.crypt(v_pw, extensions.gen_salt('bf')), now(),
      now(), now(),
      '{"provider":"email","providers":["email"]}', '{}',
      '', '', '', ''
    ) on conflict (id) do nothing;

    insert into auth.identities (
      provider_id, user_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at
    ) values (
      r.uid, r.uid::uuid,
      json_build_object('sub', r.uid, 'email', r.email, 'email_verified', true),
      'email', now(), now(), now()
    ) on conflict (provider_id, provider) do nothing;

    insert into public.admin_users (auth_user_id, tenant_id, role, email, display_name, store_ids)
    values (r.uid::uuid, r.tenant_id, r.role, r.email, r.display_name, r.store_ids)
    on conflict (auth_user_id) do nothing;
  end loop;
end $$;

-- ── 画面で確認したいこと（6 ロールを切り替えながら）────────────────────
--
-- super@local.dev      操作中テナント未選択だと /stores・/bcp がゲート表示になるか。
--                      テナントAを選ぶと A1・A2 だけになるか。②運営管理が見えるか。
-- admin-a@local.dev    A1・A2 が見えて B1 が見えないか。②運営管理のメニューが
--                      出ないか。**直 URL /admin/edges でも 403 になるか**。
-- admin-b@local.dev    B1 だけか。A の店舗名・イベントが一切出ないか。
-- store-a1@local.dev   A1 だけか。同じテナントの A2 も見えないか。
-- viewer-a1@local.dev  A1 が見えるが、設定変更・ユーザ作成のボタンが無いか。
-- baggage-a2@local.dev /baggage 系だけに入れて、他は middleware で弾かれるか。
--                      担当は A2 なので A1 の検査記録が見えないこと。
--
-- 見つかった差分は「メニューで隠れているだけ」か「API も 403 か」を必ず両方
-- 確かめる。前者だけだと直 URL で到達される（2026-07-23 に実際にあった）。
