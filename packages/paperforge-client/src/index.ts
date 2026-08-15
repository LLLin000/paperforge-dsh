/**
 * @paperforge/client — shared transport layer for PaperForge hosts
 * (Obsidian plugin, DSH adapter, future Desktop).
 *
 * Scope is strictly the wire contract (design §2.1): CLI argv, PFResult /
 * NDJSON parsing, subprocess lifecycle, runtime discovery, env hygiene.
 * No business rules, no UI state, no host-specific behavior.
 */

export * from "./argv.js";
export * from "./pfresult.js";
export * from "./subprocess.js";
export * from "./env.js";
export * from "./runtime.js";
export * from "./action.js";
export * from "./search.js";
export * from "./ndjson.js";
export * from "./probe.js";
export * from "./config.js";
