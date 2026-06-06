# Operational Runbooks

F104 で各アラートに対応する手順書を完成させる。

## ファイル命名
- `<alert-name>.md` (例: `edge-offline.md`, `bcp-failed.md`)
- Grafana アラートの `runbook_url` から直接リンク

## テンプレート
- 症状
- 根本原因の見つけ方
- 一次対応
- 二次対応 (エスカレーション基準)
- 関連 dashboard / log query
- 過去のインシデント
