// SPDX-License-Identifier: GPL-3.0-or-later
// MySQL database adapter for Spin the Web

import { Client } from "https://deno.land/x/mysql@v2.12.1/mod.ts";
import { ISTWAdapter, ISTWRecords } from "./adapter.ts";

export class STWMySQLAdapter implements ISTWAdapter {
  private client: Client;

  constructor(private config: {
    hostname: string;
    port?: number;
    username: string;
    password: string;
    db: string;
  }) {
    this.client = new Client();
  }

  async connect(): Promise<void> {
    await this.client.connect({
      hostname: this.config.hostname,
      port: this.config.port ?? 3306,
      username: this.config.username,
      password: this.config.password,
      db: this.config.db,
    });
  }

  async query(sql: string): Promise<ISTWRecords> {
    const result = await this.client.execute(sql);
    const rows = result.rows ?? [];
    const fields = result.columns?.map((col) => ({ name: col, type: "string" })) ?? [];
    return {
      affectedRows: rows.length,
      fields,
      rows,
    };
  }

  async close(): Promise<void> {
    await this.client.close();
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
      const result = await this.client.execute(batch);
      const rows = result.rows ?? [];
      const fields = result.columns?.map((col) => ({ name: col, type: "string" })) ?? [];
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
          const res = await this.query(sql);
          results.push(res);
        } catch (err) {
          results.push({ affectedRows: 0, fields: [], rows: [{ error: (err as Error).message }] });
        }
      }
      return results;
    }
  }
}
