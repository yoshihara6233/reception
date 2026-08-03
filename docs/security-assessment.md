# 脆弱性診断プログラム（内部実装）

作成: 2026-06-23 / 対象: `claude/monitor`(Next.js) + `claude/edge-agent`(Bun) + Supabase / 本番 `intereco-monitor.vercel.app`

## 0. 方針（外部業者発注 → 内部実装に切替）

GA前ロードマップの「脆弱性診断（外部）」を、当面 **内部実装の継続的セキュリティ検査に切替**える。
理由：内部で大半（依存・認可/RLS・シークレット・SAST）は自動化でき、検出の主要部分をゼロコストで常時カバーできる。

> ⚠ 外部診断を完全には捨てない。**代理店スケール（5,000店）前＝GA前後に一度、独立した第三者診断**を入れる方針は維持する（独立性・B2B商談で求められるレポート・専門ペネトレのため）。本プログラムはそれまでの主防御線＋外部診断の前処理（事前に潰して費用/期間を圧縮）。

## 1. 自動検査（CI・常時）

| 検査 | 実体 | 何を見るか | ゲート |
|---|---|---|---|
| **authz 契約テスト** | `.github/workflows/ci.yml` `authz` job（postgres + node-pg） | テナント×ロールの越権（クロステナント漏洩）を実DB+RLSで実証 | **必須**（`ci-passed`） |
| **SAST（Semgrep）** | `.github/workflows/security.yml` `semgrep` | `p/security-audit` `p/secrets` `p/owasp-top-ten` `p/typescript` `p/react`。インジェクション・危険API・秘密混入・OWASP Top10 | ERROR重大度で fail |
| **依存脆弱性** | `security.yml` `deps-audit`（`bun audit`） | 既知CVE（HIGH/CRITICAL） | 情報（HIGHは運用で是正） |
| **Action 更新** | `.github/dependabot.yml`（github-actions） | 第三者Actionの更新追従（SHA固定の維持） | PR自動起票 |
| **ビルド隔離** | `ci.yml` monitor build | 本番秘密を使わず placeholder env でビルド（CIが本番に触れない） | 必須 |

> Semgrep はプライベートrepoでも無料（GHAS不要）。CodeQL に切替える場合は GitHub Advanced Security の有効化が必要。

### CI を必須チェックにする（任意・推奨）
`security.yml` の `semgrep` を **branch protection の required checks** に追加すると、SAST 失敗で `monitor-prod` へのマージをブロックできる（GitHub の Settings → Branches、UI操作）。

## 2. 手動検査（cadence）

| タイミング | 実施 | 内容 |
|---|---|---|
| 各機能PR | `/security-review` | 差分のコード脆弱性レビュー（認可・入力・秘密・インジェクション） |
| 四半期 ＋ リリース前 | `/cso` | 態勢監査（秘密archaeology・依存・CI/CD・インフラ・OWASP・STRIDE） |
| HIGH依存検出時 | 随時 | `bun update` で是正 → PR |

## 3. スコープと脅威モデル（重点）

- **テナント分離**：Supabase RLS。越権は authz 契約テストで不可侵化。`FOR ALL` ポリシーは SELECT も許可し OR 合成される落とし穴に注意（過去に実脆弱性を検出・修正）。
- **公開面**：`/api/edge/enroll`（トークン認証・単一使用）、`/api/edge/bootstrap`（device_token）、`/api/live-proxy`（セッション+CF Access）、cron（CRON_SECRET）。
- **秘密**：env のみ（Vercel + beelink `.env`）。カメラ/VODパスワードは **AES-256-GCM で Vault化**（`SECRETS_ENC_KEY`・DBに鍵を置かない）。`enrollment_tokens`/`edge_jobs` は RLS deny（service専用）。
- **エッジ**：service_role 鍵で動作。ジョブ/カメラ取得は `edge_id=EDGE_ID` でスコープ。

## 4. 既知の残リスク（受容 or 計画中）

| 項目 | 状態 | 対応 |
|---|---|---|
| `/api/edge/bootstrap` が device_token 保持者に service_role 鍵を返す | **B2 完了・B3/B4 は段階投入中**（§4.1 / §4.2） | RLS はエッジが触る全表＋Storage に整備済み。あとはエッジ側を `EDGE_SCOPED_DB=true` に切替（B3）→ service_role 返却の撤廃（B4） |
| 過去チャットに漏れた service_role 鍵 / ログインPW `Intereco2026` | 要確認 | 鍵・PWのローテ完了を運用で確認（コード/gitには無し） |
| 依存の moderate/low CVE | 監視 | Dependabot/`bun audit` で追跡 |

## 4.1 エッジ専用スコープ鍵化 方式比較（計画）

**課題**: エッジは `SUPABASE_SERVICE_ROLE_KEY`（全RLSバイパスのマスター鍵）で直接Supabaseを叩く（`edge-agent/src/supabase.ts`）。bootstrap は device_token を検証して**そのマスター鍵をそのまま返す**（`api/edge/bootstrap/route.ts`）。
**漏洩時の影響＝全テナント・全店舗のDB/Storage読み書き（実質super_admin）**。`edge_id`/`store_id` による分離はゼロ。
**目的**: device_token / エッジ鍵が漏れても被害を「1エッジ・1店舗・短時間」に限定する。

本質的な分岐は **A（JWT+RLS）vs B（APIプロキシ）**。C は両者に被せる段階導入の進め方。

| 評価軸 | A: エッジ専用JWT + RLS | B: APIプロキシ（鍵を完全排除） |
|---|---|---|
| 漏洩時の影響限定 | ◎ 1エッジ・1店舗・短時間(JWT TTL)。RLSが`edge_id`で行を絞る | ◎◎ エッジにSupabase鍵が一切無い。被害＝API許可範囲のみ |
| device_token漏洩時 | スコープ付き短命JWTが取れるだけ（マスター鍵は出ない） | そのエッジ向けAPI操作のみ（DB直アクセス不可） |
| 実装規模 | 中（supabase.ts＋bootstrap＋RLSマイグレーション） | 大（heartbeat/edge_jobsクレーム/grid/bcp/vodを全APIルート化） |
| 新規エンドポイント | 不要（bootstrapの返却物を変えるだけ） | 多数新設（書込み系すべて） |
| ライブ/grid性能 | ◎ 現状維持（Supabase直叩き・低遅延） | △ 全書込みがmonitor往復＝遅延増・負荷増 |
| RLSポリシー作業 | 多（~10テーブル＋Storageに`edge_id`整備＋ポリシー） | 不要（スコープ判定をサーバ1箇所に集約） |
| JWT署名への依存 | ⚠ **検証済（§6 2026-06-29）**：本番はES256非対称署名へ移行（JWKS実証）。**自己署名JWTは不可**（秘密鍵エクスポート不可）。→ A実装は「**GoTrue発行のエッジ専用トークン**（per-edge authユーザ＋`app_metadata.edge_id`）」に限定。RLSは`auth.jwt()->'app_metadata'->>'edge_id'`で判定 | 無し（device_token照合のみ） |
| 本番移行リスク | 中：RLS誤りでエッジ即全停止。移行中は鍵混在 | 中〜大：書込み経路を1本ずつ無停止移行（本数多い） |
| 既存資産の再利用 | ◎ bootstrap pullループ・device_token・enrollment を活用 | △ device_token/bootstrapは活きるが書込み層は作り直し |
| 将来の多店舗スケール | ◎ RLS分離がテナント分離の基盤になる | ○ APIにスコープ集約 |
| Supabaseネイティブ度 | ◎ 公式の意図通り（RLS＋JWT claim） | △ RLSを使わずストレージ扱い |

**C（段階導入）**: A/B どちらでも、いきなり全テーブル移行せず ①spec作成 → ②最小1テーブル（推奨 `edge_jobs` か `monitor_heartbeats`）先行実装 → ③本番で挙動/性能/無停止移行を検証 → ④残りを順次。本番影響とJWT署名可否の不確実性を小さく潰す。

**推奨**: **「A方式（GoTrue発行トークン版）を、Cの段階導入で」**。低遅延な直Supabase構成を壊さず、bootstrap pullループ（5分）が短命トークン更新に最適、RLS分離は将来のテナント分離にも効く。
**前提検証の結果（2026-06-29・確定）**: 本番はES256非対称署名に移行済み（公開JWKSで実証）。**自己署名JWTは不可**（秘密鍵エクスポート不可）。よってA実装は以下に確定：
- エッジごとに Supabase Auth ユーザを1つ作成（`app_metadata` に `edge_id`/`store_id`/`tenant_id`）。
- bootstrap が device_token 検証後、**Admin API で当該ユーザの短命アクセストークン（ES256署名・既定1h）を発行/更新**して返す（service_role鍵は返さない）。
- エッジはそのトークンで Supabase 直アクセス。RLSは `((auth.jwt()->'app_metadata')->>'edge_id') = edge_id` 等で各テーブルをスコープ。
- 追加コスト：per-edge authユーザ管理、RLSポリシー整備（~10テーブル＋Storage）。これが重すぎる場合は **B（APIプロキシ）** が代替本命。

## 4.2 エッジ専用スコープ鍵化 ロールアウト（A方式・段階導入C）

**到達点**: device_token / エッジ鍵が漏れても被害は「1エッジ・1店舗・最大1時間」に限定される。

| 段階 | 内容 | 状態 |
|---|---|---|
| B1 | `edge_jobs` だけを短命スコープトークンへ（先行1テーブル） | 完了（2026-06-29） |
| B2 | 残り8テーブル＋Storage 4バケットに RLS。エッジ auth ユーザの自動 provisioning | 完了（2026-08-03・migration `20260803160000`） |
| B3 | エッジを `EDGE_SCOPED_DB=true` に切替（全DB/StorageアクセスがRLS配下） | コード投入済・**本番の切替は未**（下記手順） |
| B4 | bootstrap から `supabase_service_role_key` の返却を撤廃 | B3 の soak 後 |

### B2 で敷いたスコープ

| 対象 | スコープ |
|---|---|
| `edge_devices` | 自分の行のみ。UPDATE はトリガで自己申告列（status/last_seen_at/agent_version/ota_status/pending_command/nvr_clock_*）だけに制限＝**`store_id` の付け替えによる他店舗への昇格を禁止** |
| `recorders` / `recorder_cameras` | 自エッジ配下のみ（SELECT） |
| `stores` | 自店舗のみ（SELECT・クリップ行の tenant_id 解決用） |
| `inspection_clip_jobs` / `inspection_clips` | 自店舗のみ。clips の INSERT は tenant_id が DB 由来の値と一致必須 |
| `vod_clips` | 自エッジ配下カメラの行のみ（UPDATE） |
| `bcp_events` / `bcp_clips` | 自店舗のイベントとその配下のみ |
| Storage（`edge-grids` / `baggage-clips` / `bcp-clips` / `vod-clips`） | バケット別のパス規約でスコープ（`edge_owns_storage_object`）。**DELETE は与えない**（証跡削除の禁止） |

`store_id` / `tenant_id` は **JWT の app_metadata ではなく DB から引く**（`jwt_edge_store_id()`）。
機器入替で `edge_devices.store_id` を付け替えると app_metadata は古いままになり、旧店舗の証跡を
書ける状態が残るため。JWT から信じるのは `edge_id` だけ。

契約テスト: `claude/monitor/tests/authz/rls.authz.test.ts`（`bun run test:authz`・CI 常設）。
クロスエッジ／クロス店舗／クロステナントの読み書きが全て 0 行 or 拒否になることを実DBで実証している。

### B3 切替手順（1台ずつ・無停止）

1. 本番に migration を適用（`supabase db push`）。**先に link 先が東京DBか確認する**。
2. 対象エッジが provisioning 済みか確認（`select id from edge_devices where auth_user_id is null`）。
   未済でも次回 bootstrap で自動作成されるが、先に埋めるなら
   `bun run scripts/provision-edge-auth.ts --all`。
3. エッジの `shared/agent.env` に `EDGE_SCOPED_DB=true` を追記して `systemctl restart intereco-edge`。
   起動ログに `supabase: scoped mode` が出れば切替完了。
4. 30分ほど観察: エッジ詳細の `last_seen_at` が更新され続ける／グリッド画像が更新される／
   接続テストが通る。`permission denied` や 401 がログに出たらそのテーブルの RLS 漏れ。
5. 戻す場合は `EDGE_SCOPED_DB` を消して restart するだけ（DB側は無変更で戻る）。

**フェイルクローズ設計**: スコープトークンが取れない/期限切れのとき、エッジは service_role へ
フォールバックしない。要求は 401 になり、heartbeat のエラー処理が bootstrap を叩いて自動復帰する。
「静かに越権状態へ戻る」より「見えて止まる」を選んでいる。

### B4 の前提

全稼働エッジが `EDGE_SCOPED_DB=true` で soak 済みであること。撤廃後は **provisioning 済みでない
エッジは何もできなくなる**（bootstrap の自動 provisioning がその保険）。

## 5. findings 管理

- CI の Semgrep/authz 失敗は PR で修正してからマージ。
- 手動診断（/cso・/security-review）の確定 finding は GitHub issue 化（label: `security`）または該当PRで即修正。
- 重大度 HIGH 以上は最優先で是正。

## 6. 実施履歴

| 日付 | 実施 | 結果 |
|---|---|---|
| 2026-06-21 | authz 契約テスト導入（CI常設） | **クロステナント読取りの実脆弱性を発見・修正**（migration `20260621_003`） |
| 2026-06-23 | `/security-review`（Phase B コード：enroll/edge_jobs/管理API） | 確信度8以上の脆弱性 **ゼロ**（トークン信頼境界・可視性チェックを確認） |
| 2026-06-23 | `/cso`（態勢監査・daily） | 秘密ハードコード無/CI健全/RLS deny表確認。**是正2件**：Next.js 16.2.9 パッチ（HIGH7解消）・CI Action SHA固定 |
| 2026-06-23 | Vault化（AES-256-GCM） | カメラ/VODパスワードの平文撤廃（CSOロードマップ#1） |
| 2026-06-23 | 本プログラム（CI自動化）導入 | Semgrep（SAST+secrets+OWASP）/ bun audit / Dependabot を CI に追加 |
| 2026-06-29 | エッジ専用スコープ鍵化 方式比較（§4.1）＋JWT署名前提検証 | 本番JWKSが **ES256非対称署名**を実証 → 自己署名JWT不可。A方式は「GoTrue発行のper-edgeトークン」に確定。次：A′ vs B 最終確定 → spec → `edge_jobs`先行実装 |
| 2026-08-03 | エッジ専用スコープ鍵化 **B2**（RLS本体・§4.2） | エッジが触る8テーブル＋Storage4バケットに「1エッジ・1店舗」スコープを整備。`edge_devices` は自己申告列だけ更新可（`store_id` 付け替え禁止）。auth ユーザは bootstrap が自動 provisioning。authz 契約テスト 43件 green。B3（`EDGE_SCOPED_DB=true`）は本番切替待ち |
