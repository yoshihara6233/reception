# TODOS

## gstack デザイナー（AIモックアップ）のセットアップ
- **What:** OpenAI API キーを設定し `~/.claude/skills/gstack/design/dist/design setup` を実行して、AIモックアップ生成を有効化する。
- **Why:** 2026-07-18 の手荷物検査 /plan-design-review でキー未設定のため AI モックアップが使えず、手組み HTML ワイヤーで代替した。iPad の独自トーン（D11決定: Genesis Edge に縛らない）を実装する前に、複数案のビジュアル比較ボード（評価・コメント・リミックス付き）で見た目を確定したい。
- **Pros:** 複数スタイル案の並列生成と比較ボードでの選定ができ、視覚の合意形成が速い。
- **Cons:** OpenAI API の従量課金が発生。キーの取得・貼付は手作業。
- **Context:** 手組みワイヤー（承認済み）は `~/.gstack/projects/yoshihara6233-reception/designs/baggage-ipad-exit-20260718/wireframe-board.html`。構造はこのワイヤーで確定済みで、残るのは iPad のビジュアルトーンのみ。
- **Depends on / blocked by:** OpenAI API キー（ユーザー作業）。
