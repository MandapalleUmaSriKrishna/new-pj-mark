import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

/**
 * Flat ESLint config for the whole monorepo.
 *
 * Rules are deliberately few but meaningful: the TypeScript recommended set
 * (which catches the real bug classes - floating promises, accidental `any`,
 * misused promises), plus a handful of project-specific guards. Formatting is
 * Prettier's job, so eslint-config-prettier disables every stylistic rule.
 */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/playwright-report/**',
      'apps/web/public/sw.js',
      'apps/web/next-env.d.ts',
      '**/*.snap',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.es2024,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'warn',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      eqeqeq: ['error', 'smart'],
    },
  },
  {
    // Type-aware rules, scoped to application sources: they need a TS project
    // and catch the bug classes that matter in async Nest/React code.
    files: ['apps/api/src/**/*.ts', 'apps/web/src/**/*.{ts,tsx}', 'packages/shared/src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
    },
  },
  {
    // Browser-facing code gets DOM globals; scripts get Node only.
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
  {
    files: [
      'scripts/**/*.{js,mjs}',
      '*.config.{js,mjs,ts}',
      'apps/api/**/*.spec.ts',
      'apps/api/test/**/*',
    ],
    languageOptions: {
      globals: { ...globals.node, ...globals.jest },
    },
    rules: {
      'no-console': 'off',
    },
  },
  {
    files: ['apps/web/**/*.test.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.jest },
    },
  },
);
