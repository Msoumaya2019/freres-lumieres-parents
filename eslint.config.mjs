import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Configuration ESLint de base du monorepo.
 *
 * Volontairement minimale : elle ne fait pas de vérification de types
 * (celle-ci est assurée par `npm run typecheck`), ce qui la rend rapide
 * en CI. Chaque application peut l'étendre avec ses propres règles
 * (par exemple `eslint-config-next` pour l'admin).
 */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/lib/**',
      '**/.next/**',
      '**/.expo/**',
      '**/coverage/**',
      '**/*.config.js',
      '**/*.config.mjs',
      '**/next-env.d.ts',
      '**/expo-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      eqeqeq: ['error', 'always'],
      'prefer-const': 'error',
    },
  },
);
