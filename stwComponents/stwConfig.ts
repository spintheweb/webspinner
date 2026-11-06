import { loadEnvFile } from "node:process";
import { existsSync } from "node:fs";

const envPath = process.env.SPINNER_ENV === "docker" ? ".env.docker" : ".env";
if (existsSync(envPath)) loadEnvFile(envPath);

export function envGet(key: string, def?: string): string | undefined {
  return process.env[key] ?? def;
}

export function debugLog(...data: unknown[]): void {
  if (envGet("STW_DEBUG") === "true") console.debug(...data);
}

export function envSet(key: string, value: string) {
  process.env[key] = value;
}

export const isDocker = envGet("SPINNER_ENV") === "docker";