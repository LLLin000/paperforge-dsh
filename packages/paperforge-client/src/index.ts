/**
 * @paperforge/client
 *
 * 共享 PaperForge TS 调用层。
 * 目标：Obsidian / DSH / 未来 Desktop 共用同一套 CLI 调用、PFResult 解析、
 * NDJSON 长任务解析和类型定义。
 *
 * 当前为骨架，后续从原仓库迁移/重构：
 * - paperforge/plugin/src/services/python-bridge.ts
 * - paperforge/plugin/src/services/action-client.ts
 * - paperforge/plugin/src/services/long-task-client.ts
 * - paperforge/plugin/src/services/managed-runtime.ts
 * - paperforge/plugin/src/constants.ts（类型部分）
 */

export interface PFResult<T = unknown> {
  ok: boolean
  command: string
  version: string
  data: T | null
  error: {
    code: string
    message: string
    details?: Record<string, unknown>
    suggestions?: string[]
  } | null
  warnings?: string[]
  next_actions?: Array<Record<string, unknown>>
}

export interface PaperForgeClientOptions {
  pythonPath?: string
  extraArgs?: string[]
  vaultPath?: string
  cwd?: string
  timeout?: number
}

export function createPaperForgeClient(_options: PaperForgeClientOptions = {}) {
  // TODO: 从 Obsidian python-bridge.ts 抽取通用实现
  throw new Error('paperforge-client is not implemented yet')
}
