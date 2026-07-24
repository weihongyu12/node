---
title: 目录规范
description: NestJS 服务端项目的目录结构约定，按业务域划分模块，统一入口导出与文件命名
---

# 目录规范

## 总体结构

```
realtime-service/
├── src/
│   ├── common/                  # 跨模块共享能力
│   │   ├── decorators/          # 自定义装饰器（@CurrentUser() 等）
│   │   ├── filters/             # 全局异常过滤器
│   │   ├── guards/              # 全局守卫（JwtAuthGuard、RolesGuard）
│   │   ├── interceptors/        # 全局拦截器（日志、响应包装）
│   │   ├── pipes/               # 全局管道
│   │   └── utils/               # 纯函数工具（不含业务语义）
│   ├── config/                  # 配置模块（环境变量校验、命名空间配置）
│   ├── infra/                   # 基础设施模块
│   │   ├── redis/               # Redis 客户端与缓存服务
│   │   ├── kafka/               # Kafka 生产者/消费者封装
│   │   └── spring/              # Spring 下游服务 HTTP 客户端封装
│   ├── modules/                 # 业务模块（按业务域划分）
│   │   ├── notification/        # 通知域
│   │   │   ├── dto/             # 请求/响应 DTO（class-validator）
│   │   │   ├── notification.gateway.ts
│   │   │   ├── notification.resolver.ts
│   │   │   ├── notification.controller.ts
│   │   │   ├── notification.service.ts
│   │   │   ├── notification.module.ts
│   │   │   └── index.ts         # 统一导出
│   │   └── dashboard/           # 聚合查询域
│   │       ├── dto/
│   │       ├── dashboard.resolver.ts
│   │       ├── dashboard.service.ts
│   │       ├── dashboard.module.ts
│   │       └── index.ts
│   ├── app.module.ts            # 根模块
│   └── main.ts                  # 入口（Fastify 引导）
├── test/                        # E2E 测试
├── .env.development             # 环境变量（不提交真实密钥）
├── nest-cli.json
├── package.json
├── tsconfig.json
└── tsconfig.build.json
```

## 分层约定

| 目录 | 职责 | 依赖规则 |
|------|------|---------|
| `modules/` | 业务域模块：gateway / resolver / controller / service | 只允许依赖 `infra/`、`common/` 与自身模块内部文件 |
| `infra/` | 基础设施：下游 HTTP 客户端、消息队列、缓存 | 只允许依赖 `config/`、`common/`，**禁止依赖 `modules/`** |
| `config/` | 环境变量加载与校验 | 不依赖任何业务目录 |
| `common/` | 横切组件与纯函数 | 不依赖任何业务目录 |

**单向依赖**：`modules/` → `infra/` → `config/`，禁止反向引用。

:::warning[避免教条化]
单一职责的小服务（仅一个业务域）可直接在 `src/` 下平铺模块，不必强行套 `modules/` 目录。分层是按需收口，不是所有项目都必须完整目录树。
:::

## 模块内部约定

- 每个业务域一个目录，目录名为单数小写连字符（`notification`、`dashboard`、`device-status`）
- 文件命名遵循 NestJS 约定：`{域名}.{角色}.ts`，角色 ∈ `controller` / `gateway` / `resolver` / `service` / `module` / `dto`
- 每个模块目录提供 `index.ts` 统一导出，使用方不深入内部路径

```ts
// modules/notification/index.ts
export { NotificationModule } from './notification.module';
export { NotificationService } from './notification.service';
```

```ts
// 推荐：从统一入口导入
import { NotificationService } from '@/modules/notification';

// 反例：深入内部路径
import { NotificationService } from '@/modules/notification/notification.service';
```

## DTO 约定

- 请求 DTO 与响应 DTO 分文件存放于 `dto/` 目录：`create-notification.request.ts`、`notification.payload.ts`
- 所有入口参数（REST Body / WS Message / GraphQL Input）必须有对应 DTO，并使用 class-validator 装饰器声明校验规则
- GraphQL Code First 的 ObjectType / InputType 与 DTO 复用同一类，避免重复定义

```ts
// modules/notification/dto/subscribe-topic.dto.ts
import { IsIn, IsNotEmpty, IsString } from 'class-validator';
import { Field, InputType } from '@nestjs/graphql';

@InputType()
export class SubscribeTopicDto {
  @Field()
  @IsString()
  @IsNotEmpty()
  topic: string;

  @Field()
  @IsIn(['user', 'tenant', 'broadcast'])
  scope: 'user' | 'tenant' | 'broadcast';
}
```
