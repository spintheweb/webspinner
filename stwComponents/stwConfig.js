import { loadEnvFile } from "node:process";
import { existsSync } from "node:fs";
import { url as inspectorUrl } from "node:inspector";

const envPath = process.env.SPINNER_ENV === "docker" ? ".env.docker" : ".env";

if (existsSync(envPath)) 
	loadEnvFile(envPath);

function envGet(key, def) {
	return process.env[key] ?? def;
}

function debugLog(...data) {
	if (isDebugging) console.debug(...data);
}

function envSet(key, value) {
	process.env[key] = value;
}

const isDocker = envGet("SPINNER_ENV") === "docker";
const isDebugging = Boolean(inspectorUrl());

export {
	debugLog,
	envGet,
	envSet,
	isDocker,
	isDebugging
};
