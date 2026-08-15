# PaperForge DSH

PaperForge 的 DeepSeek Harness (DSH) 适配仓库。

> 目标：在不破坏现有 Obsidian 插件可用性的前提下，逐步把 PaperForge 迁移/适配到 DSH。
> 本仓库与 `github-release` 稳定仓库分离；Python Core 仍以原仓库/独立 pip 包为唯一后端。

## 仓库结构

```text
Paperforge-dsh/
├── docs/
│   ├── design.md                 # DSH 移植设计方案
│   └── ui-prototype.html         # UI 原型
├── packages/
│   ├── paperforge-client/        # 共享 TS 调用层（未来 Obsidian / DSH 共用）
│   └── paperforge-dsh/           # DSH Cordis 插件
└── package.json
```

## 原则

- PaperForge Python Core = 唯一后端
- DSH 只做宿主适配，不实现 PaperForge 业务逻辑
- 当前阶段不动原仓库 Obsidian 插件，保证其继续可用
