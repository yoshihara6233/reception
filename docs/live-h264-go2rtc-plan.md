# シングル高画質ライブ：H.264変換 + LL-HLS + 既存トンネル/CDN（go2rtc）方針

2026-06-20 決定。i-PRO H.265カメラ(例: 192.168.0.101 WV-U1132A)の**シングルカメラ高画質ライブ**を、
全ブラウザで・遠隔から・多店舗スケールで見られるようにするための方針。

## 背景（なぜこの方式か）
- **問題1: ブラウザ互換**。H.265(HEVC)は Chrome/Firefox で再生が不安定（Safariのみ安定）。
  → エッジで **H.265→H.264 変換**すれば全ブラウザで再生可。変換自体の遅延は HWエンコードで +100〜300ms と小さい。
- **問題2: 遠隔越え＆スケール**（本当の難所）。変換しても NAT/FW越えとスケールは別問題。
  配信プロトコルの選択がすべて：
  | 方式 | 遅延 | 既存Cloudflare Tunnel | スケール |
  |---|---|---|---|
  | MJPEG(現状) | 低 | ◎ HTTP | △ 帯域重い(5〜15Mbps) |
  | **LL-HLS** | 1〜3s | ◎ HTTP(S)・CDN相性◎ | ◎ |
  | WebRTC | 0.2〜0.5s | ✕ UDP不可(TURN/SFU要) | SFU次第 |
  - 現トンネルは HTTP/TCP → **HLSは通るがWebRTCは通らない**。
- **結論**: `H.264変換 → LL-HLS → 既存トンネル/CDN` が、互換・帯域・遠隔・スケールを一度に満たす最有力。
  代償は遅延1〜3秒（防犯確認用途では許容）。サブ秒が要件になったら WebRTC=SFU(LiveKit Cloud)へ。

## 実装方針：go2rtc を使う（ffmpeg手組みしない）
- すでにスタックに **Frigate同梱の go2rtc**（`GO2RTC_BIN` 設定済 `/usr/local/bin/go2rtc`）。
- go2rtc が「**H.265取り込み → H.264オンザフライ変換 → WebRTC/MSE/LL-HLS配信**」を1つでこなす。
- ストリーム定義に i-PRO カメラ(RTSP)を登録し、出力で H.264 トランスコード＋LL-HLSを有効化。
- **on-demand**（視聴者がいる時だけ起動）にしてエッジ負荷/電力をほぼゼロに。同時視聴は店舗数の数%と低い。
- N100/N150 の **QuickSync(QSV/VAAPI)** で HWデコード(HEVC)＋HWエンコード(H.264)。複数本でもCPUほぼ不使用。

## 配信経路（既存資産の再利用）
- LL-HLSはHTTP(S) → **既存の named tunnel `poc-beelink.genesis-edge.com`** にgo2rtcのHLSエンドポイントを通せる。
- monitor 側は `<video>` + hls.js（LL-HLS）で再生。Cloudflare Access cookie の既存仕組みを流用。
- 多店舗時は CDN 前段でスケール（HLSセグメントはキャッシュ可）。

## 録画再生(VOD)との棲み分け
- **VOD（録画再生）= MP4ダウンロード変換**（実装済 2026-06-20）。`httpdl.cgi`→必要時 H.265→H.264 変換→Storage→`<video>`。
  NU101 は Profile-G/replay RTSP 非提供のため、録画の「ストリーム再生」は不可＝MP4方式が本命。
- **ライブ = 本ドキュメントの go2rtc/LL-HLS**。
- 将来 Uniview 等 replay RTSP 対応機・VOD長尺では、録画も go2rtc/HLSストリームで配信する選択肢あり。

## 次の作業（未着手）
1. go2rtc のストリーム定義テンプレート（i-PRO RTSP入力 + H.264/LL-HLS出力 + QSV）を作る。
2. on-demand 起動/停止の制御（live モード開始時に go2rtc ストリームを有効化）。
3. monitor 側 LL-HLS プレーヤ（hls.js）と既存高画質ライブUIの統合。
4. 既存トンネル経由での疎通・遅延・帯域の実機計測（101 H.265で検証）。
5. 同時本数とエッジ(QSV)負荷の実測。
