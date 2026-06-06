# edge-agent

現地小型サーバで稼働する Node.js エージェント。
RTSP（i-PRO / Uniview）→ 16分割 JPEG / LiveKit WebRTC ライブ・VOD のブリッジ役。

## 動作モード

```
Idle ──start_grid──▶ Grid  (16ch RTSP → ffmpeg xstack → Storage)
     ──start_live──▶ Live  (1ch RTSP → ffmpeg WHIP → LiveKit)
     ──start_vod ──▶ VOD   (Uniview replay or i-PRO ONVIF → WHIP → LiveKit)
```

平常時は **Idle**（ハートビートのみ）。クラウド側からのコマンドで遷移する。

## ディレクトリ

| パス | 内容 |
|---|---|
| `src/index.ts` | エントリポイント、シャットダウンハンドリング |
| `src/state-machine.ts` | Idle/Grid/Live/VOD の状態機械 |
| `src/realtime.ts` | Supabase Realtime broadcast でコマンド受信 |
| `src/cameras.ts` | このエッジが担当するカメラ一覧を Supabase から取得 |
| `src/rtsp/url.ts` | i-PRO / Uniview の RTSP URL 組立（live + VOD） |
| `src/modes/grid.ts` | ffmpeg xstack で 16分割 JPEG 生成 |
| `src/modes/live.ts` | ffmpeg WHIP で単一 ch を LiveKit に publish |
| `src/modes/vod.ts` | Uniview replay RTSP を WHIP publish（i-PRO は Phase 8） |
| `src/upload/storage.ts` | Supabase Storage 上書きアップロード＋heartbeat |
| `systemd/edge-agent.service` | 本番常駐ユニット |

## 開発

```bash
cp .env.example .env
# .env を編集
npm install
npm run dev          # tsx でホットリロード
```

## 本番デプロイ（mini PC, Ubuntu 24.04）

```bash
# 1. ffmpeg, node を導入
apt-get update && apt-get install -y ffmpeg curl
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs

# 2. アプリ配置
sudo useradd -r -s /usr/sbin/nologin edge
sudo mkdir -p /opt/edge-agent /etc/edge-agent /var/tmp/edge-agent /var/log/edge-agent
sudo chown -R edge:edge /opt/edge-agent /var/tmp/edge-agent /var/log/edge-agent

# /opt/edge-agent に dist/ 配置、/etc/edge-agent/agent.env を作成
sudo cp systemd/edge-agent.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now edge-agent
```

## RTSP URL の挙動

| ベンダ | ライブ | 録画再生 |
|---|---|---|
| i-PRO（カメラ直結）| `rtsp://u:p@cam/MediaInput/h264/stream_1` | ONVIF Profile-G（Phase 8） |
| Uniview（NVR） | `rtsp://u:p@nvr/unicast/c{N}/s0/live` | `rtsp://u:p@nvr/c{N}/b{from}/e{to}/replay` |

## 未実装（次フェーズ）

- ONVIF Profile-G クライアント（i-PRO NVR の録画再生）
- カナリア OTA 配布
- ログ転送（journald → Better Stack）
- Vault 連携（password_enc の本物の復号）
