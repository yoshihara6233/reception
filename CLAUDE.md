
## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
- Save progress, checkpoint, resume → invoke checkpoint
- Code quality, health check → invoke health

## デザイン基本（Genesis Edge デザインシステム）★最優先で従う

**本開発の視覚（色・型・余白・コンポーネント）はすべて Genesis Edge デザインシステムに従う。**
正本: **`docs/GENESIS_EDGE_USAGE.md`**（UI を触る前に必ず読む）。独自の色・フォント・余白を発明しない。

要点（詳細は正本）:
- **三色**: 紙 `#F7F5F1`(--ge-paper) × 墨 `#0F0F10`(--ge-ink) × 藍 `#2C4A7E`(--ge-accent)。
  **一画面で藍は2〜3要素まで・グラデーション禁止。** semantic: 成功`#2F7A4F`/警告`#B5761A`/危険`#A3332B`。ダーク: bg`#0E1013`/藍`#6A90C8`。
- **タイポ**: 本文 Noto Sans JP / 欧文見出し Inter Tight / 数字・コード IBM Plex Mono(tabular)。スケール 11/12/13/14/16/20/24/32/44/64（4pxグリッド）。
- **形状**: 角丸=ボタン/入力/タグ4px・カード6px・モーダル10px。カードは影なし×1pxボーダー（影はフロート要素のみ）。**色付き左ボーダー強調は使わない**。selected=`--ge-accent-soft`+左2px藍。
- **アイコン**: Lucide(1.5px ストローク・currentColor)。ラベルなし単体アイコン/絵文字/カラフルアイコン禁止。ブランド専用「録画モニター」アイコン（右下切り欠き＋藍ドット）の SVG が正本§6 にある＝現行のヘッダー/PWAアイコンと同意匠。
- **コピー**: です・ます調、UIラベルは体言止め。数字は半角三桁カンマ＋単位前に半角スペース(`1,234 件`)。二人称「あなた」不可→職種/「現場」。機能を擬人化しない。
- **やらない**: 独自トークン発明 / グラデ・ノイズ・blur(frosted glass) / 手描きSVG・装飾アイコン・絵文字 / カード持ち上げhover / 藍4箇所以上。

注: アプリは現状 Tailwind トークン実装。`--ge-*` への完全移行は段階的（未完）だが、**新規 UI・改修は本基本に合わせる**こと。`#2C4A7E` 藍と `#F7F5F1` 紙は既に整合済み。

## Intereco プロジェクト状況（2026-06-13 更新）

**本番公開済み**: `https://intereco-monitor.vercel.app`（Vercel project `intereco-monitor`・本番ブランチ `monitor-prod`・reception と独立）。
作業worktree: `/Users/junji.y/claude/Intereco/monitor-recover`。詳細な引き継ぎは **`docs/SESSION-HANDOFF.md`** を参照（次回はまずこれを読む）。
実装の落とし穴は **`.claude/skills/intereco-patterns/SKILL.md`** に集約。計画一式は `docs/*.md` と `docs/recorder-monitoring-spec.html`(v6.0)。

**現在地**: 本番稼働（実機PoC1台・ローカル/リモート両対応・認証付き・再起動耐性あり）。開発計画フェーズ完了。

**次タスク（優先順）**:
1. ベンダ統合（config②の核）: グリッド非Frigate対応 / VODアダプタ統合(i-PRO ONVIF) / Univiewアダプタ / 3社実機検証
2. 基盤(M0): CI・エッジ/トンネル死活監視+アラート・環境分離・鍵運用の同期自動化
3. マルチグリッド16/32/48 / ユニット別ティア課金 / SFU(LiveKit Cloud)ベータ / エッジ量産

**セキュリティ宿題**: service_role secret 鍵 と ログインPW `Intereco2026` が前チャットに残存 → 鍵再ローテ推奨（Vercel と **エッジ.env 両方**更新）。
