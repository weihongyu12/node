---
title: Lint
description: Node.js 服务端 ESLint 与 TypeScript 配置——统一代码风格与质量门禁
---

# Lint

代码检查在提交前与 CI 中双重执行，确保风格统一、缺陷前置拦截。

## ESLint

沿用与前两篇文档一致的 Airbnb 体系（`eslint-config-airbnb-extended`），叠加 Node.js 平台规则与安全规则：

```bash
pnpm add -D eslint @eslint/js typescript-eslint eslint-config-airbnb-extended \
  eslint-plugin-unicorn @eslint-community/eslint-plugin-eslint-comments \
  eslint-plugin-promise eslint-plugin-regexp eslint-plugin-jsdoc \
  eslint-plugin-n eslint-plugin-security globals
```

```js
// eslint.config.mjs
import eslint from '@eslint/js';
import { configs, plugins } from 'eslint-config-airbnb-extended';
import unicorn from 'eslint-plugin-unicorn';
import comments from '@eslint-community/eslint-plugin-eslint-comments/configs';
import promise from 'eslint-plugin-promise';
import regexp from 'eslint-plugin-regexp';
import jsdoc from 'eslint-plugin-jsdoc';
import node from 'eslint-plugin-n';
import security from 'eslint-plugin-security';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'eslint.config.mjs'] },
  eslint.configs.recommended,
  plugins.stylistic,
  plugins.importX,
  ...configs.base.recommended,
  unicorn.configs.recommended,
  promise.configs['flat/recommended'],
  regexp.configs.recommended,
  comments.recommended,
  ...jsdoc.configs['flat/recommended-typescript'],
  plugins.typescriptEslint,
  ...configs.base.typescript,
  ...tseslint.configs.recommendedTypeChecked,
  ...node.configs['flat/recommended-module'],
  security.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.vitest },
      sourceType: 'module',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      'unicorn/prevent-abbreviations': 'off',
      'unicorn/no-array-for-each': 'off',
      'unicorn/no-array-reduce': 'off',
      'unicorn/no-null': 'off',

      'n/no-missing-import': 'off',
      'n/no-unpublished-import': 'off',

      'class-methods-use-this': 'off',
      '@typescript-eslint/no-extraneous-class': 'off',

      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
    },
  },
);
```

:::tip[参见]
- [Node.js 规则](../../specification/rule/n/README.md)：`eslint-plugin-n` 平台规则
- [安全规则](../../specification/rule/security/README.md)：`eslint-plugin-security` 安全规则
- [Node.js 规范](../../specification/code/node/README.md)：规则对应的编码实践
:::

:::warning[NestJS 与类型检查的平衡]
NestJS 重度依赖装饰器与元数据，部分 `typescript-eslint` 严格规则（如 `no-unsafe-*`）会产生大量误报。按项目实际情况选择性降级为 `warn` 或关闭，保留核心安全规则。
:::

## lint-staged + husky

```bash
pnpm add -D lint-staged husky
pnpm exec husky init
```

```json
// package.json
{
  "lint-staged": {
    "*.ts": ["eslint --fix"]
  }
}
```

```bash
# .husky/pre-commit
pnpm exec lint-staged
```

## TypeScript

```json
// tsconfig.json
{
  "compilerOptions": {
    "module": "commonjs",
    "declaration": false,
    "removeComments": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "allowSyntheticDefaultImports": true,
    "target": "ES2023",
    "sourceMap": true,
    "outDir": "./dist",
    "baseUrl": "./",
    "incremental": true,
    "skipLibCheck": true,
    "strictNullChecks": true,
    "noImplicitAny": true,
    "forceConsistentCasingInFileNames": true,
    "paths": {
      "@/*": ["src/*"]
    }
  }
}
```

- `strict` 系列选项全开，类型零错误是 CI 门禁
- `emitDecoratorMetadata` 与 `experimentalDecorators` 为 NestJS 必需
