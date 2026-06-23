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
| `/api/edge/bootstrap` が device_token 保持者に service_role 鍵を返す | 受容（エッジは元々保持） | 将来：エッジ専用スコープ鍵に置換 |
| 過去チャットに漏れた service_role 鍵 / ログインPW `Intereco2026` | 要確認 | 鍵・PWのローテ完了を運用で確認（コード/gitには無し） |
| 依存の moderate/low CVE | 監視 | Dependabot/`bun audit` で追跡 |

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
