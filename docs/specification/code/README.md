---
title: 编码规范
description: Node.js 服务端 TypeScript 编码约定、注释规范与分支、Commit 工作流程
---

# 编码规范

:::tip[平台专属规范]
Node.js 平台特性与服务端安全编码约定（`node:` 协议、事件循环保护、注入防护等）见 [Node.js 规范](node/README.md)，与本文档的通用语言约定配套执行。
:::

## TypeScript 约定

- 开启 `strict` 模式，禁止隐式 `any`；确需动态类型时使用 `unknown` 并收窄
- 优先 `const`，需要重新赋值时用 `let`，禁止 `var`
- 异步统一使用 `async/await` + `try/catch`，禁止裸 `.then()/.catch()` 链
- 可选值访问使用 `?.`，空值回退使用 `??`（仅处理 `null/undefined` 场景，不用 `||`）
- 类型导入使用 `import type`，与运行时导入分离
- 禁止参数重新赋值，返回新对象/数组

## NestJS 约定

- **依赖注入优先**：跨层调用一律通过构造函数注入，禁止在类内部 `new` 其他 Provider
- **单一职责**：controller / gateway / resolver 只做参数接收与响应组装，业务逻辑下沉到 service
- 全局能力（Guard / Filter / Interceptor / Pipe）在 `AppModule` 通过 `APP_*` token 注册，不集中堆在 `main.ts`

```ts
// app.module.ts
@Module({
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_PIPE, useClass: ValidationPipe },
  ],
})
export class AppModule {}
```

- 配置读取统一走 `ConfigService`，禁止在业务代码中直接访问 `process.env`

## 注释规范

- 公共 API（service 公开方法、DTO 字段）使用 JSDoc 描述用途与取值约束
- 注释说明“为什么”，不复述“做什么”；代码能表达的不写注释
- 临时方案必须标注 `TODO:` 或 `FIXME:` 并附原因与期限

```ts
export class NotificationService {
  /**
   * 按租户广播通知。
   *
   * 说明：先写 Redis 再经 Socket.IO 广播——多实例部署时，
   * 只有经由 redis-adapter 的广播才能覆盖全部连接节点。
   */
  async broadcastToTenant(tenantId: string, payload: NotificationPayload): Promise<void> {
    // ...
  }
}
```

## 分支与 Commit

### 分支模型

| 分支 | 用途 | 规则 |
|------|------|------|
| `main` | 生产分支 | 仅接受合并请求，禁止直接推送 |
| `develop` | 集成分支 | 功能分支的合并目标 |
| `feature/{scope}-{desc}` | 功能开发 | 从 `develop` 切出，合并后删除 |
| `fix/{scope}-{desc}` | 缺陷修复 | 同上 |
| `release/{version}` | 发布准备 | 仅允许 bugfix 合入 |

### Commit 信息

使用 Conventional Commits：

```
<type>(<scope>): <subject>

<body>
```

- `type`：`feat` / `fix` / `perf` / `refactor` / `docs` / `test` / `chore` / `ci`
- `scope`：业务域或模块名（`notification` / `graphql` / `gateway`）
- `subject`：祈使句、不超过 50 字、不以句号结尾

```
feat(notification): 支持按租户广播站内信

通过 redis-adapter 实现多实例广播，替代单节点 server.emit。
```

:::tip[参见]
- [Conventional Commits](https://www.conventionalcommits.org/zh-hans/)
:::
