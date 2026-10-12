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

日常开发使用 **SWC watch**：保存即整进程重启，毫秒级。

```bash
nest start -b swc --watch --type-check
```

## 与 CI / Docker 的关系

镜像构建走 Docker 多阶段（builder 阶段执行 `pnpm run build`，即 `nest build -b swc`），CI 只触发 `docker build`：

- 构建提速直接缩短镜像构建时间，见 [CI/CD](../cicd/README.md)
- 类型安全由独立的 `typecheck` 阶段兜底，不依赖构建器
- 产物为 CommonJS（NestJS 默认），`node dist/main.js` 启动，与 [多阶段构建](../cicd/README.md#多阶段构建dockerfile) 的 runner 阶段无额外适配
