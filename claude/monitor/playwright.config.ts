import { defineConfig, devices } from '@playwright/test'

/**
 * ロール別の画面境界を実ブラウザで確かめる E2E。
 *
 * ── なぜ dev サーバを使うか ────────────────────────────────────────────
 * `next build` した成果物を起動するほうが速いが、**古いビルドのまま緑になる**
 * 事故が起きる（テストは通るのにコードは直っていない）。ここで守りたいのは
 * 権限境界なので、「今のソース」を必ず見ていることを優先する。初回アクセスの
 * コンパイル待ちは navigationTimeout で吸収する。
 *
 * ── 前提 ──────────────────────────────────────────────────────────────
 *   bunx supabase start        # ローカルスタック（Docker 必要）
 *   bunx supabase db reset     # migration 適用
 *   bun run e2e                # ← ここから。seed は globalSetup が当てる
 *
 * dev の常用ポート(3200)とは別のポートを使う。開発中の dev サーバを
 * 巻き込んで落とさないため。
 */

const PORT = Number(process.env.E2E_PORT ?? 3210)
// **localhost であること。127.0.0.1 にしてはいけない。**
// Next 16 の dev サーバは自分が名乗るホスト以外からの `/_next/*` を
// 「クロスオリジン」として遮断する。127.0.0.1 で開くと HMR クライアントの
// 読み込みごと失敗し、**ページがハイドレーションされない**（フォームは
// React ではなく素の HTML として送信され、テストは原因不明の形で落ちる）。
const BASE_URL = `http://localhost:${PORT}`

export default defineConfig({
  // Playwright は設定ファイルを CJS へ変換して読むため、import.meta は使えない。
  // 相対パスはこのファイルからの解決になる。
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  // 権限境界のテストは「たまたま通る」を許さない。CI では retry しない。
  retries: 0,
  // ロール間に依存は無いので並列で良い。ただし dev サーバのコンパイルが
  // 直列なので、詰め込みすぎても速くならない。
  workers: process.env.CI ? 2 : 4,
  forbidOnly: !!process.env.CI,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: BASE_URL,
    // dev の初回コンパイルは数秒かかる。ここをケチると「遅いだけ」の失敗が出る。
    navigationTimeout: 45_000,
    actionTimeout: 15_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
  },

  projects: [
    // 6 ロール分ログインして storageState を保存する。**この project 自体が
    // 「全ロールがログインできる」ことのテスト**を兼ねる（2026-08-09 に
    // baggage_manager が DB 制約の欠落でログイン以前に作成できなかった）。
    { name: 'setup', testMatch: /auth\.setup\.ts$/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
      testIgnore: /auth\.setup\.ts$/,
    },
  ],

  webServer: {
    command: `bash scripts/e2e-dev.sh ${PORT}`,
    url: `${BASE_URL}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
