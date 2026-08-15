/**
 * Single-result subprocess transport — `paperforge <cmd> --json` → stdout.
 * Used by action / search / query-plan one-shot calls.  Long-running
 * streaming work uses `ndjson.ts` instead (never mixes the two modes).
 */

import { spawn, type ChildProcess } from "child_process";

export interface SubprocessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  elapsed: number;
}

export interface SpawnLike {
  (cmd: string, args: string[], opts: Record<string, unknown>): ChildProcess;
}

const spawnDefault: SpawnLike = (cmd, args, opts) =>
  spawn(cmd, args, opts as Parameters<typeof spawn>[2]);

export function runSubprocess(
  pythonExe: string,
  args: string[],
  cwd: string,
  timeout: number,
  _spawn: unknown,
  env?: Record<string, string | undefined>
): Promise<SubprocessResult> {
  const sp = (_spawn as SpawnLike | undefined) ?? spawnDefault;
  const { promise, resolve } = Promise.withResolvers<SubprocessResult>();

  const startTime = Date.now();
  const opts: Record<string, unknown> = { cwd, timeout, windowsHide: true };
  if (env) opts.env = env;
  const child = sp(pythonExe, args, opts);
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];

  child.stdout?.on("data", (data: Buffer) => {
    stdoutChunks.push(data.toString("utf-8"));
  });
  child.stderr?.on("data", (data: Buffer) => {
    stderrChunks.push(data.toString("utf-8"));
  });

  child.on("close", (code: number | null) => {
    resolve({
      stdout: stdoutChunks.join(""),
      stderr: stderrChunks.join(""),
      exitCode: code ?? -1,
      elapsed: Date.now() - startTime,
    });
  });

  child.on("error", (err: Error) => {
    resolve({
      stdout: stdoutChunks.join(""),
      stderr: stderrChunks.join("") + "\n" + err.message,
      exitCode: -1,
      elapsed: Date.now() - startTime,
    });
  });

  return promise;
}
