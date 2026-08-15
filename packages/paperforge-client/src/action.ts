/**
 * Action transport — single-result mode: `paperforge action run <id> ...`
 * → EXACTLY ONE PFResult JSON on stdout (never mixed with the streaming
 * mode).  Env is always the redacted paperforgeEnrichedEnv() — never
 * `{...process.env, ...userEnv}` (that re-introduces secret keys).
 */

import { runSubprocess } from "./subprocess.js";
import { paperforgeEnrichedEnv } from "./env.js";
import { buildActionArgv, type ActionRequest } from "./argv.js";

export type { ActionRequest, ActionScope } from "./argv.js";

export interface ActionRunResult {
  ok: boolean;
  payload: Record<string, unknown> | null;
  exitCode: number;
}

export function runActionRequest(
  pythonExe: string,
  extraArgs: string[],
  vaultPath: string,
  req: ActionRequest,
  timeout = 120000
): Promise<ActionRunResult> {
  const argv = [
    ...extraArgs,
    "-m",
    "paperforge",
    "--vault",
    vaultPath,
    ...buildActionArgv(req),
  ];
  return runSubprocess(
    pythonExe,
    argv,
    vaultPath,
    timeout,
    undefined,
    paperforgeEnrichedEnv()
  ).then((res) => {
    try {
      const payload = JSON.parse(res.stdout) as Record<string, unknown>;
      return {
        ok: payload.ok === true,
        payload,
        exitCode: res.exitCode,
      };
    } catch {
      return { ok: false, payload: null, exitCode: res.exitCode };
    }
  });
}
