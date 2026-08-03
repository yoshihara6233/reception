# DR（災害復旧）Runbook / 構築手順 / オペレータマニュアル

対象: Intereco Recorder Monitor（本部 Next.js on Vercel ＋ 現地エッジ ＋ Supabase）。
目的: 各構成要素の喪失シナリオに対する **復旧手順（RTO/RPO 目標付き）** と **訓練記録** を1本化し、**99% SLA** を運用で支える。

- 本番 Supabase: `jmlviywilxzavjbmlpnf`（region `ap-south-1`）
- 本番 URL: https://intereco-monitor.vercel.app（Vercel project `intereco-monitor` / prod branch `monitor-prod`）
- スキーマ正本: `claude/monitor/supabase/migrations/20260707090000_remote_baseline.sql`（git・CLI `db push` 運用 → `docs/db-environments.md`）
- エッジ運用手順: `claude/edge-agent/deploy/ota/RUNBOOK.md`（OTA + known-good ロールバック）

> ⚠ 本書のうち **本番を破壊する操作（PITR restore 等）は訓練で実行しない**。安全に実行できる
> 「スキーマ復旧ドリル」を実施記録として残し、破壊系は手順として整備する。

---

## 0. SLA と RTO/RPO 目標

99% 可用性 ＝ 月間ダウンタイム許容 約 **7.2 時間/月**。1インシデントの復旧目標を以下に置く。

| 対象 | RTO（復旧時間目標） | RPO（データ喪失許容） | 根拠 |
|------|------|------|------|
| アプリ（Vercel） | **< 15 分** | 0（git がソース） | 再デプロイのみ |
| DB スキーマ | **< 30 分** | 0（git baseline） | `db push`/`db reset` で再構築 |
| DB データ | **1〜4 時間** | **≤ 24 時間**（現状） | Supabase 日次バックアップ（後述の課題） |
| エッジ1台 | **2〜4 時間** | 該当店のライブ/巡回/発報のみ | 予備機 or 再プロビジョニング |
| 鍵漏洩 | **< 1 時間** | 0 | 無停止ローテ手順あり |

> **エッジ障害はクラウド全体を止めない**（該当1店のライブ/巡回/発報前後スナップのみ停止）。
> クラウド（DB/Vercel）障害は全店に波及するため最優先。

---

## 1. 現状のバックアップ実態（2026-07-07 調査）

`supabase backups list --project-ref jmlviywilxzavjbmlpnf` の結果:
```
walg_enabled: true      # 物理バックアップ基盤(WAL-G)は有効
pitr_enabled: false     # ★ PITR(任意時点復旧)は未購入=無効
backups: []             # セルフ物理バックアップ点は未提供
```

**意味するところ**:
- **スキーマ**は git baseline から**即時再構築可能**（RPO 0・RTO 数十秒〜数分）。
- **データ**の自動復旧点は Supabase の**日次論理バックアップ**（ダッシュボード restore）に依存 ＝ **RPO 最大約24時間**、任意秒への PITR は**不可**。
- → §6 の推奨（PITR 有効化 or 定期 `pg_dump --data-only`）で RPO を縮める。

---

## 2. 障害シナリオ一覧

| # | シナリオ | 影響範囲 | 対応節 |
|---|---------|---------|--------|
| S1 | Supabase プロジェクト喪失/破損（スキーマ or データ） | 全店・全機能 | §3 |
| S2 | Vercel デプロイ破損 / ロールバック必要 | 全店・本部UI | §4 |
| S3 | エッジ機（beelink）ハード故障 | 該当1店のライブ/巡回/発報 | §5 |
| S4 | service_role 鍵 / ログインPW の漏洩 | 全店（権限昇格リスク） | §5.4 |
| S5 | Cloudflare Tunnel 断（リモート視聴不可） | リモート視聴のみ（ローカルは可） | §5.3 |

---

## 3. S1: Supabase（クラウドDB）復旧

### 3.1 スキーマのみ破損 / 新プロジェクトへ再構築
1. 新規 or 復旧先 Supabase プロジェクトを用意（または既存を継続使用）。
2. CLI で link:
   ```bash
   cd claude/monitor
   supabase link --project-ref <復旧先ref>   # DBパスワード要
   ```
3. **スキーマを baseline から流し込む**:
   ```bash
   supabase db push        # migrations/20260707090000_remote_baseline.sql を適用
   ```
   （新規プロジェクトなら履歴は空なのでそのまま適用される。既存なら `migration list` で差分確認）
4. 検証: 主要テーブル（tenants/stores/admin_users/edge_devices/alarm_events…）の存在と RLS 有効を確認。

### 3.2 データ復旧（RPO ≤ 24h・PITR 無効の現状）
1. **Supabase ダッシュボード → Database → Backups** から**最新の日次バックアップを restore**（PITR 有効化済みなら §3.3）。
2. restore 対象を確認（別プロジェクトへ復元 → 切替 or 同プロジェクトへ上書き）。
3. restore 後、§3.4 の切替を実施。

### 3.3 PITR が有効な場合（推奨・§6）
```bash
supabase backups restore --project-ref <ref>   # 任意タイムスタンプへ復元（PITR）
```

### 3.4 復旧後の切替（Vercel + エッジ）
1. **Vercel env** の `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` を復旧先の値に更新 → **Redeploy**（env変更は再デプロイで反映）。
2. **エッジ**は `MONITOR_URL` 経由の bootstrap で**新URL/鍵を自動取得**（約5分）。急ぐ場合は `/home/intereco/edge/shared/agent.env` の該当値を更新して `sudo systemctl restart intereco-edge`。
3. 検証: `/admin/edges` でエッジがオンライン復帰・監視画面が正常。
4. **⚠ バックアップに乗らないもの（2026-08-01 東京移行の実弾教訓）**を手で再構築する:
   - **Vault secrets**: `project_url` / `service_role_key` / `app_url` / `bcp_webhook_secret`（無いと J-Alert ポーリングと BCP PDF 自動生成が**黙って**止まる）。
   - **pg_cron ジョブ**（5本: jalert_poll / bcp_report_sweep / patrol 系 / cleanup 系）— `select jobname, schedule, active from cron.job;` で確認。
   - 点検 SQL・復旧手順の詳細はメモリ/過去実績（2026-08-01 BCP 沈黙障害）を参照。

### 3.5 データ復旧訓練（非破壊・所要約30分・GA前に1回実施）

> 本番には一切書き込まない。**「ダンプ取得 → 空プロジェクトへ復元 → 検証」**を通しで計測し、§0 の RTO(データ) を実測値に置き換えるのが目的。

1. **計測開始**（開始時刻を記録）。
2. **本番からデータダンプ取得**（読み取りのみ・ユーザー実行）:
   ```bash
   pg_dump "$PROD_DB_URL" --data-only --no-owner --no-privileges -Fc -f ~/dr-drill-$(date +%Y%m%d).dump
   ```
3. **復旧先を用意**: Supabase で訓練用プロジェクトを新規作成（東京）→ スキーマは migrations から適用:
   ```bash
   supabase db push --db-url "$DRILL_DB_URL"    # スキーマ編は 28 秒実績
   ```
4. **データ復元**:
   ```bash
   pg_restore --data-only --disable-triggers --no-owner -d "$DRILL_DB_URL" ~/dr-drill-*.dump
   ```
5. **検証 SQL**（本番と件数比較・主要テーブル）:
   ```sql
   select 'stores' t, count(*) from stores union all
   select 'edge_devices', count(*) from edge_devices union all
   select 'admin_users', count(*) from admin_users union all
   select 'bcp_events', count(*) from bcp_events union all
   select 'inspection_sessions', count(*) from inspection_sessions union all
   select 'recorder_cameras', count(*) from recorder_cameras;
   ```
6. **§3.4-4 の「乗らないもの」チェック**: 訓練プロジェクトに Vault secrets と cron.job が**無い**ことを確認し、再構築手順を読み合わせる（実際の再構築は本番切替時のみ）。
7. **記録**: 所要時間を §0 の RTO(データ) 実測として追記。ダンプは削除 or 暗号化保管、訓練プロジェクトは削除。

---

## 4. S2: Vercel（アプリ）復旧
- **直近の正常デプロイへロールバック**: Vercel → Deployments → 正常な過去デプロイの「Promote to Production」。
- **git から再デプロイ**: `monitor-prod` の正しいコミットを push / Redeploy。
- env 破損時は Settings → Environment Variables を復元（§3.4 の3鍵＋通知系 `CRON_SECRET`/`RESEND_API_KEY`/`ALERT_EMAILS`/`ALERT_WEBHOOK_URL`）。`/admin` ダッシュボードの env 欠落警告で不足を確認。

---

## 5. S3: エッジ機（beelink）復旧

### 5.1 再プロビジョニング（新/交換機）
詳細は `claude/edge-agent/deploy/ota/RUNBOOK.md` の「A. 一度きりのセットアップ」。要点:
1. OS・bun・ffmpeg・go2rtc・Docker(Frigate) を用意。
2. リポジトリ配置 → OTA レイアウト作成（`setup-layout.sh`）。
3. **`/home/intereco/edge/shared/agent.env`** に `EDGE_ID` / `EDGE_DEVICE_TOKEN` / `MONITOR_URL` / `SUPABASE_*` / `EDGE_ROOT` / `ALARM_SHARED_TOKEN` 等を設定。
   - `EDGE_DEVICE_TOKEN` は `/admin/edges/new` のエンロールトークン（24h・単一使用）から発行。
4. systemd `intereco-edge` / `cloudflared-intereco` 配置・起動。
5. 検証: `/admin/edges` でオンライン・ライブ/グリッド/巡回が復帰。

### 5.2 ソフト不具合（OTA ロールバック）
`RUNBOOK.md` §C: 自動 known-good 復帰、または `rollback-edge.sh manual` で current→known-good に即時復帰。

### 5.3 S5: Cloudflare Tunnel 断
- `sudo systemctl restart cloudflared-intereco`（systemd で自動復帰する想定）。固定URL `poc-beelink.genesis-edge.com`。
- ローカル網内視聴は影響なし。リモート視聴のみ一時不可。

### 5.4 S4: 鍵/PW 漏洩時の無停止ローテ
`docs/db-environments.md` / メモの手順（2026-07-07 実施実績あり）:
1. Supabase で新 secret 鍵を発行（旧は残す）。
2. Vercel env 更新 → Redeploy。
3. エッジ `shared/agent.env` 更新 → restart。
4. 両系の正常を検証してから**旧鍵を失効**（順序厳守＝失効を先にやると全停止）。
5. ログインPW は `/forgot-password` から変更。
> ⚠ エッジ鍵は OTA 稼働のため `/home/intereco/edge/shared/agent.env`（systemd EnvironmentFile）が正。旧パス `claude/edge-agent/.env` ではない。

---

## 6. RPO 改善の推奨（99% SLA 強化）

現状 RPO ≤24h（PITR 無効）を縮めるための選択肢:
1. **Supabase PITR を有効化**（有料アドオン）→ RPO 分単位・任意時点復旧。最も確実。
2. **定期 `pg_dump --data-only` を外部保管**（cron で日次〜時間次・Storage/S3へ）→ 低コストで RPO を時間単位に。
   ```bash
   supabase db dump --linked --data-only -f backup_$(date +%Y%m%d).sql   # ※タイムスタンプは実行時に付与
   ```
3. **スキーマは git baseline で担保済**（追加コスト0）。データ層のみが課題。

> 判断: 実データ量・許容損失・コストで①/②を選ぶ。防犯用途で発報/録画メタの喪失が痛い場合は①推奨。

---

## 7. オペレータマニュアル（誰が・何を・いつ）

### 7.1 検知
- **エッジ/トンネル断**: `edge-health` cron（2分毎）が3分無応答で**メール＋Webhook 通知**（`ALERT_EMAILS`/`ALERT_WEBHOOK_URL`）。`/admin/edges` で状態確認。
- **クラウド断**: 監視画面が 500 / ログイン不可。Vercel/Supabase の status ページを確認。

### 7.2 一次対応フロー
```
通知/異常を検知
  ├─ 監視画面が開ける？
  │    NO → S2(Vercel) or S1(Supabase) を切り分け（Vercelデプロイ状態 / Supabase稼働）
  │           → §4 / §3 へ
  │    YES → 特定エッジのみ異常？
  │           YES → S3(エッジ)。§5。該当店のみ影響=優先度中
  │           NO  → 広域。通知系/DB を確認 → §3/§4
  └─ 鍵漏洩の疑い → §5.4 を最優先で実行
```

### 7.3 エスカレーション
1. 一次: 運用担当（通知受信者）。RTO 目標内に復旧見込みが立たなければ2次へ。
2. 二次: 開発担当（本Runbook＋各RUNBOOK参照で復旧）。
3. 外部依存: Supabase（DB/PITR/backup）・Vercel（deploy）・Cloudflare（tunnel）の各サポート/status。

### 7.4 復旧後
- 影響範囲・原因・復旧時刻を記録（`monitor_incidents` or 運用ログ）。
- RTO/RPO を本目標と比較し、逸脱があれば §6 等の恒久対策を検討。

---

## 8. 訓練記録

### 訓練 #1 — スキーマ復旧ドリル（2026-07-07・実施完了）
- **シナリオ**: DB スキーマ喪失 → git baseline から全スキーマを再構築（S1.1 の中核）。
- **手順**: クリーンな DB に対し `bun run db:reset`（＝`20260707090000_remote_baseline.sql` + seed を適用）。
- **結果**:
  - 所要 **28 秒**（スキーマ48定義/77ポリシー/19関数/86索引 ＋ seed 投入）
  - **public テーブル 46 / RLS 有効 46** を確認
  - 復旧後に **ローカル gotrue でログイン成功**（`admin@local.dev`）＝認証層まで機能復帰
- **判定**: ✅ スキーマ＋認証の復旧手順が有効。RTO(スキーマ) < 30分 目標を大きく満たす。
- **残課題（次回訓練候補）**: (a) データ層 restore（Supabase 日次 or PITR）の実復元テスト、(b) エッジ再プロビジョニングの実機ドリル（予備機 or 検証機）。

---

## 付録: よく使うコマンド
```bash
# バックアップ状況の確認
supabase backups list --project-ref jmlviywilxzavjbmlpnf

# スキーマ復旧（新/復旧先プロジェクトへ）
cd claude/monitor && supabase link --project-ref <ref> && supabase db push

# ローカルでの復旧ドリル（本番無関係）
bun run db:start && bun run db:reset   # → 46テーブル + seed、admin@local.dev/LocalDev!2026 でログイン

# エッジ再起動 / ロールバック
sudo systemctl restart intereco-edge
EDGE_ROOT=/home/intereco/edge bash /home/intereco/edge/bin/rollback-edge.sh manual
```
