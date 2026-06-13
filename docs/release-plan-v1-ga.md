# Intereco v1 GA 顧客本番リリース計画（eng-review 反映版）

作成: 2026-06-14 / レビュー: plan-eng-review + Outside Voice(Claude) 実施済み
前提: 第1号店=i-PRO / GA目標=2026年10月(スパイクで再評価) / SLA=best-effort(数値はGA後) / 体制3〜5名
基礎WBS: `docs/wbs-dev-test-plan.md`(218人日・M0〜M5) / 落とし穴: `.claude/skills/intereco-patterns/SKILL.md`

> このドキュメントは前バージョン（プローズ計画）を **supersede** する。WBSの詳細工数はそちらを参照。

## 0. レビューで確定した重要判断（前提を動かしたもの）

| # | 判断 | 効果 |
|---|---|---|
| T1 | **Frigateを1号店から外し i-PRO直結**（エッジ=ONVIF/RTSP中継+cloudflared） | 構成矛盾・A/B検証・運用リスクが消滅。grid/liveスナップはi-PRO経由に統一 |
| 1 | **i-PRO ONVIF VOD を Phase A でスパイク** → 結果でGA日程確定 | 最大リスクを前段で退治。Oct維持/Nov戻しを根拠で判断 |
| T2 | **SLAは録画/監視を分離 + 1号店はbest-effort**、99%数値はGA後実測後に提示 | 測定根拠なき契約数値を回避。監視/DRは「測る・戻す」目的で維持 |
| T3 | **軽量OTA(edge-agent+cloudflared)をGAに残す**（Frigate分は不要に） | 多店舗展開への布石。Frigate除外で対象2点に軽量化 |
| 4 | **ロール別authz契約テストを常設化**(CI必須・G1ブロッカー) | 今日のadmin_users越権バグを恒久的に再発防止 |
| 5 | **G1テストは高価値3本に絞り、網羅は継続** | テスト基盤ゼロからの全量前倒しでクリティカルパスの人手を奪わない |
| T4 | **Oct目標・スパイクで再評価** | 前倒しの勢いを保ちつつ、VOD実機結果で現実調整 |

## 0.5 CEO レビュー追補（2026-06-14・SELECTIVE EXPANSION）

eng-review に続き plan-ceo-review + Outside Voice を実施。前提と順序を確定し、スケールの種を cherry-pick。

| # | CEO判断 | 効果 |
|---|---|---|
| D1 | **1号店=i-PRO は顧客制約（既設NVR）**。NVR差し替え系は除外 | 前提を固定 |
| D2 | **監視プレーン先行GA + VODファストフォロー**: GAは i-PRO のライブ/グリッド/BCP/アラート/高画質。録画再生(VOD)はGA直後2〜4週で追加。当面はi-PRO NVR純正で確認 | 唯一のクリティカルパス(VOD)をGAゲートから外す→10月の確度向上 |
| TC1 | **1号店はSaaS GAとして貫く**（有償PoC扱いにしない） | 期待値・品質要求を最初から背負う |
| C1 | **テナント分離の堅牢化 + テナント次元のauthz契約テスト**をGAに追加 | 5000店・代理店経由の越権リスクをデータ増前に潰す |
| C2 | **エッジQR初回自動登録の最小版**をGAに追加 | 店2〜Nのオンボーディングが同一経路 |
| C3 | **計測イベントスキーマ(視聴/同時/遅延/稼働)をday1**でGAに追加 | SLA数値化・SFUサイジングの根拠を店1から取得 |
| TC3 | **監視中断の顧客向け見える化**をGAに追加（"黙って落ちない"設計） | best-effort SLAの信頼を守る |

**未解決（要・営業/顧客と確定）**: 1号店は「本部監視=ライブ商品」向けか「防犯=録画商品」向けか。買い手タイプでVOD後回しの妥当性が変わる（Outside Voice (a)）。

**⚠️ 最大リスク（容量）**: VODをGAゲートから外した一方で C1/C2/C3 + OTA + TC3 を追加。体制3〜5名・10月。**容量超過→日程滑り→契約テストが削られる**のが最悪経路。**G1で「ロール別/テナント次元のauthz契約テストは削らない」を不可侵条件**にする。QR/OTAが容量を圧迫するなら、ここを真っ先に2号店直前へ送る（テストは死守）。

**スケール楔の注記（Outside Voice (c)）**: この入口が学ぶのは主に「i-PRO中継技術」。5000店の最大の不確実性=流通(代理店が売るか/支払額)は別途・並行で検証すること。

## 1. リリース定義（v1 GA スコープ）

**含む（GAブロッカー）**
- i-PRO で grid / live(MJPEG) / **VOD(ONVIF Profile-G)** / BCP 全成立（実機UAT）
- セッション上限強制・レコーダ管理UI（SQL直編集の撤廃）・MJPEG帯域自動劣化
- 監視/アラート（heartbeat断・トンネル断 5分内通知）・環境分離・鍵ローテ無停止同期
- **RLS全表監査 + ロール別authz契約テスト**・Vault化・脆弱性診断・DR訓練1回
- 軽量OTA(edge-agent+cloudflared) + known-goodロールバック手順

**GA後に送る（descope）**
- Uniview統合 / Frigate再導入(検知が要る店向け) / SFU(LiveKit Cloud) / マルチグリッド32/48
- ティア課金 / SSO / 10k台・100同時の負荷試験 / OTA自動配信の本格化

## 2. ゲート方式ロードマップ

```
 今(G0)        G1            G2              G3               G4=GA
  │  Phase A   │  Phase B    │  Phase C      │  Phase D       │
  PoC─製品化基盤─i-PRO本番化──セキュリティ硬化/運用──顧客パイロット→本番
 6月   │6–7月   │ 7–9月       │ 8–10月(並行)  │ 9–10月          │ 10月(スパイクで再評価)
 即手配 ▲i-PRO実機  ▲脆弱性診断業者(往復2-3週分の枠)
```

| Gate | 時期 | Go/No-Go 判定 |
|---|---|---|
| **G1 製品化基盤** | 7月末 | CIゲート緑必須・staging分離・エッジ/トンネル死活5分内通知・鍵ローテ無停止・**RLS全表監査クリア**・ロール別authz契約テスト緑・**i-PRO VODスパイクのgo/no-go判定**（=GA日程の確定点） |
| **G2 i-PRO本番化** | 9月中旬 | **i-PRO実機で grid/live/BCP 全成立**（VODはGAゲート外＝ファストフォロー）・テナント分離+authz契約テスト緑・QR初回登録・計測スキーマ・セッション上限・レコーダUIでSQL直編集撤廃 |
| **GA後・即** | GA+2〜4週 | **i-PRO VOD（録画再生）ファストフォロー**・VODアダプタ共通IF（C4・TODOS） |
| **G3 セキュリティ/運用** | 9月末 | 脆弱性診断 重大ゼロ(or是正済・再診断済)・Vault化・DR訓練1回完了・SLA定義書/データ保持方針 顧客合意 |
| **G4 GA** | 10月(目標) | 1店実地構築・顧客UAT合格・canary 72h異常なし・OTAロールバック検証済 |

## 3. フェーズ別の中身

**Phase A 製品化基盤（最優先）**
- CI(PR必須:typecheck/lint/build/test) / **i-PRO VODスパイク**（実機入手後すぐ・最重要）
- 環境分離 dev/staging/prod・Supabase staging・seed
- エッジ/トンネル死活監視＋アラート / 鍵ローテ無停止同期（今日の事故の恒久対策）
- **RLS全表監査** + ロール別authz契約テスト（CI必須）

**Phase B i-PRO本番化**
- **i-PRO ONVIF VOD統合**（クリティカルパス）・i-PROグリッドスナップ（Frigate無しでload-bearing）
- セッション上限強制・レコーダ管理UI・MJPEG帯域自動劣化

**Phase C セキュリティ硬化＋運用（Bと並行）**
- ✅済: service_role鍵・ログインPW ローテ（宿題クローズ）
- Vault化（カメラ認証平文撤廃）・公開面防御の継続検証・**脆弱性診断（6月に発注・往復2-3週・G3に再診断完了）**
- データガバナンス(保持31日・アクセス記録)・SLA定義書・Runbook・構築手順・オペレータマニュアル・**DR訓練1回**

**Phase D 顧客パイロット→GA**
- 1店実地構築（i-PRO中継+named tunnel+Access・手動構築でOK）・顧客UAT・診断再実施・canary→Go

## 4. テスト計画（ゲート直結）

**G1ブロッカー（高価値3本）**
1. CIゲート（typecheck/lint/build/unit）必須緑
2. **ロール別authz契約テスト**（各ロールで「見える/見えない」をDB契約で検証）＋ **ロール別可視範囲のUI到達 E2E smoke**（admin_users越権バグはUI経路でも再発し得るため、契約テストだけでは不足）
3. edge-agent 状態機械 unit（heartbeat/grid・鍵ローテ後の再接続回帰を含む）

**継続（G1ゲートにしない）**: 残りのunit網羅・結合・VOD/grid/liveの実機UAT(G2)・BCP回帰。
**性能**: 1店/同時3は負荷トリビアル。負荷試験はGA後スケール時。

## 5. NOT in scope（検討した上で意図的に外す）
- Uniview統合 — 1号店i-PROのため不要。GA後。
- Frigate（検知/ローカル録画） — i-PROが録画/VODを持つため1号店では冗長(T1)。検知が要る店向けにGA後。
- SFU(LiveKit Cloud) — 同時3視聴に不要。100店以降。
- マルチグリッド32/48・ティア課金・SSO — スケール/課金フェーズ。
- エッジ量産自動化・OTA自動配信 — 1店は手動+軽量OTAで足りる。多店舗時。
- SLA数値コミット — 実測根拠ができるGA後に数値化(T2)。
- 10k台/100同時の負荷試験 — GA後スケール。

## 6. What already exists（再利用）
- i-PROアダプタ層（手厚い・ただしVOD未統合）→ Phase B VODはこの層に追加。
- named tunnel + Access（PoC実証済）→ 1店構築に流用。
- BCP/Resend（本番稼働）→ 回帰のみ。パスワードリセットも本番済。
- 詳細WBS(218人日)→ 工数の原資。intereco-patterns→落とし穴の既知集。

## 7. Failure modes（クリティカルギャップ）
| コードパス | 失敗 | テスト | エラー処理 | ユーザ可視 | 状態 |
|---|---|---|---|---|---|
| i-PRO VOD(ONVIF Profile-G) | 機種がProfile-G非対応で再生不成立 | スパイク(Phase A) | replay抽出で代替設計 | 明示 | スパイクで退治予定 |
| i-PRO grid snapshot | スナップ取得失敗でグリッド空白(Frigateフォールバック無し) | G2実機UAT | **要: 失敗時プレースホルダ+再試行** | 要明示 | **⚠️ 新規ギャップ(T1の代償)** |
| 鍵ローテ後エッジ無接続 | heartbeat全停止(silent) | edge回帰 | 監視アラート(G1) | アラートで検知 | 対処済 |
| 軽量OTA 不良更新 | 店舗監視盲目 | OTA検証(G3) | known-goodロールバック手順 | 監視で検知 | 対処予定 |
| RLS authz 越権 | 他テナント可視/不可視 | 契約テスト+UI E2E(G1) | コード認可+RLS | — | 対処済 |

**新規クリティカルギャップ**: Frigate除外で i-PRO grid snapshot が単一依存に。失敗時のプレースホルダ/再試行UXをPhase Bに明示的に入れること。

## 8. リスク
| リスク | 影響 | 対策 |
|---|---|---|
| i-PRO実機の入手遅延 | Phase B/スパイク着手不可→GA遅延 | **今週調達**・代替に開発用ONVIFカメラで先行 |
| 体制3〜5名にバッファ無し | 夏季休暇/手戻り/実機故障で遅延 | Oct目標はスパイク後に確定(T4)・OTAも重ければGA外の分岐を持つ |
| 脆弱性診断の往復 | G3直撃 | 6月発注・再診断2-3週をG3前に確保 |
| i-PRO grid 単一依存(T1代償) | グリッド空白 | 失敗時UX(プレースホルダ/再試行)をPhase Bに明示 |

## 9. 並列レーン（worktree並列の目安）
| レーン | 内容 | 依存 |
|---|---|---|
| Lane A (Edge/Infra) | i-PRO VODスパイク→VOD統合・gridスナップ・軽量OTA | 実機 |
| Lane B (Platform) | CI・RLS監査・authz契約テスト・環境分離・鍵同期 | — |
| Lane C (Frontend) | レコーダ管理UI・セッション上限UI・MJPEG劣化・E2E smoke | Bの一部 |
| Lane D (Sec/Ops) | Vault・診断手配・Runbook・DR訓練・SLA定義 | 並行 |

実行: A+B+D を並行で開始。Cは B(authz/CI)着手後。G2はAの実機結果に律速。
