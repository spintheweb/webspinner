// SPDX-License-Identifier: GPL-3.0-or-later
// PostgreSQL database adapter for Spin the Web

import { Client as PostgresClient } from "jsr:@db/postgres";
import { ISTWAdapter, ISTWRecords } from "./adapter.ts";

export class STWPostgresAdapter implements ISTWAdapter {
  private client: PostgresClient;

  constructor(private config: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
  }) {
    this.client = new PostgresClient({
      hostname: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
    });
  }

  async connect(): Promise<void> {
    await this.client.connect();
  }

  async close(): Promise<void> {
    await this.client.end();
  }

  /**
   * List all tables and views in the database
   */
  async listObjects(): Promise<ISTWRecords> {
    const sql = `SELECT table_name, table_type FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema');`;
    return (await this.execute(sql))[0];
  }

  /**
   * Get details (fields/parameters) for a table, view, procedure, or function
   * @param objectName Name of the object
   * @param objectType Type: 'TABLE', 'VIEW', 'PROCEDURE', 'FUNCTION'
   */
  async getObjectDetails(objectName: string, objectType: string): Promise<ISTWRecords> {
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
  async execute(batch: string): Promise<ISTWRecords[]> {
    try {
      // Attempt to execute the full batch as a script
      const result = await this.client.queryObject(batch);
      const fields = result.columns?.map((col: any) => ({ name: col.name, type: col.dataType })) ?? [];
      const rows = result.rows ?? [];
      return [{
        affectedRows: rows.length,
        fields,
        rows,
      }];
    } catch (e) {
      // Fallback: split and execute individually if batch fails
      const statements = batch.split(';').map(s => s.trim()).filter(s => s);
      const results: ISTWRecords[] = [];
      for (const sql of statements) {
        try {
          const result = await this.client.queryObject(sql);
          const fields = result.columns?.map((col: any) => ({ name: col.name, type: col.dataType })) ?? [];
          const rows = result.rows ?? [];
          results.push({
            affectedRows: rows.length,
            fields,
            rows,
          });
        } catch (err) {
          results.push({ affectedRows: 0, fields: [], rows: [{ error: (err as Error).message }] });
        }
      }
      return results;
    }
  }
}
