import { defineConfig } from 'vitest/config'

// monitor unit tests run in node (pure lib/logic). Component/DB tests come later
// (jsdom + a real Supabase test DB — see Phase A staging-DB task).
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
  },
})
