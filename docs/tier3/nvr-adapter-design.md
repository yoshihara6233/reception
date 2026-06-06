# F45.1: NVR アダプタ世代別構造 設計

> Phase 0 着手前の先行調査。Tier 3 集約モードで「i-PRO 2018+ 7 年運用」+ 「将来の他ベンダー追加」を両立するアダプタ層の構造。

## 1. 設計目的

- **同一プロダクト (Recorder Monitor) 内で 2 つの運用モードを共存** ─ 各店 Mini PC モード (現行) と中央集約モード (新規)
- **i-PRO 1 社で開始しつつ、後から他ベンダーを追加できる拡張性**
- **同一ベンダーでも FW 世代差を吸収** (2018 年機 と 2024 年機を同じインターフェイスで扱う)
- **アナログ DVR (WJ-GXE500 経由 + 将来の他社) を IP NVR と区別なく扱える**

## 2. ディレクトリ構造

```
claude/edge-agent/src/
├── adapters/
│   ├── _base/                            # 全アダプタ共通
│   │   ├── nvr-adapter.ts                # interface NvrAdapter (型のみ)
│   │   ├── capabilities.ts               # NvrCapabilities 型 + デフォルト値
│   │   ├── channel.ts                    # Channel 抽象型
│   │   ├── contract-tests.ts             # 共通契約テストランナー
│   │   └── errors.ts                     # NvrAdapter 系の例外型
│   │
│   ├── _registry/                        # アダプタ動的解決
│   │   ├── registry.ts                   # vendor 文字列 → ファクトリ関数
│   │   └── index.ts                      # public API: getAdapter(vendor, config)
│   │
│   ├── i-pro/                            # 初期実装ターゲット
│   │   ├── _common/
│   │   │   ├── cgi-client.ts             # 全 i-PRO 機共通の CGI クライアント
│   │   │   ├── firmware-detector.ts      # FW Ver 検出
│   │   │   ├── auth.ts                   # Digest 認証
│   │   │   └── i-pro-types.ts            # API レスポンス型
│   │   │
│   │   ├── nx-series/                    # WJ-NX200/300/400/510
│   │   │   ├── nx-adapter.ts             # 各世代の親クラス
│   │   │   ├── nx-v1-adapter.ts          # 2018-2019 FW (1.x)
│   │   │   ├── nx-v2-adapter.ts          # 2020-2021 FW (2.x)
│   │   │   └── nx-v3-plus-adapter.ts     # 2022+ FW (3.x+)
│   │   │
│   │   ├── nu-series/                    # WJ-NU101K/201K/301K (小規模向け)
│   │   │   └── nu-adapter.ts             # NX とほぼ同じ、軽量化版
│   │   │
│   │   ├── gxe500/                       # WJ-GXE500 (アナログ→IP 変換)
│   │   │   └── gxe-adapter.ts            # 仮想 channel として扱う
│   │   │
│   │   └── index.ts                      # i-PRO 系 registry 登録
│   │
│   ├── frigate/                          # 現行 Mini PC モード用 (既存)
│   │   └── frigate-adapter.ts            # 既存 edge-agent/src/modes 由来
│   │
│   └── _future/                          # Phase 5+ 拡張枠 (空ディレクトリ + README)
│       ├── README.md                     # 「ここに新ベンダーを追加してください」
│       ├── hikvision/                    # (将来)
│       ├── hanwha/                       # (将来)
│       ├── synology/                     # (将来)
│       ├── axis/                         # (将来)
│       └── onvif-generic/                # (将来) 汎用 fallback
│
├── modes/                                # 既存の per-store / 新規 central
│   ├── per-store/                        # 1 プロセス = 1 店舗 (現行)
│   │   └── runner.ts
│   └── central/                          # 1 プロセス = N 店舗 (新規)
│       ├── runner.ts                     # マルチテナント実行
│       ├── tenant-loop.ts                # 店舗ごとのコマンドポーリング
│       └── tenant-pool.ts                # 接続/リソース管理
│
├── commands/                             # ベンダー非依存 (Adapter 経由で実行)
│   ├── capture-snapshot.ts
│   ├── start-live.ts
│   ├── export-vod.ts
│   ├── start-bcp-capture.ts
│   └── ...
│
├── scheduler/                            # 6h ハートビート (central のみ)
│   └── heartbeat-cron.ts
│
├── webhook/                              # ONVIF event 受信 (central のみ)
│   └── onvif-receiver.ts
│
├── shard/                                # シャード / リース (central のみ)
│   └── lease-manager.ts
│
└── index.ts                              # mode により per-store or central を起動
```

## 3. アダプタクラス階層 (TypeScript 継承の使い方)

i-PRO 系は **共通実装 (CGI クライアント) + 世代別オーバーライド** で書く。継承は浅く保つ (深さ 2 まで)。

```
NvrAdapter (interface)
├── IProBaseAdapter (abstract class)             ← 全 i-PRO 機共通 (CGI ベース実装)
│   ├── IProNxV1Adapter      (2018-2019 FW)
│   ├── IProNxV2Adapter      (2020-2021 FW)
│   ├── IProNxV3PlusAdapter  (2022+ FW)
│   ├── IProNuAdapter        (WJ-NU 系、NX に似た構造)
│   └── IProGxe500Adapter    (アナログ→IP 変換、capability 縮退)
│
├── FrigateAdapter            ← 既存 Mini PC モードの抽象化
│
└── (将来) OnvifGenericAdapter / HikvisionAdapter / ...
```

- **`IProBaseAdapter`** は CGI 認証、リトライ、レート制限、エラー正規化などの **共通処理**を持つ
- 世代別クラスは **実装の差分** (新規 API パス、レスポンス形式、capability) **のみ**をオーバーライド
- 世代判定は **adapter ファクトリの中で FW Ver を見て決める** (`getAdapter()` 内、後述)

## 4. アダプタ動的解決 (Registry パターン)

新ベンダー追加 = registry に 1 行追加するだけにする。

```ts
// adapters/_registry/registry.ts
import type { NvrAdapter, NvrAdapterConfig } from '../_base/nvr-adapter'

type AdapterFactory = (config: NvrAdapterConfig) => Promise<NvrAdapter>

export const ADAPTER_REGISTRY: Record<string, AdapterFactory> = {
  // i-PRO 系: ファクトリの中で FW Ver を見て世代別クラスを返す
  'i-pro-nx': async (cfg) => {
    const { createIProNxAdapter } = await import('../i-pro/nx-series/nx-adapter')
    return createIProNxAdapter(cfg)
  },
  'i-pro-nu': async (cfg) => {
    const { createIProNuAdapter } = await import('../i-pro/nu-series/nu-adapter')
    return createIProNuAdapter(cfg)
  },
  'i-pro-gxe500': async (cfg) => {
    const { IProGxe500Adapter } = await import('../i-pro/gxe500/gxe-adapter')
    return new IProGxe500Adapter(cfg)
  },

  // 既存 Mini PC モード用 (Frigate)
  'frigate': async (cfg) => {
    const { FrigateAdapter } = await import('../frigate/frigate-adapter')
    return new FrigateAdapter(cfg)
  },

  // Phase 5+ で追加されるベンダー (例として枠だけ用意):
  // 'hikvision': async (cfg) => { ... },
  // 'hanwha-wisenet': async (cfg) => { ... },
  // 'synology-surveillance': async (cfg) => { ... },
  // 'onvif-generic': async (cfg) => { ... },
}

export async function getAdapter(
  vendor: string,
  config: NvrAdapterConfig,
): Promise<NvrAdapter> {
  const factory = ADAPTER_REGISTRY[vendor]
  if (!factory) {
    throw new Error(`No adapter registered for vendor: ${vendor}`)
  }
  return factory(config)
}
```

### 世代分岐は「ファクトリ内」で行う

```ts
// adapters/i-pro/nx-series/nx-adapter.ts
import { detectIProFirmware } from '../_common/firmware-detector'
import { IProNxV1Adapter } from './nx-v1-adapter'
import { IProNxV2Adapter } from './nx-v2-adapter'
import { IProNxV3PlusAdapter } from './nx-v3-plus-adapter'

export async function createIProNxAdapter(
  config: NvrAdapterConfig,
): Promise<NvrAdapter> {
  const fw = await detectIProFirmware(config)  // 起動時に 1 回 CGI 叩く
  if (fw.major >= 3) return new IProNxV3PlusAdapter(config, fw)
  if (fw.major >= 2) return new IProNxV2Adapter(config, fw)
  return new IProNxV1Adapter(config, fw)
}
```

ファクトリは **キャッシュ** (`Map<storeId, NvrAdapter>`) すべき。FW Ver 検出は店舗あたり 1 回だけ。

## 5. コマンドハンドラの実装パターン

コマンドハンドラは **adapter を vendor で動的解決** して呼ぶだけ。ベンダー固有の if-else は書かない。

```ts
// commands/capture-snapshot.ts
import { getAdapter } from '@/adapters/_registry'
import { loadStoreConfig } from '@/lib/stores'

export async function handleCaptureSnapshot(cmd: PendingCommand) {
  const store = await loadStoreConfig(cmd.store_id)
  const adapter = await getAdapter(store.nvr_vendor, {
    endpoint: store.nvr_endpoint,
    credentials: await resolveCredentials(store.nvr_credentials_ref),
    options: store.nvr_options ?? {},
  })

  // capability チェック — 不可なら早期エラー
  if (!adapter.capabilities.supportsSnapshot) {
    throw new UnsupportedOperationError('snapshot not supported by this NVR')
  }

  const jpeg = await adapter.getSnapshot(cmd.payload.channel)
  return await uploadToSupabaseStorage(jpeg, cmd.id)
}
```

## 6. アナログ DVR の扱い (i-PRO WJ-GXE500 経由)

WJ-GXE500 は「アナログカメラ 4ch → IP に変換するエンコーダ」。これを **WJ-NX 配下の仮想 channel** として扱う方法と、**独立した GxeAdapter** として扱う方法の 2 通りがある。

### 採用案: 独立 Adapter として扱う

理由:
- 単体運用 (NX なしで GXE500 → 直接 RTSP) の店舗もあり得る
- capability が NX と異なる (VOD なし、event なし、解像度 max 1080p 等)
- DB の `stores.nvr_vendor` で明示的に切り替えられる

```ts
// adapters/i-pro/gxe500/gxe-adapter.ts
export class IProGxe500Adapter extends IProBaseAdapter {
  readonly vendor = 'i-pro-gxe500'

  get capabilities(): NvrCapabilities {
    return {
      protocol: 'cgi+rtsp',
      supportsSnapshot: true,
      supportsLiveRtsp: true,
      supportsVod: false,            // ★ アナログ変換器なので録画機能なし
      supportsEventPush: false,      // ★ イベント push 非対応
      supportsMotionZone: false,
      supportsAiMetadata: false,
      maxResolution: '1080p',
      maxChannels: 4,
      authMethod: 'digest',
    }
  }

  // getVodMp4 は実装しない (capabilities.supportsVod = false なので呼ばれない)
}
```

「WJ-NX + WJ-GXE500 のハイブリッド」店舗は **2 つの adapter を別 store として扱う** か **NX adapter 側で GXE 由来チャンネルを混在表示** するか、後述の Phase 1 設計判断にする。

## 7. 拡張ポイントの明確化 (Phase 5+ 用)

新ベンダー追加時に開発者が触るのは **以下のみ**:

| 作業 | ファイル / 場所 |
|---|---|
| 1. アダプタクラス作成 | `adapters/<new-vendor>/` 配下に新規 |
| 2. registry に登録 | `adapters/_registry/registry.ts` に 1 行追加 |
| 3. 契約テスト追加 | `adapters/<new-vendor>/*.test.ts` で `runAdapterContractTests()` を呼ぶ |
| 4. UI ベンダー選択肢追加 | `monitor/src/lib/i18n/messages.ts` にベンダー表示名追加 |
| 5. (任意) capability 拡張 | `adapters/_base/capabilities.ts` に新 flag 追加 (既存に影響なし) |

これ以外のコード (`commands/`, `scheduler/`, `webhook/`, `modes/`, `shard/`, monitor UI 全般) は **触らない**。Open/Closed 原則を物理ディレクトリ構造で強制する。

## 8. 既存 edge-agent からの移行戦略

現行 `claude/edge-agent/src/modes/bcp.ts` などはすでに Frigate に密結合している。これを段階的に剥がす:

| ステップ | 内容 |
|---|---|
| **S1** (Phase 0) | `_base/nvr-adapter.ts` + `_registry/` を新規追加。既存コードは触らない。 |
| **S2** (Phase 0) | `adapters/frigate/frigate-adapter.ts` を作成、`modes/bcp.ts` のロジックを移植 (per-store mode 用の adapter として) |
| **S3** (Phase 1) | `commands/capture-snapshot.ts` を作成、Frigate 直叩きから `getAdapter('frigate')` 経由に切り替え |
| **S4** (Phase 1) | i-PRO 系 adapter を追加。`modes/central/` 配下で利用開始 |
| **S5** (Phase 2) | 既存 `modes/bcp.ts` 削除、新パスに完全移行 |

各ステップで **既存 Mini PC モードが壊れないこと** をリグレッションテストで保証。

## 9. テスト戦略

### 9-1. 契約テスト (Contract Tests)

```ts
// adapters/_base/contract-tests.ts
export function runAdapterContractTests(
  name: string,
  factory: () => Promise<NvrAdapter>,
) {
  describe(`NvrAdapter contract: ${name}`, () => {
    let adapter: NvrAdapter
    beforeAll(async () => { adapter = await factory() })

    test('testConnection returns boolean', async () => {
      const ok = await adapter.testConnection()
      expect(typeof ok).toBe('boolean')
    })

    test('getChannelList returns non-empty array', async () => {
      const list = await adapter.getChannelList()
      expect(list.length).toBeGreaterThan(0)
    })

    test('getSnapshot returns JPEG buffer', async () => {
      const buf = await adapter.getSnapshot(1)
      expect(buf.length).toBeGreaterThan(1024)         // ≥1KB
      expect(buf[0]).toBe(0xff); expect(buf[1]).toBe(0xd8)  // JPEG magic
    })

    test('getLiveRtspUri returns valid RTSP URL', async () => {
      const uri = await adapter.getLiveRtspUri(1)
      expect(uri).toMatch(/^rtsps?:\/\//)
    })

    if (adapter.capabilities.supportsVod) {
      test('getVodMp4 returns stream', async () => { /* … */ })
    }
    if (adapter.capabilities.supportsEventPush) {
      test('subscribeEvents resolves', async () => { /* … */ })
    }
  })
}
```

各アダプタ実装 ( `i-pro/nx-series/nx-v1-adapter.test.ts` 等) で `runAdapterContractTests('nx-v1', () => createIProNxAdapter(...))` を呼ぶ。新ベンダー追加時はこれを通すだけで最低品質を保証。

### 9-2. 統合テスト (Real Hardware)

Phase 0/1 では **実機 i-PRO NVR** に対して契約テストを通す。CI 環境では実機なしで動かすため:
- `MOCK_NVR=1` 環境変数でモック HTTP サーバを起動
- モックは Hikvision/Hanwha/i-PRO の典型レスポンスをファイル化したものを返す

### 9-3. リグレッション (Mini PC モード)

既存 `modes/bcp.ts` の動作を `adapters/frigate/frigate-adapter.ts` 経由に切り替えた後、**スナップショットテスト** で出力 JSON / バイナリの一致を確認。

## 10. 確定事項と今後の決定事項

### 確定済 (この設計書時点)

- [x] 1 base + per-generation 継承の構造
- [x] adapters/<vendor>/ ディレクトリで vendor を物理分離
- [x] registry パターンで動的解決
- [x] capability flag で UI を制御
- [x] 契約テストで品質保証

### Phase 0 で決定すべきこと

- [ ] `IProBaseAdapter` の具象実装 — CGI クライアントの細部
- [ ] `NvrAdapterConfig` の最終形 — 認証情報・タイムアウト・retry 設定
- [ ] Frigate adapter の API 表面 — 既存 modes/bcp.ts のどこまで切り出すか
- [ ] エラー正規化 — ベンダー固有エラー → 共通エラー型へのマッピング
- [ ] レート制限 — adapter ごとの並列度上限 (NVR が同時 4 接続まで等)

### Phase 1 で決定すべきこと

- [ ] WJ-GXE500 単体 vs NX 配下の扱い (上記 §6 参照)
- [ ] AI on iPRO / iPRO Active Guard 連携 API の取り込み範囲
- [ ] アダプタの「ホットスワップ」 — 店舗の FW 更新時に再検出する仕組み

## 11. 参考 / 関連ドキュメント

- `firmware-capability-matrix.md` — FW Ver 検出と capability 表
- `eol-eos-data-model.md` — EOL/EOS スキーマ
- `ui-mockups.md` — UI 設計
- `../monitor/src/lib/nvr-adapter/types.ts` — TypeScript 型定義 (F45.5)
