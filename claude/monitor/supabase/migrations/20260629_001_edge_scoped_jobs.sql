-- エッジ専用スコープ鍵化 Phase B1: edge_jobs を GoTrue短命トークン+RLS でスコープ化。
-- 目的: device_token/エッジ鍵が漏洩しても被害を「1エッジ・1店舗・短時間」に限定する
-- 段階導入の第1スライス。本マイグレーションは edge_jobs だけをスコープ化する。
--
-- 方式(確定): 本番Supabaseは ES256 非対称署名へ移行済み(JWKS実証)=自己署名JWT不可。
-- → エッジごとに Supabase Auth ユーザを1つ持たせ、bootstrap が device_token 検証後に
--   signInWithPassword で短命アクセストークン(≤1h)を発行する。トークンの app_metadata に
--   edge_id を載せ、RLS は auth.jwt()->'app_metadata'->>'edge_id' で行を絞る。
--
-- 安全性: service_role は従来通り RLS をバイパスするため、monitor 側(edge_jobs 作成/参照)は
--   本ポリシー追加の影響を受けない。エッジは edge_jobs だけを scoped トークンへ切替える。
--
-- 適用: Supabase SQL Editor に本ファイルの内容を貼り付けて実行する
--   (supabase migration repair / db pull は使わない)。

-- 1) per-edge auth ユーザ参照と暗号化PW(AES-256-GCM / secret-codec)。
--    auth_password_enc は enc:v1:… 形式(SECRETS_ENC_KEY で復号)。
ALTER TABLE edge_devices
  ADD COLUMN IF NOT EXISTS auth_user_id      uuid,
  ADD COLUMN IF NOT EXISTS auth_password_enc text;

COMMENT ON COLUMN edge_devices.auth_user_id IS
  'このエッジ専用 Supabase Auth ユーザの id。bootstrap が signInWithPassword でトークン発行に使う。';
COMMENT ON COLUMN edge_devices.auth_password_enc IS
  'エッジ auth ユーザのパスワード(AES-256-GCM 封筒暗号 enc:v1:…)。DBには平文を持たない。';

-- 2) edge_jobs を authenticated(=エッジの scoped トークン)にスコープ開放。
--    table-level GRANT が無いと RLS 以前に権限不足で弾かれるため明示的に付与する。
--    INSERT/DELETE は付与しない(ジョブ作成は monitor が service_role で行う)。
GRANT SELECT, UPDATE ON edge_jobs TO authenticated;

-- SELECT: 自分(edge_id)宛の行だけ見える。
DROP POLICY IF EXISTS edge_jobs_edge_select ON edge_jobs;
CREATE POLICY edge_jobs_edge_select ON edge_jobs
  FOR SELECT TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'edge_id')::uuid = edge_id);

-- UPDATE: 自分宛の行だけ更新可(running クレーム / result・status 書き戻し)。
--   WITH CHECK で edge_id の付け替え(他エッジ宛への変更)を禁止する。
DROP POLICY IF EXISTS edge_jobs_edge_update ON edge_jobs;
CREATE POLICY edge_jobs_edge_update ON edge_jobs
  FOR UPDATE TO authenticated
  USING      ((auth.jwt() -> 'app_metadata' ->> 'edge_id')::uuid = edge_id)
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'edge_id')::uuid = edge_id);

COMMENT ON TABLE edge_jobs IS
  '本部→エッジ非同期ジョブ(ONVIF探索/接続テスト)。service_role=全可。'
  ' authenticated(エッジ scoped トークン)=自分の edge_id 行のみ SELECT/UPDATE(Phase B1)。';
