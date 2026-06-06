# Phase 11 着手前 チェックリスト

実装着手の前に、以下を **上から順に** 確認してください。
すべて ✅ になったら F86 から着手可能です。

---

## 🔐 1. アカウント・認証情報の準備

### 1.1 Hetzner Cloud アカウント
- [ ] https://www.hetzner.com/cloud にて登録
- [ ] クレジットカード or PayPal を支払い方法に設定
- [ ] 2FA (TOTP) 有効化
- [ ] Project 作成: `intereco-production`
- [ ] API Token 発行 (Read & Write) → 1Password / Bitwarden に保管
- [ ] SSH 鍵を Hetzner にアップロード (ed25519 推奨)

```bash
# SSH 鍵が無い場合
ssh-keygen -t ed25519 -C "intereco-hetzner" -f ~/.ssh/intereco_hetzner
```

### 1.2 ドメイン (intereco.io 等)
- [ ] ドメイン取得済 (Cloudflare Registrar 推奨, 年 ¥1,500)
- [ ] 以下のサブドメインを使う予定:
  - [ ] `grafana.intereco.io` → 監視サーバ Grafana
  - [ ] `pushgateway.intereco.io` → メトリクス受信
  - [ ] `loki.intereco.io` → ログ受信
  - [ ] `monitor.intereco.io` → Vercel Next.js
  - [ ] `status.intereco.io` → 顧客向けステータスページ
  - [ ] `frigate.intereco.io` (オプション) → F80 iframe ライブ用

### 1.3 Cloudflare アカウント
- [ ] https://dash.cloudflare.com にて登録
- [ ] 上記ドメインを Cloudflare DNS に委任 (NS 切替)
- [ ] API Token 発行 (Zone:DNS:Edit, スコープを `intereco.io` のみに限定)
- [ ] Health Check (無料 10 個まで) を有効化する予定

### 1.4 Slack ワークスペース
- [ ] ワークスペース作成 or 既存ワークスペースを使用
- [ ] チャンネル作成:
  - [ ] `#intereco-alerts-p0` (緊急、SMS 連動)
  - [ ] `#intereco-alerts-p1` (重大、Slack のみ)
  - [ ] `#intereco-alerts-p2` (注意喚起)
  - [ ] `#intereco-deploys` (CI/CD 通知)
- [ ] Incoming Webhook を作成 (各チャンネルに 1 つずつ)
- [ ] Webhook URL を 1Password / Bitwarden に保管

### 1.5 Twilio アカウント
- [ ] https://www.twilio.com にて登録
- [ ] KYC 完了 (国際 SMS 送信に必要、~1-2 営業日)
- [ ] Phone Number 取得 (送信元、月 ¥1,000-1,500)
- [ ] API SID + Auth Token を 1Password に保管
- [ ] 日本国内 SMS 送信テスト (1 通 ¥10-20)

⚠️ Twilio は KYC に時間がかかるので **着手 1 週間前** に申請開始

---

## 👥 2. オンコール体制の決定

### 2.1 オンコール担当者の確定
- [ ] 担当者 1 (リード): _______________
  - [ ] 電話番号 (国際表記): _______________
  - [ ] Slack ID: _______________
- [ ] 担当者 2: _______________
  - [ ] 電話番号 (国際表記): _______________
  - [ ] Slack ID: _______________
- [ ] 担当者 3 (任意): _______________

### 2.2 輪番ルール
- [ ] 輪番周期: ☐ 週単位 / ☐ 月単位 / ☐ カスタム
- [ ] 担当時間: ☐ 24/7 / ☐ 平日 9-18 + 当番夜間
- [ ] エスカレーション:
  - [ ] P0: 即時 SMS + Slack → 15 分応答なし → リード → 30 分 → 全員
  - [ ] P1: Slack → 1 時間応答なし → リード
  - [ ] P2: メール送信のみ
- [ ] 振替申請ルール

### 2.3 対応時間 SLA
- [ ] P0 (即時): 15 分以内に応答 + 30 分以内に着手
- [ ] P1 (15分): 1 時間以内に応答
- [ ] P2 (1時間): 翌営業日

---

## 💵 3. 予算承認

### 3.1 初期費用 (1 回のみ)
- [ ] ドメイン取得: ¥1,500/年
- [ ] (任意) 構築外注: ¥0-300,000

### 3.2 ランニングコスト (月額)
- [ ] Hetzner CX32: €7.59 (~¥1,200)
- [ ] Hetzner Storage Box 1TB: €3.20 (~¥500)
- [ ] Twilio Pay-as-you-go: ~¥1,000 (50通/月想定)
- [ ] **合計**: ~¥2,700/月 = 年 ¥32,400
- [ ] 経費承認済?: ☐ Yes / ☐ No
- [ ] 支払い方法 (法人カード等) の確認

### 3.3 スケール時の予算 (将来想定)
- [ ] 1,000 拠点超 → Hetzner CX42 (¥2,100/月) 程度
- [ ] 10,000 拠点 → CX52 or HA 構成 (¥10,000-15,000/月)

---

## 🛠 4. 技術的前提

### 4.1 既存依存
- [ ] F50.C: edge-agent /metrics エンドポイント稼働確認
- [ ] F49: サーキットブレーカー稼働確認
- [ ] F50.E: /infra/slo ダッシュボード稼働確認
- [ ] Vercel デプロイ済み (Phase 10 完了済?) ☐ Yes / ☐ No

### 4.2 開発環境
- [ ] Docker 27.x インストール (Mac)
- [ ] docker compose 2.x
- [ ] Ansible 2.16+ (オプション)
- [ ] Hetzner CLI `hcloud` (オプション、自動化用)
- [ ] Caddy 2.7+ 知識 (TLS 設定理解)

```bash
# Mac での確認
docker --version
docker compose version
brew install hcloud  # オプション
```

---

## 📚 5. ドキュメント・知識の準備

### 5.1 公式ドキュメント
- [ ] [Prometheus 入門](https://prometheus.io/docs/introduction/overview/) を読む
- [ ] [Grafana Provisioning](https://grafana.com/docs/grafana/latest/administration/provisioning/) を読む
- [ ] [Loki LogQL](https://grafana.com/docs/loki/latest/logql/) を読む
- [ ] [Alertmanager](https://prometheus.io/docs/alerting/latest/alertmanager/) を読む
- [ ] [Caddy Docker](https://hub.docker.com/_/caddy) を読む

### 5.2 自社設計の確認
- [ ] `docs/tier3/monitoring/` の F51.F 設計を再読
- [ ] 本ディレクトリの README.md を再読

---

## 🚦 6. 着手 GO 判定

すべて ✅ になったら下記コマンドで F86 着手:

```bash
# 1. タスクを in_progress に
# (Claude Code で「F86 着手」と伝える)

# 2. Hetzner CX32 を作成 (Web UI or hcloud CLI)
hcloud server create \
  --name intereco-monitoring \
  --image debian-12 \
  --type cx32 \
  --location nbg1 \
  --ssh-key intereco-mac

# 3. SSH で接続 → setup スクリプト実行
```

---

## ⚠️ 着手しない判断 (NO-GO 条件)

以下に該当する場合は **延期** を推奨:

- ❌ オンコール担当者が決まっていない (アラートが届く先が無い)
- ❌ Phase 10 (マルチテナント) 未完で本番 URL 確定していない
- ❌ 月 ¥3,000 の経費承認が下りていない
- ❌ Twilio KYC 完了まで時間がかかる (1 週間以内に必要)

---

## 📝 メモ・特記事項

(自由記入欄)
