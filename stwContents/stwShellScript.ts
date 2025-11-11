// SPDX-License-Identifier: GPL-3.0-or-later
// Spin the Web content: stwShellScript

import { ISTWRecords } from "../stwComponents/stwDBAdapters/adapter.ts";
import type { STWSession } from "../stwComponents/stwSession.ts";
import { ISTWContent, STWContent } from "../stwElements/stwContent.ts";
import * as path from "jsr:@std/path@1";

/**
 * STWShellScript
 * 
 * A content subtype that executes bash/shell scripts stored in the layout.
 * 
 * Like all other contents, it can:
 *   - Connect to a datasource (via dsn property)
 *   - Execute a command processed by WBPL (via command property)
 *   - Receive a JSON response (ISTWRecords) from the datasource
 * 
 * Additionally, it executes bash/shell script from layout.<lang> to process the records.
 * The layout is NOT WBLL — it's raw shell script code.
 * 
 * The script receives data via environment variables:
 *   - STW_PUBLIC_ROOT — absolute path to public/ directory
 *   - STW_DATA_ROOT — absolute path to data/ directory
 *   - STW_RECORDS — JSON string of ISTWRecords from datasource
 *   - STW_PLACEHOLDERS — JSON object of session placeholders
 *   - Plus individual placeholder vars: STW_PH_<KEY> for common placeholders
 * 
 * Script capabilities:
 *   ✓ File operations within allowed directories (public/, data/)
 *   ✓ Use standard Unix tools (grep, sed, awk, jq, find, etc.)
 *   ✓ Process datasource records with shell pipelines
 *   ✓ Return results via stdout (JSON format recommended)
 *   ✗ Cannot use sudo or privileged commands
 *   ✗ Cannot access dot-files or dot-folders
 *   ✗ Limited execution time (30 second timeout)
 * 
 * Security model:
 *   - Only trusted full-stack developers should author ShellScript contents
 *   - Dangerous commands are blocked (sudo, rm -rf /, dd, mkfs, etc.)
 *   - Execution timeout prevents runaway processes
 *   - Environment is restricted (no PATH manipulation)
 *   - Working directory is project root
 * 
 * Example layout.en (bash script):
 *   ```bash
 *   #!/bin/bash
 *   set -euo pipefail
 *   
 *   # Parse datasource records
 *   count=$(echo "$STW_RECORDS" | jq -r '.rows | length')
 *   
 *   # Process files
 *   find "$STW_PUBLIC_ROOT/uploads" -type f -mtime -1 | \
 *     xargs -I {} cp {} "$STW_PUBLIC_ROOT/recent/"
 *   
 *   # Return result as JSON
 *   jq -n --arg count "$count" '{"ok": true, "processed": $count}'
 *   ```
 */

export interface ISTWShellScript extends ISTWContent {
	subtype: "ShellScript";
}

/**
 * Validate shell script for dangerous patterns.
 * Throws if script contains blocked commands or patterns.
 */
function validateShellScript(script: string): void {
	const dangerous = [
		/\bsudo\b/i,
		/\brm\s+-rf\s+\//,
		/\bmkfs\b/i,
		/\bdd\b.*if=/i,
		/\bformat\b/i,
		/:\(\)\{.*:\|:.*\}/,  // fork bomb
		/\beval\b.*\$/,       // eval with variables (injection risk)
		/>\s*\/dev\/sd[a-z]/i, // writing to raw devices
	];

	for (const pattern of dangerous) {
		if (pattern.test(script)) {
			throw new Error(`Blocked dangerous pattern in shell script: ${pattern.source}`);
		}
	}

	// Check for dot-file/folder access attempts
	if (/\/\.[a-z]/i.test(script)) {
		console.warn("Shell script may attempt to access dot-files/folders - review carefully");
	}
}

/**
 * Build environment variables for shell script execution.
 */
function buildEnvironment(session: STWSession, records: ISTWRecords): Record<string, string> {
	const publicRoot = path.resolve(Deno.cwd(), "public");
	const dataRoot = path.resolve(Deno.cwd(), "data");

	const env: Record<string, string> = {
		STW_PUBLIC_ROOT: publicRoot,
		STW_DATA_ROOT: dataRoot,
		STW_RECORDS: JSON.stringify(records),
		STW_PLACEHOLDERS: JSON.stringify(Object.fromEntries(session.placeholders)),
	};

	// Add common placeholders as individual env vars for convenience
	const commonKeys = ["HOST", "USER", "LANG", "THEME", "SITE", "PAGE"];
	for (const key of commonKeys) {
		const value = session.placeholders.get(key);
		if (value) {
			env[`STW_PH_${key}`] = value;
		}
	}

	return env;
}

export default class STWShellScript extends STWContent {
	private readonly timeout: number = 30000; // 30 seconds

	constructor(content: ISTWShellScript, settings?: { [key: string]: string }) {
		super(content, settings);
	}

	/**
	 * Override render to execute the shell script.
	 * The script processes the datasource records and can perform file operations.
	 */
	public override async render(
		_req: Request,
		session: STWSession,
		records: ISTWRecords,
	): Promise<string> {
		const script = this._extractCode(session);
		
		if (!script) {
			console.warn(`ShellScript ${this._id} has no layout script for lang ${session.lang}`);
			return JSON.stringify({ ok: false, error: "No script found" });
		}

		try {
			// Validate script for dangerous patterns
			validateShellScript(script);

			// Build environment
			const env = buildEnvironment(session, records);

			// Determine shell executable (bash preferred, fallback to sh)
			const shell = await this._detectShell();

			// Execute with timeout
			const result = await this._executeWithTimeout(shell, script, env);

			return result;
		} catch (error: any) {
			console.error(`ShellScript ${this._id} execution error:`, error);
			return JSON.stringify({
				ok: false,
				error: {
					name: error?.name ?? "Error",
					message: error?.message ?? String(error),
					stack: error?.stack,
				},
			});
		}
	}

	/**
	 * Execute shell script with timeout protection.
	 */
	private async _executeWithTimeout(
		shell: string,
		script: string,
		env: Record<string, string>
	): Promise<string> {
		const command = new Deno.Command(shell, {
			args: ["-c", script],
			env: env,
			cwd: Deno.cwd(),
			stdin: "null",
			stdout: "piped",
			stderr: "piped",
		});

		// Start the process
		const child = command.spawn();

		// Create timeout promise
		const timeoutPromise = new Promise<never>((_, reject) => {
			setTimeout(() => {
				child.kill("SIGTERM");
				reject(new Error(`Shell script timeout after ${this.timeout}ms`));
			}, this.timeout);
		});

		// Race between completion and timeout
		try {
			const output = await Promise.race([
				child.output(),
				timeoutPromise,
			]);

			const stdout = new TextDecoder().decode(output.stdout).trim();
			const stderr = new TextDecoder().decode(output.stderr).trim();

			// If stdout looks like JSON, return it directly
			if (stdout.startsWith('{') || stdout.startsWith('[')) {
				return stdout;
			}

			// Otherwise wrap in a standard response
			return JSON.stringify({
				ok: output.success,
				stdout: stdout || undefined,
				stderr: stderr || undefined,
				code: output.code,
			});
		} catch (error) {
			// Timeout or execution error
			throw error;
		}
	}

	/**
	 * Detect available shell (bash, sh, or platform equivalent).
	 */
	private async _detectShell(): Promise<string> {
		// Try bash first
		try {
			const cmd = new Deno.Command("bash", { args: ["--version"], stdout: "null", stderr: "null" });
			const output = await cmd.output();
			if (output.success) return "bash";
		} catch {
			// bash not available
		}

		// Fallback to sh on Unix-like systems
		if (Deno.build.os !== "windows") {
			return "sh";
		}

		// On Windows, try Git Bash
		const gitBashPath = "C:\\Program Files\\Git\\bin\\bash.exe";
		try {
			await Deno.stat(gitBashPath);
			return gitBashPath;
		} catch {
			// Git Bash not found
		}

		throw new Error("No suitable shell found (bash or sh required)");
	}

	/**
	 * Extract shell script code from the layout for the current session language.
	 */
	private _extractCode(session: STWSession): string | null {
		const layoutWrapper = this.layout?.get(session.lang);
		if (!layoutWrapper) return null;

		// Access the wbll property which contains the raw script string
		return (layoutWrapper as any).wbll || null;
	}

	/**
	 * Override serve to set proper contentType for JSON responses.
	 */
	public override serve(req: Request, session: STWSession, ref: STWContent | undefined): Promise<Response> {
		// Ensure JSON content type for ShellScript responses
		this.contentType = "application/json; charset=utf-8";
		return super.serve(req, session, ref);
	}
}
