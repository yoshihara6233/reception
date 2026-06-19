# i-PRO WJ-NU101 実機スパイク結果（VODスパイク / G1 判定点）

実施: 2026-06-19 / 対象: i-PRO WJ-NU101K（4ch小型NVR, 192.168.0.250）+ カメラ2台（192.168.0.101 / .102）
位置づけ: [release-plan-v1-ga.md](release-plan-v1-ga.md) の **Phase A「i-PRO VODスパイク」= G1 の go/no-go 判定点**。
検証資材: `claude/edge-agent/src/spikes/ipro-nu-spike.ts`（アダプタ直叩き）/ `ipro-nu-discover.ts`（ONVIF/CGI並行ディスカバリ）

> 一行結論: **現アダプタの WJ-NX CGI 前提はこの実機では成立しない。統合は ONVIF 寄せに再設計する。
> ライブ/スナップ＝カメラ直 ONVIF/RTSP で成立。VOD は NVR の標準外部口が無く、i-PRO API か NVR純正UIへ（GA後ファストフォローのまま）。**

## 0.5 Linux 実機で確定（2026-06-19・192.168.0.100 で `spike:ipro-discover` 相当を実行）

| 項目 | 確定結果 |
|---|---|
| **カメラ101 ライブ** | ✅ ONVIF GetStreamUri → **RTSP DESCRIBE 200・コーデック H.265(HEVC)**。URI `rtsp://192.168.0.101/ONVIF/MediaInput?profile=def_profile1` |
| **カメラ102 ライブ** | ✅ **RTSP 200・コーデック H.264**。URI `rtsp://192.168.0.102/ONVIF/MediaInput?profile=2_def_profile6`（102用の別資格情報で確定） |
| **i-PRO RTSP URI 形式** | `rtsp://<ip>/ONVIF/MediaInput?profile=<profileToken>`（ONVIF Media GetStreamUri から取得・token はカメラごとに異なる） |
| **コーデック混在** | 101=H.265 / 102=H.264 → ライブ経路は両対応必須 |
| **カメラ別 credentials** | 101 と 102 で user/pass が別（実証）→ カメラ単位で creds 保持する設計 |
| **NVR ONVIF** | ❌ `/onvif/device_service` 404 ＝ **Profile-G(VOD) 非提供を確定**（Mac/Linux 一致） |
| NVR CGI | dlogin.cgi 200・他全404（WJ-NX CGI 非互換を再確認） |

**設計に効く新事実:**
- **コーデックが H.265**。ブラウザの H.265 対応は限定的 → **リモートのブラウザ視聴は (a) エッジで H.264 トランスコード or (b) サブストリームを H.264 設定** が要る。`onvif-adapter-design.md` の live 経路に反映。
- カメラ102 の認証は別資格情報の可能性。マルチカメラでは **カメラごとに credentials を持てる**設計にする。

## 1. 実測サマリ（証拠）

| 対象 | 観点 | 実機の結果 | アダプタの前提 | 判定 |
|---|---|---|---|---|
| NVR 250 | プロトコル | **HTTPSのみ**（443開・80閉・自己署名） | http前提・TLS無検証設定なし | ⚠️ 改修要 |
| NVR 250 | 認証 | **Digest 200**（`/cgi-bin/dlogin.cgi`, realm `Network disk recorder`） | digest対応済み | 🟢 一致 |
| NVR 250 | CGI(getsysteminfo/snapshot/playback ほか14本) | **全 404** | これらのパス前提 | ❌ **非互換** |
| NVR 250 | ONVIF `/onvif/device_service` | **404**（サーバOFF/非搭載） | — | ❌ Profile-G不可 |
| NVR 250 | RTSP 554 | **閉** | 554前提 | ❌ NVR直RTSP不可 |
| Cam 101/102 | ONVIF `GetSystemDateAndTime` | **両機 ALIVE** | — | 🟢 ライブ本命 |
| Cam 101/102 | RTSP 554 | **開放**（raw OPTIONS で 401＝生存） | 554前提 | 🟢 |

補足:
- NVR は **セッションログイン型 Web**（dlogin.cgi）。WJ-NX 系の独立 CGI コマンド群は応答せず（全 404）。
- ONVIF GetProfiles（カメラ・WS-UsernameToken）は curl 試行で SOAP Fault（auth/clock skew いずれか要切り分け）。正確な RTSP URI 取得は Linux 側で再実行する（下記 §4）。

## 2. GA 判定への影響

- **GAコア（本部集中ライブ監視 + BCP）は成立可能**: カメラ直 ONVIF/RTSP が生存。10月GAの主役は守れる。
- **VOD（録画再生）は NVR の標準外部口が無い**: ONVIF Profile-G 非提供。選択肢は
  1. NVRマニュアルに外部連携(ONVIF/独立CGI)があれば有効化（無ければ非対応確定）
  2. i-PRO プロプライエタリ API/SDK（dlogin.cgi セッション + i-PRO CGIコマンド仕様書が必要）
  3. **VODは NVR 純正UIへ誘導**（再実装しない）
- VOD は CEO決定（approach B）で **GA後ファストフォロー**のため、**本スパイク結果は GA 日程をブロックしない**。VOD を「いつ・どう」足すかの判断材料が確定した、が成果。

## 3. 開発環境の制約（重要・本番Linuxには無い）

- この開発 Mac（macOS, Darwin 25）では **Node から LAN 機器に到達不可（EHOSTUNREACH）**。WAN は到達可。
- 原因: macOS ローカルネットワーク・プライバシーは**実行バイナリ単位**でも評価。Apple署名の curl/nc/ping は免除されるが、**adhoc署名の node（Homebrew, TeamIdentifier なし）は個別に拒否**される。責任アプリは Claude.app。adhoc node は UI から恒久付与しても安定しない。
- 帰結: **edge-agent(Node) の実機検証は同一LAN上の Linux で行う**のが正攻法（本番ランタイムと一致）。Mac では curl による ONVIF/HTTPS 確認まで。

## 4. 次アクション（Linux 実機検証）

実行ホスト: **Linux サーバ 192.168.0.100**（NU101/カメラと同一LAN）。
手順:
```bash
# 192.168.0.100 上で
cd <repo>/claude/edge-agent
cat > .env <<EOF
NVR_ENDPOINT=https://192.168.0.250
NVR_USER=...  NVR_PASS=...
CAM_IPS=192.168.0.101,192.168.0.102
CAM_USER=...  CAM_PASS=...
EOF
bun install
bun run spike:ipro-discover     # ONVIF GetStreamUri→RTSP URI, Profile-G可否を自動判定
```
ここで確定させる残件:
- カメラの**正確な RTSP URI とコーデック**（ONVIF GetStreamUri）
- ONVIF 認証方式（WS-UsernameToken の clock skew 対応要否）
- NVR に**外部 VOD 口が本当に無いか**の最終確認

## 5. 設計への反映

→ [onvif-adapter-design.md](onvif-adapter-design.md) に、WJ-NX CGI 前提を ONVIF へ置換する Phase B 設計を記載。
