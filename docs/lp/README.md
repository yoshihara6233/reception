# Recording Monitor — Landing Page 作成案

> Genesis Edge (https://www.genesis-edge.com/) と同じデザイントークンを流用した、
> Recording Monitor 製品紹介ランディングページの提案。

## ファイル

| ファイル | 用途 |
|---|---|
| `recording-monitor-lp.html` | 完成版 LP (単一 HTML ファイル) |
| `README.md` | 本ファイル (設計意図と構成説明) |

## プレビュー方法

```bash
# 1. ブラウザで直接開く
open docs/lp/recording-monitor-lp.html

# 2. ローカルサーバ経由 (推奨。Google Fonts が確実に読み込まれる)
cd docs/lp && python3 -m http.server 8090
# → http://localhost:8090/recording-monitor-lp.html
```

---

## デザイン方針 — Genesis Edge テイスト踏襲

### 色 (完全に同じトークンを使用)

| 用途 | 値 | 命名 |
|---|---|---|
| 背景 (paper) | `#F7F5F1` | 暖かみのあるオフホワイト |
| 背景 2 | `#EFEBE3` | セクション境界 |
| ink (文字) | `#0F0F10` | 限りなく黒に近いグレー |
| ink-3 | `#5B5B5F` | サブテキスト |
| line | `#D6CFC1` | 罫線 |
| **accent (藍)** | `#2C4A7E` | アクセントカラー (リンク、強調) |
| accent-soft | `#E4EAF3` | hero のグラデーション背景 |

### フォント (完全に同じ)

- **JP**: `Noto Sans JP` (400/500/700)
- **Latin (英数字)**: `Inter Tight` (400/500/600/700)
- **Mono (コード/数値)**: `IBM Plex Mono` (400/500/600)

### 装飾要素 (Genesis Edge 流用)

- `─` ダッシュによる eyebrow 区切り
- `●` ドットの "realtime" マーク (緑 pulse アニメーション)
- `01 / 02 / 03` の番号付き見出し
- 罫線 + 余白による「紙のような」セクション区切り
- 控えめなグリッド背景 (hero 部のみ)

---

## ページ構成 (8 セクション)

| # | セクション | 内容 | 行動目標 |
|---|---|---|---|
| 1 | **HEADER** | ロゴ + ナビ + 右上 CTA | 直帰防止 |
| 2 | **HERO** | キャッチコピー + リード + 2 CTA + ダッシュボードモック | スクロール促進 |
| 3 | **PROBLEM** | 3 つの "Pain" カード | 自分ごと化 |
| 4 | **CAPABILITIES** | 3 つの解決原則 | 解決策提示 |
| 5 | **PRODUCTS** | Live / BCP / Security Patrol の 3 プロダクト | 機能訴求 |
| 6 | **VENDORS** | 10 ベンダー対応マトリックス | 信頼性訴求 |
| 7 | **ARCHITECTURE** | 各店モード ／ 中央集約モードの 2 構成 | 技術アピール |
| 8 | **METRICS** | 4 つの大きな数字 (10000 stores / 99.9% SLO 等) | スケール訴求 |
| 9 | **CTA** | お問い合わせ + デモ依頼 | コンバージョン |
| 10 | **FOOTER** | リンク 4 列 + 法務 | 補助情報 |

---

## キーコピー (案)

### Hero
- **メイン**: `現場の "目" を、止めない。`
- **サブ**: 既存の NVR を入れ替えずに、10,000 店舗の録画を 1 画面で監視。
- **CTA**: `製品を見る →` / `デモを依頼する`

### Problem section
- **見出し**: 多店舗の録画運用は、"見えない" のが当たり前になっていませんか。
- **Pain 01**: "止まったまま" を、誰も知らない。
- **Pain 02**: 機種がバラバラで、束ねられない。
- **Pain 03**: 新規 NVR への入替コストが膨大。

### Capabilities (3 原則)
- **01 既存活用**: NVR を、買い替えない。
- **02 マルチベンダー**: 1 つの画面に、10 ベンダーを。
- **03 クラウドネイティブ**: 10,000 店舗を、スケールする。

### CTA section
- **見出し**: "見えない録画" を、今日から、見えるものに。
- **サブ**: 既存 NVR の機種一覧をお預かりすれば、互換性チェックを 1 営業日でお返しします。

---

## カスタマイズしやすいポイント

差し替えやすく作ってあります:

| 変えたい | どこを編集 |
|---|---|
| キャッチコピー | `<section class="hero">` 内の `<h1>` |
| 数字 (10 / 10000 / 99.9) | `.metrics-grid` 内の `.metric .v` |
| ベンダーロゴ追加 | `.vendor-grid` に `<div class="vendor-cell">` を追加 |
| ダッシュボード画像差し替え | `.hero-visual` を実 PNG/SVG に差し替え |
| カラー全体変更 | `:root` の `--ge-*` 変数 |
| 法人ロゴ差し替え | `.logo` 内の `<span class="mark">` を SVG に |

---

## モバイル対応

| breakpoint | 対応 |
|---|---|
| 980 px 以下 | hero/products を 1 列、ナビリンクは縮退 |
| 600 px 以下 | グリッドを 2→1 列、フッターを単列 |

---

## 次のステップ (作り込み案)

優先順位順:

1. **実写スクリーンショット**: `.hero-visual` のモックを、実際の Monitor UI のスクショに差し替え
2. **ロゴ確定**: 仮の「●」マークを、ブランドロゴ (SVG) に差し替え
3. **動画/GIF**: hero に 5-10 秒の操作デモ動画を埋め込み
4. **事例セクション**: 導入事例 3 つ (匿名でも) を `PRODUCTS` の後ろに追加
5. **価格表**: PoC / Standard / Enterprise の 3 プラン表
6. **資料 DL ゲート**: Whitepaper / 仕様書 v5.0 PDF のフォーム付き DL
7. **日英 2 言語切替**: Genesis Edge と同じ右上に言語スイッチを設置
8. **Open Graph**: Twitter Card / OGP メタタグの追加
9. **アクセシビリティ**: コントラスト比検証、`prefers-reduced-motion` 対応
10. **アナリティクス**: GA4 / Plausible / Mixpanel のタグ埋め込み

---

## 関連ドキュメント

- `docs/recorder-monitoring-spec.html` — 製品仕様書 v5.0
- `docs/tier3/vendor-support-matrix.md` — 10 ベンダー対応詳細
- `docs/tier3/nvr-adapter-design.md` — アダプタアーキテクチャ
