# i-PRO CGI 実装メモ（NVR + カメラ）

原典（PDF・大容量のため git 管理外＝`docs/vendor/*.pdf` は .gitignore）:
- `i-PRO NVR CGI-IF(NXNU)V15R1jp.pdf` — i-PRO NVR CGI コマンドI/F v1.5R1（WJ-NX/NU 系。**NU101 含む**）
- `cgimnliprov116.pdf` — i-PRO ネットワークカメラ 外部I/F v1.16

実機(2026-06-19): NU101 NVR `192.168.0.250`(HTTPS/自己署名・ADMIN/Admin123) /
カメラ `192.168.0.101`(admin/Admin123・H.265) `192.168.0.102`(admin/12345・H.264)。

---

## 1. NVR CGI（WJ-NU101）

### セッション（§6.1/6.2）
```
ログイン : GET /cgi-bin/dlogin.cgi?UID=-1        (HTTPS + Digest認証)
           → HTML 200。本文中の  hdrctl.cgi?UID=<n>  から UID を抽出
キープ   : GET /cgi-bin/status.cgi?UID=<uid>&PC=AS60   (<90秒ごと)
ログアウト: GET /cgi-bin/logout.cgi?UID=<uid>
```
制約: UID寿命 **90秒**（キープで延長）・**同時最大16**・**同一カメラを2本不可**（別UID要）・
ライブと再生は同一UIDで同時不可・コマンド間隔は **≥3秒**目安。

### ① ライブ JPEG（§2.2 / 2.3.5）= NVR から JPEG（config② 用）
```
GET /cgi-bin/hdrctl.cgi?UID=<uid>&SCREEN=16X&PC=AS60
GET /cgi-bin/push.cgi?UID=<uid>&CAM=<n>&CMD=START&COMP=JPEG&INTERNETMODE=ON
   → multipart(image/jpeg) ストリーム。各フレームは有効なJPEG
     (NVR/カメラ情報が 0xFFFE COM セグメントとして埋め込み＝標準デコーダで読める)
GET /cgi-bin/push.cgi?UID=<uid>&CAM=<n>&CMD=STOP&COMP=JPEG
```
COMP は H264/H265/JPEG/AUDIO。grid 静止画用途なら開いて1フレーム取って閉じる運用。

### ② VOD = MP4 ダウンロード（§6.3）= 録画再生（ONVIF Profile-G 不要）
```
GET /cgi-bin/httpdl.cgi?UID=<uid>&STARTTIME=yymmddhhmmss&ENDTIME=yymmddhhmmss
    &KIND=MP4&CAM=<n>&PC=AS60
```
- KIND: **MP4**(音声あり) / MP4VO(音声なし) / N3,N3VO(i-PRO独自・要専用ビューア) / LIST(リスト)
- STARTTIME/ENDTIME: `yymmddhhmmss`（yy=22→2022…、ss=**00固定**）。**ENDTIME−STARTTIME ≤ 1時間**。
- 応答は **HTTP multipart**。各パートのヘッダに:
  - `X-Temp-FileName`（ダウンロード中の仮名）/ `X-Prev-Filename`（完了ファイル名）
  - `X-RecData-Satus`(原文ママ): **0=正常 / 1=指定時間帯に録画なし / 2=コーデック非対応(MP4はJPEG不可) / 3=同時処理超過**
  - ファイル分割あり（サイズ大 or 録画内容変化）→ 複数パートを順に保存。
- 録画が H.264/H.265 なら MP4 で取得可（実機カメラは該当）。JPEG録画はMP4不可(status=2)。

> ✅ **2026-06-19 実機検証で取得成功**（NU101・CAM=1 H.265・5分で約50MB・`X-RecData-Satus:0`・`ftypmp42`）。
> ⚠️ **最重要の落とし穴：STARTTIME/ENDTIME は UTC で送る**（JST−9h）。
>    `recordedtime.cgi` の録画期間表示は **ローカル(JST)** なのに、`httpdl.cgi` の入力は **UTC** という混在仕様。
>    JST のつもりで送ると +9h ずれて「録画なし(Satus:1)」になる（応答ファイル名 `001_<UTC入力をローカル変換した時刻>_...` で気づける）。
>    実装では `STARTTIME = (要求JST時刻 − 9h) を yymmddhhmmss(UTC)` に変換。
> - 応答は `multipart/form-data; boundary=--myboundary`。各パート: `Content-Type: application/octet-stream` +
>   `X-Temp-FileName`(進行中) / `X-Prev-Filename`(完了mp4名) / `X-RecData-Satus`。**boundary とパートヘッダを剥がして
>   octet-stream 本体を連結すると再生可能な MP4**（先頭に `ftypmp42`）。サイズ大/録画変化でファイル分割あり（複数パート連結）。
> - 録画期間の確認は `recordedtime.cgi`(UID不要・ローカル時刻)、カメラCH確認は `as_getinfo.cgi?FILE=2`(`CAM_CONNECT_xxCH=1`)。

### ③ 再生ストリーミング（§3・スクラブ再生）
`再生映像要求`＋`レコーダー制御(再生開始/逆再生/コマ送り/日時指定/高速/停止)`を UID 上で。
データは H.264/H.265/JPEG。日時指定再生 §3.2.8。MP4一括DL(②)より複雑なので、
「クリップDLして再生」は②、「タイムライン擦り」は③。

### その他
PTZ §4、HDD容量 §5.2、**カメラ接続情報 §5.3**（NVR配下カメラ列挙）、障害/イベントログ §5.1。

---

## 2. カメラ CGI（ネットワークカメラ）

### JPEG（§2.1）
- **HTTPスナップショット(CGI)**＝単発JPEG。実機で確認した `/cgi-bin/camera?resolution=1280`
  はこれ（現行は ONVIF GetSnapshotUri 経由で取得。直接叩く形も可）。
- **HTTP MJPEG(CGI)**＝multipart JPEG ストリーム。

### ライブ H.264/H.265（§2.2・RTP制御）
```
GET /cgi-bin/getuid?FILE=2&vcodec=h265[&ch=<n>]      → UID + 設定値
GET /cgi-bin/h265?connect=start&protocol=rtp&UID=<uid>&my_port=<port>
GET /cgi-bin/keep_alive?mode=h265&protocol=rtp&UID=<uid>   (30秒推奨・120秒で停止)
GET /cgi-bin/h265?connect=stop&protocol=rtp&UID=<uid>&my_port=<port>
```
vcodec: jpeg/jpeg_2/3, h264/_2/_3/_4, h265/_2/_3/_4。ch=1..4（マルチセンサ/全方位）。
カメラ種別判定: `get_capability`(§9.2)・`video_server.basic.type`(dome/fixed/fixed_dome)・
`fisheye=yes`(全方位)・`image.sensor.number≥2`(マルチセンサ)。

### ⚠️ セキュリティ強化の落とし穴（§1.3）— カメラCGI直叩き時
ブラウザ風に **Accept ヘッダ**を付けて送ると **400 Bad Request** になる機種がある。回避:
1. **Accept ヘッダを付けない**、または
2. `GET /cgi-bin/get_randomnum` → `randomnum=...` を取得 → CGI末尾に **`&Randomnum=<値>`** を付与
   （randomnum は定期変更。毎回取り直す）

---

## 3. 我々の実装方針への対応

| 取得物 | 経路 | 状態 |
|---|---|---|
| カメラ直 ライブJPEG | カメラ HTTPスナップCGI（現行 ONVIF 経由） | ✅ 稼働中 |
| NVR ライブJPEG（config②） | NVR `push.cgi COMP=JPEG` | 未実装 |
| **NVR VOD(MP4)** | NVR `httpdl.cgi KIND=MP4`（≤1h） | **次タスク（A）** |

共通の注意: HTTPS自己署名（TLS無検証 dispatcher 要）・Digest認証・UID/keepalive 管理・
コマンド間隔≥3秒・同一カメラ同時2本不可。
