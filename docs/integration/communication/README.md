---
title: 服务间通信
description: Node.js 服务与 Spring 微服务的通信方式——内部 REST 调用、Kafka 事件驱动与 Redis 共享缓存
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# 服务间通信

Node.js 服务与 Spring 服务之间通过三种方式协作：内部 REST（查询）、Kafka（事件）、Redis（缓存）。不引入额外中间件，复用现有基础设施。

## 内部 REST 调用

Node.js 服务调用 Spring 服务的内部 API，获取业务数据。使用 NestJS 内置 `HttpModule`（基于 Axios），封装为统一客户端：

```bash
pnpm add @nestjs/axios
```

```ts
// infra/spring/spring-api.client.ts
@Injectable()
export class SpringApiClient {
  private readonly http: HttpService;
  private readonly baseUrl: string;

  constructor(http: HttpService, config: ConfigService) {
    this.http = http;
    this.baseUrl = config.get<string>('SPRING_API_BASE_URL');
  }

  async getTenantStats(tenantId: string): Promise<TenantStats> {
    const { data } = await firstValueFrom(
      this.http.get(`${this.baseUrl}/internal/tenants/${tenantId}/stats`, {
        headers: { 'X-Internal-Token': this.internalToken },
      }),
    );
    return data;
  }

  async getOrdersByUserIds(userIds: string[]): Promise<Order[]> {
    const { data } = await firstValueFrom(
      this.http.post(`${this.baseUrl}/internal/orders/batch`, { userIds }),
    );
    return data;
  }
}
```

- **内部端点隔离**：Spring 服务的 `/internal/**` 端点不暴露到网关，仅内网可达
- **内部认证**：使用固定内部令牌或 mTLS，不使用用户 JWT（用户身份已通过 Header 透传）
- **超时与重试**：单次调用超时 3s，仅对幂等 GET 重试 1 次

## Kafka 事件驱动

Spring 服务发布领域事件，Node.js 消费后完成实时分发或缓存更新。

```bash
pnpm add @nestjs/microservices kafkajs
```

<Tabs>
  <TabItem value="consume" label="消费事件">

```ts
// modules/notification/notification.consumer.ts
@Controller()
export class NotificationConsumer {
  constructor(private readonly notificationService: NotificationService) {}

  @EventPattern('order.paid')
  async handleOrderPaid(@Payload() event: OrderPaidEvent): Promise<void> {
    // 1. 可选：调用 Spring 服务补全订单详情
    const order = await this.springClient.getOrder(event.orderId);
    // 2. 推送到对应房间
    await this.notificationService.pushToUser(order.userId, {
      event: 'order:paid',
      data: order,
      timestamp: Date.now(),
    });
  }
}
```

  </TabItem>
  <TabItem value="produce" label="生产事件">

```ts
// infra/kafka/kafka.producer.ts
@Injectable()
export class KafkaProducer {
  constructor(@Inject('KAFKA_CLIENT') private readonly client: ClientKafka) {}

  async emitUserAction(action: UserActionEvent): Promise<void> {
    await this.client.emit('user.action', action).toPromise();
  }
}
```

  </TabItem>
  <TabItem value="register" label="模块注册">

```ts
// app.module.ts
@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: 'KAFKA_CLIENT',
        useFactory: (config: ConfigService) => ({
          transport: Transport.KAFKA,
          options: {
            client: { brokers: config.get<string[]>('KAFKA_BROKERS') },
            consumer: { groupId: 'realtime-service' },
          },
        }),
        inject: [ConfigService],
      },
    ]),
  ],
})
export class AppModule {}
```

  </TabItem>
</Tabs>

**事件设计原则**：

- 事件名使用 `{域}.{动作}` 格式，与业务域对齐：`order.paid`、`device.status-changed`
- 事件体只携带必要标识（ID、类型、时间戳），详情由消费方按需回查，避免大事件体
- Node.js 服务只消费与自身职责相关的事件（通知、状态变更），不消费业务事务事件

## Redis 共享缓存

Node.js 服务与 Spring 服务共享 Redis，用于缓存热点数据、同步在线状态、存储限流计数。

| 用途 | Key 规范 | 读写方 |
|------|---------|--------|
| 热点配置 | `config:{key}` | Spring 写，Node.js 读 |
| 在线用户 | `presence:user:{userId}` | Node.js 读写 |
| 限流计数 | `throttle:{type}:{id}` | Node.js 读写 |
| 会话（可选） | `session:{token}` | Spring 写，Node.js 读（备用校验） |

```ts
// infra/redis/redis.service.ts
@Injectable()
export class RedisService {
  constructor(@Inject('REDIS_CLIENT') private readonly client: Redis) {}

  async getJson<T>(key: string): Promise<T | null> {
    const value = await this.client.get(key);
    return value ? JSON.parse(value) : null;
  }

  async setJson(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    const serialized = JSON.stringify(value);
    if (ttlSeconds) await this.client.setex(key, ttlSeconds, serialized);
    else await this.client.set(key, serialized);
  }
}
```

:::warning[边界红线]
- Node.js 服务**不缓存**业务实体（如订单详情）超过 5 分钟，避免与 MySQL 数据不一致
- 缓存更新以 Spring 服务为准，Node.js 不主动失效缓存（除非明确的事件驱动失效）
:::

## 通信选型对照

| 场景 | 方式 | 理由 |
|------|------|------|
| 实时查询业务数据 | 内部 REST | 同步、强一致、简单 |
| 领域事件分发 | Kafka | 异步、解耦、可追溯 |
| 高频读取热点数据 | Redis 缓存 | 低延迟、减轻 Spring 压力 |
| 文件/大对象传输 | 不经过 Node.js | 直接走 Spring 或对象存储 |
