---
title: Node.js 规范
description: Node.js 服务端编码规范，覆盖模块系统、异步模式、进程管理与安全编码，配套 eslint-plugin-n 与 eslint-plugin-security
---

import TOCInline from '@theme/TOCInline';

# Node.js 规范

本文档为 Node.js 服务端项目提供统一的编码约定，聚焦 Node.js 平台特性与服务端安全两个维度。规范与 [eslint-plugin-n](../../rule/n/README.md)、[eslint-plugin-security](../../rule/security/README.md) 规则一一对应，通用语言层面约定（变量、类型、注释等）见[编码规范](../README.md)。

<TOCInline toc={toc} />

## 1. 模块系统 (Modules)

1.1 导入 Node.js 内置模块必须使用 `node:` 协议前缀，明确区分内置模块与第三方包。

:::tip[建议 👍]
```ts
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
```
:::

:::danger[不建议 👎]
```ts
import { join } from 'path';
import { readFile } from 'fs/promises';
```
:::

1.2 所有导入置于模块顶层，禁止在函数体内动态 `require()`；确需动态加载时使用 `await import()` 并注明原因。

:::tip[建议 👍]
```ts
import { Injectable } from '@nestjs/common';
import Redis from 'ioredis';
```
:::

:::danger[不建议 👎]
```ts
function getRedis() {
  const Redis = require('ioredis'); // 延迟加载导致首次调用卡顿
  return new Redis();
}
```
:::

1.3 禁止导入未在 `package.json` 声明的依赖（幻影依赖）。间接依赖必须先显式声明再使用。

:::danger[不建议 👎]
```ts
// lodash 是 @nestjs/cli 的间接依赖，未在本项目声明
import { chunk } from 'lodash';
```
:::

1.4 禁止使用变量或表达式拼接 `require()` 路径，防止任意模块加载。

:::danger[不建议 👎]
```ts
const plugin = require(`./plugins/${userInput}`); // 任意文件加载风险
```
:::

1.5 路径拼接使用 `path.join()` / `path.resolve()`，禁止与 `__dirname`、`__filename` 直接字符串拼接（Windows 与 POSIX 分隔符不同）。

:::tip[建议 👍]
```ts
import { join } from 'node:path';

const configPath = join(import.meta.dirname, '..', 'config');
```
:::

:::danger[不建议 👎]
```ts
const configPath = __dirname + '/../config'; // Windows 下产出混合分隔符
```
:::

## 2. 异步与回调 (Async & Callbacks)

2.1 统一使用 `async/await`，禁止新增回调风格的异步代码；对接旧式回调 API 时使用 `node:util` 的 `promisify` 包装。

:::tip[建议 👍]
```ts
import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';

const gunzipAsync = promisify(gunzip);
const buffer = await gunzipAsync(compressed);
```
:::

2.2 使用文件、DNS 等系统 API 的 Promise 版本，不使用回调版本。

:::tip[建议 👍]
```ts
import { readFile } from 'node:fs/promises';

const content = await readFile('./schema.gql', 'utf8');
```
:::

:::danger[不建议 👎]
```ts
import { readFile } from 'node:fs';

readFile('./schema.gql', 'utf8', (err, data) => { /* ... */ });
```
:::

2.3 禁止在请求处理路径中调用同步 API（`fs.readFileSync`、`execSync` 等）——同步调用会阻塞事件循环，拖垮该实例上的全部连接。仅在启动初始化阶段（如加载本地配置）允许使用。

:::danger[不建议 👎]
```ts
@Get('template')
getTemplate() {
  // 每个请求都阻塞事件循环
  return readFileSync('./template.html', 'utf8');
}
```
:::

2.4 error-first 回调必须首先处理错误参数，禁止忽略错误直接消费数据。

:::danger[不建议 👎]
```ts
client.get('key', (err, value) => {
  return value.length; // err 被忽略，value 可能为 null
});
```
:::

## 3. 进程与全局对象 (Process & Globals)

3.1 业务代码与库代码禁止使用 `process.exit()`——它会立即终止进程，丢弃进行中的请求与连接。异常场景应抛出错误交由全局过滤器处理；进程退出只通过 `enableShutdownHooks` 优雅停机流程触发。

:::danger[不建议 👎]
```ts
if (!config.redisUrl) {
  process.exit(1); // 直接杀死进程，K8s 无法区分故障类型
}
```
:::

:::tip[建议 👍]
```ts
if (!config.redisUrl) {
  throw new Error('REDIS_URL 未配置'); // 启动失败由引导层统一处理
}
```
:::

3.2 不直接访问 `process.env`，统一通过 `ConfigService` 读取（类型安全、可校验、可 mock）。仅允许 `main.ts` 与 `config/` 目录直接接触环境变量。

:::tip[建议 👍]
```ts
constructor(private readonly config: ConfigService) {}

get redisUrl(): string {
  return this.config.getOrThrow<string>('REDIS_URL');
}
```
:::

:::danger[不建议 👎]
```ts
const redisUrl = process.env.REDIS_URL; // 散落在业务代码中，无法统一校验
```
:::

3.3 `Buffer`、`process`、`console`、`URL` 等全局对象直接使用，不再从内置模块重复引入。

:::tip[建议 👍]
```ts
const buf = Buffer.from(payload, 'utf8');
const url = new URL(endpoint);
```
:::

:::danger[不建议 👎]
```ts
import { Buffer } from 'node:buffer'; // Node.js 中无必要的重复引入
import { URL } from 'node:url';
```
:::

3.4 CLI 入口文件的首行 hashbang（`#!/usr/bin/env node`）必须与文件实际用途一致，不含有多余 BOM 或空行。

## 4. 版本兼容 (Compatibility)

4.1 禁止使用已弃用的 Node.js API。

:::tip[建议 👍]
```ts
const buf = Buffer.from(str, 'utf8');
const empty = Buffer.alloc(16);
```
:::

:::danger[不建议 👎]
```ts
const buf = new Buffer(str); // 已弃用，且存在未初始化内存泄露风险
```
:::

4.2 禁止使用超出 `engines.node` 声明版本的语法与 API。升级依赖能力前先升级 `engines` 声明与部署基线。

```json
// package.json
{
  "engines": {
    "node": ">=22.0.0"
  }
}
```

## 5. 安全编码 (Security)

5.1 禁止 `eval()` 及任何形式的表达式动态执行；配置化逻辑用查表（`Map`/`Record`）替代。

:::tip[建议 👍]
```ts
const handlers: Record<string, () => void> = {
  created: handleCreated,
  updated: handleUpdated,
};
handlers[event.type]?.();
```
:::

:::danger[不建议 👎]
```ts
eval(`handle${event.type}()`); // 事件类型可被构造为任意代码
```
:::

5.2 正则字面量避免嵌套量词与重叠交替（ReDoS）；禁止以用户输入构造 `RegExp`，确需使用时先转义。

:::danger[不建议 👎]
```ts
const re = /^(a+)+$/;                    // 指数级回溯，可被打挂
const userRe = new RegExp(userInput);    // 用户输入直接成为正则
```
:::

5.3 `fs` 操作的文件路径禁止直接拼接用户输入；必须将路径约束在白名单目录内并校验。

:::danger[不建议 👎]
```ts
// ../../etc/passwd 路径遍历
await readFile(`/uploads/${req.params.filename}`);
```
:::

5.4 `child_process` 调用禁止拼接用户输入；优先 `execFile` 参数数组形式，避免 shell 解释。

:::tip[建议 👍]
```ts
import { execFile } from 'node:child_process';

execFile('git', ['log', '--oneline', '-n', '10'], callback); // 参数不经 shell
```
:::

:::danger[不建议 👎]
```ts
exec(`git log ${userBranch}`); // 命令注入：userBranch = "main; rm -rf /"
```
:::

5.5 安全场景（令牌、盐、密钥）的随机数使用 `crypto.randomBytes()`；`Math.random()` 与 `crypto.pseudoRandomBytes()` 不具备密码学强度。

:::tip[建议 👍]
```ts
import { randomBytes } from 'node:crypto';

const token = randomBytes(32).toString('hex');
```
:::

5.6 敏感值（令牌、签名、密钥）比较使用 `crypto.timingSafeEqual()`，禁止 `===`（逐字节短路比较泄露时序信息）。

:::tip[建议 👍]
```ts
import { timingSafeEqual } from 'node:crypto';

const valid = timingSafeEqual(Buffer.from(received), Buffer.from(expected));
```
:::

:::danger[不建议 👎]
```ts
if (receivedSignature === expectedSignature) { /* 时序攻击面 */ }
```
:::

5.7 禁止以未校验的用户输入作为对象键读写（原型污染/对象注入）；先用白名单或 `Object.hasOwn()` 校验。

:::danger[不建议 👎]
```ts
const value = configMap[req.query.key]; // key = "__proto__" 时可污染原型
```
:::

5.8 Buffer 的创建使用 `Buffer.from()`/`Buffer.alloc()`，不使用 `new Buffer()`；Buffer 读写不传 `noAssert`。

5.9 代码中禁止出现 Unicode 双向控制字符（U+202A–U+202E 等），防止源码视觉欺骗（Trojan Source）。
