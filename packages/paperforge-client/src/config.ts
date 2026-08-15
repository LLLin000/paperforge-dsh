/**
 * Config transport — thin typed verbs over the canonical config authority
 * (`paperforge config <verb> --json`).  The shared layer never parses or
 * writes paperforge.json; every read and mutation routes through Python.
 */

import { invokePaperForge } from "./pfresult.js";
import type { RuntimeSettings } from "./runtime.js";

export interface ConfigField {
  key: string;
  value: string | boolean;
  stored_value: string | boolean | null;
  source: "default" | "file" | "environment" | "override";
  is_set: boolean;
  type: string;
  default: string | boolean;
  environment: string | null;
  choices: string[];
  writable: boolean;
  allow_empty: boolean;
  vault_relative: boolean;
}

export interface ConfigListData {
  schema_version: number;
  revision: string;
  unknown_keys: string[];
  fields: ConfigField[];
}

export interface ConfigMutationData {
  schema_version: number;
  revision: string;
  unknown_keys: string[];
  changed: boolean;
  field: ConfigField;
  warnings?: string[];
}

export interface ConfigPathsData {
  revision: string;
  paths: Record<string, string>;
}

export interface ConfigValidateData {
  state: string;
  revision: string | null;
  errors: Array<Record<string, unknown>>;
  warnings: Array<Record<string, unknown>>;
  migration: Record<string, unknown> | null;
}

export function configList(
  vaultPath: string,
  settings?: RuntimeSettings | null
): Promise<ConfigListData> {
  return invokePaperForge<ConfigListData>(vaultPath, ["config", "list"], settings);
}

export function configGet(
  vaultPath: string,
  key: string,
  settings?: RuntimeSettings | null
): Promise<ConfigField> {
  return invokePaperForge<{ field: ConfigField }>(
    vaultPath,
    ["config", "get", key],
    settings
  ).then((d) => d.field);
}

export function configSet(
  vaultPath: string,
  key: string,
  value: string | boolean,
  settings?: RuntimeSettings | null
): Promise<ConfigMutationData> {
  return invokePaperForge<ConfigMutationData>(
    vaultPath,
    ["config", "set", key, String(value)],
    settings
  );
}

export function configUnset(
  vaultPath: string,
  key: string,
  settings?: RuntimeSettings | null
): Promise<ConfigMutationData> {
  return invokePaperForge<ConfigMutationData>(
    vaultPath,
    ["config", "unset", key],
    settings
  );
}

export function configPaths(
  vaultPath: string,
  settings?: RuntimeSettings | null
): Promise<ConfigPathsData> {
  return invokePaperForge<ConfigPathsData>(
    vaultPath,
    ["config", "paths"],
    settings
  );
}

export function configValidate(
  vaultPath: string,
  settings?: RuntimeSettings | null
): Promise<ConfigValidateData> {
  return invokePaperForge<ConfigValidateData>(
    vaultPath,
    ["config", "validate"],
    settings
  );
}

export function configMigrate(
  vaultPath: string,
  dryRun: boolean,
  settings?: RuntimeSettings | null
): Promise<ConfigMutationData> {
  return invokePaperForge<ConfigMutationData>(
    vaultPath,
    dryRun ? ["config", "migrate", "--dry-run"] : ["config", "migrate"],
    settings
  );
}
