---
title: 配置参考
description: Node.js 服务的环境变量与模块配置参考——Fastify、Socket.IO、GraphQL、Redis、Kafka、JWT 等核心配置项
---

# 配置参考

## 环境变量

| 变量 | 必填 | 示例 | 说明 |
|------|------|------|------|
| `NODE_ENV` | ✔️ | `production` | 运行环境 |
| `PORT` | ✔️ | `3000` | 服务监听端口 |
| `REDIS_URL` | ✔️ | `redis://redis:6379` | Redis 连接地址 |
| `KAFKA_BROKERS` | ✔️ | `kafka:9092` | Kafka broker 列表（逗号分隔） |
| `SPRING_API_BASE_URL` | ✔️ | `http://spring-service:8080` | Spring 内部 API 基础地址 |
| `SPRING_INTERNAL_TOKEN` | ✔️ | `internal-secret` | 内部调用令牌 |
| `JWT_SECRET` | ✔️ | `your-256-bit-secret` | JWT 校验密钥（与 Spring 同源） |
| `LOG_LEVEL` | 🔵 | `info` | 日志级别，默认 `info` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | 🔵 | `http://otel-collector:4318` | OpenTelemetry 导出地址 |
| `THROTTLE_LIMIT_SHORT` | 🔵 | `10` | 短窗口限流阈值（次/秒） |
| `THROTTLE_LIMIT_LONG` | 🔵 | `100` | 长窗口限流阈值（次/分钟） |

:::warning
敏感配置（密钥、令牌）通过 K8s Secret 或 Vault 注入，不写入代码仓库；`.env` 文件仅用于本地开发。
:::

## Fastify

```ts
// main.ts
const app = await NestFactory.create<NestFastifyApplication>(
  AppModule,
  new FastifyAdapter({
    logger: false, // 使用 nestjs-pino 替代
    bodyLimit: 1048576, // 1MB
    connectionTimeout: 10000, // 10s
    keepAliveTimeout: 72000, // 略大于网关/代理的 60s
  }),
);
```

| 选项 | 建议值 | 说明 |
|------|--------|------|
| `logger` | `false` | 由 nestjs-pino 接管，避免双日志器 |
| `bodyLimit` | `1048576` (1MB) | 默认 1MB，文件上传场景走对象存储，不放大 |
| `connectionTimeout` | `10000` | 防止慢速连接攻击 |
| `keepAliveTimeout` | `72000` | 大于上游代理的 60s，避免竞争条件 |

## Socket.IO

```ts
@WebSocketGateway({
  namespace: 'notification',
  pingInterval: 25000,
  pingTimeout: 20000,
  connectTimeout: 10000,
  maxHttpBufferSize: 1e6, // 1MB
  cors: { origin: false }, // 全局 CORS 已配置，此处关闭
})
```

| 选项 | 建议值 | 说明 |
|------|--------|------|
| `pingInterval` | `25000` | 移动端弱网建议 ≤ 30s |
| `pingTimeout` | `20000` | 等待 pong 的超时时间 |
| `connectTimeout` | `10000` | 握手超时 |
| `maxHttpBufferSize` | `1e6` | 单条消息体积上限 |
| `transports` | `['websocket']`（生产） | 跳过轮询降级，减少连接抖动 |

## GraphQL（Apollo）

```ts
GraphQLModule.forRoot<ApolloDriverConfig>({
  driver: ApolloDriver,
  autoSchemaFile: join(process.cwd(), 'src/schema.gql'),
  sortSchema: true,
  playground: false,
  graphiql: process.env.NODE_ENV !== 'production',
  introspection: process.env.NODE_ENV !== 'production',
  validationRules: [depthLimit(7)],
  formatError: (formattedError) => ({
    message: formattedError.message,
    extensions: {
      code: formattedError.extensions?.code ?? '50000',
      traceId: formattedError.extensions?.traceId,
    },
  }),
})
```

| 选项 | 建议值 | 说明 |
|------|--------|------|
| `autoSchemaFile` | 文件路径 | Code First 生成 Schema 文件 |
| `sortSchema` | `true` | 字典序排序，便于 diff 审查 |
| `playground` | `false` | 已废弃，使用 `graphiql` 或 Apollo Sandbox |
| `graphiql` | 非生产开启 | 生产环境关闭 IDE |
| `introspection` | 非生产开启 | 生产环境可选关闭（视协作需要） |
| `validationRules` | `[depthLimit(7)]` | 查询深度限制 |

## Redis

```ts
// infra/redis/redis.module.ts
@Module({
  providers: [
    {
      provide: 'REDIS_CLIENT',
      useFactory: (config: ConfigService) => {
        return new Redis(config.get<string>('REDIS_URL'), {
          maxRetriesPerRequest: 3,
          retryStrategy: (times) => Math.min(times * 200, 5000),
          lazyConnect: true,
        });
      },
      inject: [ConfigService],
    },
  ],
  exports: ['REDIS_CLIENT'],
})
export class RedisModule {}
```

| 选项 | 建议值 | 说明 |
|------|--------|------|
| `maxRetriesPerRequest` | `3` | 单命令最大重试次数 |
| `retryStrategy` | 指数退避 | 连接断开时的重连策略 |
| `lazyConnect` | `true` | 首次命令时才建立连接，加速启动 |

## Kafka

```ts
// app.module.ts
ClientsModule.registerAsync([
  {
    name: 'KAFKA_CLIENT',
    useFactory: (config: ConfigService) => ({
      transport: Transport.KAFKA,
      options: {
        client: {
          brokers: config.get<string>('KAFKA_BROKERS').split(','),
          connectionTimeout: 3000,
          requestTimeout: 5000,
        },
        consumer: {
          groupId: 'realtime-service',
          sessionTimeout: 30000,
          heartbeatInterval: 3000,
        },
        producer: {
          allowAutoTopicCreation: false,
        },
      },
    }),
    inject: [ConfigService],
  },
])
```

| 选项 | 建议值 | 说明 |
|------|--------|------|
| `connectionTimeout` | `3000` | 建立连接超时 |
| `requestTimeout` | `5000` | 单次请求超时 |
| `sessionTimeout` | `30000` | 消费者会话超时 |
| `allowAutoTopicCreation` | `false` | 生产环境禁止自动建 Topic |
