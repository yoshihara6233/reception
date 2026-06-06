# F45.4: /stores と /infra UI 追加要素 モック

> Tier 3 集約モード + EOL/EOS アラート + 中央ノード状況のための UI 追加要素。Phase 0〜2 で実装される画面のワイヤフレームと、必要な i18n キー、新規ファイルパスを整理。

## 1. UI 改修サマリ

| 画面 | 改修内容 | 工数 | Phase |
|---|---|---|---|
| `/stores` 一覧 | ベンダーバッジ + ライフサイクルバッジを各行に追加 | 1 日 | Phase 1 |
| `/stores/[id]` 詳細 | 「NVR 設定」タブ追加、「機材ライフサイクル」カード追加 | 3 日 | Phase 0〜1 |
| `/stores/onboard` (新規) | NVR 情報を含む店舗追加フォーム | 3 日 | Phase 1 |
| `/stores/import` (新規) | CSV/XLSX 一括インポート | 3 日 | Phase 2 |
| `/infra` ダッシュボード | EOL アラートサマリカードを追加 | 2 日 | Phase 1 |
| `/infra/lifecycle` (新規) | 機種別ライフサイクル一覧 + Excel エクスポート | 3 日 | Phase 2 |
| `/infra/nodes` (新規) | 中央集約モード時の HA ノード状況 | 3 日 | Phase 2 |
| `/admin/nvr-models` (新規) | NVR 機種マスタの管理画面 | 2 日 | Phase 1 |

**合計**: 約 20 営業日 ≒ 1.0 人月 (FE 1 名)

## 2. /stores 一覧 — ベンダーバッジ + ライフサイクルバッジ

### 2-1. 現状

```
| 店舗名         | 都道府県 | 拠点コード | アラート | 詳細 |
|---------------|---------|-----------|---------|-----|
| 世田谷店       | 東京都  | TKY-001   | 🟢      | →   |
| 練馬店         | 東京都  | TKY-002   | 🟠      | →   |
```

### 2-2. 改修後

```
| 店舗名     | 都道府県 | コード   | モード     | NVR             | ライフ      | アラート | 詳細 |
|-----------|---------|---------|-----------|-----------------|------------|---------|-----|
| 世田谷店   | 東京都  | TKY-001 | 🖥 Mini PC | [Frigate]       | —          | 🟢      | →   |
| 練馬店     | 東京都  | TKY-002 | ☁ 中央集約 | [i-PRO NX300K]  | 🟡 18ヶ月  | 🟠      | →   |
| つくば店   | 茨城県  | IBR-005 | ☁ 中央集約 | [i-PRO NU201K]  | 🟢 36ヶ月  | 🟢      | →   |
| 板橋店     | 東京都  | TKY-008 | ☁ 中央集約 | [i-PRO NX200K]  | 🔴 EOS超過 | 🔴      | →   |
```

- **モード**: `🖥 Mini PC` (per_store_minipc) / `☁ 中央集約` (central_aggregator)
- **NVR**: ベンダー + 機種番号バッジ
- **ライフ**: ライフサイクルバッジ + 残月数

### 2-3. ファイル変更

| パス | 変更 |
|---|---|
| `src/app/stores/page.tsx` | クエリに NVR 情報追加、列追加 |
| `src/app/stores/components/StoreRow.tsx` (新規) | 行コンポーネント切り出し |
| `src/components/NvrVendorBadge.tsx` (新規) | ベンダー表示 |
| `src/components/LifecycleBadge.tsx` (新規) | ライフサイクル表示 |
| `src/components/DeploymentModeBadge.tsx` (新規) | モード表示 |
| `src/lib/i18n/messages.ts` | キー追加 (後述) |

## 3. /stores/[id] 詳細 — NVR 設定タブ + ライフサイクルカード

### 3-1. ページ全体構成 (改修後)

```
┌─────────────────────────────────────────────────────────────┐
│  ← 店舗一覧                                                  │
│                                                              │
│  📍 世田谷店    [☁ 中央集約モード] [i-PRO WJ-NX300K]          │
│  TKY-001 / 東京都世田谷区...                                  │
├─────────────────────────────────────────────────────────────┤
│  [概要] [カメラ] [NVR設定★] [アラート履歴] [設定]              │
├─────────────────────────────────────────────────────────────┤
│  (タブごとに切り替わる本文)                                    │
└─────────────────────────────────────────────────────────────┘
```

### 3-2. 「NVR 設定」タブ (新規)

```
┌─ NVR 接続情報 ────────────────────────────────────────┐
│                                                       │
│  ベンダー:    [i-PRO WJ-NX シリーズ        ▼]         │
│  機種:        [WJ-NX300K (16ch IP NVR)     ▼]         │
│  エンドポイント: [https://10.0.1.5:8443           ]   │
│  認証情報:    [vault://secrets/abc12345     ▼] [選択]  │
│                                                       │
│  追加オプション (JSON):                                │
│  ┌───────────────────────────────────────────────┐   │
│  │ {                                              │   │
│  │   "cgi_path": "/cgi-bin",                      │   │
│  │   "rtsp_transport": "tcp"                      │   │
│  │ }                                              │   │
│  └───────────────────────────────────────────────┘   │
│                                                       │
│  [💾 保存]  [🔌 接続テスト]                            │
│                                                       │
└───────────────────────────────────────────────────────┘

┌─ 検出された情報 (最終: 2026-06-04 14:23) ────────────┐
│                                                       │
│  FW バージョン:  3.42-0001                            │
│  シリアル:       AB12345678                           │
│  ハードウェア:   2.10                                 │
│  MAC アドレス:   00:80:F0:XX:XX:XX                    │
│                                                       │
│  チャンネル数: 16 (12 アクティブ)                      │
│  最大解像度:   4K (3840×2160)                         │
│                                                       │
└───────────────────────────────────────────────────────┘

┌─ 機能 (capability) ──────────────────────────────────┐
│                                                       │
│  ✅ スナップショット取得                              │
│  ✅ ライブ RTSP                                       │
│  ✅ 録画→MP4 エクスポート (最大 24時間)               │
│  ✅ ONVIF Event Push                                  │
│  ✅ AI メタデータ受信                                  │
│  ✅ iPRO Active Guard 連携                            │
│  ✅ タイムラインスナップショット (BCP 用)             │
│  ❌ AI on iPRO (FW v4.x が必要、現在 v3.42)           │
│                                                       │
└───────────────────────────────────────────────────────┘

┌─ 機材ライフサイクル ────────────────────────────────┐
│                                                       │
│  導入日:        2022-04-15 (4年2ヶ月運用中)           │
│  EOL (生産終了): 2027-09-30 (残 15ヶ月)               │
│  EOS (サポート終了): 2030-09-30 (残 51ヶ月)            │
│  7年運用ルール上限: 2029-04-15 (残 33ヶ月)            │
│  ──────────────────────────────────────────────────  │
│  実質的な置換期限: 2029-04-15 (残 33ヶ月)              │
│                                                       │
│  [████████░░░░░░░░░░░░░░░░░░░░░░░░] 33%             │
│   ↑導入                          ↑置換期限           │
│                                                       │
│  状態: 🟢 サポート期間中                              │
│                                                       │
│  [📅 置換計画を作成]  [📋 履歴を見る]                  │
│                                                       │
└───────────────────────────────────────────────────────┘
```

### 3-3. ファイル変更

| パス | 変更 |
|---|---|
| `src/app/stores/[id]/page.tsx` | タブナビゲーション追加 |
| `src/app/stores/[id]/nvr/page.tsx` (新規) | NVR 設定タブ本体 |
| `src/app/stores/[id]/nvr/NvrConnectionForm.tsx` (新規) | 接続情報フォーム |
| `src/app/stores/[id]/nvr/NvrInfoCard.tsx` (新規) | 検出された情報カード |
| `src/app/stores/[id]/nvr/CapabilityList.tsx` (新規) | capability 一覧 |
| `src/app/stores/[id]/nvr/LifecycleCard.tsx` (新規) | ライフサイクルカード |
| `src/app/api/stores/[id]/nvr/test-connection/route.ts` (新規) | 接続テスト API |

## 4. /infra ダッシュボード — EOL アラートサマリ

### 4-1. 現状 (推測ベース)

```
┌─ システム健全性 ────────────────────────┐
│  店舗数: 10,000                          │
│  オンライン: 9,847  オフライン: 153      │
└─────────────────────────────────────────┘

(以下既存ダッシュボード要素)
```

### 4-2. 改修後 (上部に新セクション追加)

```
┌─ 機材ライフサイクル ───────────────────────────────────────┐
│                                                            │
│  全店舗 10,000                                              │
│                                                            │
│  🟢 サポート期間中:        8,234 店 (82.3%)                │
│  🟡 24ヶ月以内 EOS:           892 店 (8.9%)                │
│  🟠 置換計画推奨 (12mo):       451 店 (4.5%)                │
│  🔴 緊急: 6ヶ月以内 EOS:       287 店 (2.9%)                │
│  ⛔ EOS 超過:                  136 店 (1.4%)                │
│                                                            │
│  [📊 詳細を見る →] [📅 置換計画を作成 →]                    │
│                                                            │
└────────────────────────────────────────────────────────────┘

┌─ 機種別 EOS 残期間 (緊急 / 計画推奨のみ) ────────────────┐
│                                                          │
│  WJ-NX200K  ████████ 287 店 (緊急)                       │
│  WJ-NX300K  ██████ 213 店 (計画推奨)                     │
│  WJ-GXE500  ████ 142 店 (計画推奨)                       │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### 4-3. ファイル変更

| パス | 変更 |
|---|---|
| `src/app/infra/page.tsx` | 新セクション追加 |
| `src/app/infra/components/LifecycleSummary.tsx` (新規) | サマリカード |
| `src/app/infra/components/ModelBreakdownChart.tsx` (新規) | 機種別棒グラフ |

## 5. /infra/lifecycle (新規) — 機種別 / 店舗別ライフサイクル一覧

```
┌─ ライフサイクル管理 ──────────────────────────────────────┐
│                                                            │
│  [フィルタ: すべて ▼] [状態: 緊急+計画推奨 ▼] [Excel エクスポート]│
│                                                            │
│  ┌────────────────────────────────────────────────────┐   │
│  │ 店舗名     | 機種        | 導入日     | EOS まで | 状態 │
│  │────────────────────────────────────────────────────│   │
│  │ 板橋店     | WJ-NX200K   | 2018-04-01 | -2ヶ月   | ⛔   │
│  │ 川越店     | WJ-NX200K   | 2018-06-15 | -1ヶ月   | ⛔   │
│  │ 練馬店     | WJ-NX300K   | 2020-04-01 | 3ヶ月    | 🔴   │
│  │ つくば店   | WJ-NU201K   | 2022-08-10 | 31ヶ月   | 🟢   │
│  │ ...                                                 │   │
│  └────────────────────────────────────────────────────┘   │
│                                                            │
│  全 1,766 件中 1〜50 件表示                                │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### ファイル

| パス | 変更 |
|---|---|
| `src/app/infra/lifecycle/page.tsx` (新規) | テーブル本体 |
| `src/app/api/infra/lifecycle/export/route.ts` (新規) | Excel エクスポート |

## 6. /infra/nodes (新規) — 中央集約ノード状況

中央集約モードを利用している場合に、HA 構成のノード状態と店舗割当を表示。

```
┌─ 中央エージェント ノード ───────────────────────────────────┐
│                                                              │
│  ┌─ Node A (Active) ─────────────────────────────────────┐  │
│  │  🟢 稼働中  hostname: edge-central-01.intereco.jp     │  │
│  │  リージョン: ap-northeast-1 (東京)                     │  │
│  │  CPU: 18% | RAM: 42% (109/256GB) | 帯域: 234 Mbps      │  │
│  │  担当店舗: 5,127 / 上限 10,000                          │  │
│  │  最終ハートビート: 12秒前                               │  │
│  │  リース有効期限: 2026-06-04 14:35:21 (約 30 秒後更新)   │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌─ Node B (Active) ─────────────────────────────────────┐  │
│  │  🟢 稼働中  hostname: edge-central-02.intereco.jp     │  │
│  │  リージョン: ap-northeast-1 (東京)                     │  │
│  │  CPU: 21% | RAM: 39% (99/256GB) | 帯域: 198 Mbps       │  │
│  │  担当店舗: 4,873 / 上限 10,000                          │  │
│  │  最終ハートビート: 8秒前                                │  │
│  │  リース有効期限: 2026-06-04 14:35:18                   │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  [🔄 シャードリバランス] [⚠ ノードを排出 (draining)]        │
│                                                              │
└──────────────────────────────────────────────────────────────┘

┌─ 店舗→ノード割当分布 (上位 5 県) ───────────────────────┐
│  東京都 (3,251 店): A=1,623 / B=1,628                    │
│  神奈川県 (1,402 店): A=702 / B=700                       │
│  ...                                                      │
└───────────────────────────────────────────────────────────┘
```

### ファイル

| パス | 変更 |
|---|---|
| `src/app/infra/nodes/page.tsx` (新規) | ノード一覧本体 |
| `src/app/infra/nodes/NodeCard.tsx` (新規) | 個別ノードカード |
| `src/app/infra/nodes/ShardDistributionPanel.tsx` (新規) | 割当分布 |

## 7. /admin/nvr-models (新規) — NVR 機種マスタ管理

`nvr_models` テーブルの CRUD 画面 (管理者専用)。i-PRO 公式 EOL 情報を反映する運用入口。

```
┌─ NVR 機種マスタ ──────────────────────────────────────────┐
│                                                            │
│  [+ 機種を追加] [📥 CSV インポート]  [フィルタ: i-PRO ▼]  │
│                                                            │
│  ┌────────────────────────────────────────────────────┐   │
│  │ ベンダー| 機種        | 発売     | EOL       | EOS  │   │
│  │────────────────────────────────────────────────────│   │
│  │ i-PRO  | WJ-NX200K   | 2018-04  | 2024-03   | 2029-03  │
│  │ i-PRO  | WJ-NX300K   | 2018-10  | 2025-09   | 2030-09  │
│  │ i-PRO  | WJ-NX400K   | 2019-04  | 2026-03   | 2031-03  │
│  │ ...                                                  │  │
│  └────────────────────────────────────────────────────┘   │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

## 8. i18n キー追加 (`src/lib/i18n/messages.ts`)

```ts
// 既存の Msg interface に追加するキー (4 言語分):

// ─── ベンダー名 ───
nvrVendor: {
  iProNx:      string  // 'i-PRO WJ-NX' / 'i-PRO WJ-NX'
  iProNu:      string  // 'i-PRO WJ-NU' / 'i-PRO WJ-NU'
  iProGxe500:  string  // 'i-PRO WJ-GXE500' / 'i-PRO WJ-GXE500'
  frigate:     string  // 'Frigate (各店 Mini PC)' / 'Frigate (per-store)'
  hikvision:   string  // (将来)
  hanwha:      string
  synology:    string
  axis:        string
  onvifGeneric: string
}

// ─── デプロイメントモード ───
deploymentMode: {
  perStoreMinipc: string  // '各店 Mini PC' / 'Per-store Mini PC'
  centralAggregator: string  // '中央集約' / 'Central aggregator'
}

// ─── ライフサイクル状態 ───
nvrLifecycle: {
  unknown:         string
  ok:              string
  warning:         string
  replacePlanned:  string
  urgent:          string
  eos:             string
  overage:         string
  monthsUntilEos:  (n: number) => string  // ★ 関数値 → §11 でリスク回避策
  yearsInService:  (n: number) => string
}

// ─── /stores NVR タブ ───
nvrSettings: {
  tabTitle:           string  // 'NVR 設定' / 'NVR Settings'
  connectionTitle:    string
  vendor:             string
  model:              string
  endpoint:           string
  credentials:        string
  additionalOptions:  string
  save:               string
  testConnection:     string
  testInProgress:     string
  testOk:             string
  testFailed:         string
  detectedInfo:       string
  fwVersion:          string
  serial:             string
  capabilityTitle:    string
  lifecycleTitle:     string
  installedAt:        string
  eolDate:            string
  eosDate:            string
  sevenYearRule:      string
  effectiveReplaceBy: string
  createReplacePlan:  string
  viewHistory:        string
}

// ─── /infra ライフサイクルサマリ ───
infraLifecycle: {
  title:           string
  total:           string
  modelBreakdown:  string
  viewDetail:      string
  createPlan:      string
}

// ─── /infra/nodes ───
infraNodes: {
  title:           string
  active:          string
  draining:        string
  down:            string
  hostname:        string
  region:          string
  capacity:        string
  assignedStores:  string
  lastHeartbeat:   string
  leaseExpires:    string
  rebalance:       string
  drain:           string
}
```

## 9. デザインシステム遵守事項

| 要素 | 既存スタイル | 注意 |
|---|---|---|
| バッジ | `inline-block rounded px-2 py-0.5 text-[11px] font-semibold` (既存 STATUS_STYLE 風) | 既存 STATUS_STYLE に倣う |
| カード | `rounded-lg border border-slate-200 bg-white p-4` | F42 で多用済み |
| 危険状態 | `bg-red-100 text-red-700` (中度) / `bg-red-600 text-white` (極) | アクセシビリティ AA |
| アイコン | Unicode emoji (🟢🟡🟠🔴) を許可 | 既存と同様 |
| ダークモード | `dark:bg-*-900/30` 等を必ず付与 | 既存ガイドラインに準拠 |

## 10. アクセシビリティ

- バッジは色だけでなくテキストでも状態を伝える (`🔴 緊急: 6ヶ月`)
- フォーカス順序は「ベンダー → 機種 → エンドポイント → 認証 → オプション → 保存」
- 接続テスト中は `aria-busy="true"` をボタンに付与
- ライフサイクル進捗バーは `role="progressbar"` + `aria-valuenow/max`

## 11. リスク回避 (F40.4 教訓を反映)

F40.4 で「i18n の関数値メッセージ (`storeCountValue`) が HMR 経路で『is not a function』エラー」になった経験あり。

**新規キーで関数値を導入する場合は最初から保険を入れる**:

```ts
// 推奨パターン: 関数値ではなく lang ベースのインライン format
function fmtMonthsUntilEos(lang: string, n: number): string {
  if (n < 0) {
    switch (lang) {
      case 'en': return `EOS exceeded by ${Math.abs(n)}mo`
      case 'zh': return `EOS 已过 ${Math.abs(n)} 个月`
      case 'ko': return `EOS ${Math.abs(n)}개월 초과`
      default:   return `EOS 超過 ${Math.abs(n)}ヶ月`
    }
  }
  switch (lang) {
    case 'en': return `${n}mo until EOS`
    case 'zh': return `距 EOS 还有 ${n} 个月`
    case 'ko': return `EOS까지 ${n}개월`
    default:   return `EOS まで ${n}ヶ月`
  }
}
```

`messages.ts` には関数値を入れず、コンポーネント内でこういう関数を直接呼ぶ。これで `is not a function` ランタイムエラーが構造的に消せる。

## 12. 確定事項と未確定事項

### 確定済

- [x] 改修対象画面と内容
- [x] 新規ファイルパス
- [x] i18n キー一覧
- [x] アクセシビリティ要件
- [x] デザインシステム遵守

### Phase 0 で要モック検証

- [ ] NVR 設定タブのデザイン詳細 (実装前に Figma 等で確定)
- [ ] ライフサイクル進捗バーのカラーグラデーション
- [ ] EOL/EOS 期限近接時のメール通知文面

### Phase 1〜2 で実装決定

- [ ] CSV 一括インポートのフォーマット仕様
- [ ] Excel エクスポートのレイアウト
- [ ] /admin/nvr-models へのアクセス権限 (tenant_admin 以上等)

## 13. 関連ドキュメント

- `nvr-adapter-design.md` — 裏側のアダプタ層
- `firmware-capability-matrix.md` — capability list の出元
- `eol-eos-data-model.md` — ライフサイクル情報の DB 構造
- `../monitor/src/lib/nvr-adapter/types.ts` — UI と adapter 共通の型
