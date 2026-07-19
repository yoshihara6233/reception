-- 社員コードの店舗内一意制約を active な従業員のみに限定（実機E2Eで発覚）
--
-- 「登録抹消」は履歴参照のため行を残す設計（status='inactive'）だが、
-- M1 の部分一意インデックスが inactive 行にも効いていたため、抹消済み従業員の
-- 社員コードを同じ店舗で再登録できなかった（一覧は active のみ表示のため
-- 「誰もいないのにコードが重複」に見える）。
-- 履歴行はコードを保持したまま、active 同士でのみ重複を禁止する。

DROP INDEX IF EXISTS idx_employees_store_code;
CREATE UNIQUE INDEX idx_employees_store_code
  ON public.employees(store_id, employee_code)
  WHERE employee_code IS NOT NULL AND status = 'active';
