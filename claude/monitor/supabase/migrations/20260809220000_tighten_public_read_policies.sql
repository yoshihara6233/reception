-- 誰でも読めていた 2 テーブルを閉じる。
--
-- RLS のメタ検査（tests/rls-meta）を入れたところ、`USING (true)` の SELECT
-- ポリシーが 2 本見つかった。permissive かつ対象ロールが PUBLIC なので、
-- **未認証（anon）でも読める**。anon キーはブラウザに配る公開値なので、
-- 実質「インターネットに公開」と同じ。
--
-- ローカルで実測（2026-08-09）:
--   GET /rest/v1/central_nodes  apikey=<anon>
--     → [{"hostname":"node-secret.internal.example","region":"ap-northeast-1"}]
--   GET /rest/v1/stores         apikey=<anon>  → []   ← 正しく守られている対照
--
-- どちらも remote baseline（20260707090000）から入っていた＝本番も同じ状態。
-- 中央ノード機能(Tier3)は未稼働で本番の行数はおそらく 0 だが、
-- **行が入った瞬間に漏れる**ので、稼働前の今のうちに閉じる。

-- ── central_nodes: 中央ノードの hostname / region / 稼働状況 ────────────
-- 読み手は /infra/nodes と /infra/slo だけ＝②運営管理（super_admin 専用）。
-- インフラのホスト名は攻撃対象の下見に使われる。テナント側にも見せない。
drop policy if exists "central_nodes_select" on public.central_nodes;
create policy "central_nodes_select" on public.central_nodes
  for select to authenticated
  using (public.auth_user_role() = 'super_admin');

-- ── nvr_models: NVR 機種マスタ（EOL/EOS）────────────────────────────────
-- 中身はベンダ公開情報だが、無認証に配る理由が無い。読み手は
-- /admin/nvr-models（super_admin）と /admin/stores/[id]/nvr（ADMIN_ROLES）。
-- ここは「機種の一覧」であってテナントの資産ではないので、ログイン済みなら可。
drop policy if exists "nvr_models_select" on public.nvr_models;
create policy "nvr_models_select" on public.nvr_models
  for select to authenticated
  using (true);

comment on table public.central_nodes is
  'Tier3 集約ノード（未稼働）。SELECT は super_admin のみ — hostname は攻撃対象の下見に使われるため。';
