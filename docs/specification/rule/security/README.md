---
title: 安全规则
description: Node.js 服务端安全 ESLint 规则，基于 eslint-plugin-security，拦截代码层常见安全反模式
---

# 安全规则

## eslint-plugin-security

[eslint-plugin-security](https://github.com/eslint-community/eslint-plugin-security) 是 Node.js 安全规则插件，在代码层拦截常见安全反模式：正则拒绝服务（ReDoS）、命令注入、时序攻击、弱随机数、对象注入等。它与运行时防护（Helmet、限流、参数校验）互补——运行时防线在外，静态分析防线在代码内。

```js
// eslint.config.mjs（本项目实际配置节选）
import security from 'eslint-plugin-security';

export default [
  // ...其他配置
  security.configs.recommended,
];
```

:::warning[误报处理]
插件全部规则默认为 `warn` 而非 `error`——安全检测基于模式匹配，存在合理误报（如内部可信路径的 `fs` 操作）。处理原则：**优先调整代码消除告警**；确属误报的单行使用 `// eslint-disable-next-line security/{规则名}` 并附注释说明，禁止整文件禁用。
:::

### 代码执行与注入

| 规则名称 | 错误级别 | 配置选项 | 描述 |
|---|---|---|---|
| [security/detect-eval-with-expression](https://github.com/eslint-community/eslint-plugin-security/blob/main/docs/rules/detect-eval-with-expression.md) | warn | - | 检测 `eval()` 中使用非字面量表达式，防止代码注入 |
| [security/detect-child-process](https://github.com/eslint-community/eslint-plugin-security/blob/main/docs/rules/detect-child-process.md) | warn | - | 检测 `child_process` 调用（`exec`/`spawn`），防止命令注入 |
| [security/detect-non-literal-require](https://github.com/eslint-community/eslint-plugin-security/blob/main/docs/rules/detect-non-literal-require.md) | warn | - | 检测非字面量的 `require()` 调用，防止任意模块加载 |
| [security/detect-non-literal-fs-filename](https://github.com/eslint-community/eslint-plugin-security/blob/main/docs/rules/detect-non-literal-fs-filename.md) | warn | - | 检测非字面量的 `fs` 文件路径，防止路径遍历攻击 |
| [security/detect-object-injection](https://github.com/eslint-community/eslint-plugin-security/blob/main/docs/rules/detect-object-injection.md) | warn | - | 检测以用户输入作为对象键的读写，防止原型污染与对象注入 |

### 正则安全

| 规则名称 | 错误级别 | 配置选项 | 描述 |
|---|---|---|---|
| [security/detect-unsafe-regex](https://github.com/eslint-community/eslint-plugin-security/blob/main/docs/rules/detect-unsafe-regex.md) | warn | - | 检测可导致指数级回溯的正则（ReDoS），如嵌套量词 `(a+)+` |
| [security/detect-non-literal-regexp](https://github.com/eslint-community/eslint-plugin-security/blob/main/docs/rules/detect-non-literal-regexp.md) | warn | - | 检测以非字面量构造 `RegExp`，防止用户输入注入正则 |

### 密码学与时序

| 规则名称 | 错误级别 | 配置选项 | 描述 |
|---|---|---|---|
| [security/detect-pseudoRandomBytes](https://github.com/eslint-community/eslint-plugin-security/blob/main/docs/rules/detect-pseudoRandomBytes.md) | warn | - | 检测 `crypto.pseudoRandomBytes()`，应改用 `crypto.randomBytes()` |
| [security/detect-possible-timing-attacks](https://github.com/eslint-community/eslint-plugin-security/blob/main/docs/rules/detect-possible-timing-attacks.md) | warn | - | 检测敏感值的 `==`/`===` 比较，应改用 `crypto.timingSafeEqual()` |

### API 误用

| 规则名称 | 错误级别 | 配置选项 | 描述 |
|---|---|---|---|
| [security/detect-new-buffer](https://github.com/eslint-community/eslint-plugin-security/blob/main/docs/rules/detect-new-buffer.md) | warn | - | 检测 `new Buffer()`（已弃用），应改用 `Buffer.from()`/`Buffer.alloc()` |
| [security/detect-buffer-noassert](https://github.com/eslint-community/eslint-plugin-security/blob/main/docs/rules/detect-buffer-noassert.md) | warn | - | 检测 Buffer 读写中的 `noAssert: true`，防止越界读写 |
| [security/detect-bidi-characters](https://github.com/eslint-community/eslint-plugin-security/blob/main/docs/rules/detect-bidi-characters.md) | warn | - | 检测 Unicode 双向控制字符，防止“特洛伊源码”攻击 |

### Web 中间件（Express 场景）

| 规则名称 | 错误级别 | 配置选项 | 描述 |
|---|---|---|---|
| [security/detect-no-csrf-before-method-override](https://github.com/eslint-community/eslint-plugin-security/blob/main/docs/rules/detect-no-csrf-before-method-override.md) | warn | - | 检测 CSRF 中间件注册在 `method-override` 之后，防止防护被绕过 |
| [security/detect-disable-mustache-escape](https://github.com/eslint-community/eslint-plugin-security/blob/main/docs/rules/detect-disable-mustache-escape.md) | warn | - | 检测 Mustache 模板关闭 HTML 转义，防止 XSS |

:::tip[NestJS 适用性说明]
- `detect-no-csrf-before-method-override`、`detect-disable-mustache-escape` 面向 Express 中间件与模板渲染场景；纯 API 服务（无服务端模板）通常不触发，无需处理
- `detect-child-process` 在运维脚本中属合理使用，按误报流程单行豁免即可
:::

:::tip[参见]
- [功能设计 · 安全基线](../../../features/security/README.md)：运行时防护（Helmet、CORS、限流、校验、脱敏）
- [Node.js 规范 · 安全编码](../../code/node/README.md)：安全规则对应的编码实践
:::
