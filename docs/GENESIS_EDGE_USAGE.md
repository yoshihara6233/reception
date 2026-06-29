# Genesis Edge デザインシステム — 利用ガイド

> 開発環境に常駐させる前提の実装リファレンスです。
> 視覚（色・型・余白・コンポーネント）はすべて本システムに従います。独自の色・フォント・余白を発明しません。

---

## 0. 前提

- ブランド：**ジェネシス・エッジ（Genesis Edge）** — 生成AI × 現場の B2B SaaS。
- トーン：落ち着いた先輩エンジニアが現場の担当者に語りかける。信頼感 × 機敏さ。
- 言語：日本語メイン。「です・ます」調で統一。UI ラベル・ボタンは体言止め（例：受付を開始 / ログを確認）。
- フォント・ロゴは**暫定**（Google Fonts 代替）。本番資産が決まり次第差し替えます。

---

## 1. セットアップ

`<head>` でトークン CSS を一度だけ読み込みます。

```html
<link rel="stylesheet" href="./design-system/colors_and_type.css">
```

フォントは同 CSS が `@import` で読み込み済み（Inter Tight / Noto Sans JP / IBM Plex Mono / Noto Serif JP）。

---

## 2. カラー（紙 × 墨 × 藍の三色）

| トークン | 値 | 役割 |
|---|---|---|
| `--ge-paper` | `#F7F5F1` | ページ背景（和紙） |
| `--ge-paper-2` | `#EFEBE3` | 淡いパネル・交互行 |
| `--ge-paper-3` | `#E4DED3` | 区切り面 |
| `--ge-ink` | `#0F0F10` | 主要テキスト |
| `--ge-ink-2` | `#2A2A2C` | 二次テキスト |
| `--ge-ink-3` | `#5B5B5F` | キャプション |
| `--ge-line` | `#D6CFC1` | 1px ボーダー |
| `--ge-line-2` | `#B9B0A0` | hover・選択ボーダー |
| `--ge-accent` | `#2C4A7E` | 藍（アクセント / CTA / リンク） |
| `--ge-accent-soft` | `#E4EAF3` | 選択行・ピル背景 |
| `--ge-success` / `--ge-warning` / `--ge-danger` | `#2F7A4F` / `#B5761A` / `#A3332B` | セマンティック |
| `--ge-dark-bg` | `#0E1013` | 管制・夜間ダーク UI |
| `--ge-dark-accent` | `#6A90C8` | ダーク上の藍 |

**規律：一画面で藍を使う要素は 2〜3 まで。** グラデーション禁止。情報はタイポと配置で区別します。

```css
.panel { background: var(--ge-paper); color: var(--ge-ink); border: 1px solid var(--ge-line); }
```

---

## 3. タイポグラフィ

- 本文・UI：**Noto Sans JP**（400 / 500 / 700）、line-height 1.6、`palt` 有効
- 見出し（欧文混じり）：**Inter Tight** 600、tracking -0.02em
- 数字・コード：**IBM Plex Mono**、tabular-nums
- セリフ（限定）：**Noto Serif JP** — 章扉・引用のみ
- スケール（px）：`11 / 12 / 13 / 14 / 16 / 20 / 24 / 32 / 44 / 64`（4px グリッド）

型クラス：`.ge-h1` `.ge-h2` `.ge-h3` `.ge-h4` `.ge-body` `.ge-body-sm` `.ge-caption` `.ge-overline` `.ge-mono` `.ge-num`

```html
<h2 class="ge-h2">巡回ルートを編集</h2>
<p class="ge-body">現場の手順を変えずに、記録と通知だけを自動化します。</p>
<span class="ge-num">1,234 件</span>
```

---

## 4. 形状・状態

| 項目 | ルール |
|---|---|
| 角丸 | ボタン/入力/タグ `4px`、カード `6px`、モーダル `10px`。完全な丸はアバター・ドット・数値バッジのみ |
| ボーダー | 1px ソリッド。点線・破線はデータ区切りを除き不可 |
| 影 | カードは影なし × 1px ボーダー。影はフロート要素（ドロップダウン・モーダル・トースト）のみ。色味なし |
| Hover | 背景を 4% 暗く、または `--ge-accent-ink` に。opacity 変化は使わない |
| Press | `translateY(1px)` + 1px inset、影を薄く |
| Focus | `--ge-shadow-focus`（藍 25% の 3px リング） |
| Disabled | 40% 不透明 + `cursor: not-allowed`、hover なし |
| Selected | 背景 `--ge-accent-soft` + 左端 2px `--ge-accent` |
| モーション | ease `cubic-bezier(0.2,0.8,0.2,1)`、`120ms`/`180ms`/`320ms`。fade + 4px translate が基本。バウンス・ブラー禁止 |

カードに**色付き左ボーダー強調は使いません**。

---

## 5. レイアウト

- 最大幅 `1200px`、ガター `24px`、12 カラム
- アプリ UI：固定サイドバー `240px` × 固定ヘッダー `56px`
- 行高：密な表 `36px` / 標準 `44px` / 快適 `52px`

---

## 6. アイコン

- セット：**Lucide**（1.5px ストローク、24px グリッド、角丸スクエア、単色 `currentColor`）
- サイズ：ツールバー `24px` / ボタン内 `20px` / インライン `16px`
- **ラベルなしアイコン単体は避ける**（操作者は現場職員）。装飾アイコン・カラフルアイコン・絵文字は使いません。

```html
<script src="https://unpkg.com/lucide@latest"></script>
<script>lucide.createIcons();</script>
<i data-lucide="shield" style="width:20px;height:20px;color:var(--ge-accent)"></i>
```

よく使う対応：受付=`package`/`truck` 呼び出し=`bell` 検品=`scan-line` 巡回=`route`/`map-pin` 警備=`shield` 映像=`video`/`cctv` 管制=`activity`/`gauge`

### ブランド専用アイコン — 録画モニター（recording monitor / B3）

seed square モチーフ（画面右下の切り欠き + 藍）を取り込んだ専用案。録画状態を藍のドットで示します。24px グリッド・1.5px ストローク準拠。

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none"
     stroke="currentColor" stroke-width="1.5"
     stroke-linecap="round" stroke-linejoin="round"
     style="color: var(--ge-ink)">
  <path d="M21 12.5V17H16.5Z" fill="var(--ge-accent)" stroke="none"/>
  <path d="M3 4H21V12.5L16.5 17H3Z"/>
  <path d="M12 17v4"/>
  <path d="M8 21h8"/>
  <circle cx="6.6" cy="7" r="1.5" fill="var(--ge-accent)" stroke="none"/>
</svg>
```

ダーク UI では `color: var(--ge-dark-ink)` / 藍は `var(--ge-dark-accent)` に差し替えます。

---

## 7. コピーの規約

| 項目 | ルール | 例 |
|---|---|---|
| 数字 | 半角・三桁カンマ・単位前に半角スペース | `1,234 件` / `3 分前` |
| 和文中の英数 | 半角 | `AI を活用した` |
| カタカナ固有名 | 中黒（・）区切り | ジェネシス・エッジ |
| 日付 | `YYYY/MM/DD` | `2026/04/21` |
| 時刻 | 24時間・半角コロン | `14:32` |

- 二人称「あなた」は使わず、職種または「現場」と表現。
- 機能を擬人化しない（×「AI が賢く判断」→ ○「自動で処理します」）。
- 絵文字は原則不使用。`✓`/`×` は Lucide アイコンに置換。

**Do / Don't**：現場（○）/ フィールド（×）｜受付（○）/ インテーク（×）｜失敗しました（○）/ エラーが発生しました（×）

---

## 8. やらないこと（チェックリスト）

- 独自の色・フォント・余白の発明
- グラデーション / ノイズ / グレイン / frosted glass（ブラー）
- 手描き SVG イラスト・装飾アイコン・絵文字
- カードの持ち上げ（hover で translateY）・色付き左ボーダー
- 一画面に藍を 4 箇所以上

---

_本システムは起業準備中のプロトタイプです。ロゴ・専用フォント・プロダクト写真は確定次第差し替えてください。_
