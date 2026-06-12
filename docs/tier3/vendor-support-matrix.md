# ベンダー対応マトリックス (F52.E / F55)

> Tier 3 中央集約モードで対応している NVR ベンダー一覧と機能比較表。
> 新規ベンダー追加時の参考にもなる。
>
> **2026-06-04 更新 (Phase 7 完了)**:
> Synology / Axis / Dahua を「未実装」から「対応済」に昇格。
> 計 **10 ベンダー** をサポート。

## サポート状況サマリ

| ベンダー | 識別子 | Phase | 対応状況 | 主要機種 |
|---|---|---|---|---|
| **i-PRO WJ-NX シリーズ** | `i-pro-nx` | Phase 0/1 | ✅ フル対応 | WJ-NX200K/300K/400K/510K |
| **i-PRO WJ-NU シリーズ** | `i-pro-nu` | Phase 0/1 | ✅ フル対応 | WJ-NU101K/201K/301K |
| **i-PRO WJ-GXE500** | `i-pro-gxe500` | Phase 5 | ✅ 対応 (録画なし) | WJ-GXE500 |
| **Hikvision** | `hikvision` | Phase 5 / **Phase 7** | ✅ VOD+Event Push 含む | DS-7616NI-K2/16P, DS-7616NXI |
| **Hanwha Wisenet** | `hanwha-wisenet` | Phase 5/6 | ✅ VOD MP4 対応 | PRN-1610S2, XRN シリーズ |
| **ONVIF 汎用** | `onvif-generic` | Phase 5/6 | ✅ PullPoint Event 含む | ONVIF Profile S/T 対応機 |
| **Synology Surveillance Station** | `synology-surveillance` | Phase 6 / **Phase 7** | ✅ VOD MP4 対応 | DS923+/DS1522+/RS1221+ 等 |
| **Axis VAPIX** | `axis-vapix` | **Phase 7** | ✅ 単体カメラ + M30/M70 統合機 | Q3/P3/M3/M70 全シリーズ |
| **Dahua DH-NVR / IPC** | `dahua` | **Phase 7** | ✅ AcuPick AI 含む | DH-NVR4216-4KS2, DH-IPC シリーズ |
| **Frigate (OSS-VMS)** | `frigate` | Phase 0 | ✅ Mini PC モード互換 | 各種 IP カメラ |
| **Uniview** | — | Phase 8 | 🔴 必須 (未実装) | NVR301/501 シリーズ |

## 機能対応比較表

凡例: ✅ 実装済 / ⏸ 設計済 (未実装) / ❌ 仕様上非対応 / — 非該当

### コア機能

| 機能 | i-PRO NX | i-PRO NU | GXE500 | Hikvision | Hanwha | ONVIF | Synology | **Axis** | **Dahua** | Frigate |
|---|---|---|---|---|---|---|---|---|---|---|
| **接続テスト** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **FW Ver 検出** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| **スナップショット** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **ライブ RTSP** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **JPEG ポーリング (live)** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

### 録画・VOD

| 機能 | i-PRO NX | i-PRO NU | GXE500 | Hikvision | Hanwha | ONVIF | Synology | **Axis** | **Dahua** | Frigate |
|---|---|---|---|---|---|---|---|---|---|---|
| **VOD MP4 エクスポート** | ✅ | ✅ | ❌ | ✅ (Phase 7 ffmpeg) | ✅ | ❌ | ✅ (Phase 7) | ⏸ | ⏸ | ✅ |
| **タイムラインスナップショット (BCP)** | ✅ (v3+) | ✅ (v3+) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |

#### F106: BCP 8 枚タイムライン 実装状況 (i-PRO / Uniview)

| ベンダー | ① 最新スナップショット | ② 過去フレーム (T-5) | ③ テスト |
|---|---|---|---|
| **i-PRO (CGI Digest)** | ✅ `/cgi-bin/snapshot.cgi?ch=N` | ✅ `&time=<unix_ts>` (FW v3+) / v1/v2 は latest にフォールバック | ✅ `bcp-fetchers/__tests__/ipro.test.ts` |
| **Uniview (LAPI Digest)** | ✅ `/LAPI/V1.0/Channels/<N>/Media/Video/Snapshot` | ⚠️ LAPI に時刻指定エンドポイント無し → latest にフォールバック (ONVIF Profile-G 実装は別タスク) | ✅ `bcp-fetchers/__tests__/uniview.test.ts` |
| **Frigate** | ✅ `/api/<cam>/latest.jpg` | ✅ `/api/<cam>/start/<ts>/end/<ts+1>/clip.mp4` + ffmpeg | ✅ 既存 |

実装: `claude/edge-agent/src/bcp-fetchers/` (i-PRO + Uniview の dispatcher) +
`claude/edge-agent/src/util/digest-auth.ts` (Digest auth ヘルパ, MD5)。
`bcp_clips.source` カラムで `ipro-historical` / `ipro-latest` / `uniview-latest` / `frigate-recording` / `latest` を区別。

### イベント・AI

| 機能 | i-PRO NX | i-PRO NU | GXE500 | Hikvision | Hanwha | ONVIF | Synology | **Axis** | **Dahua** | Frigate |
|---|---|---|---|---|---|---|---|---|---|---|
| **イベント push** | ✅ (v2+) | ✅ (v2+) | ❌ | ✅ (Phase 7 Alert Stream) | ✅ (Phase 6) | ✅ (PullPoint) | ⏸ | ⏸ | ✅ | ❌ |
| **モーションゾーン取得** | ✅ (v2+) | ✅ (v2+) | ❌ | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ |
| **AI 検知メタデータ** | ✅ (v2+) | ✅ (v2+) | ❌ | ✅ (AcuSense) | ✅ (Wisenet AI) | ❌ | ⏸ | ✅ (Object Analytics) | ✅ (AcuPick) | — |
| **PTZ 制御** | ✅ | ✅ | ❌ | 設計のみ | 設計のみ | 設計のみ | ⏸ | ✅ | ✅ | — |

## 認証方式

| ベンダー | 認証 | プロトコル |
|---|---|---|
| i-PRO 全機種 | Digest (RFC 7616) | CGI + ONVIF |
| Hikvision | Digest (RFC 7616) + Basic (Alert Stream) | ISAPI (HTTP) |
| Hanwha Wisenet | Digest (RFC 7616) | SUNAPI (HTTP) |
| ONVIF 汎用 | WS-Security UsernameToken Digest | SOAP over HTTP |
| Synology Surveillance | SID + login API | DSM Web API |
| **Axis VAPIX** | Digest (RFC 7616) | VAPIX HTTP |
| **Dahua** | Digest (RFC 7616) | CGI + ONVIF |
| Frigate | なし or Basic | go2rtc HTTP |

## RTSP URL パターン (チートシート)

| ベンダー | URL |
|---|---|
| i-PRO NX / NU / GXE500 | `rtsp://user:pass@host:554/MediaInput/h264/ch<NN>_<main\|sub>` |
| Hikvision | `rtsp://user:pass@host:554/Streaming/Channels/<NN><01\|02>` |
| Hanwha (NVR) | `rtsp://user:pass@host:554/profile<N>/media.smp` (sub = N+100) |
| ONVIF 汎用 | `GetStreamUri` で動的取得 |
| Synology Surveillance | DSM の `GetLiveViewPath` API で取得 |
| **Axis VAPIX** | `rtsp://user:pass@host:554/axis-media/media.amp?camera=N&videocodec=h264` |
| **Dahua** | `rtsp://user:pass@host:554/cam/realmonitor?channel=N&subtype=0\|1` |
| Frigate | `rtsp://host:8554/<camera_name>[_sub]` |

## VOD playback パイプライン (Phase 7)

ベンダーによって VOD playback URL の形式が異なる。
本プロジェクトは `claude/edge-agent/src/util/playback-pipeline.ts` で **RTSP → MP4 変換** を共通化。

| ベンダー | playback URL 形式 | 必要処理 |
|---|---|---|
| i-PRO NX/NU | mp4 直接 download | そのまま stream |
| Hikvision | HTTP の場合あり / RTSP の場合あり | RTSP の場合 ffmpeg pipeline |
| Hanwha | mp4 stream over HTTP | そのまま stream |
| Synology | HTTP mp4 (SID 認証付) | そのまま stream |
| Dahua | mediaFileFind → loadfile (Phase 8 で本実装) | Phase 8 完了後 ffmpeg pipeline |

## ベンダー選定ガイド

### 国内市場 (推奨優先順位)

1. **i-PRO 系** (WJ-NX/NU) — 国内シェア最大、API ドキュメント充実
2. **Hikvision** — 国際標準、価格競争力、AcuSense AI 機能
3. **Hanwha Wisenet** — 旧サムスン由来、SUNAPI 安定
4. **Axis** — 高品質単体カメラ、Object Analytics
5. **Dahua** — コスト重視、ハイブリッド (アナログ+IP) 対応
6. **Uniview** 🔴 — コストパフォーマンス、国内代理店多数 (Phase 8 実装必須)
7. **Synology** — NAS ベース小規模拠点向け
8. **ONVIF 汎用** — 上記以外の機種を最低限カバー

### 機能で選ぶ

| 必要な機能 | 推奨ベンダー |
|---|---|
| BCP 8 枚タイムライン | i-PRO v3+ |
| 録画ローカル保存 + クラウド連携 | i-PRO NX (16/32ch) |
| AI 検知 (人/車) | Hikvision AcuSense / Dahua AcuPick / Axis Object Analytics / Hanwha AI |
| アナログカメラ既存活用 | i-PRO GXE500 / Dahua XVR (ハイブリッド) |
| 大規模 (100+ カメラ/拠点) | i-PRO NX510K / Hikvision DS-86 |
| 小規模 (4〜8 カメラ) | i-PRO NU101K/201K / Hikvision DS-72 / Synology DS923+ |
| NAS 統合 (小規模拠点) | Synology Surveillance Station |
| 単体 IP カメラのみ | Axis P3/M3 / Dahua IPC-HFW |

## 新規ベンダー追加手順

1. **`adapters/<vendor>/<vendor>-adapter.ts` を新規作成**
   - `NvrAdapter` インターフェイス実装
   - 既存 i-PRO/Hikvision/Hanwha/Axis/Dahua を参考に

2. **クライアントクラス分離** (`<vendor>-client.ts`)
   - 認証、retry、レート制限を内蔵
   - Digest auth は Hikvision の `IsapiClient` または Axis の `VapixClient` を参考に流用可

3. **`adapters/_registry/registry.ts` に登録**
   ```ts
   '<vendor>': async (cfg) => {
     const mod = await import('../<vendor>/<vendor>-adapter')
     return mod.create<Vendor>Adapter(cfg)
   },
   ```

4. **`NvrVendor` 型に追加** (`packages/shared/src/nvr-adapter/types.ts`)

5. **テスト追加** (`<vendor>-adapter.test.ts`)
   - 最低限: `testConnection`, `getSnapshot`, `getLiveRtspUri`
   - fetch を `vi.spyOn` で mock

6. **UI に追加** (`claude/monitor/src/components/nvr/NvrConnectionForm.tsx` の `VENDOR_OPTIONS`)

7. **`nvr_models` に主要機種を投入** (新規マイグレーション)

8. **本ファイル (vendor-support-matrix.md) を更新**

詳細手順: `nvr-adapter-design.md` の §7「拡張ポイントの明確化」参照。

## 認証情報の設定例

各ベンダーで `nvr_options` に格納する典型例:

```json
// i-PRO
{ "rtsp_port": 554 }

// Hikvision
{ "rtsp_port": 554 }

// Hanwha
{ "rtsp_port": 554 }

// ONVIF 汎用
{ }  // すべて GetStreamUri で動的取得

// Synology
{ "https_port": 5001 }  // DSM Web API 用

// Axis VAPIX (Phase 7)
{ "rtsp_port": 554 }

// Dahua (Phase 7)
{ "rtsp_port": 554 }

// Frigate
{ "cameraMap": { "1": "entrance", "2": "backroom" }, "apiPort": 5000, "rtspPort": 8554 }
```

## 関連ドキュメント

- `nvr-adapter-design.md` — adapter 層の設計詳細
- `firmware-capability-matrix.md` — i-PRO FW 世代別 capability
- `eol-eos-data-model.md` — ライフサイクル管理
- `customer-nvr-survey.md` — 顧客向け機種調査
