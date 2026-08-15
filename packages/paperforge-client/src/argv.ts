/**
 * CLI argv construction — the ONE place paperforge command bodies are
 * assembled.  Hosts (Obsidian / DSH) never hand-build argv; the shared
 * transport appends `-m paperforge --vault <path>` and `--json`.
 *
 * Semantic tools (search / action) own their mode flags here; config /
 * probe bodies are literal command words passed to the transport directly.
 */

export interface ActionScope {
  kind: string;
  keys?: string[];
}

export interface ActionRequest {
  action_id: string;
  scope: ActionScope;
  /** Exact action id for the confirmation gate (post-user-confirmation). */
  confirm?: string;
  follow?: "none" | "auto";
}

/** The one argv builder for action requests (T8 #169). */
export function buildActionArgv(req: ActionRequest): string[] {
  const argv = ["action", "run", req.action_id, "--scope", req.scope.kind];
  if (req.scope.kind === "papers") {
    for (const key of req.scope.keys ?? []) {
      argv.push("--key", key);
    }
  }
  if (req.confirm) {
    argv.push("--confirm", req.confirm);
  }
  if (req.follow === "auto") {
    argv.push("--follow", "auto");
  }
  argv.push("--json");
  return argv;
}
