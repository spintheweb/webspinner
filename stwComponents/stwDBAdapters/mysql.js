import { createConnection } from "mysql2/promise";
class STWMySQLAdapter {
	constructor(config) {
		this.config = config;
	}
	client = null;
	async connect() {
		this.client = await createConnection({
			host: this.config.hostname,
			port: this.config.port ?? 3306,
			user: this.config.username,
			password: this.config.password,
			database: this.config.db
		});
	}
	async query(sql) {
		if (!this.client) throw new Error("MySQL is not connected");
		const [result, fieldPackets] = await this.client.execute(sql);
		const rows = Array.isArray(result) ? result : [];
		const fields = fieldPackets.map((field) => field.name);
		return {
			affectedRows: Array.isArray(result) ? rows.length : Number(result.affectedRows ?? 0),
			fields,
			rows
		};
	}
	async close() {
		await this.client?.end();
		this.client = null;
	}
	/**
    * List all tables and views in the database
    */
	async listObjects() {
		const sql = `SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.tables WHERE table_schema = DATABASE();`;
		return await this.query(sql);
	}
	/**
    * Get details (fields/parameters) for a table, view, procedure, or function
    * @param objectName Name of the object
    * @param objectType Type: 'TABLE', 'VIEW', 'PROCEDURE', 'FUNCTION'
    */
	async getObjectDetails(objectName, objectType) {
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
	async execute(batch) {
		try {
			const rows = await this.query(batch);
			return [{
				affectedRows: rows.affectedRows ?? 0,
				fields: rows.fields,
				rows: rows.rows
			}];
		} catch (_error) {
			const statements = batch.split(";").map((s) => s.trim()).filter((s) => s);
			const results = [];
			for (const sql of statements) {
				try {
					results.push(await this.query(sql));
				} catch (err) {
					results.push({ affectedRows: 0, fields: [], rows: [{ error: err.message }] });
				}
			}
			return results;
		}
	}
}
export {
	STWMySQLAdapter
};
