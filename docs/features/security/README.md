---
title: 安全基线
description: Node.js 服务的安全基线——安全头、CORS、限流、参数校验与错误脱敏，与传统后端同一标准
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# 安全基线

Node.js 服务与传统后端执行**同一套**安全标准，不因“补充”定位而降低要求。

## 安全头

框架内置安全响应头能力（`app.useSecurityHeaders()`）：默认值与 Helmet 8 一致，Express / Fastify 行为相同，零第三方依赖。紧跟 `NestFactory.create()` 之后、`listen()` 之前调用：

```ts
// main.ts
const app = await NestFactory.create<NestFastifyApplication>(
  AppModule,
  new FastifyAdapter(),
);
app.useSecurityHeaders();
await app.listen(...);
```

默认输出 `Content-Security-Policy`、`Strict-Transport-Security`、`X-Content-Type-Options`、`X-Frame-Options`、`Referrer-Policy` 等一组头，并移除 `X-Powered-By`。头部覆盖**所有**响应——路由响应、404、异常、CSRF 拒绝响应与 SSE 流。

按头定制（选项名与 Helmet 一致，每个头接受 `false` 不输出 / `true` 默认值 / 配置对象）：

```ts
app.useSecurityHeaders({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://unpkg.com'],
    },
  },
  crossOriginEmbedderPolicy: false,
});
```

- 配置在调用时校验，错误配置启动即失败（含 Helmet legacy 选项名拒绝，如 `hsts` → `strictTransportSecurity`）
- CSP 指令**替换**同名默认值，保留 `'self'` 需显式声明；`null` 删除指令；`reportOnly: true` 输出 Report-Only 头，先观察再收紧
- 路由级仍可用 `@Header()` 覆盖单个头（如放行图片跨域加载）

## CSRF 防护

框架内置基于 Fetch Metadata 的 CSRF 防护（`app.enableCsrfProtection()`）：非令牌方案，无 cookie/session 前置、无客户端改造，Express / Fastify 行为相同：

```ts
// main.ts（紧跟 NestFactory.create() 之后调用）
app.enableCsrfProtection({
  trustedOrigins: ['https://admin.example.com'],
  exclude: [{ path: 'webhooks/stripe', method: RequestMethod.POST }],
});
```

判定规则（在中间件、守卫、处理器之前执行，未匹配路由同样受检）：

| 请求 | 判定 |
|------|------|
| GET / HEAD / OPTIONS | 始终放行 |
| 携带 `Sec-Fetch-Site` | 须为 `same-origin` / `none`；`same-site` 与 `cross-site` 拒绝 |
| `Sec-Fetch-Site` 与 `Origin` 均无（非浏览器客户端） | 放行 |
| 仅 `Origin`（旧浏览器） | `Origin` 主机须与请求 `Host` 一致（`X-Forwarded-Host` 不参与） |

- 拒绝统一抛 `ForbiddenException`，经全局异常 Filter 塑形 403
- `trustedOrigins` 条目为 `scheme://host[:port]`，不带路径；CORS 白名单**不自动**成为信任来源
- `exclude` 声明方式同 `MiddlewareConsumer.exclude()`，全局前缀在初始化时自动拼接
- WebSocket 握手不在检查范围，Gateway 侧自行校验 `Origin`（见 [WebSocket · 连接鉴权](../websocket/README.md#连接鉴权)）

:::warning[代理链路注意]
`X-Forwarded-Host` 被忽略：网关 / 反向代理改写 `Host` 头时，不发送 `Sec-Fetch-Site` 的旧浏览器会命中回退规则收到 403——配置代理保留原始 `Host`，或将对外域名加入 `trustedOrigins`。
:::

本服务 API 以 Bearer Token 鉴权、无 Cookie 会话，非浏览器客户端（App、服务间调用）天然免检——内置防护作为浏览器接入场景（Web 管理端、GraphiQL）的纵深防御层。

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
- SSE 端点与普通 REST 同属 HTTP 上下文，默认受全局 Throttler 约束；单用户并发连接数按需自行计数限制
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
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
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
