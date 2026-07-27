---
title: SSE 实时推送
description: 基于 Server-Sent Events 的服务端单向推送设计——@Sse() 端点、事件流格式、断连清理与生产环境要点
---

# SSE 实时推送

SSE（Server-Sent Events）是基于 HTTP 的服务端单向推送通道：客户端通过 EventSource 建立长连接，服务端以 `text/event-stream` 格式持续下发事件。相比 WebSocket 更轻量、无额外协议开销，承接低频、单向的推送场景。

## 技术选型

| 方案 | 结论 | 理由 |
|------|------|------|
| **NestJS `@Sse()`** | ✔️ 采用 | 框架内置，返回 RxJS `Observable` 即完成事件流对接，零额外依赖 |
| 手写 `reply.raw` 流式响应 | 🔵 备选 | 可精细控制响应头与心跳，但需自行管理连接生命周期与序列化格式 |
| 以 Socket.IO 承载单向推送 | ❌ | 单向场景引入完整 WebSocket 协议与客户端 SDK，收益不匹配 |

### 与 WebSocket 的职责划分

| 维度 | SSE | WebSocket（Socket.IO） |
|------|-----|------------------------|
| 通信方向 | 服务端 → 客户端单向 | 双向 |
| 协议 | HTTP（`text/event-stream`） | WebSocket / 长轮询降级 |
| 断线重连 | 浏览器内置自动重连 | Socket.IO 客户端内置 |
| 房间 / 命名空间 | 无，需在流内按身份过滤 | 内置 |
| 横切组件 | 与普通 REST 同属 HTTP 上下文 | WS 上下文，需适配 |
| 适用场景 | 看板大屏、进度推送、低频通知 | 双向信令、订阅管理、高频推送 |

:::tip
约定：**单向、低频、无需确认**的推送走 SSE；**双向、房间化、高频**的推送走 Socket.IO。二者可并存，按业务域各取所需。
:::

## 服务端实现

`@Sse()` 与 `MessageEvent` 来自 `@nestjs/common`，无需安装额外依赖。SSE 端点注册在 Controller 上：

```ts
// modules/device/device-status.controller.ts
import { Controller, MessageEvent, Sse } from '@nestjs/common';
import { Observable, map } from 'rxjs';

@Controller('sse')
export class DeviceStatusController {
  constructor(private readonly deviceStatusService: DeviceStatusService) {}

  @Sse('device-status')
  streamStatus(@CurrentUser() user: AuthPayload): Observable<MessageEvent> {
    return this.deviceStatusService.stream(user.tenantId).pipe(
      map((status) => ({
        id: status.eventId,
        type: 'device:status-changed',
        data: status,
      })),
    );
  }
}
```

- 方法必须返回 `Observable`，流中每个元素序列化为一条 SSE 事件
- SSE 端点属 HTTP 上下文，全局 Guard / Interceptor / Filter 与普通 REST 端点一致生效
- `MessageEvent` 字段对应 SSE 协议：`data`（必需）、`id`（断线续传标识）、`type`（事件名，对应协议 `event:` 行）、`retry`（客户端重连间隔，毫秒）

事件在连接上的线格式：

```text
id: evt-1024
event: device:status-changed
data: {"deviceId":"D-001","status":"online"}

```

每条事件以两个换行结尾；`data` 为对象时由 NestJS 自动 JSON 序列化。事件命名与 WebSocket 事件共用 `{域}:{动作}` 约定（见 [接口设计规范 · SSE 事件流规范](../../specification/api/README.md#sse-事件流规范)）。

## 客户端

浏览器原生 EventSource 监听：

```ts
const eventSource = new EventSource('/sse/device-status');

// 监听具名事件（对应服务端 type 字段）
eventSource.addEventListener('device:status-changed', (event) => {
  console.log(JSON.parse(event.data));
});

// 断线后浏览器自动重连，无需手动实现退避
eventSource.onerror = () => { /* 连接异常，等待自动重连 */ };

// 主动关闭
eventSource.close();
```

:::warning[EventSource 无法自定义请求头]
原生 `EventSource` 不支持 `Authorization` 请求头，而 URL query 传令牌被安全基线禁止。生产环境使用 [`@microsoft/fetch-event-source`](https://github.com/Azure/fetch-event-source)（基于 fetch，支持请求头与 AbortController）：

```bash
pnpm add @microsoft/fetch-event-source
```

```ts
import { fetchEventSource } from '@microsoft/fetch-event-source';

const ctrl = new AbortController();

await fetchEventSource('/sse/device-status', {
  headers: { Authorization: `Bearer ${token}` },
  onmessage(event) {
    console.log(JSON.parse(event.data));
  },
  signal: ctrl.signal,
});

// 主动断开
ctrl.abort();
```
:::

## 断连清理

客户端断开时，NestJS 自动退订返回的 Observable，事件流随之停止。需要自定义清理（释放游标、注销订阅、回收定时器）时使用 `finalize` 操作符：

```ts
import { finalize, map } from 'rxjs';

@Sse('device-status')
streamStatus(@CurrentUser() user: AuthPayload): Observable<MessageEvent> {
  return this.deviceStatusService.stream(user.tenantId).pipe(
    map((status) => ({ type: 'device:status-changed', data: status })),
    // 客户端断开、流完成或出错时均会执行
    finalize(() => this.deviceStatusService.releaseStream(user.tenantId)),
  );
}
```

## 生产环境要点

### 网关与代理

SSE 是长连接 HTTP 响应，网关与反向代理必须针对性放行（完整配置见 [网关接入 · SSE 路由要点](../../integration/gateway/README.md#sse-路由要点)）：

- **禁用响应缓冲**：Nginx 设置 `X-Accel-Buffering: no`，否则事件积压在代理缓冲区无法实时到达
- **禁用响应超时**：网关默认的 response-timeout 会强制断开长连接
- **禁止重试**：SSE 不可幂等重试，断连由客户端自动重连恢复
- 单请求长连接，无多次握手，**不需要** Sticky Session

### 心跳保活

中间代理可能按空闲超时静默断连。服务端周期性下发具名心跳事件（客户端不监听该事件名，天然忽略）：

```ts
import { interval, map, merge } from 'rxjs';

@Sse('device-status')
streamStatus(@CurrentUser() user: AuthPayload): Observable<MessageEvent> {
  const heartbeat$ = interval(30000).pipe(
    map(() => ({ type: 'heartbeat', data: '' }) as MessageEvent),
  );
  const events$ = this.deviceStatusService.stream(user.tenantId).pipe(
    map((status) => ({ type: 'device:status-changed', data: status })),
  );
  return merge(heartbeat$, events$);
}
```

### 多实例推送

SSE 没有类似 Socket.IO Redis Adapter 的跨实例广播机制，事件流只存在于本实例的连接上。按推送语义二选一：

| 推送语义 | 策略 |
|---------|------|
| 状态广播类（全体连接接收同类事件） | 各实例以**独立 consumer group** 消费 Kafka，向本实例连接下发，天然水平扩展 |
| 精准推送（指定用户 / 租户） | 经 Redis Pub/Sub 分发，各实例订阅后匹配本实例连接下发 |

### 浏览器连接数限制

浏览器对同一域名的 HTTP/1.1 并发连接有限（约 6 个），SSE 长连接会占用额度：

- 在网关上启用 HTTP/2（多路复用），规避浏览器连接数限制
- 页面其余请求出现排队现象时，优先检查是否退化到 HTTP/1.1

## 与传统后端的协作

与 WebSocket 一致：数据权威来源是传统后端，Node.js 只做事件分发，协作时序见 [WebSocket · 与传统后端的协作时序](../websocket/README.md#与传统后端的协作时序)。

:::warning[边界红线]
- SSE 仅承载服务端单向推送；客户端上行操作走 REST / WebSocket，不在 SSE 通道上扩展双向语义
- 离线消息不在 SSE 通道补发，归传统后端的站内信/APNs 通道
:::
