---
title: 网关接入
description: Spring Cloud Gateway 静态路由配置——REST、GraphQL、WebSocket 与 SSE 四类流量的路由、超时与重试策略
---

# 网关接入

Spring Cloud Gateway 作为统一入口，通过**静态路由**将不同流量分发到 Spring 服务或 Node.js 服务。客户端只感知一个域名与一套路径，不感知后端技术栈。

## 路由划分

| 路径 | 目标服务 | 协议 | 说明 |
|------|---------|------|------|
| `/api/users/**` | `user-service` (Spring) | HTTP | 用户 CRUD |
| `/api/orders/**` | `order-service` (Spring) | HTTP | 订单 CRUD |
| `/api/devices/**` | `device-service` (Spring) | HTTP | 设备 CRUD |
| `/api/health/**` | `realtime-service` (Node.js) | HTTP | 健康检查（也可直连） |
| `/graphql` | `realtime-service` (Node.js) | HTTP | GraphQL 查询 |
| `/socket.io/**` | `realtime-service` (Node.js) | WebSocket | Socket.IO 长连接 |
| `/sse/**` | `realtime-service` (Node.js) | HTTP 长连接 | SSE 单向推送 |

## 配置示例

```yaml
# application.yml (Spring Cloud Gateway)
spring:
  cloud:
    gateway:
      routes:
        # ===== Node.js 实时服务 =====
        - id: realtime-graphql
          uri: http://realtime-service:3000
          predicates:
            - Path=/graphql
          filters:
            - name: Retry
              args:
                retries: 2
                statuses: BAD_GATEWAY,SERVICE_UNAVAILABLE
            - name: Timeout
              args:
                response-timeout: 10s

        - id: realtime-websocket
          uri: ws://realtime-service:3000
          predicates:
            - Path=/socket.io/**
          filters:
            # WebSocket 不重试、不设短超时
            - name: StripPrefix=0

        - id: realtime-sse
          uri: http://realtime-service:3000
          predicates:
            - Path=/sse/**
          metadata:
            response-timeout: -1   # SSE 长连接禁用响应超时
            connect-timeout: 5000

        - id: realtime-health
          uri: http://realtime-service:3000
          predicates:
            - Path=/api/health/**
          filters:
            - name: Timeout
              args:
                response-timeout: 3s

        # ===== Spring 业务服务 =====
        - id: user-service
          uri: lb://user-service
          predicates:
            - Path=/api/users/**
          filters:
            - name: Retry
              args:
                retries: 2
                statuses: BAD_GATEWAY,SERVICE_UNAVAILABLE

        - id: order-service
          uri: lb://order-service
          predicates:
            - Path=/api/orders/**
```

:::tip
`uri: lb://` 表示走 Spring Cloud LoadBalancer（需注册中心）；`uri: http://` 为静态直连，Node.js 服务使用静态直连即可。
:::

## WebSocket 路由要点

WebSocket 与 HTTP 路由的核心差异：

| 配置项 | HTTP / GraphQL | WebSocket |
|--------|---------------|-----------|
| `uri` scheme | `http://` | `ws://` |
| Retry | 允许 1-2 次 | **禁止**（长连接不可重试） |
| Response Timeout | 3-10s | **不设置**（连接长期持有） |
| Read Timeout | 默认 | 需调大（默认 30s 会断连） |
| Idle Timeout | 默认 | 需调大（默认 30s 会断连） |
| Sticky Session | 不需要 | **必须**（多实例时握手多请求须落到同一实例） |

```yaml
# 网关 WebSocket 专项配置
spring:
  cloud:
    gateway:
      httpclient:
        websocket:
          max-frame-payload-length: 65536
      routes:
        - id: realtime-websocket
          uri: ws://realtime-service:3000
          predicates:
            - Path=/socket.io/**
          metadata:
            response-timeout: -1   # 禁用响应超时
            connect-timeout: 5000
```

:::warning
Spring Cloud Gateway 默认的 `response-timeout` 与 `idle-timeout` 对 WebSocket 不友好，必须显式禁用或调大，否则长连接会被强制断开。
:::

### 多实例 Sticky Session

Node.js 服务扩容到多实例后，Socket.IO 握手的多次请求（polling → upgrade）必须落到同一实例，否则握手失败。两种落地方式（按基础设施任选其一）：

```yaml
# 方式一（推荐）：K8s Service 层会话亲和，网关无需改动
apiVersion: v1
kind: Service
metadata:
  name: realtime-service
spec:
  sessionAffinity: ClientIP
  sessionAffinityConfig:
    clientIP:
      timeoutSeconds: 10800
```

```yaml
# 方式二：Spring Cloud LoadBalancer Cookie 亲和（走注册中心 lb:ws:// 时）
spring:
  cloud:
    loadbalancer:
      sticky-session:
        add-service-instance-cookie: true
```

:::tip
Sticky Session 只负责“连接归属”，跨实例的消息广播仍需 Redis Adapter，两者职责互补，见 [性能参考 · 水平扩展策略](../../reference/performance/README.md#水平扩展策略)。
:::

## SSE 路由要点

SSE 是长连接 HTTP 响应（`text/event-stream`），网关配置介于普通 HTTP 与 WebSocket 之间：

| 配置项 | 普通 HTTP / GraphQL | SSE |
|--------|--------------------|-----|
| `uri` scheme | `http://` | `http://` |
| Retry | 允许 1-2 次 | **禁止**（断连由客户端自动重连恢复） |
| Response Timeout | 3-10s | **禁用**（连接长期持有） |
| 响应缓冲 | 默认 | **禁用**（缓冲会导致事件积压在网关） |
| Sticky Session | 不需要 | 不需要（单请求长连接，无多次握手） |

```yaml
- id: realtime-sse
  uri: http://realtime-service:3000
  predicates:
    - Path=/sse/**
  metadata:
    response-timeout: -1   # 禁用响应超时
    connect-timeout: 5000
```

:::warning
若网关联调时出现“事件批量延迟到达”而非实时下发，优先检查链路上的缓冲：Spring Cloud Gateway 默认不缓冲响应体，但前置的 Nginx / Ingress 需要显式 `X-Accel-Buffering: no`（或 `proxy_buffering off`）。
:::

## 认证透传

网关层完成 JWT 校验（Spring Security），透传身份信息给下游：

```java
// 网关过滤器示例（Spring）
@Component
public class AuthGlobalFilter implements GlobalFilter {
    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        String token = extractToken(exchange.getRequest());
        AuthPayload payload = jwtVerifier.verify(token);
        // 身份信息放入 Header，下游直接取用
        ServerHttpRequest mutated = exchange.getRequest().mutate()
            .header("X-User-Id", payload.getSub())
            .header("X-Tenant-Id", payload.getTenantId())
            .build();
        return chain.filter(exchange.mutate().request(mutated).build());
    }
}
```

Node.js 服务从 Header 直接读取身份，无需重复验签（内网信任网关）：

```ts
// common/middleware/trust-gateway.middleware.ts
@Injectable()
export class TrustGatewayMiddleware implements NestMiddleware {
  use(req: FastifyRequest['raw'], res: FastifyReply['raw'], next: () => void) {
    // 网关已验签，直接注入身份
    req.user = {
      sub: req.headers['x-user-id'],
      tenantId: req.headers['x-tenant-id'],
    };
    next();
  }
}
```

:::tip
若安全要求更高（零信任内网），Node.js 服务仍可独立验签（见 [认证授权](../../features/authentication/README.md)），与网关形成双重校验。
:::

## 健康检查与摘除

Node.js 服务暴露 `/api/health` 与 `/api/health/ready`，供网关与 K8s 探针使用：

```ts
// modules/health/health.controller.ts
@Controller('api/health')
export class HealthController {
  constructor(private readonly health: HealthCheckService) {}

  @Get()
  @Public()
  liveness() {
    return { status: 'ok' };
  }

  @Get('ready')
  @Public()
  readiness() {
    return this.health.check([
      () => this.redis.pingCheck('redis'),
      () => this.kafka.pingCheck('kafka'),
    ]);
  }
}
```

- **存活探针**：仅确认进程运行，不检查依赖
- **就绪探针**：确认 Redis、Kafka 等依赖可用，不可用则从负载均衡摘除
