import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// monitor unit tests run in node (pure lib/logic). Component/DB tests come later
// (jsdom + a real Supabase test DB — see Phase A staging-DB task).
export default defineConfig({
  // tsconfig の `@/*` → `src/*` と同じ解決。これが無いと、`@/` を1つでも import する
  // モジュールはテストから読めない（解決不能で suite ごと落ちる）。
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // `import 'server-only'` は Next のビルド時ガード用のマーカーで、実体は
      // node_modules に無い（Next が解決する）。vitest からはそのままだと
      // 「Cannot find package 'server-only'」で suite ごと落ちるため、空実装へ逃がす。
      // これが無いと server-only を付けたモジュールは一切テストできない。
      'server-only': fileURLToPath(new URL('./src/test/server-only-stub.ts', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
  },
})
