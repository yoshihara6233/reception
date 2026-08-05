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
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
  },
})
