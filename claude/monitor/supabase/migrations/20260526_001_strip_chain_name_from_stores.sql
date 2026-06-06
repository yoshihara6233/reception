-- Remove chain name prefix "ウェルシア" / "ウェルシア薬局" from store names.
-- Before: "ウェルシア薬局 横浜西口店"
-- After:  "横浜西口店"
UPDATE stores
SET name = trim(regexp_replace(name, 'ウェルシア薬局?\s*', '', 'g'))
WHERE name LIKE '%ウェルシア%';
