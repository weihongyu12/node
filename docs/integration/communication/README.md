---
title: 服务间通信
description: Node.js 服务与 Spring 微服务的通信方式——内部 REST 与 gRPC 双通道取数、Kafka 事件驱动与 Redis 共享缓存
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# 服务间通信

Node.js 服务与 Spring 服务之间通过四类方式协作：内部 REST（简单透传、首屏全量查询）、gRPC（聚合批量取数）、Kafka（事件）、Redis（缓存）。不引入额外中间件，复用现有基础设施。

## 内部 REST 调用

Node.js 服务调用 Spring 服务的内部 API，获取业务数据。使用官方 [`@nestjs/http-client`](https://docs.nestjs.com/application/http-client)，按 Spring 服务注册命名客户端：

```bash
pnpm add @nestjs/http-client
```

```ts
// infra/spring/spring-rest.module.ts
import { HttpClientModule } from '@nestjs/http-client';

/**
 * 每个 Spring 微服务一个命名客户端：独立 baseUrl 与超时，
 * @InjectHttpClient(name) 注入，无需手工封装连接池。
 */
@Module({
  imports: [
    HttpClientModule.registerAsync([
      {
        name: 'SPRING_USER',
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          baseUrl: config.getOrThrow('SPRING_USER_URL'),
          timeout: '10s',
          // 调用自有服务不重试，避免重试放大（见下方约定）
          retry: false,
        }),
      },
      {
        name: 'SPRING_ORDER',
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          baseUrl: config.getOrThrow('SPRING_ORDER_URL'),
          timeout: '10s',
          retry: false,
        }),
      },
      // SPRING_DEVICE 同理
    ]),
  ],
  providers: [SpringRestClient],
  exports: [SpringRestClient],
})
export class SpringRestModule {}
```

```ts
// infra/spring/spring-rest.client.ts
import { InjectHttpClient, HttpClient, HttpResponseError } from '@nestjs/http-client';

/** Spring 微服务名，对应网关静态路由的后端 */
export type SpringServiceName = 'user' | 'order' | 'device';

/**
 * Spring REST 客户端：命名客户端统一封装，错误映射为 BadGatewayException。
 * Node.js 服务不直连业务库，所有取数经由此层访问 Spring 微服务。
 */
@Injectable()
export class SpringRestClient {
  private readonly logger = new Logger(SpringRestClient.name);

  constructor(
    @InjectHttpClient('SPRING_USER') private readonly user: HttpClient,
    @InjectHttpClient('SPRING_ORDER') private readonly order: HttpClient,
    @InjectHttpClient('SPRING_DEVICE') private readonly device: HttpClient,
  ) {}

  private clientOf(service: SpringServiceName): HttpClient {
    return { user: this.user, order: this.order, device: this.device }[service];
  }

  async get<T>(
    service: SpringServiceName,
    path: string,
    headers?: Record<string, string>,
  ): Promise<T> {
    try {
      const { data } = await this.clientOf(service).get<T>(path, { headers });
      return data;
    } catch (error) {
      return this.handleError(service, path, error);
    }
  }

  async post<T>(
    service: SpringServiceName,
    path: string,
    body: unknown,
    headers?: Record<string, string>,
  ): Promise<T> {
    try {
      const { data } = await this.clientOf(service).post<T>(path, { json: body, headers });
      return data;
    } catch (error) {
      return this.handleError(service, path, error);
    }
  }

  /** 下游异常统一映射 BadGatewayException，不向客户端泄露内部细节 */
  private handleError(service: SpringServiceName, path: string, error: unknown): never {
    if (error instanceof HttpResponseError) {
      this.logger.warn(
        `spring ${service}${path} 响应异常 ${error.status}: ${String(error.body).slice(0, 200)}`,
      );
      throw new BadGatewayException(`上游服务 ${service} 响应 ${error.status}`);
    }
    this.logger.error(`spring ${service}${path} 请求失败: ${(error as Error).message}`);
    throw new BadGatewayException(`上游服务 ${service} 不可用`);
  }
}
```

:::tip[为什么是 @nestjs/http-client]
官方包，替代 Axios 版 `@nestjs/axios`：基于 Node.js 内置 `fetch`（undici 驱动），除 `@nestjs/common` / `@nestjs/core` 外零依赖；base URL、超时、重试、拦截器、命名客户端开箱即用，连接池由运行时 undici 托管，无需手工维护 `Agent`。
:::

**调用约定**：

- **内部端点隔离**：Spring 服务的 `/internal/**` 端点不暴露到网关，仅内网可达
- **身份透传**：调用方透传原始 `Authorization` 头，Spring 侧校验（端到端凭据，见 [网关接入 · 认证透传](../gateway/README.md#认证透传)）；服务级隔离要求更高时叠加内部令牌或 mTLS
- **超时与重试**：客户端统一 `timeout: '10s'`；调用**自有服务**显式 `retry: false`——重试沿调用链相乘（A→B→C 各 3 次重试时，一次 C 故障放大为 9 次调用），只在链路最外层（调用外部依赖处）重试
- **非 2xx 响应**：`HttpResponseError` 携带 `status` / `body`，统一映射 `BadGatewayException`；类型参数 `get<T>` 仅为编译期断言，响应体不做运行时校验

## gRPC 聚合取数

聚合场景（GraphQL resolver 按一批 ID 富化字段）使用 gRPC 批量接口，与 REST 分工：

| 场景 | 通道 | 理由 |
|------|------|------|
| 简单透传、首屏全量查询 | REST | 通用、可调试、无契约生成成本 |
| 聚合富化（同请求多 ID 批量取数） | gRPC `ListXxxByIds` | 批量契约一次往返、二进制编码低开销、与 DataLoader 天然配合 |

```bash
pnpm add @grpc/grpc-js @grpc/proto-loader
```

proto 契约由 Spring 侧契约仓统一管理，Node.js 侧启动时一次性加载（运行时零 IO）：

```ts
// infra/grpc/grpc-client.service.ts（节选）
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';

const GRPC_DEADLINE_MS = 5000;

// proto/ 目录下的契约文件（源自 Spring 侧契约仓）
const packageDefinition = protoLoader.loadSync(protoFiles, {
  keepCase: false,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});
const loaded = grpc.loadPackageDefinition(packageDefinition);
```

调用时透传 JWT 并设置 deadline：

```ts
async call<T>(
  service: SpringServiceName,
  serviceFqName: string, // 如 'user.v1.UserService'
  method: string,        // 如 'ListUsersByIds'
  message: Record<string, unknown>,
  options: GrpcCallOptions = {},
): Promise<T> {
  const client = this.getClient(service, serviceFqName);
  const metadata = new grpc.Metadata();
  if (options.token) {
    metadata.set('authorization', `Bearer ${options.token}`);
  }
  const callOptions = { deadline: Date.now() + GRPC_DEADLINE_MS };
  ...
}
```

**实现要点**：

- **懒建连接**：按 `(服务, proto 服务名)` 缓存 Client 实例，`OnApplicationShutdown` 统一 `close()`
- **deadline 5s**：批量取数参与聚合请求，超时快速失败，与 REST 超时形成梯度
- **int64 精度红线**：`longs: String` 保证雪花 ID 以十进制字符串传递，任何 `Number()` 转换都可能静默丢精度
- **mTLS 预留**：内网开发用 `credentials.createInsecure()`，生产替换 SSL 凭据
- **与 DataLoader 配合**：请求级 loaders 实例把同一 GraphQL 请求内多次字段解析合并为一次批量调用，消除 N+1

## Kafka 事件驱动

Spring 服务发布领域事件，Node.js 消费后完成实时分发或缓存更新。使用 kafkajs 直连，不经 `@nestjs/microservices` 传输层。

```bash
pnpm add kafkajs
```

<Tabs>
  <TabItem value="consume" label="消费封装">

```ts
// infra/kafka/kafka.service.ts
import { randomUUID } from 'node:crypto';
import {
  Injectable, Logger,
  type OnApplicationBootstrap, type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, type Consumer, type EachMessagePayload } from 'kafkajs';

export interface KafkaEvent {
  topic: string;
  key: string | null;
  value: unknown;
}

export type KafkaEventHandler = (event: KafkaEvent) => void;

/**
 * Kafka 事件消费：kafkajs 直连封装。
 * 广播语义：每个实例使用独立消费组，事件全量到达后按 topic 分发给处理器。
 */
@Injectable()
export class KafkaService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(KafkaService.name);
  private readonly handlers = new Map<string, Set<KafkaEventHandler>>();
  private readonly consumer?: Consumer;

  constructor(config: ConfigService) {
    const brokers = (config.get('KAFKA_BROKERS') ?? '').split(',').filter(Boolean);
    if (brokers.length === 0) {
      this.logger.warn('KAFKA_BROKERS 未配置，Kafka 事件消费处于禁用状态');
      return;
    }
    const kafka = new Kafka({ brokers, clientId: 'realtime-service' });
    this.consumer = kafka.consumer({ groupId: `realtime-${randomUUID()}` });
  }

  /** 注册 topic 处理器（各模块在 onModuleInit 阶段挂接） */
  onMessage(topic: string, handler: KafkaEventHandler): void {
    const set = this.handlers.get(topic) ?? new Set<KafkaEventHandler>();
    set.add(handler);
    this.handlers.set(topic, set);
  }

  /** 等全部模块 onModuleInit 注册完处理器后，按 topic 并集订阅 */
  async onApplicationBootstrap(): Promise<void> {
    if (!this.consumer || this.handlers.size === 0) return;
    const topics = [...this.handlers.keys()];
    await this.consumer.connect();
    await this.consumer.subscribe({ topics });
    await this.consumer.run({
      eachMessage: async (message) => this.dispatch(message),
    });
    this.logger.log(`Kafka 已订阅 topics: ${topics.join(', ')}`);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.consumer?.disconnect();
  }

  private dispatch(payload: EachMessagePayload): void {
    const set = this.handlers.get(payload.topic);
    if (!set) return;
    let value: unknown = null;
    if (payload.message.value) {
      try {
        value = JSON.parse(payload.message.value.toString());
      } catch {
        value = payload.message.value.toString();
      }
    }
    const event: KafkaEvent = {
      topic: payload.topic,
      key: payload.message.key?.toString() ?? null,
      value,
    };
    set.forEach((handler) => handler(event));
  }
}
```

  </TabItem>
  <TabItem value="bridge" label="处理器挂接">

```ts
// modules/notification/notification.bridge.ts
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { KafkaService } from '../../infra/kafka/kafka.service';

@Injectable()
export class NotificationBridge implements OnModuleInit {
  constructor(
    private readonly kafka: KafkaService,
    private readonly notificationService: NotificationService,
  ) {}

  onModuleInit(): void {
    this.kafka.onMessage('mes.order.paid', (event) => {
      this.notificationService.pushToUser(String((event.value as OrderPaidEvent).userId), {
        event: 'order:paid',
        data: event.value,
        timestamp: Date.now(),
      });
    });
  }
}
```

  </TabItem>
  <TabItem value="produce" label="生产事件">

```ts
// infra/kafka/kafka.producer.ts
import {
  Injectable,
  type OnApplicationBootstrap, type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, type Producer } from 'kafkajs';

@Injectable()
export class KafkaProducer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly producer?: Producer;

  constructor(config: ConfigService) {
    const brokers = (config.get('KAFKA_BROKERS') ?? '').split(',').filter(Boolean);
    if (brokers.length === 0) return;
    this.producer = new Kafka({ brokers, clientId: 'realtime-service' }).producer();
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.producer?.connect();
  }

  async emitUserAction(action: UserActionEvent): Promise<void> {
    await this.producer?.send({
      topic: 'mes.user.action',
      messages: [{ key: action.userId, value: JSON.stringify(action) }],
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.producer?.disconnect();
  }
}
```

  </TabItem>
</Tabs>

**为什么 kafkajs 直连而非 `@nestjs/microservices`**：

- 推送场景的 topic 集合不是静态的：由 SSE 通道登记表在运行时聚合（见 [SSE 实时推送](../../features/sse/README.md)），`@EventPattern` 的装饰器路由无法表达
- rebalance、pause / resume、逐消息提交等客户端控制力是长连接服务运维的刚需
- `@nestjs/microservices` 的 Kafka 传输层适合 RPC 化的请求-响应模式；纯事件分发场景，抽象层只增加排障距离

**消费组语义选择**：

| 消费模式 | groupId | 语义 | 适用 |
|---------|---------|------|------|
| 实例级广播 | `{prefix}-{randomUUID}` | 每实例收到全量事件 | SSE / WS 推送：连接分散在各实例，任何实例都要能分发 |
| 竞争消费 | 固定值 | 一条消息仅一个实例处理 | 落库、发通知等幂等任务处理 |

:::warning[订阅时机与生命周期顺序]
处理器注册（`onModuleInit`）与订阅（`onApplicationBootstrap`）分两阶段。生命周期钩子按组件层级调用，跨模块顺序不再隐式保证——“注册先于订阅”必须落在显式的阶段约定上，不能依赖模块导入顺序。
:::

**事件设计原则**：

- topic 按 `{系统}.{域}.{对象}.{动作}` 组织，与业务域对齐：`mes.production.order.status-changed`、`mes.warehouse.stock.changed`
- 事件体只携带必要标识（ID、类型、时间戳），详情由消费方按需回查，避免大事件体
- Node.js 服务只消费与自身职责相关的事件（通知、状态变更），不消费业务事务事件
- 事件源缺口的通道以 REST 轮询桥过渡：仅订阅者在时轮询、快照变化才推送，契约补齐后切 Kafka（见 [SSE 实时推送 · 多实例推送](../../features/sse/README.md#多实例推送)）

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
| 聚合富化（多 ID 批量） | gRPC | 批量契约一次往返、低序列化开销 |
| 领域事件分发 | Kafka（实例级广播） | 异步、解耦、可追溯 |
| 事件源缺口过渡 | REST 轮询桥 | 契约未就绪时不阻塞业务，补齐后切换 |
| 高频读取热点数据 | Redis 缓存 | 低延迟、减轻 Spring 压力 |
| 文件/大对象传输 | 不经过 Node.js | 直接走 Spring 或对象存储 |
