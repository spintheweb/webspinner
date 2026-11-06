// SPDX-License-Identifier: GPL-3.0-or-later
// SQL Server database adapter for Spin the Web

import sql from "mssql";
import type { ConnectionPool } from "mssql";
import type { ISTWAdapter, ISTWRecords } from "./adapter.ts";

export class STWMSSQLAdapter implements ISTWAdapter {
  private connection: ConnectionPool | null = null;

  constructor(private config: {
    server: string;
    user: string;
    password: string;
    database: string;
  }) {}

  async connect(): Promise<void> {
    const { server, user, password, database } = this.config;
    // DSN-less connection string. Requires msodbcsql18 + unixODBC/ODBC manager installed.
    const connStr = `Driver={ODBC Driver 18 for SQL Server};Server=${server};Database=${database};Uid=${user};Pwd=${password};Encrypt=Yes;TrustServerCertificate=Yes`;
    this.connection = await new sql.ConnectionPool({
      server,
      user,
      password,
      database,
      options: { encrypt: true, trustServerCertificate: true },
    }).connect();
  }

  async close(): Promise<void> {
    if (this.connection) {
      await this.connection.close();
      this.connection = null;
    }
  }

  /**
   * List all database objects (tables, views, etc.)
   */
  async listObjects(): Promise<ISTWRecords> {
    const sql = `SELECT name, type_desc FROM sys.objects`;
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
      sql = `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${objectName}';`;
    } else if (objectType === "PROCEDURE" || objectType === "FUNCTION") {
      sql = `SELECT PARAMETER_NAME, DATA_TYPE, PARAMETER_MODE FROM INFORMATION_SCHEMA.PARAMETERS WHERE SPECIFIC_NAME = '${objectName}';`;
    } else {
      throw new Error("Unsupported object type");
    }
    return (await this.execute(sql))[0];
  }

  /**
   * Execute a batch of SQL statements as a single script (if supported by the driver)
   */
  async execute(batch: string): Promise<ISTWRecords[]> {
    if (!this.connection) throw new Error("SQL Server not connected");
    try {
      // Attempt to execute full batch; depending on driver/API, this may return only last result set
      const res = await this.connection.request().query(batch);
      const rows = res.recordset ?? [];
      const fields = Object.keys(res.recordset?.columns ?? {});
      return [{ rows, fields, affectedRows: Array.isArray(rows) ? rows.length : 0 }];
    } catch (_e) {
      // Fallback: split statements and execute sequentially
      const statements = batch.split(';').map((s) => s.trim()).filter((s) => s);
      const results: ISTWRecords[] = [];
      for (const sqlText of statements) {
        try {
          const res = await this.connection.request().query(sqlText);
          const rows = res.recordset ?? [];
          const fields = Object.keys(res.recordset?.columns ?? {});
          results.push({ rows, fields, affectedRows: Array.isArray(rows) ? rows.length : 0 });
        } catch (err) {
          results.push({ affectedRows: 0, fields: [], rows: [{ error: (err as Error).message }] });
        }
      }
      return results;
    }
  }
}
