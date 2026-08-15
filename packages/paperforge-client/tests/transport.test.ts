/**
 * Argv + transport parsing tests — the parts of the shared layer that are
 * pure and host-independent.  Python subprocess calls are not exercised
 * here (no backend in CI); runtime discovery is covered by unit tests.
 */
import { describe, expect, it } from "vitest";
import { buildActionArgv } from "../src/argv.js";
import {
  parsePfResult,
  PfClientError,
  type PfResult,
} from "../src/pfresult.js";
import { parseSearchOutput } from "../src/search.js";
import { parseNextActions } from "../src/probe.js";

describe("buildActionArgv", () => {
  it("builds a minimal action run with scope", () => {
    expect(
      buildActionArgv({ action_id: "sync", scope: { kind: "library" } })
    ).toEqual(["action", "run", "sync", "--scope", "library", "--json"]);
  });

  it("adds --key for papers scope", () => {
    expect(
      buildActionArgv({
        action_id: "ocr.rebuild",
        scope: { kind: "papers", keys: ["a", "b"] },
      })
    ).toEqual([
      "action",
      "run",
      "ocr.rebuild",
      "--scope",
      "papers",
      "--key",
      "a",
      "--key",
      "b",
      "--json",
    ]);
  });

  it("adds --confirm and --follow auto when set", () => {
    expect(
      buildActionArgv({
        action_id: "embed.rebuild",
        scope: { kind: "library" },
        confirm: "embed.rebuild",
        follow: "auto",
      })
    ).toEqual([
      "action",
      "run",
      "embed.rebuild",
      "--scope",
      "library",
      "--confirm",
      "embed.rebuild",
      "--follow",
      "auto",
      "--json",
    ]);
  });
});

describe("parsePfResult", () => {
  it("returns data on ok", () => {
    const doc: PfResult<{ matches: number[] }> = {
      ok: true,
      command: "search",
      version: "1.0",
      data: { matches: [1, 2] },
      error: null,
    };
    expect(parsePfResult<{ matches: number[] }>(JSON.stringify(doc))).toEqual({
      matches: [1, 2],
    });
  });

  it("throws PfClientError with backend error code on !ok", () => {
    const doc: PfResult<null> = {
      ok: false,
      command: "search",
      version: "1.0",
      data: null,
      error: { code: "embedding.credential_missing", message: "no key", details: {} },
    };
    expect(() => parsePfResult(JSON.stringify(doc))).toThrowError(
      PfClientError
    );
    try {
      parsePfResult(JSON.stringify(doc));
      expect.unreachable();
    } catch (err) {
      expect((err as PfClientError).code).toBe("embedding.credential_missing");
    }
  });

  it("throws PfClientError on invalid JSON", () => {
    expect(() => parsePfResult("not json")).toThrowError(PfClientError);
  });
});

describe("parseSearchOutput", () => {
  it("extracts the JSON document despite leading log lines", () => {
    const raw =
      "INFO: some log line\n" +
      '{"ok":true,"command":"search","version":"1","data":{"matches":[{"key":"k"}]}}\n' +
      "WARN: trailing noise\n";
    const data = parseSearchOutput(raw) as { matches: { key: string }[] };
    expect(data.matches).toHaveLength(1);
    expect(data.matches[0].key).toBe("k");
  });

  it("returns the bare document when no data field", () => {
    const out = parseSearchOutput('[{"a":1}]');
    expect(out).toEqual([{ a: 1 }]);
  });

  it("returns null when no JSON found", () => {
    expect(parseSearchOutput("no json here")).toBeNull();
  });
});

describe("parseNextActions", () => {
  it("parses next_actions from a PFResult document", () => {
    const doc = {
      ok: true,
      command: "probe",
      version: "1",
      data: null,
      error: null,
      next_actions: [
        {
          schema_version: 1,
          action_id: "embed.rebuild",
          scope: { kind: "library" },
          automatic: false,
          cost: "medium",
          impact: "medium",
          confirmation: "required",
          reason: "stale",
        },
      ],
    };
    const actions = parseNextActions(JSON.stringify(doc));
    expect(actions).toHaveLength(1);
    expect(actions[0].action_id).toBe("embed.rebuild");
  });

  it("returns [] on malformed input", () => {
    expect(parseNextActions("not json")).toEqual([]);
  });
});
