# Phase 0 Issue 一覧 (約 30 Issue / 1 ヶ月 / 2 人月)

> Tier 3 中央集約モード対応の **Phase 0 (土台作り + i-PRO PoC)** を atomic な Issue に分割。
> PoC 機材は **WJ-NX300K (2018-2019世代) + WJ-NU201K (2022+世代)** で決定済。

## 凡例

- **ID**: `F46.x` (project の連番踏襲。x はワークストリーム内連番ではなく通し番号)
- **工数**: 営業日換算 (1日=8h)
- **依存**: 完了が前提となる Issue ID
- **担当**: BE=バックエンドエンジニア / FE=フロントエンドエンジニア / OPS=DevOps / PM
- **受入条件**: 完了判定の客観基準

## Phase 0 ワークストリーム俯瞰

| Stream | Issue 数 | 累計工数 |
|---|---|---|
| A. モノレポ・基盤 | 5 | 4 日 |
| B. DB スキーマ | 4 | 4 日 |
| C. NVR Adapter コア | 5 | 7 日 |
| D. i-PRO Adapter 実装 | 6 | 10 日 |
| E. Frigate Adapter 移植 | 3 | 5 日 |
| F. monitor UI NVR タブ | 4 | 5 日 |
| G. PoC ラボ検証 | 3 | 3 日 |
| **合計** | **30** | **38 日 ≒ 2 人月** |

## ガントチャート (1 ヶ月 = 約 22 営業日 × 2 名並列)

```
Week 1   Week 2   Week 3   Week 4
├────────┼────────┼────────┼────────┤
BE-1: A1 A2 B1 B2 B3 B4 C1 C2 C3 C4 C5 D1 D2 D3 D4 D5 D6
BE-2:       A3 A4 A5 E1 E2 E3 D2 D3 G1 G2 G3
FE-1:                F1 F2 F3 F4
OPS:           OPS1 OPS2 G1 G2
```

---

# Stream A: モノレポ・基盤 (5 Issue / 4 日)

## F46.1: pnpm workspace でモノレポ移行

- **担当**: BE-1
- **工数**: 1 日
- **依存**: なし
- **説明**: 現状 `claude/monitor/` と `claude/edge-agent/` が独立リポ状態。pnpm workspace で 1 リポ化し、共有 `packages/shared` の素地を作る。
- **受入条件**:
  - [ ] ルートに `pnpm-workspace.yaml` 配置 (`apps/*`, `packages/*` を含む)
  - [ ] `claude/monitor` → `apps/monitor` リネーム (git mv)
  - [ ] `claude/edge-agent` → `apps/edge-agent` リネーム
  - [ ] `pnpm install` がエラーなく完走
  - [ ] `apps/monitor` から `bun dev` (= pnpm exec next dev) が起動できる
  - [ ] CI スクリプト (`scripts/`) のパス参照を更新

## F46.2: packages/shared パッケージ作成

- **担当**: BE-1
- **工数**: 0.5 日
- **依存**: F46.1
- **説明**: 共有型・ユーティリティを置く `packages/shared` パッケージを新規作成。
- **受入条件**:
  - [ ] `packages/shared/package.json` (name: `@intereco/shared`, type: module, exports 設定)
  - [ ] `packages/shared/src/index.ts` を作成
  - [ ] `packages/shared/tsconfig.json` (composite: true)
  - [ ] `apps/monitor` から `@intereco/shared` を import できる
  - [ ] `apps/edge-agent` から `@intereco/shared` を import できる

## F46.3: NvrAdapter 型を packages/shared へ移設

- **担当**: BE-2
- **工数**: 0.5 日
- **依存**: F46.2
- **説明**: F45.5 で作成した `apps/monitor/src/lib/nvr-adapter/types.ts` を `packages/shared/src/nvr-adapter/types.ts` へ移動。元の場所は re-export だけにする。
- **受入条件**:
  - [ ] 型ファイル移設後 `tsc --noEmit` が clean
  - [ ] `apps/monitor` 側の既存 import が壊れていない (re-export shim)
  - [ ] git diff で他コードの変更が無いこと

## F46.4: 共有定数とエラー型の整理

- **担当**: BE-2
- **工数**: 0.5 日
- **依存**: F46.3
- **説明**: 両 app で使う定数 (キュー名、ハートビート間隔、retry 回数、エラーコード) を `packages/shared/src/constants.ts` に集約。
- **受入条件**:
  - [ ] `HEARTBEAT_INTERVAL_SEC` (per-store=60, central=21600) 定数化
  - [ ] `PendingCommandStatus` enum 化
  - [ ] `NvrAdapterError` (F45.5 で定義済) を re-export

## F46.5: GitHub Actions の monorepo 対応

- **担当**: OPS
- **工数**: 0.5 日
- **依存**: F46.1
- **説明**: CI を pnpm workspace 対応に書き換え。turbo は使わず素の pnpm filter で運用 (Phase 5 で turbo 検討)。
- **受入条件**:
  - [ ] `pnpm install --frozen-lockfile` が CI で走る
  - [ ] `pnpm --filter @intereco/monitor build` で monitor だけビルドできる
  - [ ] `pnpm --filter @intereco/edge-agent typecheck` で edge-agent だけ型チェックできる
  - [ ] パスフィルタで monitor / edge-agent / shared を別 job 化

---

# Stream B: DB スキーマ (4 Issue / 4 日)

## F46.6: stores テーブル拡張マイグレーション作成

- **担当**: BE-1
- **工数**: 1 日
- **依存**: なし
- **説明**: F45.3 で設計したカラム追加 SQL を migration ファイル化。
- **受入条件**:
  - [ ] `supabase/migrations/20260605_001_nvr_lifecycle.sql` 作成
  - [ ] `deployment_mode`, `nvr_vendor`, `nvr_model`, `nvr_endpoint`, `nvr_credentials_ref`, `nvr_options`, `central_node_id`, `nvr_installed_at`, `nvr_fw_version`, `nvr_fw_detected_at`, `nvr_eol_date`, `nvr_eos_date`, `nvr_replace_by` (GENERATED ALWAYS) を追加
  - [ ] インデックス 3 本作成 (`nvr_vendor`, `nvr_replace_by`, `deployment_mode`)
  - [ ] ローカル Supabase で migrate 実行成功
  - [ ] 既存データは `deployment_mode = 'per_store_minipc'` がデフォルト

## F46.7: nvr_models マスタテーブル + サンプルデータ

- **担当**: BE-1
- **工数**: 1 日
- **依存**: F46.6
- **説明**: F45.3 の `nvr_models` テーブルと i-PRO 8 機種の初期データを投入。
- **受入条件**:
  - [ ] `supabase/migrations/20260605_002_nvr_models.sql` 作成
  - [ ] テーブル + インデックス + 自動同期トリガ作成
  - [ ] i-PRO 8 機種 (NX200K/300K/400K/510K, NU101K/201K/301K, GXE500) を INSERT
  - [ ] EOL/EOS は暫定値、TODO コメントで「要 i-PRO 公式照会」明記
  - [ ] ローカルで `SELECT * FROM nvr_models` で 8 件返ること

## F46.8: v_store_nvr_lifecycle ビュー作成

- **担当**: BE-1
- **工数**: 0.5 日
- **依存**: F46.7
- **説明**: F45.3 の `v_store_nvr_lifecycle` ビューを実装。ライフサイクル状態分類ロジック込み。
- **受入条件**:
  - [ ] `supabase/migrations/20260605_003_nvr_lifecycle_view.sql` 作成
  - [ ] ビューが正しい lifecycle_status を返す (テスト 5 ケース: ok / warning / urgent / eos / unknown)
  - [ ] パフォーマンス: 10,000 行で 50ms 以下

## F46.9: Supabase 型自動生成スクリプト

- **担当**: BE-1
- **工数**: 0.5 日
- **依存**: F46.8
- **説明**: `supabase gen types typescript` の自動化スクリプトを追加し、`packages/shared/src/db-types.ts` を生成。
- **受入条件**:
  - [ ] `scripts/gen-db-types.sh` 作成
  - [ ] `packages/shared/src/db-types.ts` 生成
  - [ ] 新カラム (nvr_vendor 等) が型に含まれる
  - [ ] `apps/monitor` と `apps/edge-agent` から `import type { Database } from '@intereco/shared'` できる

---

# Stream C: NVR Adapter コア (5 Issue / 7 日)

## F46.10: adapters/_base 共通実装

- **担当**: BE-1
- **工数**: 1 日
- **依存**: F46.3, F46.4
- **説明**: `apps/edge-agent/src/adapters/_base/` に共通実装を配置 (型は packages/shared/、ここはランタイムロジック)。
- **受入条件**:
  - [ ] `_base/nvr-adapter.ts` — interface re-export
  - [ ] `_base/capabilities.ts` — CONSERVATIVE_CAPABILITIES export
  - [ ] `_base/channel.ts` — NvrChannel 型再 export
  - [ ] `_base/errors.ts` — NvrAdapterError 基底クラス
  - [ ] `_base/contract-tests.ts` — runAdapterContractTests() ヘルパー

## F46.11: adapters/_registry 動的解決

- **担当**: BE-1
- **工数**: 1 日
- **依存**: F46.10
- **説明**: vendor 文字列から adapter ファクトリを返す registry を実装。
- **受入条件**:
  - [ ] `_registry/registry.ts` — `ADAPTER_REGISTRY` Map
  - [ ] `_registry/index.ts` — public API `getAdapter(vendor, config)`
  - [ ] 未登録 vendor で `Error('No adapter registered for vendor: ...')` を投げる
  - [ ] dynamic import で各 adapter モジュールを遅延ロード
  - [ ] unit test 3 ケース: 既知 vendor / 未知 vendor / config バリデーション

## F46.12: AdapterCache (店舗ごとのインスタンスキャッシュ)

- **担当**: BE-1
- **工数**: 1 日
- **依存**: F46.11
- **説明**: 中央集約モードで店舗ごとの adapter インスタンスをキャッシュ。FW 変化検知も含む。
- **受入条件**:
  - [ ] `_registry/adapter-cache.ts` — `Map<storeId, NvrAdapter>`
  - [ ] `getOrCreateAdapter(store)` — キャッシュ ヒット / ミス / FW 変化時の再生成
  - [ ] `dispose(storeId)` — 明示破棄
  - [ ] LRU で最大 12,000 インスタンス保持 (10k 店舗 + バッファ)
  - [ ] unit test 4 ケース

## F46.13: 接続情報の Vault resolve ヘルパー

- **担当**: BE-2
- **工数**: 1 日
- **依存**: F46.4
- **説明**: `stores.nvr_credentials_ref` (uuid) から実際の username/password を引いてくるヘルパー。Phase 0 はファイル/環境変数fallback、Phase 2 で Supabase Vault に移行。
- **受入条件**:
  - [ ] `_base/credential-resolver.ts`
  - [ ] `resolveCredentials(ref): Promise<{ username, password }>`
  - [ ] フォールバック順: Supabase Vault → 環境変数 `NVR_CRED_<REF>` → ローカル `secrets.json`
  - [ ] credentials は **絶対にログに出さない** (toString オーバーライド)
  - [ ] unit test 3 ケース

## F46.14: ChannelList とコマンドの抽象化

- **担当**: BE-2
- **工数**: 3 日
- **依存**: F46.10
- **説明**: `commands/` ディレクトリを作成し、`capture-snapshot.ts` / `start-live.ts` / `export-vod.ts` / `start-bcp-capture.ts` をベンダー非依存に書き直す素地を作る (実装は Frigate adapter で動作確認)。
- **受入条件**:
  - [ ] `commands/capture-snapshot.ts` が `getAdapter(store.nvr_vendor).getSnapshot()` を呼ぶ形
  - [ ] `commands/start-live.ts` 同様
  - [ ] `commands/export-vod.ts` 同様
  - [ ] `commands/start-bcp-capture.ts` 同様
  - [ ] capability チェック (UnsupportedOperationError) のテスト 4 ケース

---

# Stream D: i-PRO Adapter 実装 (6 Issue / 10 日)

## F46.15: i-PRO CGI クライアント基盤

- **担当**: BE-1
- **工数**: 2 日
- **依存**: F46.13
- **説明**: 全 i-PRO 機種が共通で使う CGI クライアントを実装。Digest 認証、retry、レート制限内蔵。
- **受入条件**:
  - [ ] `adapters/i-pro/_common/cgi-client.ts`
  - [ ] `get(path, params): Promise<string>` (CGI レスポンスを返す)
  - [ ] Digest 認証対応 (RFC 7616)
  - [ ] retry (max 2) + 指数バックオフ
  - [ ] rateLimitMs を guard
  - [ ] unit test (mock HTTP サーバ) 5 ケース

## F46.16: i-PRO FirmwareDetector 実装

- **担当**: BE-1
- **工数**: 1 日
- **依存**: F46.15
- **説明**: F45.2 の検出ロジックを実装。CGI → ONVIF → Header の順でフォールバック。
- **受入条件**:
  - [ ] `adapters/i-pro/_common/firmware-detector.ts`
  - [ ] `detectIProFirmware(config): Promise<FirmwareInfo>`
  - [ ] `/cgi-bin/getsysteminfo` パース対応
  - [ ] ONVIF GetDeviceInformation フォールバック
  - [ ] 全失敗時に `fwMajor=0, modelFamily='unknown'` を返す
  - [ ] unit test 4 ケース (CGI 成功 / ONVIF フォールバック / 全失敗 / 認証失敗)

## F46.17: i-PRO capability マトリックス純関数

- **担当**: BE-1
- **工数**: 0.5 日
- **依存**: F46.16
- **説明**: F45.2 の `deriveCapabilities(fw)` 関数を実装。テスト充実。
- **受入条件**:
  - [ ] `adapters/i-pro/_common/capability-matrix.ts`
  - [ ] `deriveCapabilities(fw): NvrCapabilities`
  - [ ] WJ-NX v1/v2/v3/v4 のそれぞれで正しい capability を返す
  - [ ] WJ-NU 系の差分対応
  - [ ] WJ-GXE500 専用枝
  - [ ] 未知 FW で CONSERVATIVE_CAPABILITIES を返す
  - [ ] unit test 8 ケース (世代×シリーズの組み合わせ)

## F46.18: IProBaseAdapter abstract class

- **担当**: BE-1
- **工数**: 1.5 日
- **依存**: F46.15, F46.17
- **説明**: 全 i-PRO 機種共通の adapter 基底クラス。CGI クライアント + capability + リソース管理。
- **受入条件**:
  - [ ] `adapters/i-pro/_common/i-pro-base-adapter.ts`
  - [ ] `class IProBaseAdapter implements NvrAdapter` (abstract)
  - [ ] `testConnection()` 実装 — `/cgi-bin/getsysteminfo` 叩く
  - [ ] `getSnapshot(ch)` 実装 — `/cgi-bin/snapshot.cgi?ch={ch}`
  - [ ] `getLiveRtspUri(ch, stream)` 実装 — `rtsp://...` URL 生成
  - [ ] `dispose()` 実装 — keep-alive 接続 close
  - [ ] unit test (mock 経由) 6 ケース

## F46.19: IProNxAdapter (世代分岐ファクトリ)

- **担当**: BE-1
- **工数**: 2 日
- **依存**: F46.18
- **説明**: WJ-NX シリーズの世代分岐 adapter。FW Ver から v1/v2/v3+ サブクラスを返すファクトリ。
- **受入条件**:
  - [ ] `adapters/i-pro/nx-series/nx-v1-adapter.ts` (2018-2019, 1.x)
  - [ ] `adapters/i-pro/nx-series/nx-v2-adapter.ts` (2020-2021, 2.x)
  - [ ] `adapters/i-pro/nx-series/nx-v3-plus-adapter.ts` (2022+, 3.x+)
  - [ ] `adapters/i-pro/nx-series/nx-adapter.ts` — `createIProNxAdapter(config)` ファクトリ
  - [ ] registry に `'i-pro-nx'` を登録
  - [ ] 各世代で `getVodMp4` の URL パス差分を実装
  - [ ] 各世代で `subscribeEvents` 実装 (v1 は基本 push、v2+ は AI metadata 含む)
  - [ ] contract test を 3 サブクラスすべてで通す

## F46.20: IProNuAdapter (小型機種)

- **担当**: BE-2
- **工数**: 1.5 日
- **依存**: F46.19
- **説明**: WJ-NU シリーズ adapter。NX とほぼ同じ構造、capability の `maxChannels` / `maxConcurrentSessions` を縮退。
- **受入条件**:
  - [ ] `adapters/i-pro/nu-series/nu-adapter.ts`
  - [ ] `createIProNuAdapter(config)` ファクトリ
  - [ ] registry に `'i-pro-nu'` を登録
  - [ ] WJ-NU101K (4ch) / NU201K (8ch) / NU301K (16ch) を model 名から判定
  - [ ] contract test 通過

---

# Stream E: Frigate Adapter 移植 (3 Issue / 5 日)

## F46.21: 既存 modes/bcp.ts のロジック抽出

- **担当**: BE-2
- **工数**: 2 日
- **依存**: F46.10
- **説明**: 現行 `apps/edge-agent/src/modes/bcp.ts` から、Frigate 連携部分 (HTTP snapshot, RTSP URI 生成) を切り出して新 adapter にする。既存動作は壊さない。
- **受入条件**:
  - [ ] `adapters/frigate/frigate-adapter.ts` 作成
  - [ ] `getSnapshot(ch)` — Frigate `/api/<camera>/latest.jpg`
  - [ ] `getLiveRtspUri(ch)` — go2rtc RTSP URI
  - [ ] `getTimelineSnapshots()` — 既存 8 枚タイムラインロジックを移植
  - [ ] capability: snapshot/live/timeline=true、event/vod=false
  - [ ] registry に `'frigate'` を登録

## F46.22: 既存 BCP コマンドを新 adapter 経由に切り替え

- **担当**: BE-2
- **工数**: 2 日
- **依存**: F46.21, F46.14
- **説明**: `commands/start-bcp-capture.ts` を Frigate 直叩きから `getAdapter('frigate')` 経由に変更。既存 Mini PC モード動作のリグレッションテスト。
- **受入条件**:
  - [ ] `commands/start-bcp-capture.ts` が adapter 経由
  - [ ] 既存 demo データで E2E テスト通過 (8 枚 JPEG 取得 + DB insert)
  - [ ] 旧 `modes/bcp.ts` は残しつつ feature flag で切替可能
  - [ ] パフォーマンス回帰なし (snapshot 取得時間 ±10% 以内)

## F46.23: Frigate adapter の contract test

- **担当**: BE-2
- **工数**: 1 日
- **依存**: F46.21
- **説明**: F46.10 で作った `runAdapterContractTests()` を Frigate adapter で通す。実機 Frigate 接続が必要 (ラボの世田谷店 Frigate を使う)。
- **受入条件**:
  - [ ] `adapters/frigate/frigate-adapter.test.ts`
  - [ ] testConnection / getChannelList / getSnapshot / getLiveRtspUri が全 PASS
  - [ ] capability に従い getVodMp4 / subscribeEvents は skip される
  - [ ] CI では `MOCK_FRIGATE=1` でモック化

---

# Stream F: monitor UI NVR タブ (4 Issue / 5 日)

## F46.24: /stores/[id] にタブナビゲーション追加

- **担当**: FE-1
- **工数**: 0.5 日
- **依存**: F46.1
- **説明**: 現行の店舗詳細ページにタブ UI を入れて、「概要」「カメラ」「NVR設定」「アラート履歴」「設定」のタブナビを表示。
- **受入条件**:
  - [ ] `src/app/stores/[id]/page.tsx` をタブレイアウト化 (URL `?tab=nvr` で切替)
  - [ ] 既存コンテンツが「概要」タブに収まる
  - [ ] 未実装タブは「Coming soon」表示
  - [ ] i18n キー追加 (`storeTabs.overview` 等)

## F46.25: NVR設定タブのフォーム UI

- **担当**: FE-1
- **工数**: 1.5 日
- **依存**: F46.24, F46.6 (DB スキーマ)
- **説明**: F45.4 の「NVR 接続情報」「追加オプション」「保存」「接続テスト」ボタンを実装。
- **受入条件**:
  - [ ] `src/app/stores/[id]/nvr/page.tsx` (Server Component)
  - [ ] `src/app/stores/[id]/nvr/NvrConnectionForm.tsx` (Client Component)
  - [ ] ベンダー = ['i-pro-nx', 'i-pro-nu', 'i-pro-gxe500', 'frigate'] のドロップダウン
  - [ ] 機種 = `nvr_models` から動的取得
  - [ ] 保存 = Server Action 経由で `stores` UPDATE
  - [ ] バリデーション: endpoint は URL 形式

## F46.26: 接続テスト API + UI フィードバック

- **担当**: FE-1 + BE-2
- **工数**: 2 日
- **依存**: F46.25, F46.18 (IProBaseAdapter)
- **説明**: 「接続テスト」ボタン押下 → API → adapter インスタンス化 → `testConnection()` → FW 検出 → 結果表示。
- **受入条件**:
  - [ ] `src/app/api/stores/[id]/nvr/test-connection/route.ts` (Route Handler)
  - [ ] POST で adapter インスタンス作成 → testConnection() → 結果 JSON 返却
  - [ ] FW 情報 (modelNumber, fwVersion) + capabilities を返す
  - [ ] UI で結果カード表示 (成功時は緑チェック + FW 情報、失敗時は赤 + エラー詳細)
  - [ ] タイムアウト 30 秒、ボタン中 `aria-busy="true"`

## F46.27: capability + ライフサイクル表示カード

- **担当**: FE-1
- **工数**: 1 日
- **依存**: F46.26, F46.8 (v_store_nvr_lifecycle)
- **説明**: F45.4 の「機能 (capability)」一覧 + 「機材ライフサイクル」カードを実装。
- **受入条件**:
  - [ ] `src/app/stores/[id]/nvr/CapabilityList.tsx`
  - [ ] `src/app/stores/[id]/nvr/LifecycleCard.tsx`
  - [ ] capability チェックリスト 8 項目を○/×表示
  - [ ] ライフサイクル: 導入日・EOL・EOS・実質置換期限・状態バッジ
  - [ ] 進捗バー (導入から置換期限までの経過率)
  - [ ] **F40.4 教訓**: 関数値メッセージを使わず、lang ベースのインライン format で実装

---

# Stream G: PoC ラボ検証 (3 Issue / 3 日)

## F46.28: PoC ラボネットワーク構築

- **担当**: OPS
- **工数**: 1 日
- **依存**: F46.X (機材到着)
- **説明**: WJ-NX300K + WJ-NU201K + IP カメラ × 2 + PoE スイッチで隔離 LAN を組む。開発機からアクセスできる NAT 設定。
- **受入条件**:
  - [ ] 192.168.50.0/24 の PoC LAN を構築
  - [ ] WJ-NX300K = 192.168.50.10、WJ-NU201K = 192.168.50.20 で固定 IP
  - [ ] IP カメラ x 2 = 192.168.50.101, 102
  - [ ] 開発機から ping / RTSP / HTTP すべて疎通
  - [ ] 構成図とアクセス情報を docs/tier3/poc-lab-network.md に記載

## F46.29: WJ-NX300K で adapter contract test 通過

- **担当**: BE-1 + OPS
- **工数**: 1 日
- **依存**: F46.19, F46.28
- **説明**: 実機 WJ-NX300K に対して `runAdapterContractTests()` を通す。世代別 capability の暫定値を実測で補正。
- **受入条件**:
  - [ ] testConnection / getChannelList / getSnapshot / getLiveRtspUri が全 PASS
  - [ ] FW Ver が正しく検出される (capability-matrix.ts の判定が正しい)
  - [ ] getVodMp4 で 5 分尺の MP4 export 成功
  - [ ] subscribeEvents で motion event を受信
  - [ ] 実測結果を `firmware-capability-matrix.md` に追記 (TODO 解消)

## F46.30: WJ-NU201K で adapter contract test + 比較レポート

- **担当**: BE-1 + OPS
- **工数**: 1 日
- **依存**: F46.20, F46.28
- **説明**: 実機 WJ-NU201K に対して同じテストを通し、NX300K (v1.x/2.x想定) と NU201K (v3.x+想定) の世代差を実測比較。
- **受入条件**:
  - [ ] WJ-NU201K で contract test 全 PASS
  - [ ] 2 機種の capability 差分レポート作成
  - [ ] AI on iPRO 機能の有無を実測
  - [ ] BCP 用 timeline スナップショット (8 枚) を WJ-NU201K で取得成功
  - [ ] PoC 検証レポート `docs/tier3/phase0-poc-report.md` 作成

---

# Phase 0 完了判定 (Go/No-Go for Phase 1)

以下すべて満たした時点で Phase 0 完了とみなす:

- [ ] 30 Issue すべて完了
- [ ] WJ-NX300K と WJ-NU201K の両方で snapshot + RTSP + event push が動作
- [ ] capability-matrix.ts の世代別値が実測で確定
- [ ] 既存 Frigate (Mini PC) モードが新 adapter 経由でリグレッションなく動作
- [ ] `/stores/[id]/nvr` タブで接続テスト → FW 検出 → capability 表示まで E2E 動作
- [ ] tsc + lint + unit test がすべて clean
- [ ] PoC 検証レポート作成済

**Go 判断材料**:
- アダプタ実装の所要時間が想定 (10 日) 通りか?
- WJ-NU と WJ-NX の差分が想定範囲内 (capability flag 数件) か?
- 顧客 NVR 機種分布調査の結果 (i-PRO 比率) と整合するか?

**No-Go の場合のフォールバック**:
- アダプタ実装が想定の +50% かかった → Phase 1 を 0.5 ヶ月延長
- 機種差が大きすぎた → Phase 1 で世代別 adapter をさらに細分化 (+1 週)
- 顧客機種が i-PRO 比率 50% 未満だった → Phase 1 開始前に対象 vendor 再選定

---

# 工数集計

| Stream | Issue ID 範囲 | 工数 (日) |
|---|---|---|
| A. モノレポ・基盤 | F46.1〜F46.5 | 4 |
| B. DB スキーマ | F46.6〜F46.9 | 4 |
| C. Adapter コア | F46.10〜F46.14 | 7 |
| D. i-PRO Adapter | F46.15〜F46.20 | 10 |
| E. Frigate 移植 | F46.21〜F46.23 | 5 |
| F. UI NVR タブ | F46.24〜F46.27 | 5 |
| G. PoC 検証 | F46.28〜F46.30 | 3 |
| **合計** | **30 Issue** | **38 日** |

並列度を考慮した実カレンダー: **約 4 週間 (1 ヶ月)**、チーム 2.5 名 (BE 2 + FE 0.5 + OPS 0.25)。

# Phase 1 への引き継ぎ事項

Phase 0 完了時点で以下が Phase 1 へ確実に渡る:

1. **動作確認済の i-PRO NX/NU adapter** — Phase 1 で GXE500 adapter + Hanwha 等の追加実装基盤
2. **確定した capability マトリックス** — 暫定値が実測値に
3. **モノレポ + packages/shared** — 以後の機能追加が両 app で共有可能
4. **NVR タブ UI の骨子** — Phase 2 で 100 店舗パイロット時の運用 UI に発展
5. **PoC ラボ環境** — Phase 1 以降の継続的な実機テスト基盤
6. **既存 Frigate モードへの非破壊な追加実装** — リスク最小化

# 関連ドキュメント

- `README.md` — Tier 3 設計ドキュメントの目次
- `nvr-adapter-design.md` — アダプタ層の詳細設計
- `firmware-capability-matrix.md` — FW Ver + capability
- `eol-eos-data-model.md` — DB スキーマと EOL/EOS 管理
- `ui-mockups.md` — UI 改修ワイヤフレーム
- `../../claude/monitor/src/lib/nvr-adapter/types.ts` — 型スケルトン (F46.3 で `packages/shared` に移動予定)
