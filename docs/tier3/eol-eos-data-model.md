# F45.3: EOL/EOS データモデル 設計

> 7 年運用前提で、レコーダのライフサイクル管理 (導入日・EOL・EOS) を扱うスキーマと UI ロジックを設計。

## 1. 設計目的

- **個別店舗の NVR ライフサイクル管理** — 機種・FW・導入日・残期間を把握
- **EOL/EOS アラート** — 期限が近づいた店舗を /infra で可視化
- **更新計画支援** — 「来年度に置換が必要な店舗 N 件」「期限切れ寸前 M 件」を集計
- **ベンダー横断** — i-PRO 以外を追加しても同じスキーマで扱える

## 2. 用語整理

| 用語 | 定義 |
|---|---|
| **EOL (End of Life)** | 製造販売終了。以降は新規調達不可、修理対応は継続 |
| **EOS (End of Support / End of Service)** | サポート (修理・FW 更新) 終了。実質的にリスク機材 |
| **導入日 (installed_at)** | 店舗に設置された日 (= 運用年数の起点) |
| **7 年運用ルール** | 1 機種あたり最長 7 年で置換 (社内方針として顧客と合意) |
| **置換期限 (replace_by)** | `installed_at + 7y` または `eos_date` の早い方 |

## 3. スキーマ追加

### 3-1. `stores` テーブルへのカラム追加

```sql
-- supabase/migrations/20260605_001_nvr_lifecycle.sql

-- ── NVR ベンダー / 機種 / 接続情報 (既出だが整理) ───────────────────────
ALTER TABLE stores ADD COLUMN IF NOT EXISTS
  deployment_mode text NOT NULL DEFAULT 'per_store_minipc'
  CHECK (deployment_mode IN ('per_store_minipc', 'central_aggregator'));

ALTER TABLE stores ADD COLUMN IF NOT EXISTS nvr_vendor text;
  -- 'i-pro-nx' | 'i-pro-nu' | 'i-pro-gxe500' | 'frigate' | 'hikvision' | …
  -- 'frigate' は per_store_minipc モード用 (現行互換)

ALTER TABLE stores ADD COLUMN IF NOT EXISTS nvr_model text;
  -- 'WJ-NX300K' | 'WJ-NU201K' | …

ALTER TABLE stores ADD COLUMN IF NOT EXISTS nvr_endpoint text;
  -- 'https://10.0.1.5:8443'

ALTER TABLE stores ADD COLUMN IF NOT EXISTS nvr_credentials_ref uuid;
  -- vault.secrets.id への参照

ALTER TABLE stores ADD COLUMN IF NOT EXISTS nvr_options jsonb NOT NULL DEFAULT '{}'::jsonb;
  -- ベンダー固有の設定 (CGI パス、AI モード等)

ALTER TABLE stores ADD COLUMN IF NOT EXISTS central_node_id uuid;
  -- 中央集約モード時にどのノードが担当しているか

-- ── NVR ライフサイクル管理 ────────────────────────────────────────────
ALTER TABLE stores ADD COLUMN IF NOT EXISTS nvr_installed_at date;
  -- 導入日 (= 運用年数の起点)

ALTER TABLE stores ADD COLUMN IF NOT EXISTS nvr_fw_version text;
  -- 最後に検出された FW Ver。'3.42-0001' 形式

ALTER TABLE stores ADD COLUMN IF NOT EXISTS nvr_fw_detected_at timestamptz;
  -- 上記 FW Ver を検出した時刻

ALTER TABLE stores ADD COLUMN IF NOT EXISTS nvr_eol_date date;
  -- 公式 EOL 予定 (nvr_models から自動同期 or 手動上書き)

ALTER TABLE stores ADD COLUMN IF NOT EXISTS nvr_eos_date date;
  -- 公式 EOS 予定

ALTER TABLE stores ADD COLUMN IF NOT EXISTS nvr_replace_by date GENERATED ALWAYS AS (
  LEAST(
    COALESCE(nvr_eos_date, '9999-12-31'::date),
    COALESCE(nvr_installed_at + INTERVAL '7 years', '9999-12-31'::date)::date
  )
) STORED;
  -- 自動計算: EOS と「導入 + 7年」の早い方

-- インデックス
CREATE INDEX IF NOT EXISTS idx_stores_nvr_vendor ON stores(nvr_vendor);
CREATE INDEX IF NOT EXISTS idx_stores_replace_by ON stores(nvr_replace_by);
CREATE INDEX IF NOT EXISTS idx_stores_deployment_mode ON stores(deployment_mode);
```

### 3-2. `nvr_models` マスタテーブル (新規)

ベンダー横断で機種カタログを持つ。EOL/EOS の参照ソース。

```sql
CREATE TABLE IF NOT EXISTS nvr_models (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor          text NOT NULL,          -- 'i-pro' | 'hikvision' | …
  model_family    text NOT NULL,          -- 'nx' | 'nu' | 'gxe' | …
  model_number    text NOT NULL UNIQUE,   -- 'WJ-NX300K'
  display_name    text NOT NULL,          -- 'i-PRO WJ-NX300K (16ch IP NVR)'
  released_at     date,
  eol_announced_at date,                  -- EOL 公表日
  eol_date        date,                   -- EOL 予定
  eos_date        date,                   -- EOS 予定
  max_channels    int,
  max_resolution  text,
  source_url      text,                   -- 公式情報源
  notes           text,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nvr_models_vendor ON nvr_models(vendor);
CREATE INDEX IF NOT EXISTS idx_nvr_models_eos_date ON nvr_models(eos_date);
```

#### サンプルデータ (i-PRO 主要機種)

```sql
INSERT INTO nvr_models (vendor, model_family, model_number, display_name,
                        released_at, eol_date, eos_date, max_channels, max_resolution)
VALUES
  ('i-pro', 'nx', 'WJ-NX200K', 'i-PRO WJ-NX200K (16ch IP NVR)',
   '2018-04-01', '2024-03-31', '2029-03-31', 16, '1080p'),
  ('i-pro', 'nx', 'WJ-NX300K', 'i-PRO WJ-NX300K (16ch IP NVR / 高機能)',
   '2018-10-01', '2025-09-30', '2030-09-30', 16, '4K'),
  ('i-pro', 'nx', 'WJ-NX400K', 'i-PRO WJ-NX400K (32ch IP NVR)',
   '2019-04-01', '2026-03-31', '2031-03-31', 32, '4K'),
  ('i-pro', 'nx', 'WJ-NX510K', 'i-PRO WJ-NX510K (32ch 高機能 NVR)',
   '2020-10-01', '2027-09-30', '2032-09-30', 32, '4K'),
  ('i-pro', 'nu', 'WJ-NU101K', 'i-PRO WJ-NU101K (4ch 小型 NVR)',
   '2021-04-01', '2028-03-31', '2033-03-31', 4, '4K'),
  ('i-pro', 'nu', 'WJ-NU201K', 'i-PRO WJ-NU201K (8ch 小型 NVR)',
   '2022-04-01', '2029-03-31', '2034-03-31', 8, '4K'),
  ('i-pro', 'nu', 'WJ-NU301K', 'i-PRO WJ-NU301K (16ch 小型 NVR)',
   '2023-04-01', '2030-03-31', '2035-03-31', 16, '4K'),
  ('i-pro', 'gxe', 'WJ-GXE500', 'i-PRO WJ-GXE500 (アナログ→IP 変換器)',
   '2016-04-01', '2024-03-31', '2029-03-31', 4, '1080p');
-- ★ EOL/EOS の正確な日付は i-PRO 公式情報で確認・更新が必要
```

### 3-3. 自動同期トリガ

`stores.nvr_model` が更新されたら `nvr_models` から自動的に EOL/EOS を引いてくる:

```sql
CREATE OR REPLACE FUNCTION sync_store_nvr_lifecycle() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.nvr_model IS NOT NULL AND (
    OLD.nvr_model IS NULL OR OLD.nvr_model != NEW.nvr_model
  ) THEN
    SELECT eol_date, eos_date
      INTO NEW.nvr_eol_date, NEW.nvr_eos_date
      FROM nvr_models
     WHERE model_number = NEW.nvr_model
     LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_store_nvr_lifecycle
  BEFORE INSERT OR UPDATE OF nvr_model ON stores
  FOR EACH ROW EXECUTE FUNCTION sync_store_nvr_lifecycle();
```

これにより、UI から `nvr_model = 'WJ-NX300K'` をセットすると EOL/EOS が自動入力される。手動上書きしたい場合は INSERT 後に UPDATE。

## 4. アラート閾値

| 閾値 | 状態名 | UI 表示 | 通知頻度 |
|---|---|---|---|
| **EOS まで 24ヶ月 超** | `nvr_lifecycle_ok` | 緑バッジ「サポート期間中」 | 通知なし |
| **EOS まで 12〜24ヶ月** | `nvr_lifecycle_warning` | 黄バッジ「N ヶ月後 EOS」 | 月 1 回ダッシュボード集計 |
| **EOS まで 6〜12ヶ月** | `nvr_lifecycle_replace_planned` | 橙バッジ「置換計画推奨」 | 週 1 回サマリ |
| **EOS まで 6ヶ月以内** | `nvr_lifecycle_urgent` | 赤バッジ「緊急: 置換必須」 | 日次アラート |
| **EOS 経過** | `nvr_lifecycle_eos` | 赤バッジ「EOS 超過 (N ヶ月)」 | 日次 + メール通知 |
| **導入から 7年経過** | `nvr_lifecycle_overage` | 赤バッジ「7年運用ルール超過」 | 日次 |

判定は SQL VIEW で実装:

```sql
CREATE OR REPLACE VIEW v_store_nvr_lifecycle AS
SELECT
  s.id,
  s.name,
  s.nvr_vendor,
  s.nvr_model,
  s.nvr_installed_at,
  s.nvr_eol_date,
  s.nvr_eos_date,
  s.nvr_replace_by,
  -- 残月数 (EOS まで)
  EXTRACT(YEAR  FROM age(s.nvr_eos_date, CURRENT_DATE)) * 12
  + EXTRACT(MONTH FROM age(s.nvr_eos_date, CURRENT_DATE)) AS months_until_eos,
  -- 運用年数 (導入から今まで)
  EXTRACT(YEAR FROM age(CURRENT_DATE, s.nvr_installed_at)) AS years_in_service,
  -- ステータス分類
  CASE
    WHEN s.nvr_installed_at IS NULL OR s.nvr_eos_date IS NULL THEN 'nvr_lifecycle_unknown'
    WHEN CURRENT_DATE > s.nvr_eos_date THEN 'nvr_lifecycle_eos'
    WHEN s.nvr_installed_at + INTERVAL '7 years' < CURRENT_DATE THEN 'nvr_lifecycle_overage'
    -- 注: date - date = integer (日数) なので interval と直接比較不可。
    --     date <= date + interval 形式で比較する。
    WHEN s.nvr_eos_date <= CURRENT_DATE + INTERVAL '6 months' THEN 'nvr_lifecycle_urgent'
    WHEN s.nvr_eos_date <= CURRENT_DATE + INTERVAL '12 months' THEN 'nvr_lifecycle_replace_planned'
    WHEN s.nvr_eos_date <= CURRENT_DATE + INTERVAL '24 months' THEN 'nvr_lifecycle_warning'
    ELSE 'nvr_lifecycle_ok'
  END AS lifecycle_status
FROM stores s;
```

## 5. アプリ側で使う集計クエリ

### 5-1. ダッシュボード用サマリ

```sql
-- /infra のサマリカード用
SELECT
  lifecycle_status,
  COUNT(*) AS store_count
FROM v_store_nvr_lifecycle
GROUP BY lifecycle_status
ORDER BY
  CASE lifecycle_status
    WHEN 'nvr_lifecycle_eos'              THEN 1
    WHEN 'nvr_lifecycle_overage'          THEN 2
    WHEN 'nvr_lifecycle_urgent'           THEN 3
    WHEN 'nvr_lifecycle_replace_planned'  THEN 4
    WHEN 'nvr_lifecycle_warning'          THEN 5
    WHEN 'nvr_lifecycle_ok'               THEN 6
    ELSE 7
  END;
```

### 5-2. 機種別の更新計画

```sql
-- 「今後 12 ヶ月で置換が必要な機種別の件数」
SELECT
  nvr_vendor,
  nvr_model,
  COUNT(*) AS stores_to_replace
FROM v_store_nvr_lifecycle
WHERE lifecycle_status IN ('nvr_lifecycle_urgent', 'nvr_lifecycle_replace_planned')
GROUP BY nvr_vendor, nvr_model
ORDER BY stores_to_replace DESC;
```

### 5-3. FW 未更新店舗

```sql
-- 「最新 FW を持たない店舗」(セキュリティパッチ未適用)
SELECT
  s.id, s.name, s.nvr_model, s.nvr_fw_version
FROM stores s
JOIN nvr_models m ON s.nvr_model = m.model_number
WHERE s.nvr_fw_version IS NULL
   OR s.nvr_fw_version < (
     SELECT MAX(fw_version)
     FROM known_firmware_versions f
     WHERE f.vendor = m.vendor AND f.model_family = m.model_family
   );
-- ※ known_firmware_versions テーブルは Phase 2 で追加 (FW リリース管理用)
```

## 6. TypeScript 型定義

```ts
// monitor/src/lib/nvr-adapter/lifecycle.ts (新規)
export type NvrLifecycleStatus =
  | 'nvr_lifecycle_unknown'
  | 'nvr_lifecycle_ok'
  | 'nvr_lifecycle_warning'           // EOS まで 12〜24 ヶ月
  | 'nvr_lifecycle_replace_planned'   // EOS まで 6〜12 ヶ月
  | 'nvr_lifecycle_urgent'            // EOS まで 6 ヶ月以内
  | 'nvr_lifecycle_eos'               // EOS 超過
  | 'nvr_lifecycle_overage'           // 7 年ルール超過

export interface StoreNvrLifecycle {
  storeId:          string
  storeName:        string
  nvrVendor:        string | null
  nvrModel:         string | null
  installedAt:      string | null   // ISO date
  eolDate:          string | null
  eosDate:          string | null
  replaceBy:        string | null
  monthsUntilEos:   number | null
  yearsInService:   number | null
  lifecycleStatus:  NvrLifecycleStatus
}

export const LIFECYCLE_STATUS_LABEL: Record<NvrLifecycleStatus, { ja: string; en: string }> = {
  nvr_lifecycle_unknown:          { ja: '不明',            en: 'Unknown' },
  nvr_lifecycle_ok:               { ja: 'サポート期間中',  en: 'Supported' },
  nvr_lifecycle_warning:          { ja: '24ヶ月以内 EOS',  en: 'EOS within 24mo' },
  nvr_lifecycle_replace_planned:  { ja: '置換計画推奨',    en: 'Replace planned' },
  nvr_lifecycle_urgent:           { ja: '緊急: 置換必須',  en: 'Urgent replace' },
  nvr_lifecycle_eos:              { ja: 'EOS 超過',        en: 'Past EOS' },
  nvr_lifecycle_overage:          { ja: '7年運用超過',     en: '7yr rule exceeded' },
}

export const LIFECYCLE_STATUS_BADGE: Record<NvrLifecycleStatus, string> = {
  nvr_lifecycle_unknown:          'bg-slate-200 text-slate-600',
  nvr_lifecycle_ok:               'bg-emerald-100 text-emerald-700',
  nvr_lifecycle_warning:          'bg-yellow-100 text-yellow-700',
  nvr_lifecycle_replace_planned:  'bg-orange-100 text-orange-700',
  nvr_lifecycle_urgent:           'bg-red-100 text-red-700',
  nvr_lifecycle_eos:              'bg-red-600 text-white',
  nvr_lifecycle_overage:          'bg-red-600 text-white',
}
```

## 7. 運用フロー

### 7-1. 新店舗追加時

1. UI で店舗を作成
2. NVR タブで `nvr_vendor='i-pro-nx'`, `nvr_model='WJ-NX300K'` を入力
3. トリガが `nvr_models` から `eol_date` / `eos_date` を自動コピー
4. `nvr_installed_at` を入力 (今日のデフォルト)
5. 自動的に `nvr_replace_by` が計算される

### 7-2. NVR 更新時 (旧機種 → 新機種)

1. UI で店舗詳細 → NVR タブ → 「機種を更新」
2. 旧 `nvr_model='WJ-NX300K'` → 新 `nvr_model='WJ-NU301K'`
3. `nvr_installed_at` を新規入力 (= 置換実施日)
4. トリガが新 EOL/EOS を自動再計算
5. 更新履歴は別テーブル `store_nvr_history` (Phase 2 で追加検討) に記録

### 7-3. EOL/EOS 情報の i-PRO 公式更新追従

i-PRO が新たに EOL 宣言したら、運用担当者が `nvr_models` を UPDATE。
全店舗の `stores.nvr_eol_date` `stores.nvr_eos_date` も再同期トリガで更新。

```sql
-- 月次バッチ (suggested cron)
UPDATE stores s
SET nvr_eol_date = m.eol_date,
    nvr_eos_date = m.eos_date
FROM nvr_models m
WHERE s.nvr_model = m.model_number
  AND (s.nvr_eol_date IS DISTINCT FROM m.eol_date
       OR s.nvr_eos_date IS DISTINCT FROM m.eos_date);
```

## 8. UI 連携 (詳細は ui-mockups.md)

| 画面 | 表示要素 |
|---|---|
| `/stores` 一覧 | 各行に「ライフサイクルバッジ」(ok / warning / urgent / eos) |
| `/stores/[id]` 詳細 | 「機材ライフサイクル」カード (機種・FW・導入日・残期間・進捗バー) |
| `/infra` ダッシュボード | EOL アラートサマリカード (urgent: N件 / eos: M件) |
| `/infra/lifecycle` (新規) | 機種別の更新計画一覧、Excel エクスポート |

## 9. 確定事項と未確定事項

### 確定済

- [x] `stores` カラム追加 SQL
- [x] `nvr_models` マスタテーブル
- [x] 自動同期トリガ
- [x] アラート閾値ロジック (`v_store_nvr_lifecycle`)
- [x] TypeScript 型定義
- [x] 集計クエリパターン

### Phase 0 で要決定

- [ ] サンプル機種データの正確な EOL/EOS 日付 (i-PRO 公式に要照会)
- [ ] 更新履歴テーブル `store_nvr_history` の要否 (Phase 2 想定)
- [ ] 監査ログ統合 (NVR 変更を `audit_logs` に記録するか)

### Phase 2 で着手

- [ ] FW リリース管理 (`known_firmware_versions` テーブル)
- [ ] 「置換計画推奨」店舗から見積もり画面への導線
- [ ] 顧客 IT 担当向け Excel エクスポート

## 10. 関連ドキュメント

- `nvr-adapter-design.md` — capability で UI 出し分け
- `firmware-capability-matrix.md` — FW Ver 検出 (本ドキュメントの `nvr_fw_version` を埋めるロジック)
- `ui-mockups.md` — 上記スキーマを表示する UI の具体形
