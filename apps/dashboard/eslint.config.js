import js from '@eslint/js';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'playwright-report', 'test-results', 'public'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.strict, jsxA11y.flatConfigs.recommended],
    languageOptions: { ecmaVersion: 2023, globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'jsx-a11y/label-has-associated-control': ['error', { assert: 'either', depth: 4 }],
    },
  },
  // Demo and Live data sources must never import each other (blueprint: never mix
  // synthetic and live data). Shared code lives in src/api and src/types.
  {
    files: ['src/modes/live/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/modes/demo/**', '@/modes/demo/**'],
              message: 'Live mode must never import Demo Mode code or fixtures.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/modes/demo/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/modes/live/**', '@/modes/live/**'],
              message: 'Demo Mode must never import Live mode code.',
            },
          ],
        },
      ],
    },
  },
  // Tests may assert on known fixture shapes.
  {
    files: ['**/*.test.{ts,tsx}', 'src/test/**'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
  // shadcn/ui primitives export variants alongside components.
  { files: ['src/components/ui/**'], rules: { 'react-refresh/only-export-components': 'off' } },
  {
    files: ['*.config.{js,ts}', 'e2e/**'],
    languageOptions: { globals: globals.node },
  },
);
