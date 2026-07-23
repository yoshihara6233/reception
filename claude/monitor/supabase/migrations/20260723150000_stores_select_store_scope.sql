-- 店舗マネージャ等の店舗限定ロールを「担当店舗のみ」に締める（DBレベルの enforcement）。
--
-- 従来の本番 stores_select は `auth_user_tenant_id() = tenant_id` 節がロール無差別に
-- テナント全体の SELECT を許しており、7店舗担当の store_manager でもテナント配下の
-- 全店舗（例: デモ全国チェーン=99店舗）が見えていた。
--
-- edges_select / bcp_settings_select / sessions_select は既にロール別に正しく
-- スコープされており（tenant_admin=テナント全体・store_manager=store_ids）、
-- 過剰許可は stores_select のみ。authz テスト（tests/authz/schema.sql）も既に
-- 正しいモデルを持っており、本番だけがドリフトしていた＝本番を正へ揃える。
--
-- モデル: super_admin=全件 / tenant_admin=自テナント / store_manager 等=担当店舗のみ。
-- 注: 旧 store_isolation（JWT ベース・全コマンド）は監視ユーザーの JWT メタデータが
--     NULL のため実質 inert。今回は触らない（影響最小化）。

DROP POLICY IF EXISTS "stores_select" ON public.stores;

CREATE POLICY "stores_select" ON public.stores
  FOR SELECT TO authenticated
  USING (
    public.auth_user_role() = 'super_admin'
    OR (public.auth_user_role() = 'tenant_admin' AND public.auth_user_tenant_id() = tenant_id)
    OR (id = ANY (public.auth_user_store_ids()))
  );
