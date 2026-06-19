# ONVIF アダプタ設計メモ（Phase B / 実機スパイク反映）

作成: 2026-06-19 / 前提: [spike-ipro-nu-result.md](spike-ipro-nu-result.md)（WJ-NU101K 実機で WJ-NX CGI 非互換が確定）
対象コード: `claude/edge-agent/src/adapters/`（registry / i-pro / onvif / _base）

## 0. 背景（なぜ作り直すか）

現行 i-PRO アダプタ（`i-pro/_common/i-pro-base-adapter.ts`）は **WJ-NX の独立 CGI** 前提：
- `getSnapshot` → `/cgi-bin/snapshot.cgi`
- `getLiveRtspUri` → `rtsp://…/MediaInput/h264/chNN_main`
- `getVodMp4` → `/cgi-bin/playback`（実体は NX-v1/v2 で実装、NU は継承）

実機 WJ-NU101K では **これらが全て 404**（CGI 非互換）。一方 **カメラは ONVIF/RTSP が生存**。
→ i-PRO 系の統合は **ONVIF を第一級**に据え、CGI は「対応機種でのみ使う任意経路」に格下げする。

## 1. トポロジ（確定方針）

```
            ┌─ Camera 101 (ONVIF Profile-S, RTSP)  ──┐
edge-agent ─┼─ Camera 102 (ONVIF Profile-S, RTSP)  ──┤─→ ライブ/スナップ（GAコア）
            └─ NVR NU101  (proprietary session API) ─→ VOD（GA後・口があれば）
```

- **ライブ/スナップ = カメラ直 ONVIF/RTSP**。NVR を経由しない（NVR は RTSP 554 閉・CGIスナップ無し）。
- **VOD = NVR**。ただし NVR は ONVIF サーバ非提供（`/onvif/device_service` 404）。標準外部口が無いため後述の別トラック。

## 2. 新規 ONVIF アダプタ（`adapters/onvif/`）

`NvrAdapter`（`@intereco/shared/nvr-adapter`）を ONVIF で実装する汎用アダプタを追加。vendor 文字列 `onvif`（必要なら `i-pro-onvif`）。

| NvrAdapter メソッド | ONVIF 実装 |
|---|---|
| `testConnection()` | Device `GetSystemDateAndTime`（無認証で生存確認） |
| `getChannelList()` | Media `GetProfiles`（各 Profile = チャンネル。token/解像度/コーデック取得） |
| `getLiveRtspUri(ch)` | Media `GetStreamUri`（StreamSetup: RTP-Unicast / RTSP）→ RTSP URI |
| `getSnapshot(ch)` | Media `GetSnapshotUri` → JPEG GET。非対応機は RTSP キーフレーム抽出にフォールバック |
| `getVodMp4(ch,from,to)` | **Replay(Profile-G) があれば** `GetRecordings`→`GetReplayUri`。無ければ `UnsupportedOperationError` |
| `capabilities` | `GetServices`/`GetCapabilities` から導出（`supportsVod = Replay 有無`、コーデック等） |

### 認証（重要な落とし穴）
- ONVIF は **WS-UsernameToken (PasswordDigest)**。`PasswordDigest = base64(sha1(nonce + created + password))`。
- **`Created` は機器時刻に合わせる**（端末との時刻差が大きいと NotAuthorized）。
  → 起動時に `GetSystemDateAndTime` で **clock skew を測り、以後の `Created` に補正**を入れる。
- 機種により **HTTP Digest** を併用するものもある。WS-Security で 401/Fault の場合は HTTP digest にフォールバック。
- （curl スパイクで GetProfiles が Fault → この skew/auth 切り分けを Linux 実機で確定する）

### HTTPS 自己署名
- i-PRO 機器は自己署名 HTTPS。`cgi-client.ts` / ONVIF クライアントに **自己署名許容の dispatcher**（undici `Agent({connect:{rejectUnauthorized:false}})`）を追加。`NODE_TLS_REJECT_UNAUTHORIZED` のグローバル無効化はしない（機器単位で限定）。

## 3. i-PRO レコーダ VOD（別トラック・GA後）

NU101 は ONVIF Replay 非提供のため、VOD は次のいずれか：
1. **NVR マニュアル確認** — 外部連携(ONVIF/独立CGI)が在れば有効化して Profile-G を使う
2. **i-PRO プロプライエタリ API** — `dlogin.cgi` でセッション確立 → i-PRO の CGI コマンド仕様書（要入手）で録画検索/取得
3. **NVR 純正 UI へ誘導** — monitor から再生UIへリンク（再実装しない・最小工数）

GA は approach B（VOD=ファストフォロー）なので **(3) を GA 既定**とし、(1)(2) は仕様入手後に評価。

## 4. 既存コードへの具体変更

- `adapters/_registry/registry.ts`: `onvif` ファクトリ追加（dynamic import）。
- `adapters/onvif/`: `onvif-media-adapter.ts`（本体）/ `onvif-soap.ts`（WS-Security・SOAP・clock skew）。既存 `onvif-pull-point.ts`（イベント）と同居。
- `adapters/i-pro/_common/cgi-client.ts`: 自己署名 HTTPS dispatcher を追加（i-PRO HTTPS 機全般で必要）。
- `adapters/i-pro/_common/capability-matrix.ts`: NU101 実測（ONVIFサーバOFF・CGI非WJ-NX）を反映。`i-pro-nu` の `getVodMp4` は当面 `UnsupportedOperationError` のまま。
- monitor 側:
  - `admin/stores/[id]/nvr/actions.ts` の vendor enum に `onvif` 追加。
  - **グリッドスナップを Frigate 専用から脱却**し ONVIF スナップに対応（失敗時プレースホルダ+再試行 UX = release-plan の新規ギャップ対策）。
  - `live_host`/recorder 設定にカメラ ONVIF エンドポイントを持てるようにする。

## 5. テスト計画

1. **Linux 実機ディスカバリ**（192.168.0.100）: `spike:ipro-discover` で RTSP URI・コーデック・ONVIF認証方式・VOD口の有無を確定。
2. **ユニット**: ONVIF SOAP のリクエスト生成/レスポンス解析（GetProfiles/GetStreamUri/GetSnapshotUri）をモックXMLで。WS-Security digest と clock skew 補正を検証。
3. **実機 UAT**: カメラ 101/102 で live(RTSP)/snapshot 成立、monitor グリッド表示、リモート（named tunnel + Access）まで。
4. CI ゲート（typecheck/lint/build/test）緑必須。

## 6. 未決事項（Linux 実機で詰める）

- ONVIF 認証: WS-UsernameToken の clock skew 補正で通るか／HTTP digest 併用要否。
- カメラの正確な RTSP URI / コーデック（h264/h265）と sub-stream 有無。
- NVR の外部 VOD 口の最終有無（マニュアル確認 + i-PRO 問い合わせ）。
- スナップ取得: ONVIF `GetSnapshotUri` 対応か、RTSP キーフレーム抽出が要るか。
