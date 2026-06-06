# Tier 3 (中央集約モード) 設計ドキュメント

このディレクトリは、Recorder Monitor を **「中央集約モード (Tier 3)」と「各店 Mini PC モード (現行)」両対応** に拡張するための設計成果物を保管します。

開発計画の Phase 0 着手前の **先行調査** (F45) で作成された設計ドキュメント群です。

## 構成

### 設計ドキュメント (F45 先行調査)

| ファイル | 内容 | 関連タスク |
|---|---|---|
| `nvr-adapter-design.md` | NVR アダプタ層の世代別構造、クラス階層、拡張ポイント | F45.1 |
| `firmware-capability-matrix.md` | FW Ver 検出ロジック + capability 動的決定 | F45.2 |
| `eol-eos-data-model.md` | レコーダ EOL/EOS 管理スキーマ + アラート閾値 | F45.3 |
| `ui-mockups.md` | /stores と /infra への UI 追加ワイヤフレーム | F45.4 |

### 実装計画 (F46 Phase 0 Issue 化)

| ファイル | 内容 | 関連タスク |
|---|---|---|
| `phase0-issues.md` | Phase 0 を 30 Issue に分割 (4 週間 / 2 人月) | F46 |
| `customer-nvr-survey.md` | 顧客 NVR 機種分布 調査票 | F48.F |
| `all-migrations-combined.sql` | DB マイグレーション統合ファイル (4本) | F46.6/7/8 + F51.B |
| `poc-lab-network.md` *(Phase 0 で作成予定)* | PoC ラボ網設計 | F46.28 |
| `phase0-poc-report.md` *(Phase 0 で作成予定)* | PoC 検証結果 + capability 実測 | F46.29-30 |

### 運用設計 (Phase 3〜4)

| パス | 内容 | 関連タスク |
|---|---|---|
| `monitoring/README.md` | 監視スタック設計概要 | F51.F |
| `monitoring/prometheus.yml` | Prometheus scrape config | F51.F |
| `monitoring/alert-rules.yml` | SLO 違反アラートルール | F51.F |
| `monitoring/alertmanager.yml` | アラートルーティング | F51.F |
| `monitoring/grafana-dashboard-*.json` | Grafana ダッシュボード × 2 | F51.F |
| `monitoring/docker-compose.yml` | 検証環境一発起動 | F51.F |
| `operations-runbook.md` | 障害対応 + 計画作業ランブック | F51.X |

### PoC 機材決定

| 機器 | 用途 |
|---|---|
| **i-PRO WJ-NX300K** | 16ch IP NVR、2018-2019 世代 FW v1.x 検証 |
| **i-PRO WJ-NU201K** | 8ch 小型 NVR、2022+ 世代 FW v3.x 検証 |
| **i-PRO WV-S シリーズ IP カメラ × 2** | 動作確認用 |
| **PoE スイッチ + HDD** | 周辺機材 |

## 関連ソースコード

| パス | 内容 |
|---|---|
| `claude/monitor/src/lib/nvr-adapter/types.ts` | NvrAdapter インターフェイス + 型定義 (F45.5) |

## 前提と制約

- **対象 NVR**: i-PRO 2018 年以降発売モデル (WJ-NX/NU シリーズ + WJ-GXE500 経由のアナログ流用)
- **運用期間**: 1 機種あたり最長 7 年 (= 2018 年導入機を 2025 年までサポート、2024 年導入機を 2031 年までサポート)
- **将来拡張**: 他ベンダー (Hikvision / Hanwha / Synology / Axis) + 他社アナログ DVR を追加可能な構造を維持

## 設計上の絶対ルール (Phase 0 コードレビューで遵守)

1. **ベンダー固有コードは `adapters/<vendor>/` 配下に閉じる** — 他コードが参照しない
2. **コマンドハンドラはアダプタを `vendor` で動的解決する** — registry パターン
3. **UI は capability flag で機能を出し分ける** — adapter 側の能力を UI が決め打ちしない
4. **DB スキーマはベンダー無関係** — 固有設定は `nvr_options jsonb` に格納
5. **アダプタの「契約テスト」を共通化** — 新ベンダー追加時に必ず通す
