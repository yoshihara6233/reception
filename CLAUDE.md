
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
