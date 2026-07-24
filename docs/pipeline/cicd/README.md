---
title: CI/CD 与部署
description: Node.js 服务的持续集成与容器化部署——GitHub Actions 流水线、Docker 多阶段构建与 K8s 部署清单
---

# CI/CD 与部署

Node.js 服务与 Spring 服务共用同一套 CI/CD 平台，但流水线针对 Node.js 特性做适配。

## CI 流水线（GitHub Actions）

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [develop, main]
  pull_request:
    branches: [develop, main]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm run lint
      - run: pnpm run typecheck

  test:
    runs-on: ubuntu-latest
    services:
      redis:
        image: redis:7
        ports: ['6379:6379']
      kafka:
        image: bitnami/kafka:3.7
        ports: ['9092:9092']
        env:
          KAFKA_CFG_NODE_ID: 0
          KAFKA_CFG_PROCESS_ROLES: controller,broker
          KAFKA_CFG_LISTENERS: PLAINTEXT://:9092,CONTROLLER://:9093
          KAFKA_CFG_ADVERTISED_LISTENERS: PLAINTEXT://localhost:9092
          KAFKA_CFG_LISTENER_SECURITY_PROTOCOL_MAP: CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT
          KAFKA_CFG_CONTROLLER_QUORUM_VOTERS: 0@localhost:9093
          KAFKA_CFG_CONTROLLER_LISTENER_NAMES: CONTROLLER
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm run test
      - run: pnpm run test:e2e
      - run: pnpm audit --audit-level=high

  build:
    needs: [lint, test]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: registry.example.com
          username: ${{ secrets.REGISTRY_USER }}
          password: ${{ secrets.REGISTRY_PASS }}
      - uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: |
            registry.example.com/realtime-service:${{ github.sha }}
            registry.example.com/realtime-service:latest
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

## Docker 多阶段构建

```dockerfile
# Dockerfile
# ---------- 构建阶段 ----------
FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build && pnpm prune --prod

# ---------- 运行阶段 ----------
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
RUN addgroup -g 1001 -S nodejs && adduser -S nestjs -u 1001

COPY --from=builder --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nodejs /app/dist ./dist
COPY --from=builder --chown=nestjs:nodejs /app/package.json ./

USER nestjs
EXPOSE 3000

# 优雅停机：先停接新连接，再处理存量请求，最后退出
CMD ["node", "dist/main.js"]
```

**镜像优化要点**：

- 基础镜像使用 `alpine`，最终镜像 ≤ 200MB
- 生产依赖与构建依赖分离，`pnpm prune --prod` 剔除 devDependencies
- 非 root 用户运行，降低容器逃逸风险

## 部署清单（K8s）

```yaml
# k8s/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: realtime-service
spec:
  replicas: 3
  selector:
    matchLabels:
      app: realtime-service
  template:
    metadata:
      labels:
        app: realtime-service
    spec:
      containers:
        - name: realtime-service
          image: registry.example.com/realtime-service:latest
          ports:
            - containerPort: 3000
          env:
            - name: NODE_ENV
              value: production
            - name: PORT
              value: "3000"
            - name: REDIS_URL
              valueFrom:
                secretKeyRef:
                  name: realtime-secrets
                  key: redis-url
            - name: JWT_SECRET
              valueFrom:
                secretKeyRef:
                  name: realtime-secrets
                  key: jwt-secret
          resources:
            requests:
              memory: "256Mi"
              cpu: "250m"
            limits:
              memory: "512Mi"
              cpu: "500m"
          livenessProbe:
            httpGet:
              path: /api/health
              port: 3000
            initialDelaySeconds: 10
            periodSeconds: 30
          readinessProbe:
            httpGet:
              path: /api/health/ready
              port: 3000
            initialDelaySeconds: 5
            periodSeconds: 10
          lifecycle:
            preStop:
              exec:
                command: ["sh", "-c", "sleep 5"] # 等待连接 draining
---
apiVersion: v1
kind: Service
metadata:
  name: realtime-service
spec:
  selector:
    app: realtime-service
  ports:
    - port: 3000
      targetPort: 3000
```

**部署要点**：

| 项 | 配置 | 理由 |
|---|------|------|
| 副本数 | ≥ 3 | WebSocket 场景单实例故障影响大 |
| 就绪探针 | `/api/health/ready` | 依赖（Redis/Kafka）未就绪不接流 |
| 优雅停机 | `preStop` sleep + `enableShutdownHooks` | 先停止接新连接，处理完存量再退出 |
| 资源限制 | memory 512Mi / cpu 500m | Node.js 单实例内存敏感，避免 OOMKill |

## 优雅停机

```ts
// main.ts
async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );

  // 收到 SIGTERM 时：先停止接新请求 → 关闭 WS 连接 → 关闭 Kafka 消费者 → 退出
  app.enableShutdownHooks();

  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
```

- K8s `terminationGracePeriodSeconds` 建议 ≥ 30s，覆盖 `preStop` + 连接 draining
- Socket.IO 客户端实现自动重连，实例滚动更新时用户体验无感
