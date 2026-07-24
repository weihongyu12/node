---
title: 接口设计规范
description: Node.js 服务对外的三类接口设计规范——REST 端点、WebSocket 事件与 GraphQL Schema 的命名、错误模型与版本策略
---

# 接口设计规范

Node.js 服务对外暴露三类接口，分别遵循不同规范，但共享同一套错误模型与鉴权约定。

## 入口划分

| 入口 | 路径 / 形式 | 适用场景 |
|------|------------|---------|
| REST | `/api/**` | 健康检查、第三方回调、无法被 GraphQL 覆盖的运维端点 |
| WebSocket | `/socket.io/` | 实时推送、订阅管理、双向信令 |
| GraphQL | `/graphql` | 聚合查询、BFF 数据拼装 |

:::tip
业务查询优先走 GraphQL，实时推送走 WebSocket，REST 仅作兜底——避免三类接口职责混用。
:::

## REST 端点规范

### 命名

- 资源名使用复数名词：`/api/callbacks/payment`，不使用动词
- 层级不超过两级：`/api/{资源}/{动作或子资源}`
- 健康检查固定为 `/api/health`（存活）与 `/api/health/ready`（就绪），供网关与 K8s 探针使用

### 统一响应

REST 端点响应体与传统后端保持一致的信封结构，便于网关与前端复用同一套处理逻辑：

```json
{
  "code": 0,
  "message": "ok",
  "data": {},
  "traceId": "7f3a9c2e"
}
```

- `code`：业务码，`0` 表示成功，非零为业务错误码（与 Spring 服务同一码表）
- `message`：面向调用方的描述，生产环境不暴露内部异常细节
- `traceId`：链路追踪 ID，贯穿网关 → Node.js → Spring

### 版本策略

使用 NestJS 内置的 URI 版本控制，默认版本为 `v1`：

```ts
// main.ts
app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
```

破坏性变更升级版本号（`/api/v2/...`），同一实例内旧版本至少保留一个发布周期。

## WebSocket 事件规范

### 事件命名

- 事件名使用 `{域}:{动作}` 格式，小写连字符：`notification:subscribe`、`device:status-changed`
- **客户端 → 服务端**事件使用动词开头：`notification:subscribe`、`presence:heartbeat`
- **服务端 → 客户端**事件使用名词 + 过去分词：`notification:created`、`device:status-changed`

### 消息结构

客户端上行消息统一为：

```json
{
  "event": "notification:subscribe",
  "data": { "topic": "order", "scope": "tenant" },
  "ackId": "req-8f2d"
}
```

服务端下行消息统一为：

```json
{
  "event": "notification:created",
  "data": {},
  "timestamp": 1753000000000,
  "traceId": "7f3a9c2e"
}
```

- 上行消息的响应通过 Socket.IO **acknowledgement** 返回（`@SubscribeMessage` 返回值或 `@Ack()` 回调），不额外定义响应事件
- 需要多次推送的场景返回 `Observable<WsResponse>`，事件名与上行事件对应

### 连接管理

- 鉴权令牌通过连接握手 `auth` 字段传递（`socket.handshake.auth.token`），不支持 URL query 传令牌
- 服务端必须实现 `handleConnection` 校验令牌，非法连接立即 `disconnect()`
- 断线重连由客户端指数退避驱动，服务端不保留离线消息（离线消息归传统后端的站内信/推送通道）

## GraphQL Schema 规范

### 命名

- 类型使用 PascalCase：`Notification`、`DeviceStatus`
- 字段与查询使用 camelCase：`unreadCount`、`notificationsByTenant`
- Mutation 使用动词开头：`subscribeTopic`、`markNotificationRead`
- 输入类型以 `Input` 后缀，分页参数统一 `first` / `after`（游标）或 `page` / `pageSize`（页码，二选一全服务统一）

### 边界

- **只暴露聚合查询与轻量写编排**：GraphQL 的 Query 负责跨服务聚合，Mutation 仅做编排（调用 Spring 服务完成写操作），不直接持久化
- 单服务内字段解析禁止 N+1：跨实例字段必须使用 DataLoader 批处理
- Subscription 仅用于与 WebSocket 网关语义一致的实时场景；高频推送优先走 Socket.IO 事件而非 GraphQL Subscription

## 错误模型

三类入口的错误码统一，与传统后端共用码表：

| code 区间 | 含义 | 示例 |
|-----------|------|------|
| `0` | 成功 | - |
| `400xx` | 客户端参数错误 | `40001` 参数校验失败 |
| `401xx` | 认证失败 | `40101` 令牌过期、`40102` 令牌非法 |
| `403xx` | 授权失败 | `40301` 无权访问该租户 |
| `429xx` | 限流 | `42901` 触发限流 |
| `500xx` | 服务端错误 | `50001` 下游 Spring 服务不可用 |

- REST：通过全局 Exception Filter 映射为信封结构
- WebSocket：ack 响应与异常统一为 `WsException`，错误码放入响应 `code` 字段
- GraphQL：业务错误通过 `errors[].extensions.code` 返回，HTTP 状态码保持 200

:::warning
生产环境**禁止**向客户端返回堆栈、SQL、内部主机名等信息。GraphQL 需关闭 debug，Apollo 默认在生产环境已屏蔽堆栈，仍需通过 `formatError` 统一错误格式（见 [功能设计 · GraphQL](../../features/graphql/README.md)）。
:::

## 鉴权约定

三类入口共用同一套 JWT 校验（见 [功能设计 · 认证授权](../../features/authentication/README.md)）：

| 入口 | 令牌传递方式 |
|------|-------------|
| REST | `Authorization: Bearer <token>` 请求头 |
| GraphQL | `Authorization: Bearer <token>` 请求头 |
| WebSocket | 握手 `auth.token` 字段 |
