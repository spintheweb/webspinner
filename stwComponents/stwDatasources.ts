// SPDX-License-Identifier: GPL-3.0-or-later
// Spin the Web component: stwDatasources

import { STWSession } from "./stwSession.ts";
import { STWSite } from "../stwElements/stwSite.ts";
import { STWContent } from "../stwElements/stwContent.ts";
import { wbpl } from "./stwWBPL.ts";
import { ISTWRecords } from "./stwDBAdapters/adapter.ts";
import { Client as MySQLClient } from "https://deno.land/x/mysql@v2.12.1/mod.ts";
import jsonata from "https://esm.sh/jsonata@1.8.7";

// Global cache for query results
const queryCache = new Map<string, { data: ISTWRecords; timestamp: number }>();

interface ISTWDatasource {
	type: "stw" | "json" | "api" | "mysql" | "postgres" | "mongodb" | "shell"; // Datasource type
	host?: string; // Server hostname (api, db)
	port?: number; // Server port (db)
	user?: string; // Username (db)
	password?: string; // Password (db)
	database?: string; // Database name (db)
	contentType?: string; // Content type (e.g., application/json)
	name?: string; // Executable name for shell type (mirrors settings.name)
}
export class STWDatasources {
	static datasources: Map<string, STWSite | MySQLClient | ISTWDatasource> = new Map();
	static #initializationPromise: Promise<void> | null = null;
	// Keep DSN settings to reconnect when needed
	private static mysqlConfigs = new Map<string, any>();

	private static initialize(session: STWSession): Promise<void> {
		if (!this.#initializationPromise) {
			this.#initializationPromise = (async () => {
				this.datasources.set("stw", session.site); // Webbase

				// TODO: Connection pools
				
				let datasources: any[] = [];
				try {
					datasources = JSON.parse(Deno.readTextFileSync("./.data/datasources.json"))
				} catch (error) {
					console.error(`Error reading datasources.json: ${error instanceof Error ? error.message : String(error)}`)
					return;
				}

				for (const settings of datasources) {
					try {
						switch (settings.type) {
							case "api":
								this.datasources.set(settings.name, settings);
								break;
							case "shell":
								this.datasources.set(settings.name, { ...settings, name: settings.name });
								break;
							case "mysql": {
								this.mysqlConfigs.set(settings.name, settings);
								const client = new MySQLClient();
								await client.connect({
									hostname: settings.host,
									username: settings.user,
									password: settings.password,
									db: settings.database,
								});
								this.datasources.set(settings.name, client);
								break;
							}
							case "postgres":
								break;
							case "mongodb":
								break;
						}
					} catch (error) {
						console.error(
							`Error processing datasource configuration: ${
								error instanceof Error ? error.message : String(error)
							}`,
						);
						continue;
					}
				}
			})();
		}
		return this.#initializationPromise;
	}

	// Ensure a live MySQL connection; reconnect if needed
	private static async getMySqlClient(name: string): Promise<MySQLClient | null> {
		const ds = this.datasources.get(name);
		if (!(ds instanceof MySQLClient)) return null;

		// Probe connection
		try {
			await ds.execute("SELECT 1");
			return ds;
		} catch {
			// Reconnect using stored config
			const cfg = this.mysqlConfigs.get(name);
			if (!cfg) return null;
			try {
				const client = new MySQLClient();
				await client.connect({
					hostname: cfg.host,
					username: cfg.user,
					password: cfg.password,
					db: cfg.database,
				});
				this.datasources.set(name, client);
				return client;
			} catch (e) {
				console.warn(`MySQL reconnect failed for dsn "${name}": ${e instanceof Error ? e.message : String(e)}`);
				return null;
			}
		}
	}

	static async command(session: STWSession, content: STWContent): Promise<ISTWRecords> {
		if (!content.dsn) {
			return { fields: [], rows: [] };
		}

		const cacheKey = `${content._id}:${wbpl(content.params, session.placeholders)}`;

		if (content.cache && queryCache.has(cacheKey)) {
			const cached = queryCache.get(cacheKey)!;
			const isCacheValid = content.cache === -1 || (Date.now() - cached.timestamp < content.cache * 1000);
			if (isCacheValid) {
				return cached.data;
			}
		}

		let records: ISTWRecords = { affectedRows: 0, fields: [], rows: [] };
		try {
			await this.initialize(session);

			const datasource = STWDatasources.datasources.get(content.dsn) || {};
			if (content.dsn === "json") {
				const json = JSON.parse(content.command);
				records = {
					affectedRows: 1,
					fields: json && typeof json === "object" && !Array.isArray(json)
						? Object.getOwnPropertyNames(json).map((name) => ({ name, type: "string" }))
						: [],
					rows: Array.isArray(json) ? json : [json],
				};
			} else if ("type" in datasource && (datasource as ISTWDatasource).type === "api") {
				records = await fetchAPIData(session, content, datasource);
			} else if ("type" in datasource && (datasource as ISTWDatasource).type === "shell") {
				const dsShell = datasource as ISTWDatasource;

				const shellName = dsShell.host || dsShell.name || content.dsn; // executable or path
				const cmdString = wbpl(content.command, session.placeholders).trim();
				let args: string[] = [];

				// Security: disallow sudo usage explicitly
				if (/\bsudo\b/i.test(cmdString)) {
					records = {
						affectedRows: 1,
						fields: [{ name: "error" }],
						rows: [{ error: "Forbidden token 'sudo' in shell command" }],
					};
					return records;
				}

				if (/(bash|sh|zsh)/i.test(shellName)) {
					args = ["-c", cmdString];
				} else if (/powershell/i.test(shellName)) {
					args = ["-NoProfile", "-Command", cmdString];
				} else {
					throw new Error(`Unsupported shell: ${shellName}`);
				}

				try {
					const command = new Deno.Command(shellName, { args });
					const output = await command.output();
					const stdout = new TextDecoder().decode(output.stdout).trim();
					const stderr = new TextDecoder().decode(output.stderr).trim();

					// Attempt to parse stdout as JSON for structured rows; fallback to plain text
					let rows: Record<string, any>[] = [];
					let fields: { name: string; type?: string }[] = [];
					if (stdout) {
						try {
							const parsed = JSON.parse(stdout);
							if (Array.isArray(parsed)) {
								rows = parsed.map((r) => (typeof r === "object" ? r : { value: r }));
								fields = rows.length ? Object.keys(rows[0]).map((n) => ({ name: n })) : [];
							} else if (typeof parsed === "object") {
								rows = [parsed];
								fields = Object.keys(parsed).map((n) => ({ name: n }));
							} else {
								rows = [{ value: parsed }];
								fields = [{ name: "value" }];
							}
						} catch {
							// Not JSON, split lines
							rows = stdout.split(/\r?\n/).map((line, i) => ({ line: i + 1, value: line }));
							fields = [{ name: "line" }, { name: "value" }];
						}
					} else {
						rows = [];
						fields = [];
					}
					if (stderr) {
						// Attach stderr as metadata rows if no stdout
						if (!rows.length) {
							rows = stderr.split(/\r?\n/).map((line, i) => ({ line: i + 1, error: line }));
							fields = [{ name: "line" }, { name: "error" }];
						}
					}
					records = { affectedRows: rows.length, fields, rows };
				} catch (e) {
					console.warn(`Shell command failed: ${e instanceof Error ? e.message : String(e)}`);
					records = { affectedRows: 0, fields: [], rows: [] };
				}
			} else if (datasource instanceof STWSite) {
				records = await fetchWebbaseData(session, content);
			} else if (datasource instanceof MySQLClient) {
				const sql = wbpl(content.command, session.placeholders);
				// try execute; on "closed" error, reconnect and retry once
				try {
					records = await datasource.execute(sql) as ISTWRecords;
				} catch (error) {
					const msg = error instanceof Error ? error.message : String(error);
					if (/closed/i.test(msg) || /gone away/i.test(msg)) {
						const client = await this.getMySqlClient(content.dsn);
						if (client) {
							try {
								records = await client.execute(sql) as ISTWRecords;
							} catch (e2) {
								console.warn(
									`MySQL query failed after reconnect for dsn "${content.dsn}": ${
										e2 instanceof Error ? e2.message : String(e2)
									}`,
								);
								records = { affectedRows: 0, fields: [], rows: [] };
							}
						} else {
							console.warn(`MySQL reconnect not available for dsn "${content.dsn}": ${msg}`);
							records = { affectedRows: 0, fields: [], rows: [] };
						}
					} else {
						console.warn(`MySQL query failed for dsn "${content.dsn}": ${msg}`);
						records = { affectedRows: 0, fields: [], rows: [] };
					}
				}
			}
		} catch (error) {
			console.warn(
				`Datasource error for dsn "${content.dsn}": ${error instanceof Error ? error.message : String(error)}`,
			);
			records = { affectedRows: 0, fields: [], rows: [] };
		}

		if (content.cache) {
			queryCache.set(cacheKey, { data: records, timestamp: Date.now() });
		}

		return records;
	}
}

/**
 * This function queries the webbase using JSONata expressions.
 *
 * @param session The session
 * @param content The content being rendered
 * @returns The result set
 */
async function fetchWebbaseData(session: STWSession, content: STWContent): Promise<ISTWRecords> {
	let result: any;

	let isArray = true;
	try {
		JSON.parse(content.command) instanceof Array;
	} catch {
		isArray = false;
	}

	if (!isArray) {
		const expr = jsonata(wbpl(content.command, session.placeholders));
		result = expr.evaluate(STWSite.wbol);

		if (result instanceof Promise) {
			result = await result;
		}

		return new Promise<ISTWRecords>((resolve) =>
			resolve({
				affectedRows: result.length || 1,
				fields: result && typeof result === "object" && !Array.isArray(result)
					? Object.getOwnPropertyNames(result).map((name) => ({ name }))
					: Object.keys(result[0] || {}).map((name) => ({ name })),
				rows: Array.isArray(result) ? result : [result],
			})
		);
	}

	result = STWSite.instance.find(session, session.placeholders.get("@_id") || "/")?.toLocalizedJSON(session);

	return new Promise<ISTWRecords>((resolve) =>
		resolve({
			affectedRows: 1,
			fields: (JSON.parse(content.command) || Object.getOwnPropertyNames(result) || []).map((name: string) => ({
				name,
			})),
			rows: Array.isArray(result) ? result : [result],
		})
	);
}

/**
 * This function queries an API datasource using JSONata expressions.
 *
 * @param session The session
 * @param content The content being rendered
 * @param datasource The datasource configuration
 * @returns The result set
 */
async function fetchAPIData(session: STWSession, content: STWContent, datasource: any): Promise<ISTWRecords> {
	const query = wbpl(content.command, session.placeholders);
	const expr = jsonata(query);

	const response = await fetch(`${datasource.host}?${wbpl(content.params, session.placeholders)}`, {
		headers: { "Content-Type": datasource.contentType || "application/json" },
	});
	let json = await response.json();

	json = expr.evaluate(json);
	if (json instanceof Promise) {
		json = await json;
	}

	if (Array.isArray(json)) {
		return new Promise<ISTWRecords>((resolve) =>
			resolve({
				affectedRows: 1,
				fields: Object.getOwnPropertyNames(json[0]).map((name) => ({ name })) || [],
				rows: Array.isArray(json) ? json : [json],
			})
		);
	}

	return new Promise<ISTWRecords>((resolve) =>
		resolve({
			affectedRows: 1,
			fields: json && typeof json === "object" && !Array.isArray(json)
				? Object.getOwnPropertyNames(json).map((name) => ({ name }))
				: [],
			rows: Array.isArray(json) ? json : [json],
		})
	);
}
