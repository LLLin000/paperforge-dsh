/**
 * @paperforge/dsh
 *
 * PaperForge DSH Cordis 插件（薄宿主适配层，design §2/D3）。
 * 所有 Python 调用走共享传输层 @paperforge/client —— 本包不实现任何
 * PaperForge 业务逻辑。
 *
 * 后续实现：
 * - host: ctx.subprocess → paperforge CLI（经 client 的 action/search/ndjson）
 * - service: ctx.paperforge
 * - tools: pf_search / pf_retrieve / pf_paper_context / pf_status /
 *          pf_action / pf_setup / pf_config
 * - client: DSH ui-slots 右侧 PaperForge 面板
 */

import {
  resolvePythonExecutable,
  type RuntimeSettings,
  type PythonResult,
} from "@paperforge/client";

export const name = "paperforge-dsh";

/** Host-provided runtime prefs for the shared transport. */
export interface DshRuntimeSettings extends RuntimeSettings {}

export function apply() {
  // TODO: 接入 Cordis Context，注册 service / tools / client。
  // 共享传输层已就绪：resolvePythonExecutable 可直接用于 handshake。
}

export type { PythonResult };

export { resolvePythonExecutable };
