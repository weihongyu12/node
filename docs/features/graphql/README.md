---
title: GraphQL 聚合查询
description: 基于 Apollo Server 的 GraphQL 聚合网关设计——Code First、Resolver 编排、DataLoader 批处理与查询安全
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# GraphQL 聚合查询

GraphQL 承担 BFF（Backend for Frontend）职责：一个页面需要的多个下游服务数据，由 Node.js 服务一次聚合返回，替代“前端多次调用 + 手动拼装”。

## 技术选型

Apollo Server（`@nestjs/apollo`）：生态成熟、文档完善、与 Fastify 有官方集成。

```bash
pnpm add @nestjs/graphql @nestjs/apollo @apollo/server @as-integrations/fastify graphql
```

:::tip[版本对应]
安装时需注意包版本兼容：`@nestjs/apollo` 与 `@nestjs/graphql` 主版本保持一致，`@as-integrations/fastify` 需与 Fastify 版本匹配。
:::

## 模块配置

```ts
// app.module.ts
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { GraphQLModule } from '@nestjs/graphql';
import { join } from 'node:path';

@Module({
  imports: [
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: join(process.cwd(), 'src/schema.gql'),
      sortSchema: true,
      playground: false,
      graphiql: process.env.NODE_ENV !== 'production',
      context: ({ req }) => ({ req }),
    }),
  ],
})
export class AppModule {}
```

- **Code First**：用装饰器与 TS 类生成 Schema，避免 SDL 与 TS 双份维护
- `playground` 已废弃（2025-04 起），本地调试用 `graphiql: true` 或 Apollo Sandbox
- 生产环境关闭 GraphiQL，仅保留 Schema 内省可选开启

## Resolver 编排

Resolver 只做编排：接收查询 → 调用 service 聚合 → 返回。业务逻辑与下游调用下沉到 service：

```ts
// modules/dashboard/dashboard.resolver.ts
@Resolver(() => Dashboard)
export class DashboardResolver {
  constructor(private readonly dashboardService: DashboardService) {}

  @Query(() => Dashboard)
  async dashboard(@CurrentUser() user: AuthPayload): Promise<Dashboard> {
    return this.dashboardService.aggregate(user.tenantId);
  }

  @ResolveField(() => [OrderSummary])
  async recentOrders(@Parent() dashboard: Dashboard): Promise<OrderSummary[]> {
    return this.dashboardService.loadRecentOrders(dashboard.tenantId);
  }
}
```

```ts
// modules/dashboard/dashboard.service.ts
@Injectable()
export class DashboardService {
  constructor(
    private readonly springClient: SpringApiClient,
    private readonly redis: RedisService,
  ) {}

  async aggregate(tenantId: string): Promise<Dashboard> {
    const [stats, notices, devices] = await Promise.all([
      this.springClient.getTenantStats(tenantId),
      this.springClient.getActiveNotices(tenantId),
      this.springClient.getDeviceSummary(tenantId),
    ]);
    return { tenantId, stats, notices, devices };
  }
}
```

**与传统后端的边界**：GraphQL 只查询与编排，写操作（Mutation）必须调用 Spring 服务完成，不直接持久化。

## DataLoader 批处理

跨实例字段解析（如列表中每项再查一次详情）会产生 N+1 问题，使用 DataLoader 合并批处理：

```ts
// modules/order/order.loader.ts
@Injectable()
export class OrderLoader {
  constructor(private readonly springClient: SpringApiClient) {}

  readonly byUser = new DataLoader<string, Order[]>(async (userIds) => {
    const orders = await this.springClient.getOrdersByUserIds(userIds as string[]);
    return userIds.map((id) => orders.filter((o) => o.userId === id));
  });
}
```

- Loader 按**请求作用域**实例化（`Scope.REQUEST`），避免跨请求缓存污染
- 仅用于“一次请求内”的批处理与去重，跨请求缓存走 Redis

## 查询安全

GraphQL 的灵活性带来额外攻击面，生产环境必须显式约束：

| 风险 | 对策 | 实现 |
|------|------|------|
| 深度嵌套查询（DoS） | 查询深度限制 | `graphql-depth-limit`，建议 ≤ 7 |
| 高复杂度查询 | 复杂度分析 | `graphql-query-complexity`，按字段成本阈值拒绝 |
| 批量请求轰炸 | 关闭或限制 batching | Apollo 默认关闭，保持关闭 |
| 内省泄露结构 | 生产环境可选关闭 | `introspection: false`（视协作需要） |
| 敏感字段泄露 | 字段级鉴权 | 自定义 `@Roles()` + Guard |

```ts
// main.ts
import depthLimit from 'graphql-depth-limit';

const app = await NestFactory.create(AppModule, new FastifyAdapter());
// 在 GraphQLModule 配置中注入 validationRules
```

```ts
// app.module.ts
GraphQLModule.forRoot<ApolloDriverConfig>({
  driver: ApolloDriver,
  validationRules: [depthLimit(7)],
})
```

## 错误模型

GraphQL 错误通过 `errors[].extensions` 返回，HTTP 状态码保持 200：

```json
{
  "errors": [
    {
      "message": "无权访问该租户",
      "extensions": {
        "code": "40301",
        "traceId": "7f3a9c2e"
      }
    }
  ],
  "data": null
}
```

- 业务错误在 service 抛出 `GraphQLError`，`extensions.code` 使用统一业务码表
- 生产环境通过 `formatError` 过滤堆栈与内部细节

```ts
GraphQLModule.forRoot<ApolloDriverConfig>({
  driver: ApolloDriver,
  formatError: (formattedError) => ({
    message: formattedError.message,
    extensions: {
      code: formattedError.extensions?.code ?? '50000',
      traceId: formattedError.extensions?.traceId,
    },
  }),
})
```

## 不启用 Subscription

GraphQL Subscription 基于 WebSocket，与 Socket.IO 网关能力重叠。本架构的约定：**实时推送统一走 Socket.IO / SSE**，GraphQL 只承担读侧聚合，不承载订阅。写操作走 Spring REST，推送走 SSE。
