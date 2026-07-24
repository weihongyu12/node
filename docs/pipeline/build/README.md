---
title: 构建
description: SWC 高速编译与开发模式（watch / Webpack HMR）的选型，以及类型检查防线的配置
---

# 构建

NestJS 默认用 `tsc` 编译，项目变大后全量编译动辄 30s+。[SWC](https://swc.rs)（Rust 编写）可将编译提速约 20 倍，是开发体验与 CI 效率的关键优化。

## SWC 高速编译

```bash
pnpm add -D @swc/cli @swc/core
```

```json
// .swcrc
{
  "$schema": "https://swc.rs/schema.json",
  "sourceMaps": true,
  "jsc": {
    "parser": {
      "syntax": "typescript",
      "decorators": true
    },
    "transform": {
      "legacyDecorator": true,
      "decoratorMetadata": true
    },
    "baseUrl": "./",
    "keepClassNames": true
  },
  "minify": false
}
```

```json
// package.json
{
  "scripts": {
    "build": "nest build -b swc",
    "start:dev": "nest start -b swc --watch --type-check"
  }
}
```

:::danger[装饰器元数据必须显式开启]
NestJS 的依赖注入依赖 `emitDecoratorMetadata`，`.swcrc` 中 `legacyDecorator` + `decoratorMetadata` **缺一不可**，否则启动时全部注入失效。这是 SWC 迁移的最高频事故点。
:::

:::warning[SWC 不做类型检查]
SWC 只转译、不校验类型，类型错误会被静默放过。两条防线必须同时存在：

- **开发时**：`nest start -b swc --watch --type-check`，后台并行 `tsc --watch` 实时报类型错误
- **CI 门禁**：独立的 `pnpm run typecheck`（`tsc --noEmit`）阶段——本项目 [CI 流水线](../cicd/README.md) 已内置
:::

:::tip[路径别名需在 .swcrc 同步声明]
若使用 `@/` 等路径别名，`tsconfig.json` 的 `paths` 对 SWC 不生效，必须在 `jsc.paths` 中再声明一次：

```json
{
  "jsc": {
    "baseUrl": "./",
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```
:::

## 开发模式

| 模式 | 命令 | 特点 | 适用 |
|------|------|------|------|
| 默认 watch | `nest start --watch` | tsc 增量编译，零额外依赖，偏慢 | 小项目起步 |
| **SWC watch（推荐）** | `nest start -b swc --watch --type-check` | 保存即整进程重启，毫秒级 | 日常开发 |
| Webpack HMR | `pnpm run start:hot` | 模块级热替换，保留进程内存状态 | 调试长流程（如 WS 会话） |

### Webpack HMR（可选）

```bash
pnpm add -D webpack webpack-cli webpack-node-externals run-script-webpack-plugin
```

```js
// webpack-hmr.config.js
const nodeExternals = require('webpack-node-externals');
const { RunScriptWebpackPlugin } = require('run-script-webpack-plugin');

module.exports = function hmrConfig(options, webpack) {
  return {
    ...options,
    entry: ['webpack/hot/poll?100', options.entry],
    externals: [
      nodeExternals({
        allowlist: ['webpack/hot/poll?100'],
      }),
    ],
    plugins: [
      ...options.plugins,
      new webpack.HotModuleReplacementPlugin(),
      new webpack.WatchIgnorePlugin({
        paths: [/\.js$/, /\.d\.ts$/],
      }),
      new RunScriptWebpackPlugin({ name: options.output.filename }),
    ],
  };
};
```

```ts
// main.ts 末尾
declare const module: {
  hot?: { accept: () => void; dispose: (callback: () => Promise<void>) => void };
};

if (module.hot) {
  module.hot.accept();
  module.hot.dispose(() => app.close());
}
```

```json
// package.json
{
  "scripts": {
    "start:hot": "nest build --webpack --webpackPath webpack-hmr.config.js --watch"
  }
}
```

:::tip[选型建议]
日常开发用 **SWC watch**——无状态服务整进程毫秒级重启已足够快；只有调试需要保留内存状态的长流程（WebSocket 连接会话、大对象缓存预热）时才上 Webpack HMR。两套构建器**互斥**，不要混用。
:::

## 与 CI / Docker 的关系

CI 与镜像构建统一走 `pnpm run build`（即 `nest build -b swc`）：

- 构建提速直接缩短流水线时间，见 [CI/CD](../cicd/README.md)
- 类型安全由独立的 `typecheck` 阶段兜底，不依赖构建器
- 产物为 CommonJS（NestJS 默认），`node dist/main.js` 启动，与 [Docker 多阶段构建](../cicd/README.md#docker-多阶段构建) 无额外适配
