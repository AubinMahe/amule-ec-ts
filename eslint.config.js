import js from '@eslint/js';
import ts from 'typescript-eslint';
import sonarjs from 'eslint-plugin-sonarjs';
import globals from 'globals';

export default ts.config(
   {
      "ignores": [
         '**/dist/**',
         '**/node_modules/**',
         '*.config.js',
      ]
   },
   js.configs.recommended,
   sonarjs.configs.recommended,
   {
      languageOptions: {
         ecmaVersion: 2024,
         sourceType: 'module',
         globals: {
            ...globals.node,
         },
      },
   },
   ...ts.configs.strictTypeChecked,
   ...ts.configs.stylisticTypeChecked,
   {
      files: [
         './src/**/*.ts',
         './tests/**/*.ts'
      ],
      languageOptions: {
         parser: ts.parser,
         parserOptions: {
            project: [
               './tsconfig.tests.json'
            ],
            tsconfigRootDir: import.meta.dirname,
         },
      },
      rules: {
         "sonarjs/no-commented-code": "off",
         "sonarjs/constructor-for-side-effects": "off",
         '@typescript-eslint/explicit-function-return-type': 'error',
         '@typescript-eslint/restrict-template-expressions': [
            'error', {
               allowNumber: true,
               allowBoolean: true,
               allowAny: true,
               allowNullish: true,
            },
         ],
      },
   }
);
