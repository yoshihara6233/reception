import { defineConfig } from 'vitest/config'

// authz 契約テスト専用設定。実DB(Postgres)が必要なため、通常の `vitest run`
// (src/** ・DB不要) とは分離する。CI は postgres サービス + DATABASE_URL で実行。
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/authz/**/*.authz.test.ts'],
    // スキーマ適用→シードを beforeAll で逐次行うため、ファイル間並列は無効化。
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
