-- 来店者管理: person_type カラム追加
-- visitors テーブルを「来店者管理」として拡張する
-- person_type: 'visitor' (一般来訪者) | 'employee' (従業員) | 'external' (外部登録者)

ALTER TABLE visitors
  ADD COLUMN IF NOT EXISTS person_type TEXT NOT NULL DEFAULT 'visitor'
    CHECK (person_type IN ('visitor', 'employee', 'external')),
  ADD COLUMN IF NOT EXISTS employee_code TEXT,        -- 従業員番号 (任意)
  ADD COLUMN IF NOT EXISTS notes TEXT,                -- メモ
  ADD COLUMN IF NOT EXISTS is_registered BOOLEAN NOT NULL DEFAULT false; -- 事前登録済みフラグ

-- インデックス
CREATE INDEX IF NOT EXISTS visitors_person_type_idx ON visitors (tenant_id, person_type);
CREATE INDEX IF NOT EXISTS visitors_employee_code_idx ON visitors (tenant_id, employee_code) WHERE employee_code IS NOT NULL;
