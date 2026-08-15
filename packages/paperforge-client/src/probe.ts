/**
 * Probe transport — `probe all --json` emits a BARE envelope
 * (`module: "all"`, top-level `modules`), NOT a PFResult `{ok, data}`.
 * Also carries the `next_actions` wire types that ride inside probe /
 * PFResult documents (T8 #169: TS renders/executes, never re-derives
 * policy).
 */

import { invokeBareEnvelope } from "./pfresult.js";
import type { RuntimeSettings } from "./runtime.js";

export interface ProbeAllData {
  schema_version: number;
  module: "all";
  updated_at: string;
  modules: Record<string, Record<string, unknown>>;
}

export function probeAll(
  vaultPath: string,
  settings?: RuntimeSettings | null
): Promise<ProbeAllData> {
  return invokeBareEnvelope<ProbeAllData>(
    vaultPath,
    ["probe", "all"],
    settings,
    (data) => data.module === "all" && data.modules !== undefined
  );
}

// ── Next-action wire types (T8 closure #169) ──

export interface NextActionScope {
  kind: string;
  keys?: string[];
}

export interface NextAction {
  schema_version: number;
  action_id: string;
  scope: NextActionScope;
  automatic: boolean;
  cost: string;
  impact: string;
  confirmation: string;
  reason: string;
  dedupe_key?: string;
}

/** Parse `next_actions` from a PFResult JSON document; malformed → []. */
export function parseNextActions(stdout: string): NextAction[] {
  try {
    const payload = JSON.parse(stdout) as { next_actions?: unknown };
    return Array.isArray(payload.next_actions)
      ? (payload.next_actions as NextAction[])
      : [];
  } catch {
    return [];
  }
}
