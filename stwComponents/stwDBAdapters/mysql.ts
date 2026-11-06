// SPDX-License-Identifier: GPL-3.0-or-later
// MySQL database adapter for Spin the Web

import { createConnection, type Connection } from "mysql2/promise";
import type { ISTWAdapter, ISTWRecords } from "./adapter.ts";

export class STWMySQLAdapter implements ISTWAdapter {
	private client: Connection | null = null;

	constructor(private config: {
		hostname: string;
		port?: number;
		username: string;
		password: string;
		db: string;
	}) {
	}

	async connect(): Promise<void> {
		this.client = await createConnection({
			host: this.config.hostname,
			port: this.config.port ?? 3306,
			user: this.config.username,
			password: this.config.password,
			database: this.config.db,
		});
	}

	async query(sql: string): Promise<ISTWRecords> {
		if (!this.client) throw new Error("MySQL is not connected");
		const [result, fieldPackets] = await this.client.execute(sql);
		const rows = Array.isArray(result) ? result as Record<string, unknown>[] : [];
		const fields = fieldPackets.map(field => field.name);
		return {
			affectedRows: Array.isArray(result) ? rows.length : Number((result as { affectedRows?: number }).affectedRows ?? 0),
			fields,
			rows,
		};
	}

	async close(): Promise<void> {
		await this.client?.end();
		this.client = null;
	}

	/**
	 * List all tables and views in the database
	 */
	async listObjects(): Promise<ISTWRecords> {
		const sql = `SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.tables WHERE table_schema = DATABASE();`;
		return await this.query(sql);
	}

	/**
	 * Get details (fields/parameters) for a table, view, procedure, or function
	 * @param objectName Name of the object
	 * @param objectType Type: 'TABLE', 'VIEW', 'PROCEDURE', 'FUNCTION'
	 */
	async getObjectDetails(objectName: string, objectType: string): Promise<ISTWRecords> {
		let sql = "";
		if (objectType === "TABLE" || objectType === "VIEW") {
			sql = `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = '${objectName}';`;
		} else if (objectType === "PROCEDURE" || objectType === "FUNCTION") {
			sql = `SELECT PARAMETER_NAME, DATA_TYPE, DTD_IDENTIFIER, PARAMETER_MODE FROM information_schema.parameters WHERE SPECIFIC_SCHEMA = DATABASE() AND SPECIFIC_NAME = '${objectName}';`;
		} else {
			throw new Error("Unsupported object type");
		}
		return await this.query(sql);
	}

	/**
	 * Execute a batch of SQL statements as a single script (if supported by the driver)
	 */
	async execute(batch: string): Promise<ISTWRecords[]> {
		try {
			// Attempt to execute the full batch as a script
			const rows = await this.query(batch);
			return [{
				affectedRows: rows.affectedRows ?? 0,
				fields: rows.fields,
				rows: rows.rows,
			}];
		} catch (_error) {
			// Fallback: split and execute individually if batch fails
			const statements = batch.split(';').map(s => s.trim()).filter(s => s);
			const results: ISTWRecords[] = [];
			for (const sql of statements) {
				try {
					results.push(await this.query(sql));
				} catch (err) {
					results.push({ affectedRows: 0, fields: [], rows: [{ error: (err as Error).message }] });
				}
			}
			return results;
		}
	}
}
