# 月次利用状況レポート — 設計ドキュメント

作成: 2026-07-25 / 対象: Intereco Monitor (Next.js + Supabase 東京) / ステータス: **設計（未実装）**
決定: アプローチ **B（日次ロールアップ表）** で実装する。

---

## 1. 目的
テナント／店舗の利用状況を月次で可視化し、契約（上限）と実利用の対比・トレンドを運営とテナント管理者が把握できるようにする。毎月の指定日に自動でレポートを確定・通知する。

## 2. 見たい指標（要望）
- **契約数(上限) vs 実際の登録数**: 店舗数、各オプション(巡回/発報/検査)のON店舗数。
- **利用量（テナント全体 & 店舗別）**: 巡回数・発報数・手荷物検査数・映像確認数(と率)・顔認証数。
- **時間軸**: 曜日毎の変化、月次推移。
- **運用**: 毎月XX日にレポート作成（テナント毎に設定）。

## 3. データソース（確認済み）
| 指標 | ソース | 集計キー |
|---|---|---|
| 契約(上限) | `tenants.max_stores/max_patrol/max_alarm/max_baggage` | スナップショット時点 |
| 登録数 | `stores`（件数）/ `stores.opt_patrol/alarm/baggage=true`（件数） | スナップショット時点 |
| 巡回数 | `patrol_runs`（store_id, created_at, trigger, status） | store×日 |
| 発報数 | `alarm_events`（store_id, occurred_at, event_type） | store×日 |
| 手荷物検査数 | `inspection_sessions`（store_id, inspection_date, status, person_kind） | store×日 |
| 映像確認数 | `live_sessions`（store_id, mode=grid/live/vod, started_at）＋ `footage_access_log` | store×日 |
| 顔認証数 | `inspection_sessions`（顔照合結果ステータス） | store×日 |

## 4. 指標定義（確定 2026-07-25）
1. **映像確認率 = 手荷物検査（退出）の映像確認率**（確定）
   - **分子** = 店長が映像を再生確認した検査数 = `inspection_sessions.confirmed_at IS NOT NULL`（`confirmed_by` = 確認した店長）。
   - **分母** = 退出時に検査を実施したセッション数（`exit_at IS NOT NULL` の検査セッション）。
   - 率 = 分子 / 分母。**既存の確認導線をそのまま集計**する（`ConfirmButton.tsx` / `POST /api/baggage/sessions/[id]/confirm` / 列 `confirmed_by,confirmed_at`・部分索引 `idx_inspection_sessions_unconfirmed`）。**新規トラッキング不要**。
   - 補足の分母定義（退出検査の対象ステータス）だけは実装時に最終確定（`exit_at` 基準を既定とする）。
2. **顔認証数 = 試行数（一致/アンマッチ内訳つき）**（確定）
   - **試行数** = 入退室で顔照合を行った回数。
   - 内訳: **一致** と **アンマッチ**（`unmatched_entry` / `unmatched_exit`）を併記。
3. 参考: ライブ/録画視聴(`live_sessions`)・証跡確認(`footage_access_log`)は「映像確認率(検査)」とは別指標として利用量に併記（率の対象ではない）。

## 5. アーキテクチャ（採用: B 日次ロールアップ）

### 5.1 集計テーブル `usage_daily`
```
usage_daily(
  tenant_id      uuid    not null,
  store_id       uuid    not null,
  date           date    not null,       -- JST基準の対象日
  patrol_count           int not null default 0,   -- patrol_runs
  alarm_count            int not null default 0,   -- alarm_events
  inspection_count       int not null default 0,   -- inspection_sessions(全体)
  baggage_exit_count     int not null default 0,   -- 退出時検査実施数(exit_at not null)=映像確認率の分母
  baggage_confirmed_count int not null default 0,  -- 店長が映像確認済(confirmed_at not null)=分子
  face_auth_attempts     int not null default 0,   -- 顔認証試行(=検査の入退照合)
  face_auth_matched      int not null default 0,   -- 一致
  face_auth_unmatched    int not null default 0,   -- アンマッチ(unmatched_entry+unmatched_exit)
  video_live_count       int not null default 0,   -- live_sessions(live/vod/grid) 参考指標
  footage_access_count   int not null default 0,   -- footage_access_log(証跡確認) 参考指標
  updated_at     timestamptz not null default now(),
  primary key (store_id, date)
)
-- index: (tenant_id, date)
-- RLS: super_admin=全件 / tenant_admin=自テナント / store_manager=担当店舗
```
- 1行 = 1店舗×1日。月次・曜日別・店舗別・テナント全体はすべてこの表の GROUP BY で出せる。
- **契約(上限)・登録数は時点値**なので rollup には入れず、レポート時に `tenants`/`stores` から直接読む（またはスナップショットで確定月の値を `monthly_report` 側に焼く＝C拡張時）。

### 5.2 ロールアップ cron
- **新規** `GET /api/cron/usage-rollup`（Vercel Cron・毎日 早朝 JST、baggage-daily の後）。
- 前日(必要なら過去数日ぶんも冪等再計算)を対象に、各ソースを store×date で集計し `usage_daily` に **upsert**。
- 冪等（同日再実行で上書き）・店舗単位 try/catch（既存 cron 前例に倣う）。CRON_SECRET 認証。
- 遅延到着データに備え「直近3日ぶんを毎回再集計」する。

### 5.3 レポート作成日（毎月XX日）
- `tenants` に `report_day smallint`（1〜28・null=既定28）を追加。UIはテナント編集フォームに1項目追加。
- **新規** `GET /api/cron/monthly-report`（毎日実行し、`report_day = 今日のJST日` のテナントだけ処理）。
  - 対象月（＝前月 or 当月確定分）の `usage_daily` を集計してレポートを生成。
  - 通知メール（テナント管理者＋運営）に要約＋管理画面リンク。※PDF化はC拡張（任意）。
- 28日上限にするのは「29〜31日が無い月」を避けるため（末日運用が要れば別途 `report_day=0=末日` を定義）。

### 5.4 画面 `/admin/reports/usage`（②運営管理 or ①設定に配置）
- **テナント選択**は既存の「操作中テナント」方式に乗せる（super_adminは選択、tenant_adminは自テナント固定）。
- 月セレクタ（既定=前月）。
- **サマリカード**: 契約 vs 登録（店舗数・各オプションON数を `x / 上限` で・上限超過はアンバー警告=既存表記に統一）。
- **テナント全体の指標**: 巡回/発報/検査/映像確認/顔認証（当月合計＋前月比）。
- **店舗別テーブル**: 店舗×各指標。ソート・CSV書出し（既存 AccessLogTable のCSV流用方針）。
- **曜日別**: 各指標の曜日平均（月〜日の棒）。
- **月次推移**: 直近6〜12ヶ月の折れ線（`usage_daily` を月GROUP BY）。
- 権限: super_admin=全テナント / tenant_admin=自テナント / store_manager=担当店舗のみ（既存スコープ流用）。

## 6. 権限・プライバシー
- 既存の二プレーン権限（[[monitor-admin-authz-model]]）に従う。
- **運営(super_admin)の映像確認は、テナント側レポートに含めない**（PR#213 の非開示方針と整合。rollup 集計時に super_admin actor を除外する）。

## 7. 段階実装（WBS・Bのみ / C は任意拡張）
1. **R1 migration**: `usage_daily` テーブル＋RLS、`tenants.report_day` 列。（要 `supabase db push`・東京link確認）
2. **R2 集計ロジック（純関数＋テスト）**: 各ソース→日次カウントの純ロジックを `src/lib/reports/` に。単体テストで境界（JST日跨ぎ・遅延到着・重複）を固める。
3. **R3 rollup cron** `/api/cron/usage-rollup` ＋ vercel.json 登録。過去バックフィル用の手動トリガも用意。
4. **R4 レポートAPI/集計**: 月・テナント・店舗スコープの読み取り（`usage_daily` GROUP BY）。
5. **R5 UI** `/admin/reports/usage`（サマリ/店舗別/曜日別/月次推移/CSV）。
6. **R6 レポート作成日**: `report_day` 設定UI＋ `/api/cron/monthly-report`（該当日テナントを通知）。
7. **R7 検証（typecheck/lint/build/test）→ PR → 本番migration → マージ**。
- **C拡張（任意）**: `monthly_reports` スナップショット＋PDF（security-report のPDF前例流用）で過去月を不変確定・監査対応。

## 8. リスク / 注意
- **集計の正確性**: JST日境界・タイムゾーン。純関数＋テストで担保（R2）。
- **バックフィル**: 既存の過去データは cron 導入時に `usage-rollup` を過去日ぶん手動実行して埋める（baggage/backfill と同じ考え方）。
- **コスト**: rollup は日1回・店舗数分の集計のみ＝軽い。レポート閲覧は `usage_daily` 読み取りで高速。
- **映像確認率の定義変更**に強い設計（生カウントを列で保持し、率は表示側で算出）。

## 9. 見積り（CC+gstack 目安）
- R1–R4（DB＋集計＋cron＋読み取り）: 中。R5 UI: 中。R6 作成日＋通知: 小。C拡張(PDF): 中。
- 最小で「R1–R5（画面で月次・店舗別・曜日別・推移が見える）」を第一弾、R6（自動作成日通知）を第二弾、C（PDF確定）を第三弾に分割推奨。

## 10. The Assignment（次の具体アクション）
実装着手の前に、**§4 の2つの定義を確定**してください：
1. 「映像確認率」の分母 = (a)発報応答率 / (b)視聴カバレッジ / (c)率なし。
2. 「顔認証数」= 試行数(一致/アンマッチ内訳) / 一致数のみ。

この2点が決まれば R1（migration）から実装に入れます。まず**第一弾 R1–R5（閲覧できる状態）**を作り、実データで指標の妥当性を見てから R6/C を足すのが安全です。

関連: [[monitor-admin-authz-model]] [[baggage-inspection-project]] [[intereco-monitor-deploy]]
