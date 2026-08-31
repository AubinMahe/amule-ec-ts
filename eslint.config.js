import js from '@eslint/js';
import ts from 'typescript-eslint';
import sonarjs from 'eslint-plugin-sonarjs';
import jsdoc from 'eslint-plugin-jsdoc';
import commentLength from 'eslint-plugin-comment-length';
import globals from 'globals';

const namingConvention = [
   'error',
   { selector: 'default', format: ['camelCase'], leadingUnderscore: 'allow' },
   { selector: 'import', format: ['camelCase', 'PascalCase'] },
   { selector: 'variable', format: ['camelCase', 'UPPER_CASE', 'PascalCase'], leadingUnderscore: 'allow' },
   { selector: 'classProperty', modifiers: ['static', 'readonly'], format: ['camelCase', 'UPPER_CASE'] },
   { selector: 'classProperty', format: ['camelCase'], leadingUnderscore: 'allow' },
   { selector: 'typeLike', format: ['PascalCase'] },
   { selector: 'enumMember', format: ['PascalCase', 'UPPER_CASE'] },
   { selector: 'objectLiteralProperty', format: null },
   { selector: 'typeProperty', format: null },
];

const commonRules = {
   "sonarjs/no-commented-code": "off",
   "sonarjs/constructor-for-side-effects": "off",
   curly: ['error', 'all'],
   'comment-length/limit-single-line-comments': ['error', { maxLength: 100 }],
   'comment-length/limit-multi-line-comments': ['error', { maxLength: 100 }],
   'jsdoc/multiline-blocks': ['error', { noSingleLineBlocks: true }],
   '@typescript-eslint/explicit-function-return-type': 'error',
   '@typescript-eslint/restrict-template-expressions': [
      'error', {
         allowNumber: true,
         allowBoolean: true,
         allowAny: true,
         allowNullish: true,
      },
   ],
   '@typescript-eslint/naming-convention': namingConvention,
};

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
   {
      plugins: { jsdoc, "comment-length": commentLength },
   },
   ...ts.configs.strictTypeChecked,
   ...ts.configs.stylisticTypeChecked,
   {
      files: [
         './src/**/*.ts'
      ],
      languageOptions: {
         parser: ts.parser,
         parserOptions: {
            project: [
               './tsconfig.src.json'
            ],
            tsconfigRootDir: import.meta.dirname,
         },
      },
      rules: commonRules,
   },
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
      rules: commonRules,
   }
);
