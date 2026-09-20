import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'docs']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    files: ['packages/contracts/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['@evolution/core', '@evolution/harness', '@evolution/adapters', '@/*', 'react', 'react-dom', '@supabase/*', '@vercel/*'],
          message: 'contracts is the innermost shared language and cannot depend on UI, domain, harness or infrastructure.',
        }],
      }],
      'no-restricted-globals': ['error', 'window', 'localStorage', 'indexedDB', 'fetch'],
    },
  },
  {
    files: ['packages/core/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['@evolution/harness', '@evolution/adapters', '@/*', 'react', 'react-dom', '@supabase/*', '@vercel/*'],
          message: 'core is pure Evolution Domain logic and cannot depend on execution hosts or infrastructure.',
        }],
      }],
      'no-restricted-globals': ['error', 'window', 'localStorage', 'indexedDB', 'fetch'],
    },
  },
  {
    files: ['packages/harness/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['@evolution/adapters', '@/*', 'react', 'react-dom', '@supabase/*', '@vercel/*'],
          message: 'harness may depend on contracts/core only; infrastructure must be injected through ports/tools.',
        }],
      }],
      'no-restricted-globals': ['error', 'window', 'localStorage', 'indexedDB', 'fetch'],
    },
  },
  {
    files: ['packages/adapters/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['@/*'],
          message: 'adapters cannot depend on the React application. Move shared contracts/domain code into packages first.',
        }],
      }],
    },
  },
])
