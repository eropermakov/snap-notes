import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

export default tseslint.config(
  { ignores: ['out/**', 'release/**', 'node_modules/**', 'integrations/**', 'scripts/**', '*.config.*', 'src/main/vendor/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.ts'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // The code base marks intentionally unused values with a leading underscore.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-empty-function': 'off',
      // Existing, deliberate code: non-breaking spaces handled as text, control characters stripped by sanitizers,
      // and two @ts-ignore lines in the preload typing shim.
      'no-irregular-whitespace': ['error', { skipStrings: true, skipRegExps: true, skipTemplates: true, skipComments: true }],
      'no-control-regex': 'off',
      '@typescript-eslint/ban-ts-comment': ['error', { 'ts-ignore': false }],
      'no-empty': ['error', { allowEmptyCatch: true }]
    }
  }
)
