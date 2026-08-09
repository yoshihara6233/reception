/**
 * 変異テスト（mutation testing）の設定。
 *
 * ── 何をするものか ──────────────────────────────────────────────────────
 * 実装をわざと少しずつ壊し（`>` を `>=` に、`&&` を `||` に、条件を `true` に…）、
 * **テストが気づくか**を機械的に測る。気づかなければその変異は「生き残った」＝
 * その行はテストで守られていない。カバレッジが「実行されたか」しか見ないのに対し、
 * こちらは「壊したら落ちるか」を見る。
 *
 * ── なぜ入れたか ────────────────────────────────────────────────────────
 * 2026-08-09、webhook のフェイルクローズを**正規表現でソースの形から**検査して
 * いたが、壊した実装（`if (!secret) { /* 何もしない *\/ } else {`）が素通りした。
 * 検査そのものが嘘をついていた。以降その日の作業では 11 通りの変異を手でかけて
 * 確認したが、手作業は続かない。機械にやらせる。
 *
 * ── 対象の選び方 ────────────────────────────────────────────────────────
 * 全部にかけると遅すぎて誰も回さなくなる。**間違えると権限・署名・可用性が
 * 壊れるもの**に絞る。UI や整形処理は対象外——そこは変異が生き残っても困らない。
 *
 * 実行は週次（CI）と手動。PR ごとには回さない（数分かかるため）。
 *   bun run test:mutation                 全対象
 *   bun run test:mutation -- --mutate src/lib/tenant/**   一部だけ
 */
export default {
  packageManager: 'npm',           // bun は未対応。インストールはしないので実害なし
  testRunner: 'vitest',
  // bun の node_modules は実体が .bun/ 配下にあり、Stryker の既定の
  // プラグイン探索（node_modules/@stryker-mutator/* の走査）が空振りする。
  // 明示すると通常の import 解決に乗るので、素直に指定する。
  plugins: ['@stryker-mutator/vitest-runner'],
  vitest: { configFile: 'vitest.config.ts' },
  reporters: ['html', 'clear-text', 'progress'],
  htmlReporter: { fileName: 'reports/mutation/index.html' },

  // 各テストがどのコードを通るかを先に測り、変異ごとに関係するテストだけ回す。
  // これが無いと 1 変異ごとに全 439 件を実行することになり、桁違いに遅い。
  coverageAnalysis: 'perTest',

  concurrency: 4,
  timeoutMS: 20_000,

  /**
   * 対象。**認可・署名・可用性**に関わるものだけを並べる。
   * ここに足すときは「壊れたら何が起きるか」を言えること。
   */
  mutate: [
    // 誰がどのテナント・店舗を見られるか（越権の中心）
    'src/lib/tenant/*.ts',
    // session.ts は request 単位のキャッシュ包み（Supabase 呼び出しの薄いラッパ）で、
    // 分岐が実質無い。変異させてもモックを突くだけのテストしか生まれないため外す。
    // **判断ロジックを足したらここから外すこと。**
    '!src/lib/tenant/session.ts',
    'src/lib/admin/user-scope.ts',
    'src/lib/admin/super-admin-floor.ts',
    'src/lib/admin/enrollment.ts',
    'src/lib/edge/view-access.ts',
    'src/lib/edge/auth-provision.ts',
    'src/middleware.ts',

    // 署名・トークン（偽造されると境界が無意味になる）
    'src/lib/live-sign.ts',
    'src/lib/storage/edge-images-sign.ts',
    'src/lib/auth/token-cache.ts',
    'src/lib/baggage/kiosk-pin.ts',
    'src/lib/rate-limit.ts',

    // 発令・監視の判定（誤ると誤発報 or 見逃し）
    'src/lib/bcp/intensity.ts',
    'src/lib/ops/partition-health.ts',
    'src/lib/ops/tunnel-health.ts',
    'supabase/functions/jalert-poller/match.ts',

    // テスト自身は変異させない
    '!src/**/*.test.ts',
  ],

  /**
   * しきい値。**2026-08-09 の実測 69.98% を基準に置いた**もので、理想値ではない。
   *
   * `break` の役目は「回帰を捕まえること」で、目標を掲げることではない。
   * 実測値ちょうどに置くと変異の揺らぎで落ちるので、少し下にとる。
   * 上げるのは歓迎。**下げるときは理由をここに書くこと。**
   *
   * 現状の内訳（低い順・次に手を入れるならこの順）:
   *   edge/auth-provision.ts   11%  … 62 変異がテストに触れられていない
   *   edge/view-access.ts      33%  … 35 変異が同上（エッジ視聴の認可）
   *   storage/edge-images-sign 42%  … 20 変異が同上（署名付き URL）
   *   admin/super-admin-floor  70%
   *   jalert-poller/match.ts   74%
   */
  thresholds: { high: 85, low: 70, break: 65 },

  // 生き残っても意味の無い変異を最初から作らない。
  // （ログ文字列の中身が変わってもテストが落ちないのは当然で、指摘されても直せない）
  disableTypeChecks: false,
  ignorers: [],
  tempDirName: '.stryker-tmp',
}
