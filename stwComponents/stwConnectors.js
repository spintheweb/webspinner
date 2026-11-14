import { WBPL } from "./stwWBPL.js";
import { envGet } from "./stwConfig.js";
import { dirname } from "node:path";
import { readFileSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createConnection } from "mysql2/promise";
import { Client } from "pg";
import sql from "mssql";
import { BSON, MongoClient, ObjectId } from "mongodb";
import jsonata from "jsonata";
import { isNotFoundError, runCommand } from "./stwNode.js";
import { getWbolContent } from "./stwWBOLApi.js";
class STWConnectors {
	static connectors = new Map();
	static #initializationPromise = null;
	static connectorConfigs = new Map();
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
			if (isDatabaseConnection(connector)) {
				try {
					await closeDatabaseConnection(connector);
				} catch (error) {
					closeErrors.push(error);
				}
			}
		}
		this.connectors.clear();
		this.connectorConfigs.clear();
		this.#initializationPromise = null;
		if (closeErrors.length > 0) {
			throw new AggregateError(closeErrors, "One or more database connections could not be closed");
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
				const initializationErrors = [];
				for (const settings of connectors) {
					try {
						if (isDatabaseType(settings.type)) {
							this.connectorConfigs.set(settings.name, settings);
						}
						switch (settings.type) {
							case "api":
								this.connectors.set(settings.name, settings);
								break;
							case "shell":
								this.connectors.set(settings.name, { ...settings, name: settings.name });
								break;
							case "mysql":
							case "postgres":
							case "mssql":
							case "mongodb": {
								const connection = await this.connectDatabase(settings);
								this.connectors.set(settings.name, connection);
								break;
							}
							default:
								throw new TypeError(`Unsupported connector type: ${settings.type}`);
						}
					} catch (error) {
						if (strict) {
							initializationErrors.push(new Error(
								`Connector "${settings.name}" failed to initialize: ${error instanceof Error ? error.message : String(error)}`,
								{ cause: error }
							));
						}
						console.error(
							`Error processing connector configuration: ${error instanceof Error ? error.message : String(error)}`
						);
						continue;
					}
				}
				if (strict && initializationErrors.length) {
					throw new AggregateError(initializationErrors, "One or more connectors failed to initialize");
				}
			})();
		}
		return this.#initializationPromise;
	}
	static async connectDatabase(settings) {
		return await createDatabaseConnection(settings);
	}
	static async reconnectAll() {
		let resetError;
		try {
			await this.resetRuntime();
		} catch (error) {
			resetError = error;
		}
		let initializationError;
		try {
			await this.initialize(true);
		} catch (error) {
			initializationError = error;
		}
		if (resetError && initializationError) {
			throw new AggregateError([resetError, initializationError], "Reconnect completed with errors");
		}
		if (resetError) throw resetError;
		if (initializationError) throw initializationError;
		return { reconnected: true };
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
		const connection = requireSqlConnection(connector, this.connectors.get(connector));
		const sql = WBPL(query, session.placeholders);
		return await this.executeSqlCommand(connector, connection, sql, values);
	}
	static async executeBoundCommand(connector, query, values = []) {
		if (!connector) throw new TypeError("Connector name is required");
		await this.initialize();
		const connection = requireSqlConnection(connector, this.connectors.get(connector));
		return await this.executeSqlCommand(connector, connection, query, values);
	}
	static async executeSqlCommand(name, connection, query, values = []) {
		try {
			return await executeSql(connection, query, values);
		} catch (error) {
			if (connection.type !== "mysql" || !/closed|gone away/i.test(error instanceof Error ? error.message : String(error))) {
				throw error;
			}
			const reconnected = await this.getMySqlConnection(name);
			if (!reconnected) throw error;
			return await executeSql(reconnected, query, values);
		}
	}
	static async getMySqlConnection(name) {
		const connection = this.connectors.get(name);
		if (!connection || connection.type !== "mysql") return null;
		try {
			await executeSql(connection, "SELECT 1");
			return connection;
		} catch {
			const settings = this.connectorConfigs.get(name);
			if (!settings) return null;
			try {
				const reconnected = await createDatabaseConnection(settings);
				this.connectors.set(name, reconnected);
				return reconnected;
			} catch (error) {
				console.warn(`MySQL reconnect failed for connector "${name}": ${error instanceof Error ? error.message : String(error)}`);
				return null;
			}
		}
	}
	static async getType(connector) {
		await this.initialize();
		const configuration = this.connectors.get(connector);
		if (isDatabaseConnection(configuration)) return configuration.type;
		return configuration?.type ?? this.connectorConfigs.get(connector)?.type ?? null;
	}
	static async supportsCrud(connector) {
		const type = await this.getType(connector);
		return SQL_CONNECTOR_TYPES.has(type) || type === "mongodb";
	}
	static async executeAction(session, connector, command, method, fields = {}) {
		if (!connector) throw new TypeError("Connector name is required");
		await this.initialize();
		const configuration = this.connectors.get(connector);
		if (isDatabaseConnection(configuration)) {
			if (configuration.type === "mongodb") {
				throw new TypeError("MongoDB writes must use stwinsert, stwupdate, or stwdelete");
			}
			const { query, values } = bindSqlPlaceholders(command, session.placeholders, configuration.type);
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
		await this.initialize();
		const connection = this.connectors.get(content.connector);
		if (!isDatabaseConnection(connection)) {
			throw new TypeError(`Connector "${content.connector}" does not support database CRUD`);
		}
		const command = WBPL(content.query, session.placeholders);
		if (connection.type === "mongodb") {
			return await executeMongoCrud(connection, command, operation, submittedFields, keyField || "_id");
		}
		return await executeSqlCrud(
			connection,
			command,
			operation,
			submittedFields,
			keyField || "id",
			(query, values) => this.executeBoundCommand(content.connector, query, values)
		);
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
			} else if (isDatabaseConnection(configuration)) {
				const command = WBPL(content.query, session.placeholders);
				if (configuration.type === "mongodb") {
					records = await executeMongoQuery(configuration, command);
				} else if (configuration.type === "mysql") {
					try {
						records = await this.executeSqlCommand(content.connector, configuration, command);
					} catch (error) {
						const message = error instanceof Error ? error.message : String(error);
						console.warn(`MySQL query failed for connector "${content.connector}": ${message}`);
						records = { affectedRows: 0, fields: [], rows: [] };
					}
				} else {
					records = await executeSql(configuration, command);
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
function bindSqlPlaceholders(query, placeholders, type) {
	const values = [];
	const sql = query.replace(/(['"])(@@[A-Za-z0-9_$.]+)\1|(@@[A-Za-z0-9_$.]+)/g, (match, quote, quoted, plain) => {
		const name = quoted || plain;
		if (!placeholders.has(name)) return match;
		values.push(placeholders.get(name));
		return sqlPlaceholder(type, values.length - 1);
	});
	return { query: sql, values };
}
const SQL_CONNECTOR_TYPES = new Set(["mysql", "postgres", "mssql"]);
function isDatabaseType(type) {
	return SQL_CONNECTOR_TYPES.has(type) || type === "mongodb";
}
function isDatabaseConnection(value) {
	return value !== null && typeof value === "object" && (SQL_CONNECTOR_TYPES.has(value.type) || value.type === "mongodb");
}
function requireSqlConnection(name, connection) {
	if (!isDatabaseConnection(connection) || !SQL_CONNECTOR_TYPES.has(connection.type)) {
		throw new TypeError(`Connector "${name}" is not a configured SQL database connector`);
	}
	return connection;
}
async function createDatabaseConnection(settings) {
	switch (settings.type) {
		case "mysql": {
			const client = await createConnection({
				host: settings.host,
				port: settings.port ?? 3306,
				user: settings.user,
				password: settings.password,
				database: settings.database
			});
			return { type: settings.type, client };
		}
		case "postgres": {
			const client = new Client({
				host: settings.host,
				port: settings.port ?? 5432,
				user: settings.user,
				password: settings.password,
				database: settings.database
			});
			await client.connect();
			return { type: settings.type, client };
		}
		case "mssql": {
			const client = await new sql.ConnectionPool({
				server: settings.host,
				port: settings.port ?? 1433,
				user: settings.user,
				password: settings.password,
				database: settings.database
			}).connect();
			return { type: settings.type, client };
		}
		case "mongodb": {
			const uri = /^(mongodb(?:\+srv)?:\/\/)/i.test(settings.host)
				? settings.host
				: `mongodb://${settings.host}`;
			const client = new MongoClient(uri, settings.user
				? { auth: { username: settings.user, password: settings.password ?? "" } }
				: {});
			await client.connect();
			return { type: settings.type, client, database: client.db(settings.database) };
		}
		default:
			throw new TypeError(`Unsupported database connector type: ${settings.type}`);
	}
}
async function closeDatabaseConnection(connection) {
	if (connection.type === "mysql") await connection.client.end();
	else if (connection.type === "postgres") await connection.client.end();
	else if (connection.type === "mssql") await connection.client.close();
	else if (connection.type === "mongodb") await connection.client.close();
}
async function executeSql(connection, query, values = []) {
	if (connection.type === "mysql") {
		const [result, fields] = await connection.client.execute(query, values);
		const rows = Array.isArray(result) ? result : [];
		return {
			affectedRows: Array.isArray(result) ? rows.length : Number(result.affectedRows ?? 0),
			insertId: Array.isArray(result) ? 0 : result.insertId ?? 0,
			fields: (fields ?? []).map((field) => field.name),
			rows
		};
	}
	if (connection.type === "postgres") {
		const result = await connection.client.query(query, values);
		return {
			affectedRows: Number(result.rowCount ?? result.rows.length),
			insertId: 0,
			fields: (result.fields ?? []).map((field) => field.name),
			rows: result.rows
		};
	}
	const request = connection.client.request();
	values.forEach((value, index) => request.input(`p${index}`, value));
	const result = await request.query(query);
	const rows = result.recordset ?? [];
	return {
		affectedRows: Number(result.rowsAffected?.reduce((total, count) => total + count, 0) ?? rows.length),
		insertId: 0,
		fields: rows.length ? Object.keys(rows[0]) : Object.keys(result.recordset?.columns ?? {}),
		rows
	};
}
async function executeSqlCrud(connection, command, operation, submittedFields, keyField, execute = executeSql) {
	const table = getTableFromQuery(command);
	const metadataQuery = connection.type === "mssql"
		? `SELECT TOP 0 * FROM ${quoteIdentifier(table, connection.type)}`
		: `SELECT * FROM ${quoteIdentifier(table, connection.type)} LIMIT 0`;
	const tableInfo = await execute(metadataQuery);
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
		recordKey = canonicalKey ? fields[canonicalKey] : void 0;
		if (recordKey === "") delete fields[canonicalKey];
		const names = Object.keys(fields);
		if (!names.length) throw new TypeError("No submitted fields match columns in the connector table");
		const placeholders = names.map((_, index) => sqlPlaceholder(connection.type, index));
		const output = connection.type === "mssql" && canonicalKey
			? ` OUTPUT INSERTED.${quoteIdentifier(canonicalKey, connection.type)}`
			: "";
		query = `INSERT INTO ${quoteIdentifier(table, connection.type)} (${names.map((name) => quoteIdentifier(name, connection.type)).join(", ")})${output} VALUES (${placeholders.join(", ")})`;
		if (connection.type === "postgres" && canonicalKey) {
			query += ` RETURNING ${quoteIdentifier(canonicalKey, connection.type)}`;
		}
		values = names.map((name) => fields[name]);
	} else {
		recordKey = Object.entries(submittedFields).find(([name]) => name.toLowerCase() === canonicalKey.toLowerCase())?.[1];
		if (recordKey === void 0 || recordKey === "") throw new TypeError(`Missing key field: ${canonicalKey}`);
		if (operation === "update") {
			delete fields[canonicalKey];
			const names = Object.keys(fields);
			if (!names.length) throw new TypeError("No submitted fields to update");
			query = `UPDATE ${quoteIdentifier(table, connection.type)} SET ${names.map((name, index) => `${quoteIdentifier(name, connection.type)} = ${sqlPlaceholder(connection.type, index)}`).join(", ")} WHERE ${quoteIdentifier(canonicalKey, connection.type)} = ${sqlPlaceholder(connection.type, names.length)}`;
			values = [...names.map((name) => fields[name]), recordKey];
		} else {
			query = `DELETE FROM ${quoteIdentifier(table, connection.type)} WHERE ${quoteIdentifier(canonicalKey, connection.type)} = ${sqlPlaceholder(connection.type, 0)}`;
			values = [recordKey];
		}
	}
	const result = await execute(query, values);
	const generatedKey = result.rows[0]?.[canonicalKey] ?? result.insertId;
	return {
		fields,
		affectedRows: result.affectedRows,
		keyValue: operation === "insert" && (recordKey === void 0 || recordKey === "")
			? generatedKey ?? ""
			: recordKey
	};
}
async function executeMongoCrud(connection, command, operation, submittedFields, keyField) {
	const specification = parseMongoCommand(command);
	const collection = connection.database.collection(specification.collection);
	const fields = { ...submittedFields };
	const recordKey = fields[keyField];
	if (operation === "insert") {
		if (fields[keyField] === "") delete fields[keyField];
		if (!Object.keys(fields).length) throw new TypeError("No submitted fields to insert");
		const result = await collection.insertOne(fields);
		return {
			fields,
			affectedRows: result.acknowledged ? 1 : 0,
			keyValue: recordKey && recordKey !== "" ? recordKey : result.insertedId
		};
	}
	if (recordKey === void 0 || recordKey === "") throw new TypeError(`Missing key field: ${keyField}`);
	const filter = { ...specification.filter, [keyField]: mongoKeyValue(keyField, recordKey) };
	if (operation === "update") {
		delete fields[keyField];
		if (!Object.keys(fields).length) throw new TypeError("No submitted fields to update");
		const result = await collection.updateOne(filter, { $set: fields });
		return { fields, affectedRows: result.modifiedCount, keyValue: recordKey };
	}
	const result = await collection.deleteOne(filter);
	return { fields: {}, affectedRows: result.deletedCount, keyValue: recordKey };
}
async function executeMongoQuery(connection, command) {
	const specification = parseMongoCommand(command);
	let cursor = connection.database.collection(specification.collection).find(specification.filter, {
		projection: specification.projection,
		sort: specification.sort
	});
	if (specification.limit !== void 0) cursor = cursor.limit(specification.limit);
	const rows = await cursor.toArray();
	return {
		affectedRows: rows.length,
		fields: rows.length && rows[0] && typeof rows[0] === "object" ? Object.keys(rows[0]) : [],
		rows
	};
}
function parseMongoCommand(command) {
	let specification;
	try {
		specification = BSON.EJSON.parse(command);
	} catch (error) {
		throw new TypeError("MongoDB connector queries must be JSON objects", { cause: error });
	}
	if (!specification || typeof specification !== "object" || Array.isArray(specification)) {
		throw new TypeError("MongoDB connector queries must be JSON objects");
	}
	if (typeof specification.collection !== "string" || !specification.collection.trim()) {
		throw new TypeError("MongoDB connector queries require a collection name");
	}
	for (const key of ["filter", "projection", "sort"]) {
		if (specification[key] !== void 0 && (!specification[key] || typeof specification[key] !== "object" || Array.isArray(specification[key]))) {
			throw new TypeError(`MongoDB query ${key} must be an object`);
		}
	}
	if (specification.limit !== void 0 && (!Number.isInteger(specification.limit) || specification.limit < 0)) {
		throw new TypeError("MongoDB query limit must be a non-negative integer");
	}
	return {
		collection: specification.collection,
		filter: specification.filter ?? {},
		projection: specification.projection,
		sort: specification.sort,
		limit: specification.limit
	};
}
function mongoKeyValue(keyField, value) {
	return keyField === "_id" && /^[a-f\d]{24}$/i.test(value) ? new ObjectId(value) : value;
}
function sqlPlaceholder(type, index) {
	return type === "postgres" ? `$${index + 1}` : type === "mssql" ? `@p${index}` : "?";
}
function getTableFromQuery(query) {
	const identifier = "(?:`[^`]+`|\"[^\"]+\"|\\[[^\\]]+\\]|[A-Za-z0-9_$]+)";
	const match = new RegExp(`^\\s*SELECT\\b[\\s\\S]*?\\bFROM\\s+(${identifier}(?:\\s*\\.\\s*${identifier}){0,2})([\\s\\S]*)$`, "i").exec(query ?? "");
	if (!match) {
		throw new TypeError("CUD actions require a SELECT query with a single table source");
	}
	const table = match[1].split(".").map((part) => part.trim().replace(/^(?:`([^`]+)`|"([^"]+)"|\[([^\]]+)\])$/, "$1$2$3")).join(".");
	if (!table.split(".").every((part) => /^[A-Za-z0-9_$]+$/.test(part))) {
		throw new TypeError("The SELECT query contains an unsupported table identifier");
	}
	if (/^\s*(?:(?:AS\s+)?[A-Za-z0-9_$]+)?\s*(?:,|\bJOIN\b)/i.test(match[2])) {
		throw new TypeError("CUD actions require a SELECT query with a single table source");
	}
	return table;
}
function quoteIdentifier(identifier, type) {
	return identifier.split(".").map((part) => {
		if (type === "mssql") return `[${part.replaceAll("]", "]]")}]`;
		if (type === "postgres") return `"${part.replaceAll("\"", "\"\"")}"`;
		return `\`${part.replaceAll("`", "``")}\``;
	}).join(".");
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
	if (!session.roles.includes("developer")) {
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
