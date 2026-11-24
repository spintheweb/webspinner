/**
 * @fileoverview Loads environment configuration and runtime flags for Webspinner.
 *
 * Reads `.env` or `.data/.env.docker`, provides environment getters/setters, and
 * exposes Docker, debugger, and debug logging helpers.
 *
 * @author Giancarlo Trevisan
 * @version 1.0.0
 * @module stwConfig
 * @note Copilot-assisted
 * @license Apache-2.0
 */
import { loadEnvFile } from "node:process";
import { existsSync } from "node:fs";
import { url as inspectorUrl } from "node:inspector";

const envPath = process.env.SPINNER_ENV === "docker" ? ".data/.env.docker" : ".env";

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

function readBooleanSetting(name) {
	const value = envGet(name, "false").trim().toLowerCase();
	if (value !== "true" && value !== "false") throw new TypeError(`${name} must be "true" or "false"`);
	return value === "true";
}

const isDocker = envGet("SPINNER_ENV") === "docker";
const isDebugging = Boolean(inspectorUrl());

export {
	debugLog,
	envGet,
	envPath,
	envSet,
	isDocker,
	isDebugging,
	readBooleanSetting
};
