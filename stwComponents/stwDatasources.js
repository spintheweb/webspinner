import { WBPL } from "./stwWBPL.js";
import { envGet } from "./stwConfig.js";
import { dirname } from "node:path";
import { readFileSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createConnection } from "mysql2/promise";
import jsonata from "jsonata";
import { isNotFoundError, runCommand } from "./stwNode.js";
class STWDatasources {
  static datasources = /* @__PURE__ */ new Map();
  static #initializationPromise = null;
  // Keep DSN settings to reconnect when needed
  static mysqlConfigs = /* @__PURE__ */ new Map();
  static async getConfigurations() {
    const path = envGet("DATASOURCES") || "./.data/datasources.json";
    try {
      const configurations = JSON.parse(await readFile(path, "utf8"));
      if (!Array.isArray(configurations)) throw new TypeError("Datasource configuration must be a JSON array");
      return configurations;
    } catch (error) {
      if (isNotFoundError(error)) return [];
      throw error;
    }
  }
  static async saveConfigurations(configurations) {
    const path = envGet("DATASOURCES") || "./.data/datasources.json";
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
          "Datasource reload failed and the previous configuration could not be restored"
        );
      }
      if (resetError !== void 0) {
        throw new AggregateError(
          [error, resetError],
          "Datasource reload failed; the previous configuration was restored but a connection did not close cleanly"
        );
      }
      throw new Error("Datasource reload failed; the previous configuration was restored", { cause: error });
    }
  }
  static async resetRuntime() {
    const closeErrors = [];
    for (const datasource of this.datasources.values()) {
      if (isMySQLConnection(datasource)) {
        try {
          await datasource.end();
        } catch (error) {
          closeErrors.push(error);
        }
      }
    }
    this.datasources.clear();
    this.mysqlConfigs.clear();
    this.#initializationPromise = null;
    if (closeErrors.length > 0) {
      throw new AggregateError(closeErrors, "One or more MySQL connections could not be closed");
    }
  }
  static initialize(strict = false) {
    if (!this.#initializationPromise) {
      this.#initializationPromise = (async () => {
        let datasources = [];
        try {
          datasources = JSON.parse(readFileSync(envGet("DATASOURCES") || "./.data/datasources.json", "utf8"));
        } catch (error) {
          if (strict) throw error;
          console.error(
            `Error reading datasources.json: ${error instanceof Error ? error.message : String(error)}`
          );
          return;
        }
        for (const settings of datasources) {
          try {
            switch (settings.type) {
              case "api":
                this.datasources.set(settings.name, settings);
                break;
              case "shell":
                this.datasources.set(settings.name, { ...settings, name: settings.name });
                break;
              case "mysql": {
                this.mysqlConfigs.set(settings.name, settings);
                const client = await createConnection({
                  host: settings.host,
                  port: settings.port ?? 3306,
                  user: settings.user,
                  password: settings.password,
                  database: settings.database
                });
                this.datasources.set(settings.name, client);
                break;
              }
              case "postgres":
                if (strict) throw new TypeError(`Unsupported datasource type: ${settings.type}`);
                break;
              case "mongodb":
                if (strict) throw new TypeError(`Unsupported datasource type: ${settings.type}`);
                break;
              default:
                throw new TypeError(`Unsupported datasource type: ${settings.type}`);
            }
          } catch (error) {
            if (strict) throw error;
            console.error(
              `Error processing datasource configuration: ${error instanceof Error ? error.message : String(error)}`
            );
            continue;
          }
        }
      })();
    }
    return this.#initializationPromise;
  }
  // Ensure a live MySQL connection; reconnect if needed
  static async getMySqlClient(name) {
    const ds = this.datasources.get(name);
    if (!isMySQLConnection(ds)) return null;
    try {
      await ds.execute("SELECT 1");
      return ds;
    } catch {
      const cfg = this.mysqlConfigs.get(name);
      if (!cfg) return null;
      try {
        const client = await createConnection({
          host: cfg.host,
          port: cfg.port ?? 3306,
          user: cfg.user,
          password: cfg.password,
          database: cfg.database
        });
        this.datasources.set(name, client);
        return client;
      } catch (e) {
        console.warn(`MySQL reconnect failed for dsn "${name}": ${e instanceof Error ? e.message : String(e)}`);
        return null;
      }
    }
  }
  static async query(session, dsn, query) {
    return await this.execute(session, { dsn, query, params: "" });
  }
  static async command(session, content) {
    return await this.execute(session, content);
  }
  static async execute(session, content) {
    if (!content.dsn) {
      return { affectedRows: 0, fields: [], rows: [{}] };
    }
    let records = { affectedRows: 0, fields: [], rows: [{}] };
    try {
      await this.initialize();
      const datasource = STWDatasources.datasources.get(content.dsn) || {};
      if (content.dsn === "json") {
        const json = JSON.parse(content.query);
        records = {
          affectedRows: 1,
          fields: json && typeof json === "object" && !Array.isArray(json) ? Object.keys(json) : [],
          rows: Array.isArray(json) ? json : [json]
        };
      } else if ("type" in datasource && datasource.type === "api") {
        records = await fetchAPIData(session, content, datasource);
      } else if ("type" in datasource && datasource.type === "shell") {
        const dsShell = datasource;
        const shellName = dsShell.host || dsShell.name || content.dsn;
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
      } else if (isMySQLConnection(datasource)) {
        const sql = WBPL(content.query, session.placeholders);
        try {
          records = await executeMySQL(datasource, sql);
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          if (/closed/i.test(msg) || /gone away/i.test(msg)) {
            const client = await this.getMySqlClient(content.dsn);
            if (client) {
              try {
                records = await executeMySQL(client, sql);
              } catch (e2) {
                console.warn(
                  `MySQL query failed after reconnect for dsn "${content.dsn}": ${e2 instanceof Error ? e2.message : String(e2)}`
                );
                records = { affectedRows: 0, fields: [], rows: [{}] };
              }
            } else {
              console.warn(`MySQL reconnect not available for dsn "${content.dsn}": ${msg}`);
              records = { affectedRows: 0, fields: [], rows: [{}] };
            }
          } else {
            console.warn(`MySQL query failed for dsn "${content.dsn}": ${msg}`);
            records = { affectedRows: 0, fields: [], rows: [] };
          }
        }
      }
    } catch (error) {
      console.warn(
        `Datasource error for dsn "${content.dsn}": ${error instanceof Error ? error.message : String(error)}`
      );
      records = { affectedRows: 0, fields: [], rows: [{}] };
    }
    return records;
  }
}
function isMySQLConnection(value) {
  return value !== null && value !== void 0 && typeof value === "object" && "execute" in value && "end" in value;
}
async function executeMySQL(client, sql) {
  const [result, fieldPackets] = await client.execute(sql);
  const rows = Array.isArray(result) ? result : [];
  const affectedRows = Array.isArray(result) ? rows.length : Number(result.affectedRows ?? 0);
  return {
    affectedRows,
    fields: fieldPackets.map((field) => field.name),
    rows
  };
}
async function fetchAPIData(session, content, datasource) {
  const query = WBPL(content.query, session.placeholders);
  const expr = jsonata(query);
  const response = await fetch(`${datasource.host}?${WBPL(content.params, session.placeholders)}`, {
    headers: { "Content-Type": datasource.contentType || "application/json" }
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
export {
  STWDatasources
};
