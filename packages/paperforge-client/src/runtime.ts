/**
 * Runtime discovery — Python executable resolution, version handshake,
 * install-command construction, and error classification.
 *
 * Extracted from the Obsidian plugin `python-bridge.ts` (github-release
 * repo, design §2.1 `runtime.ts`).  Transport-layer only: hosts pass a
 * `RuntimeSettings` subset (`python_path`) instead of their full settings
 * object; the shared layer never touches host UI state.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execFile, execFileSync, type ExecFileOptions, type ExecFileSyncOptions } from "child_process";
import { paperforgeEnrichedEnv } from "./env.js";

/** Host-provided runtime preferences (Obsidian settings subset). */
export interface RuntimeSettings {
  python_path?: string;
}

// ── Injected-dependency interfaces (tests pass mocks; defaults are real) ──

export interface FsLike {
  existsSync(p: string): boolean;
}

export interface ExecFileSyncLike {
  (cmd: string, args: readonly string[], opts: Record<string, unknown>): string;
}

export interface ExecFileLike {
  (
    cmd: string,
    args: readonly string[],
    opts: Record<string, unknown>,
    cb: (err: unknown, stdout: unknown, stderr: unknown) => void
  ): void;
}

const fsDefault: FsLike = fs;
const execFileSyncDefault: ExecFileSyncLike = (cmd, args, opts) => {
  const r = execFileSync(cmd, args, opts as ExecFileSyncOptions);
  return typeof r === "string" ? r : r.toString();
};
const execFileDefault: ExecFileLike = (cmd, args, opts, cb) => {
  execFile(cmd, args, opts as ExecFileOptions, (err, stdout, stderr) =>
    cb(err, stdout, stderr)
  );
};

// ── Types ──

export interface PythonResult {
  path: string;
  source: "manual" | "auto-detected";
  extraArgs: string[];
}

export interface InstallCommand {
  cmd: string;
  url: string;
  args: string[];
  pypiArgs: string[];
  gitArgs: string[];
  timeout: number;
}

export interface ErrorClassification {
  type: string;
  message: string;
  recoverable: boolean;
  action?: string;
}

export interface RuntimeStatus {
  status: string;
  version: string | null;
  type?: string;
  message?: string;
  recoverable?: boolean;
  action?: string;
}

export interface QueryPlanResult {
  ok: boolean;
  command: string;
  version: string;
  data: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
}

// ── Runtime helpers ──

export function resolvePythonExecutable(
  vaultPath: string,
  settings: RuntimeSettings | null | undefined,
  _fs: unknown,
  _execFileSync: unknown
): PythonResult {
  const f = (_fs as FsLike | undefined) ?? fsDefault;
  const execSync = (_execFileSync as ExecFileSyncLike | undefined) ??
    execFileSyncDefault;

  if (settings && settings.python_path && settings.python_path.trim()) {
    const manualPath = settings.python_path.trim();
    if (f.existsSync(manualPath)) {
      return { path: manualPath, source: "manual", extraArgs: [] };
    }
  }

  const venvCandidates = [
    path.join(vaultPath, ".paperforge-test-venv", "Scripts", "python.exe"),
    path.join(vaultPath, ".venv", "Scripts", "python.exe"),
    path.join(vaultPath, "venv", "Scripts", "python.exe"),
  ];
  for (const candidate of venvCandidates) {
    try {
      if (f.existsSync(candidate)) {
        return { path: candidate, source: "auto-detected", extraArgs: [] };
      }
    } catch {}
  }

  const systemCandidates = [
    { path: "py", extraArgs: ["-3"] },
    { path: "python", extraArgs: [] },
    { path: "python3", extraArgs: [] },
  ];
  for (const candidate of systemCandidates) {
    try {
      const verOut = execSync(
        candidate.path,
        [...candidate.extraArgs, "--version"],
        { encoding: "utf-8", timeout: 5000, windowsHide: true }
      );
      if (verOut && verOut.toLowerCase().includes("python")) {
        return {
          path: candidate.path,
          source: "auto-detected",
          extraArgs: candidate.extraArgs,
        };
      }
    } catch {}
  }

  return { path: "python", source: "auto-detected", extraArgs: [] };
}

export interface RuntimeVersionCheck {
  status: string;
  pyVersion: string | null;
  pluginVersion: string | null;
  error: string | null;
}

export function checkRuntimeVersion(
  pythonExe: string,
  pluginVersion: string | null,
  cwd: string,
  timeout: number | undefined,
  _execFile: unknown
): Promise<RuntimeVersionCheck> {
  const timeoutMs = timeout === undefined ? 10000 : timeout;
  const exe = (_execFile as ExecFileLike | undefined) ?? execFileDefault;
  const { promise, resolve } = Promise.withResolvers<RuntimeVersionCheck>();

  exe(
    pythonExe,
    ["-c", "import paperforge; print(paperforge.__version__)"],
    { cwd, timeout: timeoutMs },
    (err, stdout) => {
      if (err) {
        resolve({
          status: "not-installed",
          pyVersion: null,
          pluginVersion,
          error: err instanceof Error ? err.message : String(err),
        });
        return;
      }
      const pyVer =
        typeof stdout === "string" && stdout.trim() ? stdout.trim() : null;
      resolve({
        status: pyVer === pluginVersion ? "match" : "mismatch",
        pyVersion: pyVer,
        pluginVersion,
        error: null,
      });
    }
  );
  return promise;
}

// ── Error helpers ──

export function classifyError(errorCode: string): ErrorClassification {
  const code = String(errorCode);
  const patterns: Record<string, ErrorClassification> = {
    ENOENT: {
      type: "python_missing",
      message: "Python executable not found",
      recoverable: true,
    },
    "python-missing": {
      type: "python_missing",
      message: "Python executable not found",
      recoverable: true,
    },
    MODULE_NOT_FOUND: {
      type: "import_failed",
      message: "PaperForge package not installed",
      recoverable: true,
    },
    "import-failed": {
      type: "import_failed",
      message: "PaperForge package not installed",
      recoverable: true,
    },
    "version-mismatch": {
      type: "version_mismatch",
      message: "Plugin and package versions differ",
      recoverable: true,
      action: "sync-runtime",
    },
    "pip-failed": {
      type: "pip_install_failure",
      message: "pip install command failed",
      recoverable: true,
    },
    ETIMEDOUT: {
      type: "timeout",
      message: "Subprocess timed out",
      recoverable: true,
      action: "retry",
    },
    timeout: {
      type: "timeout",
      message: "Subprocess timed out",
      recoverable: true,
      action: "retry",
    },
    NO_PYTHON: {
      type: "no_python",
      message: "Python executable not found",
      recoverable: true,
      action: "open-setup",
    },
    VECTOR_NOT_BUILT: {
      type: "vectors_not_built",
      message: "Vector index has not been built yet",
      recoverable: true,
      action: "open-vector-settings",
    },
    VECTOR_CORRUPTED: {
      type: "vectors_corrupted",
      message: "Vector index is corrupted",
      recoverable: true,
      action: "force-rebuild",
    },
    MODEL_CHANGED: {
      type: "model_changed",
      message: "Embedding model has changed since vectors were built",
      recoverable: true,
      action: "rebuild-vectors",
    },
    BACKEND_UNAVAILABLE: {
      type: "backend_unavailable",
      message: "Python CLI search backend is not responding",
      recoverable: true,
      action: "run-doctor",
    },
    TIMEOUT: {
      type: "timeout",
      message: "Search timed out",
      recoverable: true,
      action: "retry",
    },
    INTERNAL_ERROR: {
      type: "internal_error",
      message: "An internal error occurred",
      recoverable: false,
    },
  };
  const match = patterns[code];
  if (match) return { ...match };
  return { type: "unknown", message: String(errorCode), recoverable: false };
}

export function buildRuntimeInstallCommand(
  pythonExe: string,
  version: string,
  extraArgs: string[]
): InstallCommand {
  const args = extraArgs === undefined ? [] : extraArgs;
  // #120-fix (P0-2): always install with vector extras — bare paperforge
  // leaves Build Index broken (missing openai/sqlite_vec).
  const pypiPkg = `paperforge[vector]==${version}`;
  // PEP 508 direct-reference form — fragment extras (#extras=vector) is
  // not valid pip syntax for VCS URLs.
  const gitUrl = `paperforge[vector] @ git+https://github.com/LLLin000/PaperForge.git@${version}`;
  const pypiArgs = [...args, "-m", "pip", "install", "--upgrade", pypiPkg];
  const gitArgs = [...args, "-m", "pip", "install", "--upgrade", gitUrl];
  return {
    cmd: pythonExe,
    url: gitUrl,
    args: gitArgs,
    pypiArgs,
    gitArgs,
    timeout: 120000,
  };
}

export function parseRuntimeStatus(
  err: unknown,
  stdout: unknown,
  stderr: unknown
): RuntimeStatus {
  const errObj = err as { code?: string; killed?: boolean; message?: string } | null;
  const stdoutStr = typeof stdout === "string" ? stdout : "";
  const stderrStr = typeof stderr === "string" ? stderr : "";

  if (!errObj && stdoutStr) {
    return { status: "ok", version: stdoutStr.trim() };
  }
  if (errObj && errObj.code === "ENOENT") {
    const classified = classifyError("ENOENT");
    return { status: "error", version: null, ...classified };
  }
  if (stderrStr.includes("No module named paperforge")) {
    const classified = classifyError("import-failed");
    return { status: "error", version: null, ...classified };
  }
  if (errObj && errObj.killed) {
    const classified = classifyError("timeout");
    return { status: "error", version: null, ...classified };
  }
  if (stderrStr.includes("ModuleNotFoundError")) {
    const classified = classifyError("import-failed");
    return { status: "error", version: null, ...classified };
  }
  return {
    status: "error",
    version: null,
    type: "unknown",
    message: errObj ? errObj.message ?? "" : stderrStr,
    recoverable: false,
  };
}

// ── Query-plan (execFile one-shot) ──

export function runQueryPlan(
  pythonExe: string,
  extraArgs: string[],
  vaultPath: string,
  query: string,
  intent: "discover" | "content" | "known-paper",
  timeout = 20000,
  _execFile?: unknown
): Promise<QueryPlanResult> {
  const exe = (_execFile as ExecFileLike | undefined) ?? execFileDefault;
  const { promise, resolve } = Promise.withResolvers<QueryPlanResult>();
  const args = [
    ...extraArgs,
    "-m",
    "paperforge",
    "--vault",
    vaultPath,
    "query-plan",
    query,
    "--intent",
    intent,
    "--json",
  ];
  exe(
    pythonExe,
    args,
    { cwd: vaultPath, timeout, windowsHide: true },
    (err, stdout, stderr) => {
      if (err) {
        resolve({
          ok: false,
          command: "query-plan",
          version: "",
          data: null,
          error: {
            message: stderr || (err instanceof Error ? err.message : String(err)) || "query-plan failed",
          },
        });
        return;
      }
      try {
        resolve(JSON.parse(String(stdout)) as QueryPlanResult);
      } catch (parseErr) {
        resolve({
          ok: false,
          command: "query-plan",
          version: "",
          data: null,
          error: {
            message: parseErr instanceof Error ? parseErr.message : "Invalid query-plan JSON",
          },
        });
      }
    }
  );
  return promise;
}

// ── Cross-platform Python discovery (macOS/Linux) ──

export function isLikelyAppleStubPython(resolvedAbsPath: string): boolean {
  const n = String(resolvedAbsPath).toLowerCase().replace(/\\/g, "/");
  return (
    n.includes("commandlinetools") ||
    n.includes("/library/developer/commandlinetools")
  );
}

export function collectDarwinPythonCandidates(home: string): string[] {
  return [
    "/opt/homebrew/bin/python3",
    "/usr/local/bin/python3",
    path.join(home, ".local", "bin", "python3"),
    path.join(home, ".pyenv", "shims", "python3"),
    "/usr/bin/python3",
  ];
}

/** True when a Zotero profiles dir looks like it contains Better BibTeX. */
export function dirLooksLikeBetterBibtexFolder(entryName: string): boolean {
  const compact = String(entryName)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return compact.includes("betterbibtex");
}

export function scanBbtDirectChildren(dir: string): boolean {
  if (!dir) return false;
  try {
    if (!fs.existsSync(dir)) return false;
    for (const entry of fs.readdirSync(dir)) {
      if (dirLooksLikeBetterBibtexFolder(entry)) return true;
    }
  } catch {}
  return false;
}

export function scanBbtUnderProfiles(profilesDir: string): boolean {
  if (!profilesDir) return false;
  try {
    if (!fs.existsSync(profilesDir)) return false;
    for (const prof of fs.readdirSync(profilesDir)) {
      const extDir = path.join(profilesDir, prof, "extensions");
      try {
        if (!fs.existsSync(extDir)) continue;
        for (const entry of fs.readdirSync(extDir)) {
          if (dirLooksLikeBetterBibtexFolder(entry)) return true;
        }
      } catch {}
    }
  } catch {}
  return false;
}
