---
title: 流水线
description: Node.js 服务的工程化流水线——代码检查、测试策略、CI/CD 与容器化部署
---

# 流水线

Node.js 服务的工程化与前端项目类似，但增加了服务端特有的质量门禁与部署约束。

## 流水线总览

```mermaid
graph LR
    A[提交代码] --> B[Lint / Format]
    B --> C[单元测试]
    C --> D[E2E 测试]
    D --> E[构建 Docker 镜像]
    E --> F[推送镜像仓库]
    F --> G[部署测试环境]
    G --> H[自动化验收]
    H --> I[人工审批]
    I --> J[部署生产环境]

    style B fill:#e1f5fe,stroke:#03a9f4
    style C fill:#fff3e0,stroke:#ff9800
    style D fill:#fff3e0,stroke:#ff9800
    style J fill:#c8e6c9,stroke:#4caf50
```

| 阶段 | 工具 | 门禁 |
|------|------|------|
| 代码检查 | ESLint + Prettier + TypeScript | 零警告、类型零错误 |
| 单元测试 | Jest | 核心 service 覆盖率 ≥ 80% |
| E2E 测试 | Jest + supertest（Fastify 适配） | 关键链路全通过 |
| 安全审计 | pnpm audit | 高危漏洞阻断 |
| 构建 | SWC + Docker 多阶段构建 | 镜像体积 ≤ 200MB |
| 部署 | K8s / Docker Compose | 就绪探针通过后接流 |

## 与前端流水线的差异

| 维度 | 前端 | Node.js 服务端 |
|------|------|---------------|
| 运行环境 | 浏览器 | Node.js 进程（容器） |
| 测试重点 | 组件渲染、交互 | 业务逻辑、下游调用、并发 |
| 部署目标 | CDN / 静态托管 | K8s / 容器编排 |
| 健康检查 | 无 | 必须暴露探针 |
| 回滚方式 | 重新部署旧版本 | 切换镜像版本 + 就绪探针验证 |

## 关键原则

- **一次构建，到处运行**：镜像构建时注入环境无关配置，环境差异通过环境变量注入
- **不可变部署**：任何变更通过新镜像发布，禁止容器内修改
- **快速回滚**：保留最近 3 个镜像版本，回滚切换时间 < 1 分钟
