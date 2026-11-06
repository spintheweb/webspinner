// SPDX-License-Identifier: GPL-3.0-or-later
// Spin the Web component: stwDatasources

import { STWSession } from "./stwSession.ts";
import { STWContent } from "../stwElements/stwContent.ts";
import { WBPL } from "./stwWBPL.ts";
import { ISTWRecords } from "./stwDBAdapters/adapter.ts";
import { envGet } from "./stwConfig.ts";
import { dirname } from "node:path";
import { readFileSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createConnection, type Connection } from "mysql2/promise";
import jsonata from "jsonata";
import { isNotFoundError, runCommand } from "./stwNode.ts";

interface ISTWDatasource {
	type: "json" | "api" | "mysql" | "postgres" | "mongodb" | "shell"; // Datasource type
	host?: string; // Server hostname (api, db)
	port?: number; // Server port (db)
	user?: string; // Username (db)
	password?: string; // Password (db)
	database?: string; // Database name (db)
	contentType?: string; // Content type (e.g., application/json)
	name?: string; // Executable name for shell type (mirrors settings.name)
}
type DatasourceQuery = Pick<STWContent, "dsn" | "query" | "params">;

export class STWDatasources {
	static datasources: Map<string, Connection | ISTWDatasource> = new Map();
	static #initializationPromise: Promise<void> | null = null;
	// Keep DSN settings to reconnect when needed
	private static mysqlConfigs = new Map<string, any>();

	static async getConfigurations(): Promise<Record<string, unknown>[]> {
		const path = envGet("DATASOURCES") || "./.data/datasources.json";
		try {
			const configurations: unknown = JSON.parse(await readFile(path, "utf8"));
			if (!Array.isArray(configurations)) throw new TypeError("Datasource configuration must be a JSON array");
			return configurations as Record<string, unknown>[];
		} catch (error) {
			if (isNotFoundError(error)) return [];
			throw error;
		}
	}

	static async saveConfigurations(configurations: Record<string, unknown>[]): Promise<void> {
		const path = envGet("DATASOURCES") || "./.data/datasources.json";
		await mkdir(dirname(path), { recursive: true });
		let previousConfiguration: string | null;
		try {
			previousConfiguration = await readFile(path, "utf8");
		} catch (error) {
			if (!isNotFoundError(error)) throw error;
			previousConfiguration = null;
		}
		await writeFile(path, JSON.stringify(configurations, null, 2));
		try {
			await this.resetRuntime();
			await this.initialize(true);
		} catch (error) {
			let resetError: unknown;
			try {
				await this.resetRuntime();
			} catch (error) {
				resetError = error;
			}
			try {
				if (previousConfiguration === null) {
					await rm(path);
				} else {
					await writeFile(path, previousConfiguration);
				}
				await this.initialize();
			} catch (restoreError) {
				throw new AggregateError(
					[error, ...(resetError === undefined ? [] : [resetError]), restoreError],
					"Datasource reload failed and the previous configuration could not be restored",
				);
			}
			if (resetError !== undefined) {
				throw new AggregateError(
					[error, resetError],
					"Datasource reload failed; the previous configuration was restored but a connection did not close cleanly",
				);
			}
			throw new Error("Datasource reload failed; the previous configuration was restored", { cause: error });
		}
	}

	private static async resetRuntime(): Promise<void> {
		const closeErrors: unknown[] = [];
		for (const datasource of this.datasources.values()) {
			if (isMySQLConnection(datasource)) {
				try {
					await datasource.end();
				} catch (error) {
					closeErrors.push(error);
				}
			}
		}
		this.datasources.clear();
		this.mysqlConfigs.clear();
		this.#initializationPromise = null;

		if (closeErrors.length > 0) {
			throw new AggregateError(closeErrors, "One or more MySQL connections could not be closed");
		}
	}

	private static initialize(strict = false): Promise<void> {
		if (!this.#initializationPromise) {
			this.#initializationPromise = (async () => {
				// TODO: Connection pools

				let datasources: any[] = [];
				try {
					datasources = JSON.parse(readFileSync(envGet("DATASOURCES") || "./.data/datasources.json", "utf8"));
				} catch (error) {
					if (strict) throw error;
					console.error(
						`Error reading datasources.json: ${error instanceof Error ? error.message : String(error)}`,
					);
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
								const client = await createConnection({
									host: settings.host,
									port: settings.port ?? 3306,
									user: settings.user,
									password: settings.password,
									database: settings.database,
								});
								this.datasources.set(settings.name, client);
								break;
							}
							case "postgres":
								if (strict) throw new TypeError(`Unsupported datasource type: ${settings.type}`);
								break;
							case "mongodb":
								if (strict) throw new TypeError(`Unsupported datasource type: ${settings.type}`);
								break;
							default:
								throw new TypeError(`Unsupported datasource type: ${settings.type}`);
						}
					} catch (error) {
						if (strict) throw error;
						console.error(
							`Error processing datasource configuration: ${error instanceof Error ? error.message : String(error)
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
	private static async getMySqlClient(name: string): Promise<Connection | null> {
		const ds = this.datasources.get(name);
		if (!isMySQLConnection(ds)) return null;

		// Probe connection
		try {
			await ds.execute("SELECT 1");
			return ds;
		} catch {
			// Reconnect using stored config
			const cfg = this.mysqlConfigs.get(name);
			if (!cfg) return null;
			try {
				const client = await createConnection({
					host: cfg.host,
					port: cfg.port ?? 3306,
					user: cfg.user,
					password: cfg.password,
					database: cfg.database,
				});
				this.datasources.set(name, client);
				return client;
			} catch (e) {
				console.warn(`MySQL reconnect failed for dsn "${name}": ${e instanceof Error ? e.message : String(e)}`);
				return null;
			}
		}
	}

	static async query(session: STWSession, dsn: string, query: string): Promise<ISTWRecords> {
		return await this.execute(session, { dsn, query, params: "" });
	}

	static async command(session: STWSession, content: STWContent): Promise<ISTWRecords> {
		return await this.execute(session, content);
	}

	private static async execute(session: STWSession, content: DatasourceQuery): Promise<ISTWRecords> {
		if (!content.dsn) {
			return { affectedRows: 0, fields: [], rows: [{}] };
		}

		let records: ISTWRecords = { affectedRows: 0, fields: [], rows: [{}] };
		try {
			await this.initialize();

			const datasource = STWDatasources.datasources.get(content.dsn) || {};
			if (content.dsn === "json") {
				const json = JSON.parse(content.query);
				records = {
					affectedRows: 1,
					fields: json && typeof json === "object" && !Array.isArray(json) ? Object.keys(json) : [],
					rows: Array.isArray(json) ? json : [json],
				};
			} else if ("type" in datasource && (datasource as ISTWDatasource).type === "api") {
				records = await fetchAPIData(session, content, datasource);
			} else if ("type" in datasource && (datasource as ISTWDatasource).type === "shell") {
				const dsShell = datasource as ISTWDatasource;

				const shellName = dsShell.host || dsShell.name || content.dsn; // executable or path
				const cmdString = WBPL(content.query, session.placeholders).trim();
				let args: string[] = [];

				// Security: disallow sudo usage explicitly
				if (/\bsudo\b/i.test(cmdString)) {
					records = {
						affectedRows: 1,
						fields: ["error"],
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
					const output = await runCommand(shellName, args);
					const stdout = output.stdout.trim();
					const stderr = output.stderr.trim();

					// Attempt to parse stdout as JSON for structured rows; fallback to plain text
					let rows: Record<string, any>[] = [], fields: string[] = [];
					if (stdout) {
						try {
							const parsed = JSON.parse(stdout);
							if (Array.isArray(parsed)) {
								rows = parsed.map((r) => (typeof r === "object" ? r : { value: r }));
								fields = rows.length ? Object.keys(rows[0]) : [];
							} else if (typeof parsed === "object") {
								rows = [parsed];
								fields = Object.keys(parsed);
							} else {
								rows = [{ value: parsed }];
								fields = ["value"];
							}
						} catch {
							// Not JSON, split lines
							rows = stdout.split(/\r?\n/).map((line, i) => ({ line: i + 1, value: line }));
							fields = ["line", "value"];
						}
					} else {
						rows = [{}];
						fields = []
					}
					if (stderr) {
						// Attach stderr as metadata rows if no stdout
						if (!rows.length) {
							rows = stderr.split(/\r?\n/).map((line, i) => ({ line: i + 1, error: line }));
							fields = ["line", "error"];
						}
					}
					records = { affectedRows: rows.length, fields, rows };
				} catch (e) {
					console.warn(`Shell command failed: ${e instanceof Error ? e.message : String(e)}`);
					records = { affectedRows: 0, fields: [], rows: [{}] };
				}
			} else if (isMySQLConnection(datasource)) {
				const sql = WBPL(content.query, session.placeholders);
				// try execute; on "closed" error, reconnect and retry once
				try {
					records = await executeMySQL(datasource, sql);
				} catch (error) {
					const msg = error instanceof Error ? error.message : String(error);
					if (/closed/i.test(msg) || /gone away/i.test(msg)) {
						const client = await this.getMySqlClient(content.dsn);
						if (client) {
							try {
								records = await executeMySQL(client, sql);
							} catch (e2) {
								console.warn(
									`MySQL query failed after reconnect for dsn "${content.dsn}": ${e2 instanceof Error ? e2.message : String(e2)
									}`,
								);
								records = { affectedRows: 0, fields: [], rows: [{}] };
							}
						} else {
							console.warn(`MySQL reconnect not available for dsn "${content.dsn}": ${msg}`);
							records = { affectedRows: 0, fields: [], rows: [{}] };
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
			records = { affectedRows: 0, fields: [], rows: [{}] };
		}

		return records;
	}
}

function isMySQLConnection(value: unknown): value is Connection {
	return value !== null && value !== undefined && typeof value === "object" && "execute" in value && "end" in value;
}

async function executeMySQL(client: Connection, sql: string): Promise<ISTWRecords> {
	const [result, fieldPackets] = await client.execute(sql);
	const rows = Array.isArray(result) ? result as Record<string, unknown>[] : [];
	const affectedRows = Array.isArray(result)
		? rows.length
		: Number((result as { affectedRows?: number }).affectedRows ?? 0);
	return {
		affectedRows,
		fields: fieldPackets.map(field => field.name),
		rows,
	};
}

/**
 * This function queries an API datasource using JSONata expressions.
 *
 * @param session The session
 * @param content The content being rendered
 * @param datasource The datasource configuration
 * @returns The result set
 */
async function fetchAPIData(session: STWSession, content: DatasourceQuery, datasource: any): Promise<ISTWRecords> {
	const query = WBPL(content.query, session.placeholders);
	const expr = jsonata(query);

	const response = await fetch(`${datasource.host}?${WBPL(content.params, session.placeholders)}`, {
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
				affectedRows: json.length,
				fields: Object.keys(json[0]) || [],
				rows: Array.isArray(json) ? json : [json],
			})
		);
	}

	return new Promise<ISTWRecords>((resolve) =>
		resolve({
			affectedRows: 1,
			fields: json && typeof json === "object" && !Array.isArray(json) ? Object.keys(json) : [],
			rows: Array.isArray(json) ? json : [json],
		})
	);
}
