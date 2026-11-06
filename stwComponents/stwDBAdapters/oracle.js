import { runCommand } from "../stwNode.js";
class STWOracleAdapter {
  config;
  constructor(cfg) {
    this.config = {
      mode: cfg.mode ?? "cli",
      username: cfg.username,
      password: cfg.password,
      host: cfg.host,
      port: cfg.port ?? 1521,
      service: cfg.service,
      sqlclCommand: cfg.sqlclCommand ?? "sql",
      env: cfg.env
    };
  }
  connect() {
    return Promise.resolve();
  }
  close() {
    return Promise.resolve();
  }
  async listObjects() {
    const sql = `SELECT OBJECT_NAME, OBJECT_TYPE FROM ALL_OBJECTS WHERE OWNER = USER`;
    return (await this.execute(sql))[0];
  }
  async getObjectDetails(objectName, objectType) {
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
  async execute(batch) {
    try {
      const rec = await this.runSqlcl(batch);
      return [rec];
    } catch (_e) {
      const statements = batch.split(";").map((s) => s.trim()).filter((s) => s);
      const results = [];
      for (const sql of statements) {
        try {
          results.push(await this.runSqlcl(sql));
        } catch (err) {
          results.push({ affectedRows: 0, fields: [], rows: [{ error: err.message }] });
        }
      }
      return results;
    }
  }
  // ---- Internals ----
  buildEzConnect() {
    const { username, password, host, port, service } = this.config;
    return `${username}/${password}@${host}:${port}/${service}`;
  }
  async runSqlcl(sqlText) {
    const conn = this.buildEzConnect();
    const script = [
      `SET PAGESIZE 0`,
      `SET SQLFORMAT json`,
      sqlText.replace(/;\s*$/, "") + ";",
      `EXIT`,
      ""
    ].join("\n");
    const { code, stdout: out, stderr: err } = await runCommand(this.config.sqlclCommand, [conn], {
      input: script,
      env: { ...process.env, ...this.config.env }
    });
    if (code !== 0) {
      throw new Error(err || `SQLcl exited with code ${code}`);
    }
    const rows = this.parseSqlclJson(out);
    const fields = rows.length > 0 ? Object.keys(rows[0]) : [];
    return { rows, fields, affectedRows: rows.length };
  }
  parseSqlclJson(output) {
    const trimmed = output.trim();
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      const match = trimmed.match(/\{[\s\S]*\}$/m);
      if (!match) return [];
      parsed = JSON.parse(match[0]);
    }
    if (parsed && typeof parsed === "object") {
      const obj = parsed;
      if (Array.isArray(obj.items)) return obj.items;
      if (obj.result && typeof obj.result === "object") {
        const r = obj.result;
        if (Array.isArray(r.rows)) return r.rows;
      }
      if (Array.isArray(parsed)) return parsed;
    }
    return [];
  }
}
export {
  STWOracleAdapter
};
