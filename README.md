# PaperForge DSH

PaperForge 的 DeepSeek Harness (DSH) 适配仓库。

> 目标：在不破坏现有 Obsidian 插件可用性的前提下，逐步把 PaperForge 迁移/适配到 DSH。
> 本仓库与 `github-release` 稳定仓库分离；Python Core 仍以原仓库/独立 pip 包为唯一后端。

## 仓库结构

```text
Paperforge-dsh/
├── docs/
│   ├── design.md                 # DSH 移植设计方案
│   ├── api-contract.md           # 前端↔后端接口冻结基准（后端优化清单）
│   └── ui-prototype.html         # UI 原型
├── packages/
│   ├── paperforge-client/        # 共享 TS 调用层（Obsidian / DSH 共用传输）
│   └── paperforge-dsh/           # DSH Cordis 插件（薄宿主适配）
└── package.json
```

## 上游仓库（共享后端的家）

Python Core 与 Obsidian 插件在独立稳定仓库，本仓库的共享 TS 层从这里抽取：

```text
D:\L\Med\Research\99_System\LiteraturePipeline\github-release
├── paperforge/            # Python Core（唯一后端，独立 pip 包）
│   └── plugin/            # Obsidian 插件（TS，薄宿主）
│       └── src/services/  # ← paperforge-client 抽取来源（python-bridge /
│                          #    action-client / long-task-client / config-client）
└── scripts/               # pre-commit 守卫等（.husky 已按需继承）
```

共享层抽取原则（design §2.1 / D7）：只搬传输层（argv / PFResult / NDJSON /
runtime 发现 / env），宿主 UI 状态、路径投影、向导逻辑留在各宿主。
阶段 B 时 Obsidian 插件改为依赖 `@paperforge/client` 并删除重复解析。

## 原则

- PaperForge Python Core = 唯一后端
- DSH 只做宿主适配，不实现 PaperForge 业务逻辑
- 当前阶段不动原仓库 Obsidian 插件，保证其继续可用
