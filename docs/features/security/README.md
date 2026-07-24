---
title: 安全基线
description: Node.js 服务的安全基线——安全头、CORS、限流、参数校验与错误脱敏，与传统后端同一标准
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# 安全基线

Node.js 服务与传统后端执行**同一套**安全标准，不因“补充”定位而降低要求。

## 安全头（Helmet）

Fastify 平台使用 `@fastify/helmet`（非 Express 的 `helmet`）：

```bash
pnpm add @fastify/helmet
```

```ts
// main.ts
import helmet from '@fastify/helmet';

await app.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      // GraphQL 端点如需 GraphiQL，单独放宽该路径
    },
  },
  crossOriginEmbedderPolicy: false, // 允许跨域嵌入（WebSocket 场景需要）
});
```

- 默认开启 XSS 过滤、MIME 嗅探防护、点击劫持防护
- GraphQL 端点的 CSP 单独配置，避免阻断 GraphiQL 资源加载

## CORS

CORS 白名单与传统后端保持一致，仅允许明确的业务域名：

```ts
// main.ts
await app.register(cors, {
  origin: [
    'https://app.example.com',
    'https://admin.example.com',
  ],
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
});
```

- **禁止** `origin: '*'`（生产环境）
- WebSocket 的 CORS 由 Socket.IO 单独配置，与 HTTP 层对齐
- 预检请求（`OPTIONS`）由 Fastify 自动处理，不进入业务逻辑

## 限流

使用 `@nestjs/throttler`，Redis 作为计数存储（多实例共享）：

```bash
pnpm add @nestjs/throttler
```

<Tabs>
  <TabItem value="http" label="HTTP / GraphQL">

```ts
// app.module.ts
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      useFactory: (config: ConfigService) => ({
        throttlers: [
          { name: 'short', ttl: seconds(1), limit: 10 },
          { name: 'long', ttl: seconds(60), limit: 100 },
        ],
        storage: new ThrottlerStorageRedisService(config.get('REDIS_URL')),
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
```

  </TabItem>
  <TabItem value="ws" label="WebSocket">

WebSocket 事件不走 HTTP 管道，`ThrottlerGuard` 默认不生效。需自定义 WS 限流 Guard 或改用 `@fastify/rate-limit`：

```ts
// common/guards/ws-throttler.guard.ts
@Injectable()
export class WsThrottlerGuard implements CanActivate {
  constructor(private readonly redis: RedisService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const client = context.switchToWs().getClient();
    const key = `throttle:ws:${client.data.userId ?? client.id}`;
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, 60);
    if (count > 100) throw new WsException({ code: 42901, message: '触发限流' });
    return true;
  }
}
```

  </TabItem>
</Tabs>

- 限流维度：用户 ID（已认证）→ IP（未认证）
- GraphQL 按查询复杂度限流（见 [GraphQL · 查询安全](../graphql/README.md#查询安全)），而非仅按请求数

## 参数校验

所有入口参数统一走 `ValidationPipe`（class-validator）：

```ts
// app.module.ts
@Module({
  providers: [
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,        // 剥离未声明属性
        forbidNonWhitelisted: true, // 未声明属性直接拒绝
        transform: true,        // 自动类型转换
      }),
    },
  ],
})
export class AppModule {}
```

- REST Body / WS Message / GraphQL Input 共用同一套 DTO 与校验规则
- 嵌套对象用 `@Type()` 显式声明，数组用 `@ValidateNested({ each: true })`

## 错误脱敏

生产环境统一过滤敏感信息：

| 泄露风险 | 对策 |
|---------|------|
| 堆栈跟踪 | 全局 Exception Filter 捕获后仅返回业务码与 message |
| 内部主机名/IP | 日志中脱敏，响应体不含 |
| SQL / 查询细节 | 不向上传递，仅记录到服务端日志 |
| 令牌内容 | 日志中不打印完整令牌，仅打印 `sub` 与 `tenantId` |

```ts
// common/filters/global-exception.filter.ts
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    const status = exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const body = exception instanceof HttpException
      ? exception.getResponse()
      : { code: 50000, message: '内部服务错误' };

    // 生产环境不暴露堆栈与内部细节
    response.status(status).send({
      ...body,
      traceId: request.id,
      timestamp: new Date().toISOString(),
    });
  }
}
```

## 其他基线

| 项 | 配置 |
|---|------|
| 请求体大小 | Fastify `bodyLimit` 默认 1MB，生产环境保持默认或按业务收紧 |
| 超时 | Fastify `connectionTimeout` 显式设置，避免慢速攻击 |
| 日志 | 结构化日志（pino），不打印敏感字段；访问日志由网关统一采集 |
| 依赖审计 | CI 中执行 `pnpm audit --audit-level=high`，高危阻断 |

:::tip[参见]
- [接口设计规范 · 错误模型](../../specification/api/README.md#错误模型)
- [GraphQL · 查询安全](../graphql/README.md#查询安全)
:::
