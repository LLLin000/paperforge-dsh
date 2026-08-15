# PaperForge API 契约(前端 ↔ 后端冻结基准)

> 用途:两端对拍基准,2026-08-15 冻结草案。
> - **前端**(`paperforge-client` 共享层 + `paperforge-dsh` adapter)按此实现,不依赖后端内部。
> - **后端优化**:不得破坏「§一 已冻结」;按「§二 优化清单」补齐后冻结;「§三」可自由改。
>
> 依据:github-release 仓库源码(`core/result.py`、`commands/{probe,action,search,retrieve,config,status}.py`、`actions/runner.py`、`actions/types.py`)+ 设计文档(§2.1/§5.6/§5.7/§6)。

---

## 一、已冻结契约(改动即破坏前端)

### 1.1 CLI 全局形态
- 调用:`python -m paperforge --vault <path> <command> ... --json`
- `--json` 时 **stdout = 恰好一个 PFResult JSON**(成功或失败);stderr 仅诊断
- 版本握手:`python -c "import paperforge; print(paperforge.__version__)"` → stdout 纯版本号
- 安装契约:`pip install "paperforge[vector]==<version>"`;git 源 `git+https://github.com/LLLin000/PaperForge.git@<version>`

### 1.2 PFResult 信封(`core/result.py`)
```json
{ "ok": true, "command": "search", "version": "1.0",
  "data": { ... },
  "error": { "code": "embedding.credential_missing", "message": "...",
             "details": {}, "suggestions": ["..."] } | null,
  "warnings": ["..."],          // 可选
  "next_actions": [ { ... } ] } // 可选,action 链
```
- `error.code` 是**稳定字符串枚举**(`action.unknown`/`action.confirmation_required`/`action.cancelled`/`credential.confirm_required`/`action.unavailable`/`action.busy`/`action.scope_invalid`/`action.invalid_request`…),前端按 code 判定,message 只做展示。

### 1.3 probe(SCHEMA_VERSION=2,`commands/probe.py`)
- `probe all --json` → **裸信封(非 PFResult)**:`{schema_version:2, module:"all", updated_at, modules:{installation, library, ocr, memory, help, maintenance}}`
- 每 module envelope 关键字段:`capability_state`、`severity`(`ok/unknown/warning/error`)、`reason:{code,text}`、`action:{primary}`、`notices[]`、`ttl_seconds`
- 用户状态:`ready` / `not_enabled` / `setup_required` / `action_required` / `detection_failed` / `checking`
- safety 类:`safe` / `destructive` / `irreversible`

### 1.4 action(`commands/action.py` + `actions/runner.py`)
- `action list --json` → `data.actions:[{action_id, cost, impact, confirmation, automatic, ...}]`
- `action describe <id> --json` → descriptor(availability + preservation_facts + replacement_facts)
- `action run <id> --scope <kind> [--key K ...] [--confirm <id>] [--follow auto] --json`
- 退出码:**0** 成功 / **1** preflight 失败(`data.availability_reason_code`)/ **2** 无效请求 / **3** 需确认(携带当前 descriptor)/ **130** 取消(取消是终态,不折叠为 1)
- `--follow auto`:仅接管后代链;成功时根结果 `data.chain` 附带链 wire
- **action_id 命名空间是注册表枚举**(`sync`/`embed.build`/`ocr.rebuild`/`library.sync`/`config.embedding_credentials`…),前端 `pf_action` 直接消费

### 1.5 search / retrieve
- `search <query> --json` → PFResult,`data.matches[]`
- `retrieve <query> [--deep] [--limit N] [--paper K] --json` → `data:{query, matches, count, deep?, route_explanation:{primary_arm, query_rewrite?, hybrid?, compatibility_mode?}, scoped_paper?}`
- retrieve 失败时 **`data.next_action_id` = 注册 action id**(如 `embed.build`),绝不允许命令字符串

### 1.6 config(`commands/config.py`)
- `config list/get/set/unset/paths/validate/migrate --json` + `ConfigField` 结构(`key/value/stored_value/source/is_set/type/default/environment/choices/writable/allow_empty/vault_relative`)
- 密钥永不进 `paperforge.json`;keyring / `PAPERFORGE_CREDENTIAL_*` env 权威

### 1.7 NDJSON 长任务协议(#137)
- stdout 逐行 JSON:`{schema_version:1, event, operation, ...}`
- 事件集:`start / phase / progress / item_result / result / error / cancelled`
- **恰好一个终态**(result/error/cancelled)后 EOF;违反即 protocol failure
- 取消:stdin 写 `PAPERFORGE_STOP\n` → 宽限期 → 硬杀
- 硬规则:**stdout 只承载协议,所有 log 走 stderr**

### 1.8 凭据 seam(#173/C1)
- TS 端永远传脱敏 env;凭据由 Python 从 keyring/`PAPERFORGE_CREDENTIAL_*` 解析
- `auth status <kind> --json` → `credentials[].state == "available"`

---

## 二、后端优化清单(信息不足 → 补齐后冻结)

> 按优先级。每条 = 现状缺口 + 目标形态 + 出处。完成后在「§一」登记冻结。

### P0-1 workspace 级 canonical envelope(最缺)
- **现状**:`probe all` 返回散装 modules;severity/reason/action.primary/notices 分散在各 module,无聚合的 health、issues、available_actions。
- **缺口**:前端 `pf_status`(DSH 面板 + agent 工具)需要**一个命令拿全**状态;现在要前端拼装,且 agent 无法拿到"下一步可做什么"。
- **目标**:新增 `probe workspace --json`(或 `status` 升级),输出(设计 §5.7 示例):
```json
{ "state": "degraded",
  "issues": [ { "code": "embedding.stale", "severity": "warning", "summary": "..." } ],
  "available_actions": [ { "action_id": "embed.rebuild", "label": "...",
      "parameters": { "type": "object", "properties": {} },
      "risk": "safe", "requires_confirmation": false } ],
  "capabilities": [ ... ], "library_summary": { ... }, "recent_activity": { ... } }
```

### P0-2 available_actions 缺参数 JSON-Schema
- **现状**:`ActionSpec` 只有 `cost/impact/confirmation/automatic`(`actions/types.py`),无 `parameters` schema。
- **缺口**:agent 拿到 `available_actions` 后不知道 `pf_action` 怎么传参(scope? keys? 额外参数?);前端无法渲染参数表单。
- **目标**:每个 action 暴露 `parameters` JSON-Schema(在 `action describe` 与 workspace envelope 中同一份);新增带参 action 时必须提供 schema。

### P1-1 issue code 命名空间冻结
- **现状**:`reason.code` 已存在(probe),`availability_reason_code`(runner)已有,但未冻结为文档化枚举;设计文档示例用 `embedding.stale` / `embedding.credential_missing` / `ocr.pending`。
- **缺口**:code 是前端机器判定字段,命名不冻结就会漂移。
- **目标**:冻结 issue code 全集(模块前缀 + 状态),severity 严格用 `ok/unknown/warning/error`(已存在),写入本契约附录。

### P1-2 动作前置检查结构化输出
- **现状**:preflight 已内嵌 action 管线(rc1 + availability_reason_code),但失败时返回的是错误码而非"blocked 状态 + issues + 下一步 available_actions"。
- **缺口**:设计 §5.6 要求"问题当场由 agent 反馈,不需常驻轮询"——失败响应应让 agent 直接知道下一步调什么 action。
- **目标**:action 失败时(§5.6 `embed.build` 示例)返回:
```json
{ "ok": false, "state": "blocked",
  "issues": [{ "code": "embedding.credential_missing", "severity": "blocking" }],
  "available_actions": [{ "action_id": "config.embedding_credentials", ... }] }
```

### P1-3 三处 action 提示单一事实源
- **现状**:`PFResult.next_actions`(链式)、probe `action.primary`、retrieve `data.next_action_id` 三处分散,形状不一。
- **缺口**:前端无法统一消费;`pf_status`/`pf_action` 需要一个权威。
- **目标**:workspace envelope 的 `available_actions` 为唯一权威;其余保留为兼容别名(不删,标注 deprecated)。

### P2-1 search/retrieve `matches` 最小字段集
- **现状**:matches 元素字段未定型(Obsidian dashboard 只透传数组)。
- **缺口**:DSH `pf_search`/`pf_retrieve` 要返回结构化结果给 agent,字段不定则 agent 拿不到稳定信息。
- **目标**:冻结最小集 `key / title / authors / year / abstract / snippet / score`;deep 检索加 chunk 定位字段(`source_prefix: "deep"` 已有)。

---

## 三、可自由变化(接口之外)

- 内部实现:db schema、sqlite-vec/chromadb 后端、检索/混合加权算法、OCR 队列、embedding 模型、性能、缓存 TTL
- `matches` 内排序/评分数值、结果条数
- 新增 action(进 `action list` + `available_actions` 即自动暴露,无需改 TS)
- 依赖管理方式(保留 `paperforge[vector]` extras 名与版本号即可)
