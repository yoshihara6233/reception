# RLS 全表監査（Phase A）

実施: 2026-06-14 / 対象: monitor Supabase スキーマ（`claude/monitor/supabase/migrations/*.sql`）
背景: 2026-06-14 に `admin_users` の self-only RLS 由来で「一覧に他ユーザが出ない/越権」バグが発生（[intereco-patterns §6](../.claude/skills/intereco-patterns/SKILL.md)）。同種の穴が他表に無いか全表点検する。

> ⚠️ 本監査はマイグレーション（コード）からの静的監査。**本番DBの実ポリシーは未照合**（staging DB 構築後に `pg_policies` で突合する＝Phase A の後続）。

## 1. RLS 有効テーブル一覧とポリシー型

| テーブル | SELECT | 変更(ALL/INSERT) | 型 | 越権リスク |
|---|---|---|---|---|
| `admin_users` | `auth_user_id = auth.uid()`（**self-only**） | ポリシー無し（service役のみ） | 自己参照 | ⚠️ 一覧は service client+コード認可必須（対処済） |
| `edge_devices` | admin_users経由(super_admin or store所属) | role∈(super/tenant/store) | store スコープ | 低（要テスト） |
| `recorders` | 同上(edge→store) | 同上 | store スコープ | 低（要テスト） |
| `recorder_cameras` | 同上(recorder→edge→store) | 同上 | store スコープ | 低（要テスト） |
| `live_sessions` | admin_users経由 | INSERT `user_id = auth.uid()` | 自己/スコープ | 低 |
| `session_limits` | super_admin or tenant一致 | super/tenant | tenant スコープ | 低 |
| `bcp_events/clips/reports/settings` | admin_users経由(store) | role∈(super/tenant/store) | store スコープ | 低 |
| `security_settings/camera_config/reports`, `patrol_runs/findings` | 同上 | 同上 | store スコープ | 低 |
| `monitor_*`（checks/results/incidents/reports/settings/daily_stats） | admin_users経由 | 同上 | スコープ | 低 |
| `central_nodes` | `USING (true)`（認証済全員） | `auth.role()='service_role'` | 参照データ | 低（読取専用相当） |
| `nvr_models` | `USING (true)` | `service_role` | 参照データ | 低 |

## 2. 主要所見

1. **`admin_users` のみ self-only**（`auth_user_id = auth.uid()`・変更系ポリシー無し）。他テーブルは admin_users を EXISTS 参照する **store スコープ型**で一貫。→ admin_users が「誰が何を見えるか」のルートだが、自分の行しか読めないため、**管理系の一覧/他者読みは service client（RLSバイパス）+ `requireAdmin()` のコード認可**に依存する設計（今回の修正で確立）。
2. **コード認可依存のリスク（最重要）**: service client は RLS をバイパスするため、**新しい admin ルートが認可（ロール/テナント）を忘れると越権**になる。RLS は「セッションクライアント直叩き」に対する防御としては効くが、service client 経路はコードが唯一のゲート。
3. **テナント分離は RLS で完結していない**: store スコープは `store_ids`/stores 経由で効くが、admin_users 自体のテナント境界（代理店/多顧客）は self-only + コードに委ねられている。5000店・代理店経由ではここが要硬化（計画 C1）。
4. **`USING (true)` は参照2表のみ**（central_nodes/nvr_models）で書込は service_role 限定。機微データの全開放は無し。
5. **reception由来の `get_tenant_id()`（JWT app_metadata.tenant_id）依存ポリシーは撤去済み**（今回の調査で確認）。現行は `auth_user_id = auth.uid()` ベース。

## 3. 是正・恒久防止（Phase A / GA）

- **[P1] ロール×テナント次元の authz 契約テストを常設化**（CI必須）。各 (role × tenant × store) で「見える/見えない」を**実DB統合テスト**で検証（staging DB 前提＝DR1）。service client 経路の越権を機械的に捕える唯一の手段。
- **[P1] admin 読み取りの規約**: 他者/一覧を読む admin ルートは「`requireAdmin()` で認可 → service client で読む → コードで role/tenant フィルタ」を固定パターンに（[intereco-patterns §6] に記載済）。新規ルートのレビュー観点に追加。
- **[P2] staging DB で `pg_policies` 実照合**: 本監査（静的）と本番/staging の実ポリシーを突合し、マイグレーション未反映の差分が無いか確認。
- **[P2] テナント分離硬化（C1）**: 代理店・多顧客フェーズ前に admin_users のテナント境界を強化（GA後の deployment_mode/dealer モデルと整合）。

## 4. 結論
self-only は `admin_users` 1表のみで、他表は store スコープ型で一貫。**機微データの全開放や `USING(true)` の書込穴は無し**。最大の残リスクは「**service client + コード認可**」への依存で、**authz 契約テストの常設**が恒久対策。本番実ポリシーの突合は staging DB 構築後に実施する。
