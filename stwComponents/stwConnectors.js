import { WBPL } from "./stwWBPL.js";
import { envGet } from "./stwConfig.js";
import { dirname } from "node:path";
import { readFileSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createConnection } from "mysql2/promise";
import jsonata from "jsonata";
import { isNotFoundError, runCommand } from "./stwNode.js";
import { getWbolContent } from "./stwWBOLApi.js";
class STWConnectors {
	static connectors = new Map();
	static #initializationPromise = null;
	// Keep connector settings to reconnect when needed
	static mysqlConfigs = new Map();
	static async getConfigurations() {
		const path = envGet("CONNECTORS") || "./.data/connectors.json";
		try {
			const configurations = JSON.parse(await readFile(path, "utf8"));
			if (!Array.isArray(configurations)) throw new TypeError("Connector configuration must be a JSON array");
			return configurations;
		} catch (error) {
			if (isNotFoundError(error)) return [];
			throw error;
		}
	}
	static async saveConfigurations(configurations) {
		const path = envGet("CONNECTORS") || "./.data/connectors.json";
		await mkdir(dirname(path), { recursive: true });
		let previousConfiguration;
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
			let resetError;
			try {
				await this.resetRuntime();
			} catch (error2) {
				resetError = error2;
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
					[error, ...resetError === void 0 ? [] : [resetError], restoreError],
					"Connector reload failed and the previous configuration could not be restored"
				);
			}
			if (resetError !== void 0) {
				throw new AggregateError(
					[error, resetError],
					"Connector reload failed; the previous configuration was restored but a connection did not close cleanly"
				);
			}
			throw new Error("Connector reload failed; the previous configuration was restored", { cause: error });
		}
	}
	static async resetRuntime() {
		const closeErrors = [];
		for (const connector of this.connectors.values()) {
			if (isMySQLConnection(connector)) {
				try {
					await connector.end();
				} catch (error) {
					closeErrors.push(error);
				}
			}
		}
		this.connectors.clear();
		this.mysqlConfigs.clear();
		this.#initializationPromise = null;
		if (closeErrors.length > 0) {
			throw new AggregateError(closeErrors, "One or more MySQL connections could not be closed");
		}
	}
	static initialize(strict = false) {
		if (!this.#initializationPromise) {
			this.#initializationPromise = (async () => {
				let connectors = [];
				try {
					connectors = JSON.parse(readFileSync(envGet("CONNECTORS") || "./.data/connectors.json", "utf8"));
				} catch (error) {
					if (strict) throw error;
					console.error(
						`Error reading connectors.json: ${error instanceof Error ? error.message : String(error)}`
					);
					return;
				}
				for (const settings of connectors) {
					try {
						switch (settings.type) {
							case "api":
								this.connectors.set(settings.name, settings);
								break;
							case "shell":
								this.connectors.set(settings.name, { ...settings, name: settings.name });
								break;
							case "mysql": {
								this.mysqlConfigs.set(settings.name, settings);
								const client = await createConnection({
									host: settings.host,
									port: settings.port ?? 3306,
									user: settings.user,
									password: settings.password,
									database: settings.database
								});
								this.connectors.set(settings.name, client);
								break;
							}
							case "postgres":
								if (strict) throw new TypeError(`Unsupported connector type: ${settings.type}`);
								break;
							case "mongodb":
								if (strict) throw new TypeError(`Unsupported connector type: ${settings.type}`);
								break;
							default:
								throw new TypeError(`Unsupported connector type: ${settings.type}`);
						}
					} catch (error) {
						if (strict) throw error;
						console.error(
							`Error processing connector configuration: ${error instanceof Error ? error.message : String(error)}`
						);
						continue;
					}
				}
			})();
		}
		return this.#initializationPromise;
	}
	// Ensure a live MySQL connection; reconnect if needed
	static async getMySqlClient(name) {
		const connection = this.connectors.get(name);
		if (!isMySQLConnection(connection)) return null;
		try {
			await connection.execute("SELECT 1");
			return connection;
		} catch {
			const cfg = this.mysqlConfigs.get(name);
			if (!cfg) return null;
			try {
				const client = await createConnection({
					host: cfg.host,
					port: cfg.port ?? 3306,
					user: cfg.user,
					password: cfg.password,
					database: cfg.database
				});
				this.connectors.set(name, client);
				return client;
			} catch (e) {
				console.warn(`MySQL reconnect failed for connector "${name}": ${e instanceof Error ? e.message : String(e)}`);
				return null;
			}
		}
	}
	static async query(session, connector, query) {
		return await this.execute(session, { connector, query, params: "" });
	}
	static async command(session, content) {
		return await this.execute(session, content);
	}
	static async executeCommand(session, connector, query, values = []) {
		if (!connector) throw new TypeError("Connector name is required");
		await this.initialize();
		const connection = this.connectors.get(connector);
		if (!isMySQLConnection(connection)) {
			throw new TypeError(`Connector "${connector}" is not a configured MySQL connector`);
		}
		const sql = WBPL(query, session.placeholders);
		try {
			return await executeMySQL(connection, sql, values);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (!/closed|gone away/i.test(message)) throw error;
			const client = await this.getMySqlClient(connector);
			if (!client) throw error;
			return await executeMySQL(client, sql, values);
		}
	}
	static async executeBoundCommand(connector, query, values = []) {
		if (!connector) throw new TypeError("Connector name is required");
		await this.initialize();
		const connection = this.connectors.get(connector);
		if (!isMySQLConnection(connection)) {
			throw new TypeError(`Connector "${connector}" is not a configured MySQL connector`);
		}
		try {
			return await executeMySQL(connection, query, values);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (!/closed|gone away/i.test(message)) throw error;
			const client = await this.getMySqlClient(connector);
			if (!client) throw error;
			return await executeMySQL(client, query, values);
		}
	}
	static async getType(connector) {
		await this.initialize();
		const configuration = this.connectors.get(connector);
		if (isMySQLConnection(configuration)) return "mysql";
		return configuration?.type ?? null;
	}
	static async executeAction(session, connector, command, method, fields = {}) {
		if (!connector) throw new TypeError("Connector name is required");
		await this.initialize();
		const configuration = this.connectors.get(connector);
		if (isMySQLConnection(configuration)) {
			const { query, values } = bindSqlPlaceholders(command, session.placeholders);
			return await this.executeBoundCommand(connector, query, values);
		}
		if (!configuration) throw new TypeError(`Connector "${connector}" is not configured`);
		if (configuration.type === "shell") {
			const shellName = configuration.host || configuration.name || connector;
			if (/@{1,3}[A-Za-z0-9_$.]+/.test(command)) {
				throw new TypeError("Shell action commands cannot contain placeholders");
			}
			const shellCommand = command.trim();
			if (/\bsudo\b/i.test(shellCommand)) {
				throw new TypeError("Forbidden token 'sudo' in shell command");
			}
			let args;
			if (/(bash|sh|zsh)/i.test(shellName)) {
				args = ["-c", shellCommand];
			} else if (/powershell/i.test(shellName)) {
				args = ["-NoProfile", "-Command", shellCommand];
			} else {
				throw new TypeError(`Unsupported shell: ${shellName}`);
			}
			const output = await runCommand(shellName, args);
			if (output.code !== 0) {
				throw new Error(output.stderr.trim() || `Shell command exited with code ${output.code}`);
			}
			return { affectedRows: 1, fields: ["value"], rows: [{ value: output.stdout.trim() }] };
		}
		if (configuration.type === "api") {
			const base = new URL(configuration.host);
			const endpoint = new URL(WBPL(command, session.placeholders), base);
			if (endpoint.origin !== base.origin) {
				throw new TypeError("API action URL must use the configured connector origin");
			}
			const response = await fetch(endpoint, {
				method,
				headers: { "Content-Type": configuration.contentType || "application/json" },
				...(method === "GET" ? {} : { body: JSON.stringify(fields) })
			});
			if (!response.ok) {
				throw new Error(`API action failed with status ${response.status}`);
			}
			const text = await response.text();
			let data = {};
			if (text) {
				try {
					data = JSON.parse(text);
				} catch {
					data = { value: text };
				}
			}
			const rows = Array.isArray(data) ? data : [data];
			return {
				affectedRows: rows.length,
				fields: rows[0] && typeof rows[0] === "object" ? Object.keys(rows[0]) : [],
				rows
			};
		}
		throw new TypeError(`Connector "${connector}" does not support actions`);
	}
	static async executeCrud(session, content, operation, submittedFields, keyField) {
		if (!["insert", "update", "delete"].includes(operation)) {
			throw new TypeError(`Unsupported CRUD operation: ${operation}`);
		}
		const table = getTableFromQuery(WBPL(content.query, session.placeholders));
		const tableInfo = await this.executeCommand(
			session,
			content.connector,
			`SELECT * FROM ${quoteIdentifier(table)} LIMIT 0`
		);
		const columns = new Map(tableInfo.fields.map((column) => [column.toLowerCase(), column]));
		const canonicalKey = columns.get(keyField.toLowerCase());
		if (operation !== "insert" && !canonicalKey) {
			throw new TypeError(`Key field is not a column in ${table}: ${keyField}`);
		}

		const fields = {};
		for (const [name, value] of Object.entries(submittedFields)) {
			const column = columns.get(name.toLowerCase());
			if (column) fields[column] = value;
		}
		let query;
		let values;
		let recordKey;
		if (operation === "insert") {
			const submittedKey = canonicalKey ? fields[canonicalKey] : void 0;
			if (submittedKey === "") delete fields[canonicalKey];
			const names = Object.keys(fields);
			if (!names.length) throw new TypeError("No submitted fields match columns in the connector table");
			query = `INSERT INTO ${quoteIdentifier(table)} (${names.map(quoteIdentifier).join(", ")}) VALUES (${names.map(() => "?").join(", ")})`;
			values = names.map((name) => fields[name]);
			recordKey = submittedKey;
		} else {
			recordKey = Object.entries(submittedFields).find(([name]) => name.toLowerCase() === canonicalKey.toLowerCase())?.[1];
			if (recordKey === void 0 || recordKey === "") {
				throw new TypeError(`Missing key field: ${canonicalKey}`);
			}
			if (operation === "update") {
				delete fields[canonicalKey];
				const names = Object.keys(fields);
				if (!names.length) throw new TypeError("No submitted fields to update");
				query = `UPDATE ${quoteIdentifier(table)} SET ${names.map((name) => `${quoteIdentifier(name)} = ?`).join(", ")} WHERE ${quoteIdentifier(canonicalKey)} = ?`;
				values = [...names.map((name) => fields[name]), recordKey];
			} else {
				query = `DELETE FROM ${quoteIdentifier(table)} WHERE ${quoteIdentifier(canonicalKey)} = ?`;
				values = [recordKey];
			}
		}
		const result = await this.executeCommand(session, content.connector, query, values);
		return {
			fields,
			affectedRows: result.affectedRows,
			keyValue: operation === "insert" && (recordKey === void 0 || recordKey === "")
				? result.insertId ?? ""
				: recordKey
		};
	}
	static async execute(session, content) {
		if (!content.connector) {
			return { affectedRows: 0, fields: [], rows: [{}] };
		}
		let records = { affectedRows: 0, fields: [], rows: [{}] };
		try {
			if (content.connector === "WBOLApi") return await fetchWBOLApiData(session, content);
			await this.initialize();
			const configuration = STWConnectors.connectors.get(content.connector) || {};
			if (content.connector === "json") {
				const json = JSON.parse(content.query);
				records = {
					affectedRows: 1,
					fields: json && typeof json === "object" && !Array.isArray(json) ? Object.keys(json) : [],
					rows: Array.isArray(json) ? json : [json]
				};
			} else if ("type" in configuration && configuration.type === "api") {
				records = await fetchAPIData(session, content, configuration);
			} else if ("type" in configuration && configuration.type === "shell") {
				const shellConnector = configuration;
				const shellName = shellConnector.host || shellConnector.name || content.connector;
				const cmdString = WBPL(content.query, session.placeholders).trim();
				let args = [];
				if (/\bsudo\b/i.test(cmdString)) {
					records = {
						affectedRows: 1,
						fields: ["error"],
						rows: [{ error: "Forbidden token 'sudo' in shell command" }]
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
					let rows = [], fields = [];
					if (stdout) {
						try {
							const parsed = JSON.parse(stdout);
							if (Array.isArray(parsed)) {
								rows = parsed.map((r) => typeof r === "object" ? r : { value: r });
								fields = rows.length ? Object.keys(rows[0]) : [];
							} else if (typeof parsed === "object") {
								rows = [parsed];
								fields = Object.keys(parsed);
							} else {
								rows = [{ value: parsed }];
								fields = ["value"];
							}
						} catch {
							rows = stdout.split(/\r?\n/).map((line, i) => ({ line: i + 1, value: line }));
							fields = ["line", "value"];
						}
					} else {
						rows = [{}];
						fields = [];
					}
					if (stderr) {
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
			} else if (isMySQLConnection(configuration)) {
				const sql = WBPL(content.query, session.placeholders);
				try {
					records = await executeMySQL(configuration, sql);
				} catch (error) {
					const msg = error instanceof Error ? error.message : String(error);
					if (/closed/i.test(msg) || /gone away/i.test(msg)) {
						const client = await this.getMySqlClient(content.connector);
						if (client) {
							try {
								records = await executeMySQL(client, sql);
							} catch (e2) {
								console.warn(
									`MySQL query failed after reconnect for connector "${content.connector}": ${e2 instanceof Error ? e2.message : String(e2)}`
								);
								records = { affectedRows: 0, fields: [], rows: [{}] };
							}
						} else {
							console.warn(`MySQL reconnect not available for connector "${content.connector}": ${msg}`);
							records = { affectedRows: 0, fields: [], rows: [{}] };
						}
					} else {
						console.warn(`MySQL query failed for connector "${content.connector}": ${msg}`);
						records = { affectedRows: 0, fields: [], rows: [] };
					}
				}
			}
		} catch (error) {
			console.warn(
				`Connector error for connector "${content.connector}": ${error instanceof Error ? error.message : String(error)}`
			);
			records = { affectedRows: 0, fields: [], rows: [{}] };
		}
		return records;
	}
}
function bindSqlPlaceholders(query, placeholders) {
	const values = [];
	const sql = query.replace(/(['"])(@@[A-Za-z0-9_$.]+)\1|(@@[A-Za-z0-9_$.]+)/g, (match, quote, quoted, plain) => {
		const name = quoted || plain;
		if (!placeholders.has(name)) return match;
		values.push(placeholders.get(name));
		return "?";
	});
	return { query: sql, values };
}
function isMySQLConnection(value) {
	return value !== null && value !== void 0 && typeof value === "object" && "execute" in value && "end" in value;
}
async function executeMySQL(client, sql, values = []) {
	const [result, fieldPackets] = await client.execute(sql, values);
	const rows = Array.isArray(result) ? result : [];
	const affectedRows = Array.isArray(result) ? rows.length : Number(result.affectedRows ?? 0);
	return {
		affectedRows,
		insertId: Array.isArray(result) ? 0 : result.insertId ?? 0,
		fields: (fieldPackets ?? []).map((field) => field.name),
		rows
	};
}
function getTableFromQuery(query) {
	const match = /^\s*SELECT\b[\s\S]*?\bFROM\s+((?:`[^`]+`|[A-Za-z0-9_$]+)(?:\s*\.\s*(?:`[^`]+`|[A-Za-z0-9_$]+))?)([\s\S]*)$/i.exec(query ?? "");
	if (!match) {
		throw new TypeError("CUD actions require a SELECT query with a single table source");
	}
	const table = match[1].replaceAll("`", "").replace(/\s*\.\s*/g, ".");
	if (!/^[A-Za-z0-9_$]+(?:\.[A-Za-z0-9_$]+)?$/.test(table)) {
		throw new TypeError("The SELECT query contains an unsupported table identifier");
	}
	if (/^\s*(?:(?:AS\s+)?[A-Za-z0-9_$]+)?\s*(?:,|\bJOIN\b)/i.test(match[2])) {
		throw new TypeError("CUD actions require a SELECT query with a single table source");
	}
	return table;
}
function quoteIdentifier(identifier) {
	return identifier.split(".").map((part) => `\`${part.replaceAll("`", "``")}\``).join(".");
}
async function fetchAPIData(session, content, connector) {
	const query = WBPL(content.query, session.placeholders);
	const expr = jsonata(query);
	const response = await fetch(`${connector.host}?${WBPL(content.params, session.placeholders)}`, {
		headers: { "Content-Type": connector.contentType || "application/json" }
	});
	let json = await response.json();
	json = expr.evaluate(json);
	if (json instanceof Promise) {
		json = await json;
	}
	if (Array.isArray(json)) {
		return new Promise(
			(resolve) => resolve({
				affectedRows: json.length,
				fields: Object.keys(json[0]) || [],
				rows: Array.isArray(json) ? json : [json]
			})
		);
	}
	return new Promise(
		(resolve) => resolve({
			affectedRows: 1,
			fields: json && typeof json === "object" && !Array.isArray(json) ? Object.keys(json) : [],
			rows: Array.isArray(json) ? json : [json]
		})
	);
}
async function fetchWBOLApiData(session, content) {
	if (!session.roles.includes("developers")) {
		return { affectedRows: 0, fields: ["error"], rows: [{ error: "Forbidden" }] };
	}
	const params = new URLSearchParams(WBPL(content.params, session.placeholders).replace(/^\?/, ""));
	const data = getWbolContent(params.get("uuid"), session);
	if (!data) return { affectedRows: 0, fields: ["error"], rows: [{ error: "Content not found" }] };
	const result = await jsonata(WBPL(content.query, session.placeholders)).evaluate(data);
	const rows = Array.isArray(result) ? result : [result];
	return {
		affectedRows: rows.length,
		fields: rows.length && rows[0] && typeof rows[0] === "object" ? Object.keys(rows[0]) : [],
		rows
	};
}
export {
	STWConnectors
};
