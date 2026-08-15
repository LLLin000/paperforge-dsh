/**
 * Subprocess environment — PATH enrichment plus credential redaction.
 *
 * #173/C1: the child env is ALWAYS the redacted base env; credentials are
 * resolved by Python from the OS keyring / PAPERFORGE_CREDENTIAL_* env.
 * Never pass `{...process.env, ...userEnv}` to a PaperForge subprocess —
 * that re-introduces secret keys.
 */

import * as path from "path";
import * as os from "os";
import { execFileSync } from "child_process";

// ── Env redaction ──

const LEGACY_CREDENTIAL_ENV_PREFIXES = [
  "PAPERFORGE_OCR_",
  "PAPERFORGE_EMBEDDING_",
  "PAPERFORGE_VECTOR_",
  "PAPERFORGE_API_",
  "PAPERFORGE_KEY_",
  "PADDLE_",
  "OPENAI_",
];

export function stripCredentialEnv(
  env: Record<string, string | undefined>
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    const upper = k.toUpperCase();
    if (LEGACY_CREDENTIAL_ENV_PREFIXES.some((p) => upper.startsWith(p))) {
      continue;
    }
    out[k] = v;
  }
  return out;
}

// ── PATH enrichment ──

let _gitDir: string | null = null;
let _gitDirResolved = false;

export function resolveGitDir(): string | null {
  if (_gitDirResolved) return _gitDir;
  _gitDirResolved = true;
  try {
    let out: string;
    if (process.platform === "win32") {
      const cmdExe = process.env.ComSpec || "C:\\Windows\\System32\\cmd.exe";
      out = execFileSync(cmdExe, ["/c", "where", "git"], {
        timeout: 5000,
        windowsHide: true,
        encoding: "utf-8",
      });
    } else {
      out = execFileSync("which", ["git"], {
        timeout: 5000,
        encoding: "utf-8",
      });
    }
    if (out) {
      const line = out.split("\n")[0].trim();
      if (line) _gitDir = path.dirname(line);
    }
  } catch {}
  return _gitDir;
}

export function paperforgeEnrichedEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  const plat = process.platform;
  const home = os.homedir();
  const extras: string[] = [];
  const gitDir = resolveGitDir();
  if (gitDir) extras.push(gitDir);
  if (plat === "darwin") {
    extras.push(
      "/opt/homebrew/bin",
      "/usr/local/bin",
      "/usr/bin",
      `${home}/.local/bin`
    );
  } else if (plat === "linux") {
    extras.push("/usr/local/bin", "/usr/bin", `${home}/.local/bin`);
  }
  const cur = env.PATH || "";
  env.PATH = [...extras, cur].filter(Boolean).join(path.delimiter);
  return stripCredentialEnv(env) as Record<string, string | undefined>;
}
