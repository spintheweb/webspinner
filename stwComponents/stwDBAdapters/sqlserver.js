import sql from "mssql";
class STWMSSQLAdapter {
	constructor(config) {
		this.config = config;
	}
	connection = null;
	async connect() {
		const { server, user, password, database } = this.config;
		const connStr = `Driver={ODBC Driver 18 for SQL Server};Server=${server};Database=${database};Uid=${user};Pwd=${password};Encrypt=Yes;TrustServerCertificate=Yes`;
		this.connection = await new sql.ConnectionPool({
			server,
			user,
			password,
			database,
			options: { encrypt: true, trustServerCertificate: true }
		}).connect();
	}
	async close() {
		if (this.connection) {
			await this.connection.close();
			this.connection = null;
		}
	}
	/**
    * List all database objects (tables, views, etc.)
    */
	async listObjects() {
		const sql2 = `SELECT name, type_desc FROM sys.objects`;
		return (await this.execute(sql2))[0];
	}
	/**
    * Get details (fields/parameters) for a table, view, procedure, or function
    * @param objectName Name of the object
    * @param objectType Type: 'TABLE', 'VIEW', 'PROCEDURE', 'FUNCTION'
    */
	async getObjectDetails(objectName, objectType) {
		let sql2 = "";
		if (objectType === "TABLE" || objectType === "VIEW") {
			sql2 = `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${objectName}';`;
		} else if (objectType === "PROCEDURE" || objectType === "FUNCTION") {
			sql2 = `SELECT PARAMETER_NAME, DATA_TYPE, PARAMETER_MODE FROM INFORMATION_SCHEMA.PARAMETERS WHERE SPECIFIC_NAME = '${objectName}';`;
		} else {
			throw new Error("Unsupported object type");
		}
		return (await this.execute(sql2))[0];
	}
	/**
    * Execute a batch of SQL statements as a single script (if supported by the driver)
    */
	async execute(batch) {
		if (!this.connection) throw new Error("SQL Server not connected");
		try {
			const res = await this.connection.request().query(batch);
			const rows = res.recordset ?? [];
			const fields = Object.keys(res.recordset?.columns ?? {});
			return [{ rows, fields, affectedRows: Array.isArray(rows) ? rows.length : 0 }];
		} catch (_e) {
			const statements = batch.split(";").map((s) => s.trim()).filter((s) => s);
			const results = [];
			for (const sqlText of statements) {
				try {
					const res = await this.connection.request().query(sqlText);
					const rows = res.recordset ?? [];
					const fields = Object.keys(res.recordset?.columns ?? {});
					results.push({ rows, fields, affectedRows: Array.isArray(rows) ? rows.length : 0 });
				} catch (err) {
					results.push({ affectedRows: 0, fields: [], rows: [{ error: err.message }] });
				}
			}
			return results;
		}
	}
}
export {
	STWMSSQLAdapter
};
