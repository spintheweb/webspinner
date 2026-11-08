/**
 * @fileoverview Defines the shell-script content element.
 *
 * Executes shell scripts stored in content layouts against datasource records
 * using the module's restricted filesystem and environment contract.
 *
 * @author Giancarlo
 * @version 1.0.0
 * @module stwShellScript
 * @requires node:path
 * @license GPL-3.0-or-later
 */
import { STWContent } from "../stwElements/stwContent.js";
import * as path from "node:path";
import { stat } from "node:fs/promises";
import { runCommand } from "../stwComponents/stwNode.js";

function validateShellScript(script) {
	const dangerous = [
		/\bsudo\b/i,
		/\brm\s+-rf\s+\//,
		/\bmkfs\b/i,
		/\bdd\b.*if=/i,
		/\bformat\b/i,
		/:\(\)\{.*:\|:.*\}/,
		// fork bomb
		/\beval\b.*\$/,
		// eval with variables (injection risk)
		/>\s*\/dev\/sd[a-z]/i
		// writing to raw devices
	];
	for (const pattern of dangerous) {
		if (pattern.test(script)) {
			throw new Error(`Blocked dangerous pattern in shell script: ${pattern.source}`);
		}
	}
	if (/\/\.[a-z]/i.test(script)) {
		console.warn("Shell script may attempt to access dot-files/folders - review carefully");
	}
}
function buildEnvironment(session, records) {
	const publicRoot = path.resolve(process.cwd(), "public");
	const dataRoot = path.resolve(process.cwd(), "data");
	const env = {
		STW_PUBLIC_ROOT: publicRoot,
		STW_DATA_ROOT: dataRoot,
		STW_RECORDS: JSON.stringify(records),
		STW_PLACEHOLDERS: JSON.stringify(Object.fromEntries(session.placeholders))
	};
	const commonKeys = ["HOST", "USER", "LANG", "THEME", "PORTAL", "PAGE"];
	for (const key of commonKeys) {
		const value = session.getPlaceholder(key);
		if (value)
			env[`STW_PH_${key}`] = value;
	}
	return env;
}
class STWShellScript extends STWContent {
	timeout = 3e4;
	// 30 seconds
	constructor(content, settings) {
		super(content, settings);
	}
	/**
    * Override render to execute the shell script.
    * The script processes the datasource records and can perform file operations.
    */
	async render(_req, session, records) {
		const script = this._extractCode(session);
		if (!script) {
			console.warn(`ShellScript ${this.uuid} has no layout script for lang ${session.lang}`);
			return JSON.stringify({ ok: false, error: "No script found" });
		}
		try {
			validateShellScript(script);
			const env = buildEnvironment(session, records);
			const shell = await this._detectShell();
			const result = await this._executeWithTimeout(shell, script, env);
			return result;
		} catch (error) {
			console.error(`ShellScript ${this.uuid} execution error:`, error);
			return JSON.stringify({
				ok: false,
				error: {
					name: error?.name ?? "Error",
					message: error?.message ?? String(error),
					stack: error?.stack
				}
			});
		}
	}
	/**
    * Execute shell script with timeout protection.
    */
	async _executeWithTimeout(shell, script, env) {
		const output = await runCommand(shell, ["-c", script], {
			env: { ...process.env, ...env },
			cwd: process.cwd(),
			timeoutMs: this.timeout
		});
		const stdout = output.stdout.trim();
		const stderr = output.stderr.trim();
		if (stdout.startsWith("{") || stdout.startsWith("[")) return stdout;
		return JSON.stringify({
			ok: output.code === 0,
			stdout: stdout || void 0,
			stderr: stderr || void 0,
			code: output.code
		});
	}
	/**
    * Detect available shell (bash, sh, or platform equivalent).
    */
	async _detectShell() {
		try {
			const output = await runCommand("bash", ["--version"], { timeoutMs: 2e3 });
			if (output.code === 0) return "bash";
		} catch {
		}
		if (process.platform !== "win32") {
			return "sh";
		}
		const gitBashPath = "C:\\Program Files\\Git\\bin\\bash.exe";
		try {
			await stat(gitBashPath);
			return gitBashPath;
		} catch {
		}
		throw new Error("No suitable shell found (bash or sh required)");
	}
	/**
    * Extract shell script code from the layout for the current session language.
    */
	_extractCode(session) {
		const layoutWrapper = this.layout?.get(session.lang);
		if (!layoutWrapper) return null;
		return layoutWrapper.wbll || null;
	}
	/**
    * Override serve to set proper contentType for JSON responses.
    */
	serve(req, session, ref) {
		this.contentType = "application/json; charset=utf-8";
		return super.serve(req, session, ref);
	}
}
export {
	STWShellScript as default
};
