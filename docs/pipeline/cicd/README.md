---
title: CI/CD 与部署
description: Node.js 服务的持续集成与容器化部署——GitLab CI 流水线、Docker 多阶段构建与运行契约
---

# CI/CD 与部署

Node.js 服务与 Spring 服务共用同一套 CI/CD 平台，但流水线针对 Node.js 特性做适配。

## CI 流水线（GitLab CI）

```yaml
# .gitlab-ci.yml
stages: [lint, test, package]

default:
  image: node:lts

variables:
  PNPM_HOME: "$CI_PROJECT_DIR/.pnpm"

.pnpm: &pnpm
  before_script:
    - export PATH="$PNPM_HOME/bin:$PATH"
    - curl -fsSL https://get.pnpm.io/install.sh | sh -
    - pnpm config set store-dir .pnpm-store
    - pnpm install --frozen-lockfile
  cache:
    key:
      files:
        - pnpm-lock.yaml
    paths:
      - .pnpm-store

workflow:
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_COMMIT_BRANCH == "develop"
    - if: $CI_COMMIT_BRANCH == "main"

lint:
  stage: lint
  <<: *pnpm
  script:
    - pnpm run lint
    - pnpm run typecheck

test:
  stage: test
  services:
    - name: redis:7
      alias: redis
    - name: apache/kafka:4.3.1
      alias: kafka
      variables:
        KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://kafka:9092
  variables:
    REDIS_URL: redis://redis:6379
    KAFKA_BROKERS: kafka:9092
  <<: *pnpm
  script:
    - pnpm run test
    - pnpm run test:e2e
    - pnpm audit --audit-level=high

package:
  stage: package
  image: docker:29
  services:
    - name: docker:29-dind
      alias: docker
  variables:
    DOCKER_HOST: tcp://docker:2376
    DOCKER_TLS_CERTDIR: /certs
    IMAGE_TAG: $CI_REGISTRY_IMAGE:$CI_COMMIT_SHA
  before_script:
    - docker login -u $CI_REGISTRY_USER -p $CI_REGISTRY_PASSWORD $CI_REGISTRY
    - docker pull $CI_REGISTRY_IMAGE:latest || true
  script:
    - docker build
      --cache-from $CI_REGISTRY_IMAGE:latest
      --tag $IMAGE_TAG
      --tag $CI_REGISTRY_IMAGE:latest
      .
    - docker push $IMAGE_TAG
    - docker push $CI_REGISTRY_IMAGE:latest
```

## 多阶段构建（Dockerfile）

构建在 Dockerfile 内完成（[Docker 官方最佳实践](https://docs.docker.com/build/building/best-practices/)第一条），`docker build` 一条命令从源码到镜像——builder 阶段编译并裁剪生产依赖，runner 阶段只 COPY 产物，最终镜像不含源码与构建工具链：

```dockerfile
# Dockerfile
# ---------- builder ----------
FROM node:lts AS builder
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build && pnpm prune --prod

# ---------- runner ----------
FROM node:lts AS runner
WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder --chown=node:node /app/package.json ./
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist

USER node
EXPOSE 3000

CMD ["node", "dist/main.js"]
```

**镜像要点**：

- 多阶段分离：最终镜像不含源码、构建工具链与 devDependencies，只打包 `dist` 与生产依赖（`pnpm prune --prod` 在 builder 内完成）
- 依赖清单（`package.json` + `pnpm-lock.yaml`）先于源码 COPY：依赖未变时 `pnpm install` 层直接命中缓存，源码改动不触发依赖重装
- 以基础镜像内置 `node` 用户（非 root）运行
- `node:lts` 满足框架运行要求（≥ 20.19 / 22.12，建议 Active LTS）

构建上下文排除无关文件，缩减传输与缓存失效面：

```
# .dockerignore
.git
.env*
node_modules
dist
*.log
*.md
coverage
test
```

## 运行与探活

镜像推送到仓库后，部署编排由运维侧统一承接（容器平台、编排工具不在本文档范围），应用侧需履行的契约：

| 契约 | 实现 | 说明 |
|------|------|------|
| 健康端点 | `GET /api/health`、`GET /api/health/ready` | 存活探针只确认进程运行；就绪探针确认 Redis / Kafka 依赖可用，未就绪不接流 |
| 优雅停机 | `enableShutdownHooks` + 响应 SIGTERM | 收到停止信号：先停接新连接 → 处理存量请求 → 关闭 WS 连接与 Kafka 消费者 → 退出 |
| 环境变量 | `NODE_ENV=production`、连接串、`JWT_PUBLIC_KEY` | 经部署平台密钥机制注入，不硬编码、不入镜像 |
| 镜像 tag | `CI_COMMIT_SHA`（不可变） | 部署可追溯到具体提交，回滚切回任意历史版本；`:latest` 漂移不可控 |
| 副本数 | ≥ 3 | WebSocket 场景单实例故障影响大，多实例水平分摊连接 |

:::tip[参见]
探活端点实现见 [可观测性 · 健康检查](../../integration/observability/README.md#健康检查)；优雅停机实现见下节。
:::

## 优雅停机

```ts
// main.ts
async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );

  app.enableShutdownHooks();

  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
```

- 部署平台的宽限期建议 ≥ 30s，覆盖停止信号传播与存量请求 draining
- Socket.IO 客户端实现自动重连，实例滚动更新时用户体验无感
