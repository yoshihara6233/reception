import { defineConfig } from 'vitest/config'

// RLS メタ検査専用設定。**本番と同じ migration を当てた DB** が必要なので、
// 手書き近似スキーマで走る authz（vitest.authz.config.ts）とも、DB 不要の
// 通常 vitest（src/**）とも分離する。
//
//   bunx supabase start && bunx supabase db reset
//   bun run test:rls-meta
//
// CI は e2e job（同じローカル Supabase を立てる）の中で走らせる。
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/rls-meta/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
