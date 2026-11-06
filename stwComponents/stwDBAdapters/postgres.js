import { Client as PostgresClient } from "pg";
class STWPostgresAdapter {
  constructor(config) {
    this.config = config;
    this.client = new PostgresClient({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database
    });
  }
  client;
  async connect() {
    await this.client.connect();
  }
  async close() {
    await this.client.end();
  }
  /**
   * List all tables and views in the database
   */
  async listObjects() {
    const sql = `SELECT table_name, table_type FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema');`;
    return (await this.execute(sql))[0];
  }
  /**
   * Get details (fields/parameters) for a table, view, procedure, or function
   * @param objectName Name of the object
   * @param objectType Type: 'TABLE', 'VIEW', 'PROCEDURE', 'FUNCTION'
   */
  async getObjectDetails(objectName, objectType) {
    let sql = "";
    if (objectType === "TABLE" || objectType === "VIEW") {
      sql = `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = '${objectName}';`;
    } else if (objectType === "FUNCTION" || objectType === "PROCEDURE") {
      sql = `SELECT parameter_name, data_type, parameter_mode FROM information_schema.parameters WHERE specific_name = '${objectName}';`;
    } else {
      throw new Error("Unsupported object type");
    }
    return (await this.execute(sql))[0];
  }
  /**
   * Execute a batch of SQL statements as a single script (if supported by the driver)
   */
  async execute(batch) {
    try {
      const result = await this.client.query(batch);
      const fields = result.fields?.map((col) => col.name) ?? [];
      const rows = result.rows ?? [];
      return [{
        affectedRows: rows.length,
        fields,
        rows
      }];
    } catch (e) {
      const statements = batch.split(";").map((s) => s.trim()).filter((s) => s);
      const results = [];
      for (const sql of statements) {
        try {
          const result = await this.client.query(sql);
          const fields = result.fields?.map((col) => col.name) ?? [];
          const rows = result.rows ?? [];
          results.push({
            affectedRows: rows.length,
            fields,
            rows
          });
        } catch (err) {
          results.push({ affectedRows: 0, fields: [], rows: [{ error: err.message }] });
        }
      }
      return results;
    }
  }
}
export {
  STWPostgresAdapter
};
