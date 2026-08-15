/**
 * Search / retrieve transport — `search <query> [--deep] --json` and the
 * matching response shape (PFResult v1: `data.matches`).  Response
 * interpretation (rankings, UI state) is host-owned; this module only
 * assembles argv, runs the one-shot subprocess, and extracts the JSON.
 */

import { runSubprocess } from "./subprocess.js";
import { paperforgeEnrichedEnv } from "./env.js";

export interface SearchOptions {
  deep?: boolean;
  timeout?: number;
  env?: Record<string, string | undefined>;
}

export interface SearchResult {
  ok: boolean;
  /** Parsed PFResult data payload (e.g. `{ matches: [...] }`), or null. */
  data: unknown;
  exitCode: number;
  error?: string;
}

/** `search <query> --json` for metadata; `retrieve <query> --deep --json`. */
export function buildSearchArgv(query: string, deep: boolean): string[] {
  return [
    deep ? "retrieve" : "search",
    query,
    ...(deep ? ["--deep"] : []),
    "--json",
  ];
}

/**
 * Extract the JSON document from raw stdout, tolerating INFO/WARNING log
 * lines before/after it (first `{`…last `}` or `[`…`]`).  Returns the
 * parsed payload — the PFResult `data` field when present, else the bare
 * document.
 */
export function parseSearchOutput(rawOutput: string): unknown {
  const firstBrace = rawOutput.indexOf("{");
  const firstBracket = rawOutput.indexOf("[");
  let start = -1;
  let endChar: "}" | "]" = "}";
  if (firstBrace === -1 && firstBracket === -1) {
    return null;
  }
  if (firstBrace === -1) {
    start = firstBracket;
    endChar = "]";
  } else if (firstBracket === -1) {
    start = firstBrace;
  } else {
    // Whichever JSON opener comes first — log lines precede both.
    start = Math.min(firstBrace, firstBracket);
    endChar = start === firstBrace ? "}" : "]";
  }
  const end = rawOutput.lastIndexOf(endChar);
  const jsonStr =
    end > start ? rawOutput.slice(start, end + 1) : "";
  if (!jsonStr) return null;
  const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
  if (parsed && typeof parsed === "object" && "data" in parsed) {
    return parsed.data;
  }
  return parsed;
}

export function runSearch(
  pythonExe: string,
  extraArgs: string[],
  vaultPath: string,
  query: string,
  opts: SearchOptions = {}
): Promise<SearchResult> {
  const timeout = opts.timeout ?? 30000;
  const env = opts.env ?? paperforgeEnrichedEnv();
  const argv = [
    ...extraArgs,
    "-m",
    "paperforge",
    "--vault",
    vaultPath,
    ...buildSearchArgv(query, opts.deep ?? false),
  ];
  return runSubprocess(pythonExe, argv, vaultPath, timeout, undefined, env).then(
    (res) => {
      if (res.exitCode !== 0) {
        return {
          ok: false,
          data: null,
          exitCode: res.exitCode,
          error: res.stderr.trim() || `exit ${res.exitCode}`,
        };
      }
      try {
        return { ok: true, data: parseSearchOutput(res.stdout), exitCode: 0 };
      } catch (parseErr) {
        return {
          ok: false,
          data: null,
          exitCode: res.exitCode,
          error:
            parseErr instanceof Error
              ? parseErr.message
              : "Invalid search output",
        };
      }
    }
  );
}
