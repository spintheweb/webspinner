import { load as loadDotEnv } from "@std/dotenv";

const envPath = Deno.env.get("SPINNER_ENV") === "docker" ? ".env.docker" : ".env";
const fileEnv = await loadDotEnv({ envPath });

// Cache .env values so we don’t lose them if Deno.env is readonly
const cache = new Map<string, string>(Object.entries(fileEnv));

export function envGet(key: string, def?: string): string | undefined {
  return Deno.env.get(key) ?? cache.get(key) ?? def;
}

export function debugLog(...data: unknown[]): void {
  if (envGet("STW_DEBUG") === "true") console.debug(...data);
}

export function envSet(key: string, value: string) {
  try { Deno.env.set(key, value); } catch { /* readonly in some envs */ }
  cache.set(key, value);
}

export const isDocker = envGet("SPINNER_ENV") === "docker";