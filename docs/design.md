# PaperForge → DeepSeek Harness 移植设计方案

> 目标:把 PaperForge(Obsidian + Zotero 文献工作台)以"即插即用"插件形态移植进 DeepSeek Harness(dsh),前后端都放到 dsh 的 Cordis 插件体系里,获得一个可对话驱动、可配置的"文献研究助手"。

---

## 0. 背景与已知条件(经源码调研确认)

### PaperForge
- 后端 = 纯 Python CLI `paperforge`,几十个子命令,**统一输出 `PFResult` JSON 到 stdout**(`{ok, command, version, data, error}`)。
- 前端 = Obsidian 插件(`paperforge/plugin/`,TS+esbuild,已编译 `main.js` 464KB),依赖 Obsidian API(desktop-only),通过 `python-bridge.ts` 用 child_process 调后端 CLI。**纯进程桥接,无深度 Obsidian 绑定。**
- 已有的 agent 协作层:`AGENTS.md`、`paperforge/commands/agent_context.py`、`paperforge/skills/`。`commands/__init__.py` 有 `_COMMAND_REGISTRY` 动态分发。
- 已内置 `agent-context`(查询路由)、`search`/`retrieve`/`paper-context` 等面向 agent 的分命令。
- **SCOPE 关键事实**:由于用户确认 <Zotero 是硬前提>,文献库以 Zotero + Better BibTeX 为主库,vault 通过 junction/symlink 指向 Zotero 数据,sync 拉取。

### DeepSeek Harness (dsh)
- 一切皆插件,基于 Cordis(TS),配置用 `cordis.yml`(profile = bundles 堆叠 + out-of-tree 插件 + 用户 `cordis.patch.yml`)。
- **能力接缝**(方案挂靠点):
  - `ctx.tools` — 工具注册(JSON-Schema + execute)
  - `ctx.skills` — 技能提供者注册(Markdown SKILL.md,`skill-filesystem` 可磁盘加载)
  - `ctx.subprocess` — 子进程接缝(`@deepseek-ai/dsh-subprocess-local`),支持 spawn 长驻进程、`stdio:'pipe'` 原始流、collect 尾部、树级优雅 terminate、PTY
  - `ctx.storage` / `ctx.sessions` / `ctx.credentials`(密钥 seam) / `ctx.userQuestions`(ask_user_question 工具)
- **标准工具插件模板**(以 `@deepseek-ai/dsh-tool-fs` 为范本):
  ```ts
  export const name = 'tool-fs'
  export const inject = ['tools', 'fs', 'systemPrompt']  // 声明依赖服务
  export const Config = z.object({ ... })                 // schemastery schema
  export function apply(ctx: Context, config: Config) {} // 注册工具
  ```
- 发布形态:标准 npm 包 + profile/cordis.yml insert,**即插即用、不引入 harness**(已验证可行)。

---

## 1. 决策记录

| 决策 | 结论 | 说明 |
|------|------|------|
| **D1 后端深度(演进式)** | **Phase 0 = one-shot CLI ← MVP;Phase 1 = 可选长驻 serve(远期)** | 见 §2/§7。第一版用 `ctx.subprocess → paperforge <cmd> --json → PFResult` 一次性调用,先脱离 Obsidian;**不把长驻进程当 MVP 前提**。启动延迟/jobs/events 确有需要时,再演进到 `paperforge serve --stdio`(作为 PaperForge core 正式命令,DSH/Obsidian/Desktop 共用同一 transport)。 |
| **D2 前端形态** | **TUI 式健康/注意面板(仅托管右侧 slot)** | 生产插件**只拥有 DSH UI 的右侧 PaperForge slot**(DSH owns sidebar/chat,PaperForge 不实现)。面板 = health + attention 控制面,检索/分析/执行交给 agent。 |
| **D3 发布形态** | **标准 npm 插件,即插即用;PaperForge 保持独立 pip 包** | **核心约束:PaperForge=内核,DSH=shell,adapter=仅传输层。单向依赖 DSH→PaperForge,绝不反向。** DSH 不实现任何 PaperForge 业务逻辑。 |
| **D4 库依赖** | **Zotero 硬前提** | 文献库 = Zotero + Better BibTeX,sync 拉取。 |
| **D5 运行平台** | 当前 **Windows**;不排除未来移植手机端(iSH/iOS) | Windows 可行;手机端需复评 vec0/vector 与 Python 运行时。 |
| **D6 凭据唯一事实源** | **第一版 PaperForge keyring 唯一权威** | DSH 只调用 `pf_config` / `pf_setup`,不另建 ctx.credentials 存储;避免"有时候在这有时候在那"的双存储。 |
| **D7 前端共享层** | **PaperForge Python Core 为唯一后端;新增共享 TS client(`paperforge-client`)供 Obsidian / DSH / 未来 Desktop 共用** | 两个前端都只写“宿主薄壳”;CLI argv、PFResult 解析、NDJSON 长任务解析、类型定义全部收敛到共享 client。后端契约稳定后,前后端可并行开发、互不阻塞。 |

> **三层审查原则(每次设计决策都要过)**:`DSH owns interaction / PaperForge owns truth / Adapter owns transport`。任何让 adapter 实现 PaperForge 业务逻辑、或让 PaperForge 依赖 DSH 的改动,都视为越界。

---

## 2. 架构总览(三层,单向依赖)

```
                    ┌──────────────────────┐
                    │      DSH Web         │   ← DSH owns interaction
                    │  chat / sessions     │
                    │  PaperForge UI slot  │
                    └──────────┬───────────┘
                               │ RPC / tools
                    ┌──────────▼───────────┐
                    │ paperforge-dsh       │   ← Adapter owns transport
                    │  Adapter only        │      (不实现业务逻辑)
                    │  tools/skills/UI桥/   │
                    │  process lifecycle   │
                    └──────────┬───────────┘
              Phase 0          │ ctx.subprocess one-shot
                     ┌─────────▼─────────┐
                     │ paperforge --json │   ← PaperForge owns truth
                     │  (CLI → PFResult) │
                     └─────────┬─────────┘
              Phase 1(远期)     │
                     ┌─────────▼─────────┐
                     │ paperforge serve  │
                     │ state/actions/jobs│
                     │ events/health     │
                     └─────────┬─────────┘
         ┌─────────────────────┼─────────────────────┐
         ▼                     ▼                     ▼
       Zotero              paperforge.db           OCR (云端API)
                          vec0 + FTS5
```

**三层铁律**:
- **DSH owns interaction** — chat/sessions/输入/UI 由 DSH 管,PaperForge 只挂右侧 slot。
- **PaperForge owns truth** — 建库/配置/校验/状态/动作 的一切规则与判定,全在 PaperForge(CLI 或 serve)。
- **Adapter owns transport** — `paperforge-dsh` 只做:命令→JSON-Schema 工具映射、subprocess 生命周期、UI 桥、结果转发。**绝不复制业务规则。**

> **Phase 0(现在)**:one-shot CLI。`ctx.fs` 最多用于路径选择/宿主可访问性检查/文件选择,**绝对不做建库/建 schema/junction**(那些走 PaperForge 命令)。

### 2.1 共享后端 + 共享 TS Client + 薄宿主适配

> **补充决策(D7,2026-08-15)**：用户确认希望“完全分割 Python 后端与前端”，即 `paperforge-dsh` 和原 Obsidian 前端**共用同一套 PaperForge Python 后端**，只在前端调用方式上做宿主适配，从而可以并行优化后端与各前端。

#### 目标

- **只维护一个 Python 后端**：PaperForge Core 是唯一事实源。
- **所有前端共用同一套后端契约**：PFResult、Probe、Action、Search/Retrieve、NDJSON 长任务事件。
- **新增共享 TS client**：`paperforge-client` 统一封装 CLI argv、PFResult 解析、NDJSON 解析、类型定义。
- **Obsidian / DSH / 未来 Desktop 都只写“宿主薄壳”**：不再各自维护一套 Python 调用/解析逻辑。

#### 目标架构

```text
┌─────────────────────────────────────────────┐
│            PaperForge Python Core            │
│  probe / action / search / retrieve / serve  │
└──────────────────────┬──────────────────────┘
                       │ 稳定契约：PFResult / NDJSON / JSON-Schema
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ paperforge-  │ │ paperforge-  │ │ paperforge-  │
│ client (TS)  │ │ dsh adapter  │ │ obsidian     │
│ 共享调用层    │ │ 薄宿主适配    │ │ 薄宿主适配    │
└──────────────┘ └──────────────┘ └──────────────┘
```

#### 共享 `paperforge-client` 的职责

```text
paperforge-client/
├── src/
│   ├── argv.ts          # 构造 paperforge CLI 参数
│   ├── pfresult.ts      # PFResult 类型 + 解析
│   ├── probe.ts         # ProbeEnvelope schema-v2 类型
│   ├── action.ts        # ActionRequest / ActionRun
│   ├── search.ts        # Search 请求/响应类型
│   ├── retrieve.ts      # Retrieve 请求/响应类型
│   ├── ndjson.ts        # 长任务 NDJSON 流解析
│   └── runtime.ts       # Python 解释器 / runtime pointer 发现
```

**Obsidian 与 DSH 各自只保留：**

| 宿主 | 保留内容 |
|------|----------|
| Obsidian | vault path、Markdown/当前笔记、Ribbon/View/SettingTab、Obsidian 特有命令 |
| DSH | `ctx.subprocess`、`ctx.tools`、`ctx.skills`、ui-slots、DSH 配置 |

#### 为什么不是“两个后端并行优化”

如果 DSH 和 Obsidian 各自维护一套后端，必然会出现行为分叉。  
正确做法是：

```text
一个 Python 后端
   ↓ 通过版本化契约
Obsidian 和 DSH 各自独立升级前端
```

后端可以快速演进，但通过：

- 稳定的 PFResult / Probe / Action / NDJSON 契约
- 契约测试 / golden files
- 语义化版本

保证两个前端互不阻塞。

#### 落地顺序

1. 抽取 Obsidian 现有 `python-bridge.ts` / `action-client.ts` / `long-task-client.ts` 的通用部分为 `paperforge-client`。
2. Obsidian 插件改为依赖 `paperforge-client`，删除重复解析逻辑。
3. DSH adapter 也依赖 `paperforge-client`，只写 Cordis/DSH 宿主适配。
4. 后续 `paperforge serve` 作为 Python Core 正式命令，继续由 `paperforge-client` 统一封装，DSH / Obsidian / Desktop 共用同一 transport。

---

## 3. 设计分块

### 3.1 工具层:`pf_*` 工具集(语义收敛,不镜像 CLI)

**原则**:CLI command registry ≠ LLM tool registry。CLI 给确定性调用者;Agent tool 是**语义 API**,数量收敛(~7),不把几十个子命令 1:1 暴露给模型。

| 工具 | 语义 | 对应 PaperForge |
|------|------|-----------------|
| `pf_search` | 全文/元数据检索 | `search` |
| `pf_retrieve` | 语义向量检索 | `retrieve` / `hybrid_search` |
| `pf_paper_context` | 单篇结构化上下文 | `paper-context` / `paper-status` / `reading-log` |
| `pf_status` | 单源状态 + issues + **available_actions** | `probe`(已有 action_id/availability/schema 方向) |
| `pf_action` | 执行一个命名动作 | `sync`/`ocr`/`embed`/`prune`/`repair` 等,**通过 action_id 分发** |
| `pf_setup` | 引导式初始化 | `setup`(checker→config→vault→deps→agent) |
| `pf_config` | 配置读写 | `config set/get/unset` |

**核心机制:`pf_status` + `pf_action`(单源状态→动作)**
- `pf_status(...)` 返回 `{ state, issues, available_actions }`(`available_actions` 带 action_id + 参数 schema + 风险/成本)。
- `pf_action(action="ocr.rebuild", ...)` 执行。
- **Python 新增命令(memory.rebuild / embed.resume / library.repair…)DSH 无需加 TS tool** —— 只要它在 `pf_status` 的 available_actions 里,`pf_action` 就能调。这就把 probe→reason/details→action 的单源状态方向贯彻到位。**Python 是内核,DSH 是 shell。**

### 3.2 Skill 层

用 dsh `skill` 机制封装 PaperForge 命令序列为可执行技能(如"深读一篇文献""从检索到精读的全流程"),agent 按流程调用而不是阻塞单发工具。`setup/agent.py` 的"deploy skills"在 dsh 场景下**直接部署到 dsh skill 注册表**,不再需要 `.agents/skills/` 目标目录。

### 3.3 TUI / agent 信息划分

**原则:凡是 agent 算得出、且需它上下文判断的,交给 agent;agent 不可见或不该每次问的低频全局信息,才进 TUI。**

✅ **TUI 常驻**(低频、全局、一次取):
| 区域 | 数据源 |
|------|--------|
| 健康 / 待处理 | `probe`(health + needs attention) |
| 库宏观统计 | `status` / `dashboard`(论文数、可检索、深读、存储) |
| 同步状态 | `status`(Zotero 同步时间) |

❌ **交给 agent**(agent 用工具自查自反馈):
- 检索结果(search/retrieve)、单篇上下文(paper-context/paper-status/reading-log)
- 深读分析、查询规划、变更操作执行及其结果反馈

> 一句话:**TUI = 健康 + 注意控制面;agent = 检索器 + 分析器 + 执行器。**

---

## 4. 前端(TUI)设计

### 4.1 边界:只拥有右侧 slot

**生产代码只实现右侧 PaperForge UI slot**(通过 ui-slots,dsh owns sidebar/chat)。不复制 Obsidian 的设置页/maintenance modal/search view/OCR view 等。左侧与中间由 DSH 提供,PaperForge 不碰。

### 4.2 定位:health + attention 控制面(非 stats panel)

右栏是**「整个库是否健康、有无需要处理的事」**,不是论文数展示。层级:

```
PaperForge
  HEALTH         ← hero
  Ready          All core systems operational
  LIBRARY        248 papers · 238 searchable · 6 deep-read
  NEEDS ATTENTION  2 OCR pending · 1 embedding stale   (全健康时: None)
  RECENT        Zotero 2min · OCR yesterday
```

hero 数字是 **✓ Library healthy**,异常时 **N items need attention**;论文数量是次要 metadata。

### 4.3 数据刷新:snapshot + events,非轮询

移除"60s auto-refresh"这类轮询设计:
- **页面重开 / reconnect → snapshot**(一次性拉取状态)。
- **状态变更 → event → host service → client RPC/event → 面板更新**。
- 不用 polling 作为 state system。Phase 0 无 serve 时,可接受"动作完成后触发一次状态刷新"(reactive),而非定时轮询。

---

## 5. Setup 移植(重点)——"方便配置"

### 5.1 铁律:DSH 不实现 PaperForge 业务逻辑

**`pf_setup` / `pf_config` / 状态 → 全部走 PaperForge 命令,DSH 只做薄透传。**
- 建库(目录/schema/junction/config 校验)一律由 PaperForge setup/config 完成。
- **DSH 的 ctx.fs 最多用于**:路径选择、宿主可访问性检查(如能否读 Zotero 目录)、UI 文件选择。**绝不拥有建库规则。**否则 PaperForge 改目录结构/schema/junction,DSH adapter 就 stale。

### 5.2 setup 全景(源码解剖,三层面)

| 层面 | 内容 | 源码 |
|------|------|------|
| **① 运行时环境** | Python≥3.11 + pip + `paperforge[vector]`(chromadb/sqlite_vec/openai) | `setup/plan.py`④ + `checker.py` |
| **② 文献库(vault)** | `paperforge.json` + 功能目录树(System/Resources/Literature/...) + **Zotero junction** + `.env`;库内容靠 sync 拉取 | `setup/vault.py` + `checker.py` |
| **③ 功能配置** | 5 个功能面,进 `paperforge.json` + keyring,见下 | `config.py` 17 个 FieldSpec |

**③ 的 5 个功能面:**
| 功能面 | 字段 | 凭据/外部依赖 |
|--------|------|--------------|
| vault 布局 | system/resources/literature/base/skill/command 目录 | 无 |
| Zotero 库 | `zotero_data_dir` | Zotero + Better BibTeX(硬前提) |
| OCR | `ocr_profile`、`paddleocr_job_url`、`paddleocr_model` | **PaddleOCR API key(云端付费,非本地推理)** |
| Embedding | `embedding_profile`、`vector_db_provider_type`、`vector_db_api_base`、`vector_db_api_model` | **embedding API key(keyring)** |
| Agent 平台 | `agent_platform`(opencode/claude/codex/...) | 各 agent skill 部署(dsh 场景≈部署到 dsh) |

> 密钥永不进 `paperforge.json`(#138/C1:keyring + env 权威),配置为 fail-closed(fail 前提,不猜测)。

### 5.3 dsh 中"方便配置"的形态(核心主张)

把 5 步手工向导压缩成**引导式对话**,但这些步骤**全部由 PaperForge 执行,DSH 只调度**:

- **`pf_setup`(引导初始化,agent 调度)**:说"建个新文献库连接我的 Zotero" → agent 依次调 `pf_setup` 的引导步骤(内部走 PaperForge `setup`,checker→config→vault→junction→deps)。**建库规则 100% 在 PaperForge,DSH 不建目录/schema/junction。**
- **`pf_config`(薄透传)**:`paperforge config set/get/unset`,复用其原子写/校验/schema;枚举变成 JSON-Schema properties。
- **`pf_status`(雷达图/health)**:驱动 TUI——`{ state, issues, available_actions }`,对应 §4.2 的 health+attention 层级。
- **仅人工项才 `ask_user_question`**:Zotero 数据路径、PaddleOCR key、embedding key。
- **凭据唯一事实源(D6)**:第一版 PaperForge keyring 继续唯一权威,**不引入 ctx.credentials 双存储**;DSH 只调 `pf_config`/`pf_setup`(密钥经它们写入 keyring)。

**参考对话流:**
```
用户:  "在 D:\research 建个库连我的 Zotero,做 OCR 和语义检索。"
agent: [pf_setup → 引导(走 PaperForge setup,建骨架/junction/config)]
       [pf_config → zotero_data_dir + embedding 选型]
       [pf_status → 发现缺 OCR key]
       [ask_user_question → "需要 PaddleOCR API key(百度 AI Studio)"]
用户:  [提供 key(写入 PaperForge keyring)]
agent: [sync 拉库 → 完成]
```

### 5.5 既有库的导入 & 动作前置检查

**导入**:`pf_setup` 支持"导入已有 vault"——校验已有 `paperforge.json`(schema version、base_paths,fail-closed 不猜测),Zotero 已有库直接指 junction。复用 PaperForge `checker` + `config` 能力,不重写规则。

**动作前置检查(替代长驻/轮询的关键)**:
每类动作在执行前,由 `pf_status`/对应命令自检其**板块前提**:
- `embed` 前 → 查向量构建状态 / embedding 配置;
- `ocr` 前 → 查 OCR key / 网络 / 队列;
- `search`/`retrieve` 前 → 查索引是否就绪。

**问题当场由 agent 反馈,不需要常驻进程、不需要轮询、不需要一直挂面板提醒。** 这正是"Agent 调用 embed 之前,自然就会看到哪里有问题,直接反馈"的实现——只需保证每个 action 暴露"前置检查结论",而不是让 DSH 持续轮询状态。

### 5.4 依赖痛点对策

| 痛点 | 对策 |
|------|------|
| Python 系统级缺失 | dsh 不内置 Python;用一键 `uv python install 3.12` + `uv venv` 建隔离环境(自动处理 sqlite-vec/chromadb wheel) |
| PaddleOCR key 交互 | 云端 API,不可自动化(付费服务)；由 `pf_setup` 走 `ask_user_question` 引导,密钥写入 PaperForge keyring(唯一权威,D6) |
| vector/全文依赖(Windows) | 主后端 = sqlite-vec(`vec0.so`)+ 原生 FTS5,都在 **Windows x86_64 有 wheel(已验证,§8.3)**,uv 一键安装 |
| 手机端移植(未来,B5) | **sqlite-vec 的 `vec0.so` 为 glibc 编译,无 musllinux-aarch64 wheel(iSH 无法直接加载)**,需自编译 musl 版或向量库服务化,属中长期改造(§8.3) |

---

### 5.6 状态体系:action-time validation(否决 always-on monitoring)

**核心原则:不做常驻监控内核;采用 action-time validation。** 正确性不依赖任何"全知常驻 daemon",而是依赖"任何操作发生时,PaperForge 都知道当前事实、允许什么、会改变什么"。

状态体系分三种检查(职责不同,勿混):

| 检查 | 时机 | 职责 | 说明 |
|------|------|------|------|
| **① Installation handshake** | host 刚准备调用 PaperForge 时检查一次 | 宿主↔PaperForge 接口健康 | 可执行?版本兼容?installation 完整?不需持续跑 |
| **② Action preflight** | 每次真正干活前 | **权威正确性检查** | 见下 |
| **③ Workspace snapshot** | 打开 DSH / 切 workspace / action 完成 / 手动刷新 | **observability**(供 UI/Agent 观察) | 过期没关系,因为执行 action 时会重新 preflight |

**② Action preflight 关键要求**:
- **preflight + execute 必须在同一个 PaperForge command contract 里**,绝不是"Agent 先检查、再运行"两个独立命令靠 agent 串联(否则正确性依赖 agent 记得检查,且 status 与执行间可能变化、CLI 绕过时无检查)。
- 每个 command:自身先跑 preflight → `blocker? → 返回 structured issue` / `ready → execute → result + next_actions`。
- 例 `embed.build`:vault 存在 → db 正常 → 有内容 → provider 配置完整 → API key 存在 → vec0 可加载 → schema 需 migrate? → 真需 rebuild?任一不过,直接返回 `{ok:false, state:"blocked", issues:[{code:"embedding.credential_missing", severity:"blocking"}], available_actions:[{action_id:"config.embedding_credentials",...}]}`。Agent 只解释,不自己懂"embed 需要哪些东西"。

### 5.7 统一 state / action contract(PaperForge core cleanup,非 DSH 专属)

**核心动作可能使"pf_status 多源"**:probe 一种 action、maintenance 又一套、setup 又一套,若由 DSH adapter 拼 available_actions 则仍多源、且 TS 开始拥状态组合逻辑(越界)。

**正确做法**:PaperForge core 正式冻结一个 **workspace-level canonical envelope**:

```json
{
  "state": "degraded",
  "issues": [
    { "code": "embedding.stale", "severity": "warning", "summary": "Embedding index is stale" }
  ],
  "available_actions": [
    { "action_id": "embed.rebuild", "label": "Rebuild embedding index",
      "parameters": { "type": "object", "properties": {} },
      "risk": "safe", "requires_confirmation": false }
  ]
}
```

- `paperforge action run embed.rebuild --json` **直接消费 action_id**。
- **DSH adapter 绝不自己翻译**(如 `if(issue==="embedding_stale") action="embed build..."`)。出现这种代码即越界。
- 命令出口:`paperforge probe workspace --json`(或等价 canonical 状态面),输出 `health / issues / capabilities / available_actions / library_summary / recent_activity`。Obsidian / DSH / CLI UI / 未来 Desktop **全读它**。
- 这是 PaperForge core 本来就该有的能力(core cleanup),不是 DSH-specific feature。

**UI 一致性**:Human UI 与 Agent 调用**同一个 action contract**——`issue → available_action.action_id → pf_action`。不是两条执行路径。Human UI 的按钮就是调用 pf_action,不是硬编码行为。

**UI 展示语言**:Python 状态事实返回结构化 `{ overall:"healthy" }`,**绝不返回本地化字符串**(如 "Library healthy")——展示语言由各前端 i18n,状态事实由 Python 给。

### 5.8 setup 状态机化

`pf_setup` 不做成"agent 一步步知道 checker→config→vault→junction→deps"。**setup 本身是状态机**:
- `pf_setup(mode="new", root="...")` → 返回 `{status:"needs_input", next_requirements:[{field:"zotero_data_dir", type:"path", reason:"..."}]}`。
- Agent 取用户输入后再调 `pf_setup(...)`,继续。
- **Agent owns conversation / PaperForge owns setup state machine** —— 完全符合三层铁律,Agent 不持有 setup 的 workflow。

### 5.9 何时才引入常驻 serve(仅明确需求驱动)

只有出现以下**明确需求**才上 `paperforge serve`(此时 daemon 职责 = job execution / scheduling / events,而非替 PaperForge 轮询找问题):
- OCR 一跑几十分钟需要关页面后继续;
- 多 Agent 并发需 job arbitration;
- 实时进度跨 session 推送;
- 需要暂停/恢复/取消任务;
- DSH 重启后需恢复未完成 job;
- Python cold start 已明显成性能瓶颈。

### 5.10 sync 如何"保持更新"(问题解答)

**sync 与 embed/ocr 不同:它的数据源在外部(Zotero + Better BibTeX 导出),天生有"新鲜度"概念。但不能因此回到轮询。正确的更新策略仍走 action-time validation + 按需快照:**

#### 现状事实(源码确认)
- PaperForge sync 是**纯命令式、按需**的:`paperforge sync` / `index-refresh` 手动触发。
- **无自动轮询、无文件监视、无 freshness 时间戳检测。**
- 输入 = `System/PaperForge/exports/*.json`(Better BibTeX 导出,外部产生)。
- 增量:按 Zotero key 对比(已有不重处理、新增补齐、删除清理 orphaned),**非全量重建**。
- **PaperForge 无法、也不该主动监听 Zotero**(那需要 daemon / 常驻监听)。

#### 怎么"保持更新"(不做常驻)
sync 本身不需要"一直保持最新"。它作为 **action**,享受和其他 action 相同的三项待遇:

1. **preflight 检测新鲜度**——`sync` 命令在 execute 前自检:
   - BBT exports 是否存在 / 有效(`BBT_EXPORT_NOT_FOUND` / `BBT_EXPORT_INVALID`);
   - **导出文件 mtime 是否比上次 sync 记录新**(若可记录 last_sync 时间,发现导出更新 → 提示"有可同步变更",否则 no-op);
   - 前置(Zotero 路径/Better BibTeX)是否满足。
2. **按需触发(embedded in action flows)**——哪些动作会用到库内容,就在其 preflight 里判断是否需要先 sync:
   - 如 `search`/`retrieve` 前若发现库从未同步或导出较新,可返回 `available_actions:[{action_id:"library.sync"}]`,提示先同步;
   - 但**不强制**——search 可在现存快照上工作,数据过期以 issue 提示,而非阻塞(除非解析器需要)。
3. **observability**——`pf_status` / 右栏 UI 的 `library_summary` + `recent_activity` 显示**上次 sync 时间**,作为"已知到何时为止"的锚点;不确定时就由 agent 或用户手动 `pf_action("library.sync")`。

#### 明确不做什么
- **不做"每 60s 检查导出文件"的轮询**——它本质上是最轻的常驻,仍违背 action-time validation。
- **不做 daemon 监听 Zotero/BBT**。
- **不做"同步永续最新"的假设**——快照一定可能滞后,靠 preflight 时新鲜度判断 + 按需 sync 兜住。

> **结论**:sync = 命令式 + preflight 检测新鲜度 + 按需在动作流里触发 + 以 last_sync 时间戳作可观测锚点。数据新鲜度由"用到时校验 + 需要时同步"保证,不由"常驻监控"保证。这与整个 action-time validation 体系一致。

---

## 6. 工作量预估

| 模块 | 内容 | 工作量 |
|------|------|--------|
| 共享 TS client | 抽取 `paperforge-client`：CLI argv、PFResult、Probe、Action、Search/Retrieve、NDJSON、runtime 发现；Obsidian 与 DSH 共用 | 中 |
| 工具层 | **收敛 ~7 个语义工具**(search/retrieve/paper_context/status/action/setup/config)→ JSON-Schema;Phase 0 **一次性 `ctx.subprocess` 调 CLI**(不装长驻),结果解析 | 小-中 |
| Skill 层 | 深读/检索/问答 3 个 SKILL.md | 小 |
| 后端 | **小改动(core cleanup)**——统一 state/action 为 workspace-level contract(不是 DSH 专属,PaperForge core 应有能力);其余复用现有 CLI → PFResult | 小 |
| Setup | `pf_setup`(薄透传 PaperForge setup)+ `pf_config`(透传 config)+ 前置检查 | 中 |
| TUI | 右侧 health+attention slot(ui-slots),snapshot+events | 中 |
| 集成验证 | 桌面 dsh + Node + Python 跑通纵向切片 | 中 |

---

## 7. 建议推进顺序(垂直切片,改自 P0-2)

> **当前原则:先用 one-shot CLI 快速脱离 Obsidian,不把长驻服务当 MVP。** 长驻 serve 仅当启动延迟 / jobs / 事件确有必要时再引入。

- **Vertical Slice 0(不改 Python 架构,最快)**:先抽取 `paperforge-client` 共享 TS 调用层;然后 DSH plugin → 一次性 `paperforge <cmd> --json` → PFResult。做通:**安装插件 → handshake → `pf_status` → `pf_search` → `pf_retrieve` → agent 回答 → UI slot 显示健康**。
- **Vertical Slice 1(脱离 Obsidian 验收)**:完全不启动 Obsidian,完成**安装 → 配置 → sync → search → retrieve → OCR/status** 全链路。
- **决策门**:再决定是否引入 `paperforge serve`。若启动延迟 / jobs / 后台任务 / 并发确有需要,才正式定义 transport 协议(见 §8.6)。
- **最后**:把 Obsidian **降级为可选 adapter**,只保留 vault/Markdown/当前笔记等 Obsidian 特有功能。

前置环境:**Windows + Node≥22 + uv**(依赖可行已确认,§8)。

---

## 8. 调研结论(全部完成,2026-08-15)

### ✅ 8.1 dsh 插件安装机制(out-of-tree / 即插即用)【已确认】

dsh profile 机制(`apps/cli/src/plugin.ts` + `packages/boot/app-boot`):

- Profile = `$DSH_HOME/profiles/<name>/`(DSH_HOME 默认 `~/.dsh`),含：
  - `package.json` → out-of-tree 插件 `dependencies` + `dsh.profile.bundles` 有序层列表
  - `cordis.patch.yml` → 用户补丁层(`insert`/id-targeted `config` 覆盖)
- **Bundle** = npm 包,其 manifest 声明 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`。
- **实际安装命令(用户只此一步)**:
  ```
  dsh plugin --profile <name> add @paperforge/dsh-bundle
  ```
  该命令:pnpm add → 检测包声明 `dsh.bundle` → **自动**追加到 `dsh.profile.bundles` 层栈。零手工改配置,即插即用成立。
- Cordis loader 解析 `@deepseek-ai/dsh-*` 等 bare 插件名；`healProfilesModuleFallback` 维护 profile 的 node_modules symlink。

> **落地**：paperforge-dsh 发布为 npm 包 `@paperforge/dsh-bundle`(声明 `dsh.bundle`),用户跑一条 `dsh plugin ... add` 即接入。

### ✅ 8.2 dsh 第三方面板(TUI 落点)【已确认,完全可行】

dsh Web UI(`apps/web` → `@deepseek-ai/dsh-client-web`)是浏览器应用,提供:

- **ui-slots 插槽系统**(`packages/client/ui-slots`,React 组件注册核心)：`ctx.slots.inject(name, cb)` + `ctx.slots.register({name, key, ...}, Component)`。
- **UI 插件包形态**(以 `ui-skill` 为范本)：宿主端空 `apply()` → **浏览器端**通过 `exports["./client"]` + `package.json` 的 `dsh.client` 声明被 web 运行时发现并加载。
  ```json
  "dsh": { "client": { "inject": [...], "platform": "web" } }
  ```
- browser 端 context 经 `ctx.get('connection')` 拿 RPC(`api.skills`/`api.sessions` 等),可驱动 tool/skill 调用。
- profile 模式：`web`(带浏览器 UI;TUI 落点)、`headless`(无 UI 一次性 runner)。

> **落地**：TUI 面板注册进 `web` profile 的 slot;同一个插件包可同时携带宿主端工具 `apply` 和浏览器端 `client` UI(两个独立入口,机制天然共存)。面板数据源 = `pf_status`(health + available_actions)。

### ✅ 8.3 本地向量存储(手机端评估)【已更正:主后端是 sqlite-vec,非 chromadb】

> **更正(2026-08-15,用户确认)**:当前主路径已用 **sqlite-vec + FTS5(全文检索)**,不再用 chromadb。ChromaDB 仅作旧库迁移/兼容层回退。

**实际架构**(源码确认 `memory/db.py` + `embedding/substrate.py` + `memory/schema.py` + `memory/fts.py`):
- **向量检索**:`sqlite_vec` 扩展 + **`vec0`** 虚拟表,metadata 同库(`paperforge.db`),`ensure_vec_extension()` 运行时 `sqlite_vec.load(conn)` 加载。
- **全文检索 FTS**:sqlite **原生 FTS5**(`paper_fts`/`body_units_fts`,`USING fts5(...)`,external-content + 触发器同步)。**FTS5 是 sqlite 内置模块,不依赖 sqlite-vec**——即使 vec0.so 未装,FTS5 也能单独跑。
- **混合检索**:`hybrid_search()` 融合 BM25(FTS5)与 vec0 k-NN,线性加权 `combined = 0.3*bm25_norm + 0.7*vec_norm`,带查询改写。
- 元数据/全文/向量**全在同一 `paperforge.db`**,依赖极轻——这正是从 chromadb 迁到 sqlite-vec 的动因。
- `paperforge/embedding/backends/chroma_backend.py` 仍存在,但 `runtime_health.py` 优先查 `vec0`,ChromaDB 路径标注"upgrade recommended",是回退。
- LanceDB 后端(评估接缝、非默认、未接 config)。
- 配置面不变:`vector_db_provider_type`(openai_sdk/requests)、`vector_db_api_base`、`vector_db_api_model`——**是 embedding 的 API provider 配置,与本地向量存储是两码事**。

**sqlite-vec 0.1.9 wheel 实测(含内容展开)**:每个 wheel = 一个 `vec0.so`(py3-none 纯加载)。
- ✅ **Windows x86_64**:`py3-none-win_amd64.whl` → 可用
- ✅ Linux glibc aarch64:`manylinux2014_aarch64` → 可用
- ❌ **musllinux aarch64(iSH/iOS 地形):无 wheel**(vec0.so 是 glibc 编译,musl 无法加载)

> **手机端评估**:与 chromadb 时代比,sqlite-vec 更轻(单个 .so,可自编译),**潜在解路**:为 iSH 自编译 musl 版 `vec0.so`/wheel;或向量库服务化。仍属中长期改造,不阻塞 Windows MVP。

### ✅ 8.4 uv 装 `paperforge[vector]` 在 Windows 可行性【已确认可行】

- `paperforge[vector]` extras = `chromadb + openai + sqlite-vec + socksio`(chromadb 为兼容层,主向量依赖是 sqlite-vec)。
- **Windows x86_64** 关键依赖(sqlite_vec `py3-none-win_amd64`、chromadb `cp39-abi3-win_amd64`)都有预编译 wheel → `uv python install 3.12 && uv venv && uv pip install "paperforge[vector]"` **一键可行,无需本机编译**。
- uv 优势:自动装隔离 Python、锁版本、避免编译坑。
- iSH 上 `vec0.so` 为 glibc 无法加载(见 8.3),实测在 Windows 做。

---

### ✅ 8.6 Phase-1 `paperforge serve` 协议要求(P0-3,前瞻)

> **仅在 §7 决策门确认需要时启用。** 且 serve 应作为 **PaperForge core 的正式命令**,让 DSH / Obsidian / PaperForge Desktop / 其他 agent **共用同一 transport**,不做 DSH 专属 wrapper。

**为何 NDJSON+PFResult 不够**:对 search 足够,但对 **OCR / sync / embed / rebuild / repair** 会遇到并发、归属、进度、取消、崩溃恢复问题。因此协议至少需要:

- **请求带 id**:`{ "id":"req-123", "method":"search", "params":{} }` → 结果能归属到请求。
- **流式事件**:`{ "id":"req-123", "event":"progress", "data":{} }`。
- **终态**:`{ "id":"req-123", "result":{ "ok":true } }`。
- **长任务生命周期**:`request → accepted → job_id → progress events → completed | failed | cancelled`。
- **并发**:支持 agent 同时调用多个 tool;每个请求独立 id。
- **取消**:tool call 取消 → 对应 job 可取消(cancel method)。
- **崩溃恢复**:进程 crash 后能识别哪些 job 是 interrupted。
- **硬规则:stdout 只承载协议,所有 Python log 走 stderr。** 否则第三方库往 stdout 打 warning,NDJSON parser 即乱。

---

## 8.7 待办(不再调研,进入实施时逐项处理)

- [ ] 在 Windows + Node≥22 实测 `dsh plugin --profile research add @paperforge/dsh-bundle` 全链路
- [ ] 确认 `@paperforge/dsh-bundle` 的双端包构建(exports `./client` + `dsh.client`)在有前端打包器(tsdown)时的具体配置
- [ ] 手机端(如有意)选型:LanceDB 迁移 vs chromadb 服务化
