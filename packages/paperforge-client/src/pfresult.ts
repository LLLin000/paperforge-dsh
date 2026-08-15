/**
 * PFResult contract — the canonical PaperForge CLI envelope
 * `{ok, command, version, data, error}` plus its parsing and the generic
 * one-shot transport.
 *
 * #137 machine contract: `--json` emits EXACTLY ONE PFResult JSON on
 * stdout (success OR failure); stderr is diagnostics only.  Some commands
 * (e.g. `probe all`) emit a BARE envelope instead — use
 * `invokeBareEnvelope` for those.
 */

import { execFile, type ExecFileOptions } from "child_process";
import {
  resolvePythonExecutable,
  type ExecFileLike,
  type RuntimeSettings,
} from "./runtime.js";

export interface PfError {
  code: string;
  message: string;
  details: Record<string, unknown>;
}

export interface PfResult<T> {
  ok: boolean;
  command: string;
  version: string;
  data: T | null;
  error: PfError | null;
}

export class PfClientError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(
    code: string,
    details: Record<string, unknown>,
    message?: string
  ) {
    super(message ?? code);
    this.name = "PfClientError";
    this.code = code;
    this.details = details;
  }
}

/** Parse a PFResult document; returns `data` or throws PfClientError. */
export function parsePfResult<T>(stdout: string): T {
  let parsed: PfResult<T>;
  try {
    parsed = JSON.parse(stdout) as PfResult<T>;
  } catch (parseErr) {
    throw new PfClientError(
      "pf.invalid_response",
      { stdout: stdout.slice(0, 200) },
      `Invalid PFResult JSON: ${String(parseErr)}`
    );
  }
  if (parsed.ok && parsed.data !== null) return parsed.data;
  // Structured code is the machine-decision field (§5.7); message is
  // display text.  Prefer code, fall back to message for legacy backends.
  const code = parsed.error?.code || parsed.error?.message || "pf.error";
  throw new PfClientError(
    code,
    parsed.error?.details ?? {},
    parsed.error?.message ?? code
  );
}

const execFileDefault: ExecFileLike = (cmd, args, opts, cb) => {
  execFile(cmd, args, opts as ExecFileOptions, (err, stdout, stderr) =>
    cb(err, stdout, stderr)
  );
};

function invoke(
  vaultPath: string,
  argvBody: string[],
  settings: RuntimeSettings | null | undefined,
  timeout: number,
  _execFile?: unknown
): Promise<string> {
  const exe = (_execFile as ExecFileLike | undefined) ?? execFileDefault;
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  const py = resolvePythonExecutable(
    vaultPath,
    settings,
    undefined,
    undefined
  );
  if (!py) {
    reject(new PfClientError("pf.python_unresolved", {}));
    return promise;
  }
  const argv = [
    ...py.extraArgs,
    "-m",
    "paperforge",
    "--vault",
    vaultPath,
    ...argvBody,
  ];
  exe(
    py.path,
    argv,
    { encoding: "utf-8", timeout, windowsHide: true },
    (err, stdout) => {
      if (err) {
        reject(
          new PfClientError(
            "pf.subprocess_failed",
            { stderr: err instanceof Error ? err.message.slice(0, 200) : "" },
            `PaperForge subprocess failed: ${String(err)}`
          )
        );
        return;
      }
      resolve(String(stdout));
    }
  );
  return promise;
}

/**
 * Generic one-shot transport for PFResult commands: builds argv from the
 * body, unwraps `data`, rejects with PfClientError on any failure.
 * `argvBody` must NOT include `--json` (appended here).
 */
export function invokePaperForge<T>(
  vaultPath: string,
  argvBody: string[],
  settings: RuntimeSettings | null | undefined,
  timeout = 60000
): Promise<T> {
  return invoke(vaultPath, [...argvBody, "--json"], settings, timeout).then(
    (stdout) => parsePfResult<T>(stdout)
  );
}

/**
 * Generic one-shot transport for commands that emit a BARE envelope
 * (module-discriminated JSON, not a PFResult) — e.g. `probe all --json`.
 * The `isValid` guard distinguishes a valid envelope from garbage.
 */
export function invokeBareEnvelope<T>(
  vaultPath: string,
  argvBody: string[],
  settings: RuntimeSettings | null | undefined,
  isValid: (data: T) => boolean,
  timeout = 60000
): Promise<T> {
  return invoke(vaultPath, [...argvBody, "--json"], settings, timeout).then(
    (stdout) => {
      try {
        const parsed = JSON.parse(stdout) as T;
        if (isValid(parsed)) return parsed;
        throw new PfClientError(
          "pf.invalid_envelope",
          { stdout: stdout.slice(0, 200) },
          "Command returned an invalid envelope"
        );
      } catch (err) {
        if (err instanceof PfClientError) throw err;
        throw new PfClientError(
          "pf.invalid_response",
          { stdout: stdout.slice(0, 200) },
          `Invalid JSON response: ${String(err)}`
        );
      }
    }
  );
}
