import { loadEnvFile } from "node:process";
import { existsSync } from "node:fs";
const envPath = process.env.SPINNER_ENV === "docker" ? ".env.docker" : ".env";
if (existsSync(envPath)) loadEnvFile(envPath);
function envGet(key, def) {
  return process.env[key] ?? def;
}
function debugLog(...data) {
  if (envGet("STW_DEBUG") === "true") console.debug(...data);
}
function envSet(key, value) {
  process.env[key] = value;
}
const isDocker = envGet("SPINNER_ENV") === "docker";
export {
  debugLog,
  envGet,
  envSet,
  isDocker
};
