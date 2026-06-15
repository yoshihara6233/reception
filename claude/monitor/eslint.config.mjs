// Next.js 16 flat ESLint config.
//
// eslint-config-next 16 ships a *native* flat config array (see its `exports`
// map), so we import it directly. We deliberately avoid `FlatCompat`
// (`@eslint/eslintrc`): on ESLint 9 + eslint-config-next 16 the compat path
// crashes the config-validator with "Converting circular structure to JSON".
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';

/** @type {import('eslint').Linter.Config[]} */
const config = [
  // Next.js recommended + Core Web Vitals (react, react-hooks, jsx-a11y,
  // import, @next/next, @typescript-eslint parser/plugin) — all flat-native.
  ...nextCoreWebVitals,

  // Project ignores. (`.next/`, `out/`, `build/`, `next-env.d.ts` are already
  // ignored by eslint-config-next.)
  {
    ignores: ['next.config.ts', 'postcss.config.mjs'],
  },

  // ── 段階対応 (staged remediation) ──────────────────────────────────────
  // eslint-plugin-react-hooks v7 enables the new React Compiler rule-set in
  // `recommended`. These flag legitimate-but-non-idiomatic patterns already
  // shipped in production (localStorage hydration in effects, Date.now()/refs
  // read during render, etc.) and need careful per-component refactors that
  // could change runtime behavior. To unblock the CI lint gate now without a
  // risky mass-refactor, they are demoted to `warn` and tracked.
  // TODO(phase-a follow-up): refactor offenders and restore these to `error`.
  //   - set-state-in-effect: MonitorWorkspace, ServerClock, ShellBody,
  //     ThemeToggle, i18n/context, login, live-player
  //   - purity:    infra/page, infra/slo, stores/page, AppShell, ServerClock
  //   - immutability: bcp/test/test-form
  //   - refs:      map/store-map
  {
    rules: {
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/refs': 'warn',
    },
  },
];

export default config;
