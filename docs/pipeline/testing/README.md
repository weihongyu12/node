---
title: 测试
description: Node.js 服务端测试策略——单元测试、集成测试与 E2E 测试的分层覆盖与工具选型
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# 测试

测试金字塔：单元测试覆盖核心逻辑，集成测试验证下游协作，E2E 测试保障关键链路。

## 测试分层

| 层级 | 范围 | 工具 | 覆盖率目标 |
|------|------|------|-----------|
| 单元测试 | service / provider / 工具函数 | Vitest | 核心 service ≥ 80% |
| 集成测试 | 网关 → service → 下游 mock | Vitest + Fastify inject | 关键 API 全通过 |
| E2E 测试 | 完整容器环境（真实 Redis/Kafka） | Vitest + Fastify inject | 核心用户旅程全通过 |

## 单元测试

```bash
pnpm add -D vitest vite-tsconfig-paths @vitest/coverage-v8 @nestjs/testing
```

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    include: ['**/*.spec.ts'],
  },
});
```

`globals: true` 时在 `tsconfig.json` 补充全局类型声明：

```json
{ "compilerOptions": { "types": ["vitest/globals"] } }
```

```json
// package.json scripts
{
  "test": "vitest run",
  "test:watch": "vitest",
  "test:cov": "vitest run --coverage",
  "test:e2e": "vitest run --config ./vitest.config.e2e.ts"
}
```

<Tabs>
  <TabItem value="service" label="Service 测试">

```ts
// modules/notification/notification.service.spec.ts
describe('NotificationService', () => {
  let service: NotificationService;
  let springClient: SpringApiClient;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationService,
        {
          provide: SpringApiClient,
          useValue: { getTenantStats: vi.fn() },
        },
      ],
    }).compile();

    service = module.get(NotificationService);
    springClient = module.get(SpringApiClient);
  });

  it('聚合租户通知数据', async () => {
    vi.mocked(springClient.getTenantStats).mockResolvedValue({ unread: 5 });
    const result = await service.aggregate('tenant-1');
    expect(result.unread).toBe(5);
  });
});
```

  </TabItem>
  <TabItem value="guard" label="Guard 测试">

```ts
// common/guards/jwt-auth.guard.spec.ts
describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let jwtService: JwtService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtAuthGuard,
        { provide: JwtService, useValue: { verifyAsync: vi.fn() } },
        { provide: ConfigService, useValue: { get: vi.fn().mockReturnValue('pem') } },
      ],
    }).compile();

    guard = module.get(JwtAuthGuard);
    jwtService = module.get(JwtService);
  });

  it('有效令牌放行', async () => {
    vi.mocked(jwtService.verifyAsync).mockResolvedValue({ sub: 'user-1', tenantId: 't-1' });
    const context = createMockExecutionContext({ headers: { authorization: 'Bearer valid' } });
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('无效令牌拒绝', async () => {
    vi.mocked(jwtService.verifyAsync).mockRejectedValue(new Error('expired'));
    const context = createMockExecutionContext({ headers: { authorization: 'Bearer invalid' } });
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });
});
```

  </TabItem>
</Tabs>

**Mock 原则**：

- 下游 HTTP 调用（SpringApiClient）必须 mock，不发起真实网络请求
- Redis 操作使用 `ioredis-mock` 或内存实现，不连接真实 Redis
- Kafka 事件（kafkajs）mock 处理器注册或 Producer，不连接真实 broker

## E2E 测试

E2E 测试在独立容器中运行，连接真实 Redis 与 Kafka（Docker Compose 编排）。独立的 `vitest.config.e2e.ts` 与单元测试隔离（不同 include 模式，可独立编排执行时机）：

```ts
// vitest.config.e2e.ts
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    include: ['test/**/*.e2e-spec.ts'],
  },
});
```

```ts
// test/app.e2e-spec.ts
describe('AppController (e2e)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('/api/health (GET)', () => {
    return app.inject({ method: 'GET', url: '/api/health' })
      .then((res) => {
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.payload).status).toBe('ok');
      });
  });

  it('GraphQL 聚合查询', () => {
    const query = `{ dashboard { tenantId stats { unread } } }`;
    return app.inject({
      method: 'POST',
      url: '/graphql',
      headers: { authorization: 'Bearer test-token' },
      payload: { query },
    }).then((res) => {
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.payload).data.dashboard).toBeDefined();
    });
  });
```

## 测试数据管理

- 测试数据在 `beforeAll` 中通过工厂函数构造，测试间隔离
- 敏感字段（密码、令牌）使用固定测试值，不使用真实数据
- 测试完成后清理 Redis key 与 Kafka topic（或按测试用例命名隔离）
