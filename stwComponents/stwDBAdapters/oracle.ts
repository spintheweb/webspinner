// SPDX-License-Identifier: GPL-3.0-or-later
// Oracle database adapter (SQLcl/CLI) for Spin the Web

// Oracle adapter (CLI via SQLcl). Requires `sql` in PATH.
// Supports: execute (batch script), listObjects, getObjectDetails.
import { ISTWAdapter, ISTWRecords } from "./adapter.ts";

export type OracleMode = "cli";

export interface OracleConfig {
  mode?: OracleMode;
  username: string;
  password: string;
  host: string;
  port?: number; // default 1521
  service: string; // service name (EZCONNECT)
  sqlclCommand?: string; // default "sql"
  env?: Record<string, string>; // optional environment
}

export class STWOracleAdapter implements ISTWAdapter {
  private config: Required<Omit<OracleConfig, "env">> & { env?: Record<string, string> };

  constructor(cfg: OracleConfig) {
    this.config = {
      mode: cfg.mode ?? "cli",
      username: cfg.username,
      password: cfg.password,
      host: cfg.host,
      port: cfg.port ?? 1521,
      service: cfg.service,
      sqlclCommand: cfg.sqlclCommand ?? "sql",
      env: cfg.env,
    };
  }

  connect(): Promise<void> {
    // CLI-based: no persistent connection; optionally we could verify availability
    return Promise.resolve();
  }

  close(): Promise<void> {
    // Nothing to close for CLI mode
    return Promise.resolve();
  }

  async listObjects(): Promise<ISTWRecords> {
    const sql = `SELECT OBJECT_NAME, OBJECT_TYPE FROM ALL_OBJECTS WHERE OWNER = USER`;
    return (await this.execute(sql))[0];
  }

  async getObjectDetails(objectName: string, objectType: string): Promise<ISTWRecords> {
    let sql = "";
    if (objectType === "TABLE" || objectType === "VIEW") {
      sql = `SELECT COLUMN_NAME, DATA_TYPE, NULLABLE, DATA_DEFAULT FROM ALL_TAB_COLUMNS WHERE TABLE_NAME = '${objectName}' AND OWNER = USER`;
    } else if (objectType === "PROCEDURE" || objectType === "FUNCTION") {
      sql = `SELECT ARGUMENT_NAME, DATA_TYPE, IN_OUT FROM ALL_ARGUMENTS WHERE OBJECT_NAME = '${objectName}' AND OWNER = USER`;
    } else {
      throw new Error("Unsupported object type");
    }
    return (await this.execute(sql))[0];
  }

  async execute(batch: string): Promise<ISTWRecords[]> {
    // Send full script to SQLcl; if it fails, try per-statement fallback.
    try {
      const rec = await this.runSqlcl(batch);
      return [rec];
    } catch (_e) {
      const statements = batch.split(";").map((s) => s.trim()).filter((s) => s);
      const results: ISTWRecords[] = [];
      for (const sql of statements) {
        try {
          results.push(await this.runSqlcl(sql));
        } catch (err) {
          results.push({ affectedRows: 0, fields: [], rows: [{ error: (err as Error).message }] });
        }
      }
      return results;
    }
  }

  // ---- Internals ----
  private buildEzConnect(): string {
    const { username, password, host, port, service } = this.config;
    return `${username}/${password}@${host}:${port}/${service}`;
  }

  private async runSqlcl(sqlText: string): Promise<ISTWRecords> {
    const conn = this.buildEzConnect();
    const script = [
      `SET PAGESIZE 0`,
      `SET SQLFORMAT json`,
      sqlText.replace(/;\s*$/, "") + ";",
      `EXIT`,
      "",
    ].join("\n");

    const cmd = new Deno.Command(this.config.sqlclCommand, {
      args: [conn],
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
      env: this.config.env,
    });

    const child = cmd.spawn();
    const writer = child.stdin.getWriter();
    const encoder = new TextEncoder();
    await writer.write(encoder.encode(script));
    await writer.close();

    const { code, stdout, stderr } = await child.output();
    const out = new TextDecoder().decode(stdout);
    const err = new TextDecoder().decode(stderr);
    if (code !== 0) {
      throw new Error(err || `SQLcl exited with code ${code}`);
    }

    const rows = this.parseSqlclJson(out);
    const fields = rows.length > 0
      ? Object.keys(rows[0]).map((k) => ({ name: k }))
      : [];
    return { rows: rows as Record<string, any>[], fields, affectedRows: rows.length };
  }

  private parseSqlclJson(output: string): Array<Record<string, unknown>> {
    const trimmed = output.trim();
    // Try direct parse
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // Extract last JSON object if banners/noise present
      const match = trimmed.match(/\{[\s\S]*\}$/m);
      if (!match) return [];
      parsed = JSON.parse(match[0]);
    }
    if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      if (Array.isArray(obj.items)) return obj.items as Array<Record<string, unknown>>;
      if (obj.result && typeof obj.result === "object") {
        const r = obj.result as Record<string, unknown>;
        if (Array.isArray(r.rows)) return r.rows as Array<Record<string, unknown>>;
      }
      if (Array.isArray(parsed)) return parsed as Array<Record<string, unknown>>;
    }
    return [];
  }
}
