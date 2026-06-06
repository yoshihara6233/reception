# F45.2: FW Ver 検出 + Capability マトリックス 設計

> 7 年運用前提で、同じ i-PRO NVR でも FW 世代差が広く存在する。adapter 起動時に FW Ver を取り、それに応じて機能 (capability) を動的に決定する。

## 1. 設計方針

- **adapter インスタンスごとに FW Ver を 1 回だけ検出** (起動時)
- **capability は immutable** (FW Ver が変わったら adapter インスタンスを破棄して再生成)
- **未知の FW** に遭遇したら **最も保守的な capability** にフォールバック (= 古い世代として扱う)
- **テスト容易性**: capability マトリックスは純関数 `(fw) => capabilities`

## 2. FW Ver 検出ロジック

### 2-1. i-PRO NX / NU での検出方法

i-PRO の WJ-NX/NU は **複数の検出経路**を持つ。優先順位順:

| 優先 | 方法 | エンドポイント | 信頼性 |
|---|---|---|---|
| 1 | **CGI: getsysteminfo** | `GET /cgi-bin/getsysteminfo` (basic / digest auth) | ★★★ 公式仕様 |
| 2 | **ONVIF: GetDeviceInformation** | `POST /onvif/device_service` | ★★ 標準だが詳細が乏しい |
| 3 | **HTTP Header の Server: 値** | 任意の HTTP 応答ヘッダー | ★ fallback のみ |

### 2-2. 取得結果のパース

`/cgi-bin/getsysteminfo` の典型レスポンス (簡略化):

```
ModelName=WJ-NX300K
FirmwareVersion=3.42-0001
SerialNumber=AB12345678
MacAddress=00:80:F0:XX:XX:XX
HardwareVersion=2.10
```

これをパースして以下の構造体に変換:

```ts
interface FirmwareInfo {
  vendor:       string    // 'i-pro'
  modelFamily:  'nx' | 'nu' | 'gxe' | 'hd' | 'unknown'
  modelNumber:  string    // 'WJ-NX300K'
  fwVersion:    string    // '3.42-0001'
  fwMajor:      number    // 3
  fwMinor:      number    // 42
  fwPatch:      number    // 1
  hwVersion?:   string
  serial?:      string
  detectedAt:   Date
  source:       'cgi' | 'onvif' | 'header'  // どの経路で取れたか
}
```

### 2-3. パース失敗時のフォールバック

| シナリオ | 動作 |
|---|---|
| CGI が 401 (認証失敗) | 即エラー、ユーザに認証情報の見直しを促す |
| CGI が 404 (古い FW) | ONVIF にフォールバック |
| ONVIF も失敗 | HTTP Server ヘッダーから推定 |
| 全て失敗 | `FirmwareInfo` を `{ fwMajor: 0, ... }` で作り、**最保守 capability** で起動 |

## 3. Capability 型定義

```ts
// adapters/_base/capabilities.ts
export interface NvrCapabilities {
  // === プロトコル ===
  protocol:               ('cgi' | 'onvif' | 'sdk' | 'rtsp_only')[]
  authMethod:             'digest' | 'basic' | 'token'

  // === コアスナップショット / ライブ ===
  supportsSnapshot:       boolean
  supportsLiveRtsp:       boolean
  supportsLiveJpegPull:   boolean       // HTTP 連続 JPEG (古い機種は無い)

  // === 録画 / VOD ===
  supportsVod:            boolean       // 録画→MP4 export 可
  vodFormats:             ('mp4' | 'avi' | 'i-pro-proprietary')[]
  maxVodHours:            number        // 一度に出せる最大時間

  // === イベント ===
  supportsEventPush:      boolean       // ONVIF Notification / i-PRO Alarm
  supportsOnvifPullPoint: boolean
  eventTypes:             ('motion' | 'video_loss' | 'tampering' | 'ai_person' | 'ai_vehicle')[]

  // === AI / メタデータ ===
  supportsAiMetadata:     boolean       // ONVIF Profile T 等
  supportsActiveGuard:    boolean       // i-PRO Active Guard 連携
  supportsAiOnIpro:       boolean       // AI on iPRO (新世代)

  // === 映像仕様 ===
  maxResolution:          'D1' | '960H' | '720p' | '1080p' | '4K' | '8K'
  maxChannels:            number
  supportedCodecs:        ('h264' | 'h265' | 'mjpeg')[]

  // === BCP / 特殊機能 ===
  supportsTimelineSnapshot: boolean     // BCP 8 枚タイムラインを native で取れる
  supportsMotionZone:       boolean
  supportsPtz:              boolean

  // === 接続性 ===
  maxConcurrentSessions:    number      // 同時セッション数の上限
  rateLimitMs:              number      // 連続呼び出しの最小間隔 (ms)
}

export const CONSERVATIVE_CAPABILITIES: NvrCapabilities = {
  protocol:                 ['rtsp_only'],
  authMethod:               'digest',
  supportsSnapshot:         true,         // 最低限
  supportsLiveRtsp:         true,
  supportsLiveJpegPull:     false,
  supportsVod:              false,
  vodFormats:               [],
  maxVodHours:              0,
  supportsEventPush:        false,
  supportsOnvifPullPoint:   false,
  eventTypes:               [],
  supportsAiMetadata:       false,
  supportsActiveGuard:      false,
  supportsAiOnIpro:         false,
  maxResolution:            '720p',
  maxChannels:              4,
  supportedCodecs:          ['h264'],
  supportsTimelineSnapshot: false,
  supportsMotionZone:       false,
  supportsPtz:              false,
  maxConcurrentSessions:    2,
  rateLimitMs:              1000,
}
```

## 4. Capability マトリックス (i-PRO WJ-NX/NU)

| FW 世代 | 発売時期 | 対象シリーズ | 主要 capability |
|---|---|---|---|
| **v1.x** | 2018-2019 | WJ-NX200/300 初期 | ONVIF Profile S, CGI 旧仕様, RTSP, snapshot, basic event push |
| **v2.x** | 2020-2021 | WJ-NX300/400/510 中期 | + ONVIF Profile T, AI メタデータ受信, motion zone API |
| **v3.x** | 2022-2023 | WJ-NX300K/410K/510K/NU201K | + iPRO Active Guard 連携, タイムラインスナップショット |
| **v4.x** | 2024+ | 最新世代 | + AI on iPRO, クラウド同期 |

### 4-1. 完全マトリックス

| Capability | v1.x | v2.x | v3.x | v4.x |
|---|---|---|---|---|
| `protocol` | cgi+onvif | cgi+onvif | cgi+onvif | cgi+onvif |
| `supportsSnapshot` | ✓ | ✓ | ✓ | ✓ |
| `supportsLiveRtsp` | ✓ | ✓ | ✓ | ✓ |
| `supportsLiveJpegPull` | ✓ | ✓ | ✓ | ✓ |
| `supportsVod` | ✓ | ✓ | ✓ | ✓ |
| `vodFormats` | mp4 | mp4 | mp4 | mp4 |
| `maxVodHours` | 6 | 12 | 24 | 24 |
| `supportsEventPush` | ✓ (basic) | ✓ (拡張) | ✓ | ✓ |
| `supportsOnvifPullPoint` | ✓ | ✓ | ✓ | ✓ |
| `supportsAiMetadata` | — | ✓ | ✓ | ✓ |
| `supportsActiveGuard` | — | — | ✓ | ✓ |
| `supportsAiOnIpro` | — | — | — | ✓ |
| `maxResolution` | 1080p | 4K | 4K | 4K |
| `maxChannels` | 16 | 32 | 32 | 32 |
| `supportedCodecs` | h264 | h264,h265 | h264,h265 | h264,h265 |
| `supportsTimelineSnapshot` | — | — | ✓ | ✓ |
| `supportsMotionZone` | — | ✓ | ✓ | ✓ |
| `supportsPtz` | ✓ | ✓ | ✓ | ✓ |
| `maxConcurrentSessions` | 4 | 8 | 16 | 16 |
| `rateLimitMs` | 500 | 250 | 200 | 100 |

★ **注意**: 上記は **暫定値**。Phase 0 で実機検証して確定する。

### 4-2. WJ-GXE500 (アナログ→IP 変換) の capability

| Capability | 値 |
|---|---|
| `protocol` | cgi+rtsp |
| `supportsSnapshot` | ✓ |
| `supportsLiveRtsp` | ✓ |
| `supportsVod` | ✗ (録画機能なし、単なる変換器) |
| `supportsEventPush` | ✗ |
| `supportsAiMetadata` | ✗ |
| `maxResolution` | 1080p (但しアナログ入力解像度に依存、実質 D1〜960H) |
| `maxChannels` | 4 |
| `supportsMotionZone` | ✗ |
| `maxConcurrentSessions` | 2 |
| `rateLimitMs` | 1000 |

## 5. Capability 決定関数

純関数として実装。テストしやすい。

```ts
// adapters/i-pro/_common/capability-matrix.ts
import type { FirmwareInfo } from './firmware-detector'
import type { NvrCapabilities } from '../../_base/capabilities'
import { CONSERVATIVE_CAPABILITIES } from '../../_base/capabilities'

export function deriveCapabilities(fw: FirmwareInfo): NvrCapabilities {
  // 安全側: 不明な機種・FW は最保守
  if (fw.modelFamily === 'unknown' || fw.fwMajor === 0) {
    return CONSERVATIVE_CAPABILITIES
  }

  // WJ-GXE500 は完全に別系統
  if (fw.modelFamily === 'gxe') {
    return GXE500_CAPABILITIES
  }

  // WJ-NX / WJ-NU は同じ系統で扱える
  const base: NvrCapabilities = {
    ...CONSERVATIVE_CAPABILITIES,
    protocol: ['cgi', 'onvif'],
    supportsSnapshot: true,
    supportsLiveRtsp: true,
    supportsLiveJpegPull: true,
    supportsVod: true,
    vodFormats: ['mp4'],
    supportsEventPush: true,
    supportsOnvifPullPoint: true,
    supportsPtz: true,
    supportedCodecs: ['h264'],
    eventTypes: ['motion', 'video_loss'],
  }

  // v2.x (2020-2021) 以降の追加
  if (fw.fwMajor >= 2) {
    base.supportsAiMetadata = true
    base.supportsMotionZone = true
    base.maxResolution = '4K'
    base.maxChannels = 32
    base.supportedCodecs = ['h264', 'h265']
    base.maxVodHours = 12
    base.maxConcurrentSessions = 8
    base.rateLimitMs = 250
    base.eventTypes.push('tampering')
  } else {
    base.maxVodHours = 6
    base.maxResolution = '1080p'
    base.maxChannels = 16
    base.maxConcurrentSessions = 4
    base.rateLimitMs = 500
  }

  // v3.x (2022-2023) 以降の追加
  if (fw.fwMajor >= 3) {
    base.supportsActiveGuard = true
    base.supportsTimelineSnapshot = true
    base.maxVodHours = 24
    base.maxConcurrentSessions = 16
    base.rateLimitMs = 200
    base.eventTypes.push('ai_person', 'ai_vehicle')
  }

  // v4.x (2024+) 以降の追加
  if (fw.fwMajor >= 4) {
    base.supportsAiOnIpro = true
    base.rateLimitMs = 100
  }

  // WJ-NU は WJ-NX より同時セッション数が少なめ (実機検証で要確定)
  if (fw.modelFamily === 'nu') {
    base.maxConcurrentSessions = Math.min(base.maxConcurrentSessions, 4)
    base.maxChannels = 8         // NU101K=4ch / NU201K=8ch
  }

  return base
}
```

## 6. ユニットテストの形

```ts
// adapters/i-pro/_common/capability-matrix.test.ts
import { deriveCapabilities } from './capability-matrix'

describe('deriveCapabilities (i-PRO)', () => {
  test('v1.x: 2018-2019 NX300', () => {
    const caps = deriveCapabilities({
      vendor: 'i-pro', modelFamily: 'nx', modelNumber: 'WJ-NX300K',
      fwVersion: '1.20-0001', fwMajor: 1, fwMinor: 20, fwPatch: 1,
      detectedAt: new Date(), source: 'cgi',
    })
    expect(caps.supportsAiMetadata).toBe(false)
    expect(caps.maxResolution).toBe('1080p')
    expect(caps.maxChannels).toBe(16)
  })

  test('v3.x: 2022+ NX300K', () => {
    const caps = deriveCapabilities({
      vendor: 'i-pro', modelFamily: 'nx', modelNumber: 'WJ-NX300K',
      fwVersion: '3.42-0001', fwMajor: 3, fwMinor: 42, fwPatch: 1,
      detectedAt: new Date(), source: 'cgi',
    })
    expect(caps.supportsActiveGuard).toBe(true)
    expect(caps.supportsTimelineSnapshot).toBe(true)
    expect(caps.maxResolution).toBe('4K')
  })

  test('未知の FW は CONSERVATIVE にフォールバック', () => {
    const caps = deriveCapabilities({
      vendor: 'i-pro', modelFamily: 'unknown', modelNumber: '?',
      fwVersion: '?', fwMajor: 0, fwMinor: 0, fwPatch: 0,
      detectedAt: new Date(), source: 'header',
    })
    expect(caps.supportsVod).toBe(false)
    expect(caps.maxResolution).toBe('720p')
  })
})
```

## 7. UI 側の利用パターン

UI は capability flag を見て **存在しないボタン/メニューを物理的に出さない**。

```tsx
// monitor/src/app/stores/[id]/page.tsx
const adapter = await getAdapterForStore(store.id)  // server-side helper
const caps = adapter.capabilities

return (
  <>
    <SnapshotButton storeId={store.id} />                                 {/* 全機 OK */}
    {caps.supportsVod && <VodExportButton maxHours={caps.maxVodHours} />}
    {caps.supportsTimelineSnapshot && <BcpTimelineButton />}
    {caps.supportsActiveGuard && <ActiveGuardPanel />}
    {caps.supportsAiOnIpro && <AiOnIproSettings />}
    {caps.supportsPtz && <PtzControls />}
  </>
)
```

## 8. 運用上の注意

### 8-1. FW Ver の変化検知

7 年間で店舗側 FW は更新される。adapter は **永続化された FW Ver と現在の FW Ver を比較**して、変化があったらインスタンスを再生成する:

```ts
// modes/central/tenant-loop.ts (擬似コード)
const cached = adapterCache.get(storeId)
const currentFw = await detectIProFirmware(store)

if (!cached || cached.fwVersion !== currentFw.fwVersion) {
  adapterCache.set(storeId, await createAdapter(store, currentFw))
  await db.updateStoreNvrInfo(storeId, currentFw)  // DB にも記録
  emitEvent('nvr.fw_changed', { storeId, from: cached?.fwVersion, to: currentFw.fwVersion })
}
```

### 8-2. FW Ver の DB 記録

`stores.nvr_fw_version` カラム (後の §EOL データモデルで設計) に最新検出値を記録。これにより:
- 「この FW Ver 使ってる店舗は何件?」のクエリが可能
- セキュリティパッチ FW を未適用な店舗を可視化

### 8-3. capability マトリックスのメンテナンス

新 FW が出るたびに `capability-matrix.ts` を更新する運用が必要。これを忘れると、**新 capability を持つ機械を「古い世代」として扱ってしまう** (機能が動くのに UI に出てこない問題)。

対策:
- リリースノート購読 (i-PRO公式) を運用 TODO に組込み
- 「最新 FW を持つ実機」を 1 台ラボに常設、月 1 回手動で機能差分チェック
- マトリックス更新 PR には実機検証ログを必須添付

## 9. 確定事項と未確定事項

### 確定済

- [x] FW Ver 検出方法 (CGI 優先、ONVIF / Header にフォールバック)
- [x] capability 型定義
- [x] 純関数 `deriveCapabilities(fw)` のシグネチャ
- [x] CONSERVATIVE_CAPABILITIES の存在 (未知 FW 用 fallback)

### Phase 0 で実機確定が必要

- [ ] 各 FW 世代の正確な capability 値 (上記マトリックスは暫定)
- [ ] `/cgi-bin/getsysteminfo` の正確なレスポンス形式
- [ ] WJ-NU と WJ-NX の差分の精密化
- [ ] WJ-GXE500 の capability の精密化
- [ ] レート制限 (rateLimitMs) の実機計測

## 10. 関連ドキュメント

- `nvr-adapter-design.md` — アダプタ構造全体
- `eol-eos-data-model.md` — FW Ver 含む NVR ライフサイクル管理
- `../monitor/src/lib/nvr-adapter/types.ts` — TypeScript 型定義
