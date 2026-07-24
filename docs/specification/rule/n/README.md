---
title: Node.js 规则
description: Node.js 平台 ESLint 规则，基于 eslint-plugin-n，覆盖模块系统、回调与异步、进程全局与版本兼容性
---

# Node.js 规则

## eslint-plugin-n

[eslint-plugin-n](https://github.com/eslint-community/eslint-plugin-n) 是 ESLint 官方的 Node.js 规则插件（fork 自停止维护的 `eslint-plugin-node`），提供模块解析、依赖声明、进程 API、版本兼容性等 Node.js 平台专属检查，是服务端项目的必装插件。

:::tip[版本要求]
- `eslint-plugin-n@18.x`：Node.js `^20.19.0 || ^22.13.0 || >=24.0.0`，ESLint `>= 8.57.1`
- 建议在 `package.json` 声明 `engines.node`，`no-unsupported-features/*` 规则据此判断 API 可用性
:::

```js
// eslint.config.mjs（本项目实际配置节选）
import node from 'eslint-plugin-n';

export default [
  // ...其他配置
  node.configs['flat/recommended-module'],
  {
    rules: {
      // Node 插件在 TS 环境下的路径兼容（由 tsc 与 importX 接管）
      'n/no-missing-import': 'off',
      'n/no-unpublished-import': 'off',
    },
  },
];
```

:::warning[项目调整]
- `n/no-missing-import`、`n/no-unpublished-import` 在 TypeScript 项目关闭：`@/` 别名与 `.ts` 扩展解析超出插件静态分析能力，由 `tsc` 与 `eslint-plugin-import-x` 接管
- 预设 `recommended-module` 视所有文件为 ES Module；CommonJS 项目改用 `recommended-script`
:::

### 模块系统

| 规则名称 | 错误级别 | 配置选项 | 描述 |
|---|---|---|---|
| [n/exports-style](https://github.com/eslint-community/eslint-plugin-n/blob/master/docs/rules/exports-style.md) | off | 🔧 可修复 | 统一 `module.exports` 与 `exports` 的使用风格 |
| [n/file-extension-in-import](https://github.com/eslint-community/eslint-plugin-n/blob/master/docs/rules/file-extension-in-import.md) | off | 🔧 可修复 | 强制 `import` 声明中文件扩展名的书写风格 |
| [n/global-require](https://github.com/eslint-community/eslint-plugin-n/blob/master/docs/rules/global-require.md) | off | - | 强制 `require()` 置于模块顶层作用域 |
| [n/no-exports-assign](https://github.com/eslint-community/eslint-plugin-n/blob/master/docs/rules/no-exports-assign.md) | error | - | 禁止对 `exports` 直接赋值（会导致引用断裂） |
| [n/no-extraneous-import](https://github.com/eslint-community/eslint-plugin-n/blob/master/docs/rules/no-extraneous-import.md) | error | - | 禁止 `import` 未在 `package.json` 声明的依赖 |
| [n/no-extraneous-require](https://github.com/eslint-community/eslint-plugin-n/blob/master/docs/rules/no-extraneous-require.md) | error | - | 禁止 `require` 未在 `package.json` 声明的依赖 |
| [n/no-missing-import](https://github.com/eslint-community/eslint-plugin-n/blob/master/docs/rules/no-missing-import.md) | off | - | 禁止 `import` 无法解析的模块（TS 项目关闭，由 `tsc` 接管） |
| [n/no-missing-require](https://github.com/eslint-community/eslint-plugin-n/blob/master/docs/rules/no-missing-require.md) | error | - | 禁止 `require` 无法解析的模块 |
| [n/no-mixed-requires](https://github.com/eslint-community/eslint-plugin-n/blob/master/docs/rules/no-mixed-requires.md) | off | - | 禁止 `require` 调用与普通变量声明混合 |
| [n/no-new-require](https://github.com/eslint-community/eslint-plugin-n/blob/master/docs/rules/no-new-require.md) | off | - | 禁止对 `require()` 使用 `new` 操作符 |
| [n/no-restricted-import](https://github.com/eslint-community/eslint-plugin-n/blob/master/docs/rules/no-restricted-import.md) | off | 模块清单 | 禁止 `import` 指定模块（按项目清单配置） |
| [n/no-restricted-require](https://github.com/eslint-community/eslint-plugin-n/blob/master/docs/rules/no-restricted-require.md) | off | 模块清单 | 禁止 `require` 指定模块（按项目清单配置） |
| [n/no-unpublished-bin](https://github.com/eslint-community/eslint-plugin-n/blob/master/docs/rules/no-unpublished-bin.md) | off | - | 禁止 `bin` 指向 npm 发布时被忽略的文件 |
| [n/no-unpublished-import](https://github.com/eslint-community/eslint-plugin-n/blob/master/docs/rules/no-unpublished-import.md) | off | - | 禁止 `import` 不会随包发布的模块（TS 项目关闭） |
| [n/no-unpublished-require](https://github.com/eslint-community/eslint-plugin-n/blob/master/docs/rules/no-unpublished-require.md) | error | - | 禁止 `require` 不会随包发布的模块 |
| [n/prefer-node-protocol](https://github.com/eslint-community/eslint-plugin-n/blob/master/docs/rules/prefer-node-protocol.md) | off | 🔧 可修复 | 内置模块导入强制使用 `node:` 协议前缀 |

### 回调与异步

| 规则名称 | 错误级别 | 配置选项 | 描述 |
|---|---|---|---|
| [n/callback-return](https://github.com/eslint-community/eslint-plugin-n/blob/master/docs/rules/callback-return.md) | off | - | 强制回调执行后跟随 `return` 语句 |
| [n/handle-callback-err](https://github.com/eslint-community/eslint-plugin-n/blob/master/docs/rules/handle-callback-err.md) | off | - | 强制处理回调中的错误参数 |
| [n/no-callback-literal](https://github.com/eslint-community/eslint-plugin-n/blob/master/docs/rules/no-callback-literal.md) | off | - | 强制遵循 error-first 回调约定 |
| [n/no-sync](https://github.com/eslint-community/eslint-plugin-n/blob/master/docs/rules/no-sync.md) | off | - | 禁止同步方法（如 `fs.readFileSync`）阻塞事件循环 |
| [n/no-top-level-await](https://github.com/eslint-community/eslint-plugin-n/blob/master/docs/rules/no-top-level-await.md) | off | - | 禁止发布模块中的顶层 `await` |
| [n/prefer-promises/dns](https://github.com/eslint-community/eslint-plugin-n/blob/master/docs/rules/prefer-promises/dns.md) | off | - | 强制使用 `dns.promises` 而非回调版本 |
| [n/prefer-promises/fs](https://github.com/eslint-community/eslint-plugin-n/blob/master/docs/rules/prefer-promises/fs.md) | off | - | 强制使用 `fs.promises` 而非回调版本 |

### 进程与全局

| 规则名称 | 错误级别 | 配置选项 | 描述 |
|---|---|---|---|
| [n/no-path-concat](https://github.com/eslint-community/eslint-plugin-n/blob/master/docs/rules/no-path-concat.md) | off | - | 禁止 `__dirname`/`__filename` 与字符串直接拼接路径 |
| [n/no-process-env](https://github.com/eslint-community/eslint-plugin-n/blob/master/docs/rules/no-process-env.md) | off | - | 禁止使用 `process.env`（项目约定走 `ConfigService`，见[编码规范](../../code/README.md)） |
| [n/no-process-exit](https://github.com/eslint-community/eslint-plugin-n/blob/master/docs/rules/no-process-exit.md) | error | - | 禁止使用 `process.exit()`（官方文档不推荐） |
| [n/process-exit-as-throw](https://github.com/eslint-community/eslint-plugin-n/blob/master/docs/rules/process-exit-as-throw.md) | error | - | 要求 `process.exit()` 与 `throw` 处于同一代码路径 |
| [n/hashbang](https://github.com/eslint-community/eslint-plugin-n/blob/master/docs/rules/hashbang.md) | error | 🔧 可修复 | 强制正确使用 hashbang（`#!`），且与文件实际可执行性一致 |
| [n/prefer-global/buffer](https://github.com/eslint-community/eslint-plugin-n/blob/master/docs/rules/prefer-global/buffer.md) | off | - | 统一使用全局 `Buffer` 或显式引入，不混用 |
| [n/prefer-global/console](https://github.com/eslint-community/eslint-plugin-n/blob/master/docs/rules/prefer-global/console.md) | off | - | 统一使用全局 `console` 或显式引入，不混用 |
| [n/prefer-global/crypto](https://github.com/eslint-community/eslint-plugin-n/blob/master/docs/rules/prefer-global/crypto.md) | off | - | 统一使用全局 `crypto` 或显式引入，不混用 |
| [n/prefer-global/process](https://github.com/eslint-community/eslint-plugin-n/blob/master/docs/rules/prefer-global/process.md) | off | - | 统一使用全局 `process` 或显式引入，不混用 |
| [n/prefer-global/text-decoder](https://github.com/eslint-community/eslint-plugin-n/blob/master/docs/rules/prefer-global/text-decoder.md) | off | - | 统一使用全局 `TextDecoder` 或显式引入，不混用 |
| [n/prefer-global/text-encoder](https://github.com/eslint-community/eslint-plugin-n/blob/master/docs/rules/prefer-global/text-encoder.md) | off | - | 统一使用全局 `TextEncoder` 或显式引入，不混用 |
| [n/prefer-global/timers](https://github.com/eslint-community/eslint-plugin-n/blob/master/docs/rules/prefer-global/timers.md) | off | - | 统一使用全局定时器函数或显式引入，不混用 |
| [n/prefer-global/url](https://github.com/eslint-community/eslint-plugin-n/blob/master/docs/rules/prefer-global/url.md) | off | - | 统一使用全局 `URL` 或显式引入，不混用 |
| [n/prefer-global/url-search-params](https://github.com/eslint-community/eslint-plugin-n/blob/master/docs/rules/prefer-global/url-search-params.md) | off | - | 统一使用全局 `URLSearchParams` 或显式引入，不混用 |

### 版本兼容性

| 规则名称 | 错误级别 | 配置选项 | 描述 |
|---|---|---|---|
| [n/no-deprecated-api](https://github.com/eslint-community/eslint-plugin-n/blob/master/docs/rules/no-deprecated-api.md) | error | - | 禁止已弃用的 Node.js API（如 `new Buffer()`） |
| [n/no-unsupported-features/es-builtins](https://github.com/eslint-community/eslint-plugin-n/blob/master/docs/rules/no-unsupported-features/es-builtins.md) | error | - | 禁止目标 Node.js 版本不支持的 ES 内置对象 |
| [n/no-unsupported-features/es-syntax](https://github.com/eslint-community/eslint-plugin-n/blob/master/docs/rules/no-unsupported-features/es-syntax.md) | error | `{ ignores: ['modules'] }` | 禁止目标版本不支持的 ES 语法（`recommended-module` 忽略 modules） |
| [n/no-unsupported-features/node-builtins](https://github.com/eslint-community/eslint-plugin-n/blob/master/docs/rules/no-unsupported-features/node-builtins.md) | error | - | 禁止目标 Node.js 版本不支持的内置 API |

:::tip[版本判定来源]
`no-unsupported-features/*` 按以下优先级确定支持的 Node.js 版本：规则 `version` 选项 → ESLint `settings.node.version` → `package.json` `engines` 字段 → 默认 `>=16.0.0`。**务必在 `package.json` 声明 `engines.node`**。
:::

### 已弃用

| 规则名称 | 状态 | 替代方案 |
|---|---|---|
| [n/no-hide-core-modules](https://github.com/eslint-community/eslint-plugin-n/blob/master/docs/rules/no-hide-core-modules.md) | ❌ 已弃用 | `n/no-missing-import` / `n/no-missing-require` |
| [n/shebang](https://github.com/eslint-community/eslint-plugin-n/blob/master/docs/rules/shebang.md) | ❌ 已弃用 | `n/hashbang` |
