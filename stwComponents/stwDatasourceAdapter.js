import { WBPL } from "./stwWBPL.js";
import { runCommand } from "./stwNode.js";
class STWAdapterRegistry {
  static adapters = /* @__PURE__ */ new Map();
  static register(adapter) {
    this.adapters.set(adapter.type, adapter);
  }
  static get(type) {
    return this.adapters.get(type);
  }
  static execute(ctx) {
    const adapter = this.get(ctx.config.type);
    if (!adapter) {
      return Promise.resolve({ affectedRows: 0, fields: ["error"], rows: [{ error: `No adapter for type ${ctx.config.type}` }] });
    }
    return adapter.execute(ctx);
  }
}
const ApiAdapter = {
  type: "api",
  async execute(ctx) {
    const _query = WBPL(ctx.content.query, ctx.session.placeholders);
    const url = `${ctx.config.host}?${WBPL(ctx.content.params, ctx.session.placeholders)}`;
    const response = await fetch(url, { headers: { "Content-Type": ctx.config.contentType || "application/json" } });
    const json = await response.json();
    const rows = Array.isArray(json) ? json : [json];
    const fields = Object.keys(rows[0] || {});
    return { affectedRows: rows.length, fields, rows };
  }
};
const MySqlAdapter = {
  type: "mysql",
  execute(ctx) {
    const sql = WBPL(ctx.content.query, ctx.session.placeholders);
    return Promise.resolve({ affectedRows: 0, fields: ["sql"], rows: [{ sql }] });
  }
};
const ShellAdapter = {
  type: "shell",
  async execute(ctx) {
    const shellName = ctx.config.host || ctx.config.name || ctx.content.dsn;
    const cmdString = WBPL(ctx.content.query, ctx.session.placeholders).trim();
    if (/\bsudo\b/i.test(cmdString)) {
      return { affectedRows: 1, fields: ["error"], rows: [{ error: "Forbidden token 'sudo' in shell command" }] };
    }
    let args = [];
    if (/(bash|sh|zsh)/i.test(shellName || "")) {
      args = ["-c", cmdString];
    } else if (/powershell/i.test(shellName || "")) {
      args = ["-NoProfile", "-Command", cmdString];
    } else {
      return { affectedRows: 0, fields: ["error"], rows: [{ error: `Unsupported shell: ${shellName}` }] };
    }
    try {
      const output = await runCommand(shellName, args);
      const stdout = output.stdout.trim();
      const stderr = output.stderr.trim();
      if (stdout) {
        try {
          const parsed = JSON.parse(stdout);
          const rows = Array.isArray(parsed) ? parsed : [parsed];
          const fields = Object.keys(rows[0] || {});
          return { affectedRows: rows.length, fields, rows };
        } catch {
          const rows = stdout.split(/\r?\n/).map((value, i) => ({ line: i + 1, value }));
          return { affectedRows: rows.length, fields: ["line", "value"], rows };
        }
      }
      if (stderr) {
        const rows = stderr.split(/\r?\n/).map((error, i) => ({ line: i + 1, error }));
        return { affectedRows: rows.length, fields: ["line", "error"], rows };
      }
      return { affectedRows: 0, fields: [], rows: [] };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { affectedRows: 0, fields: ["error"], rows: [{ error: msg }] };
    }
  }
};
STWAdapterRegistry.register(ApiAdapter);
STWAdapterRegistry.register(MySqlAdapter);
STWAdapterRegistry.register(ShellAdapter);
export {
  ApiAdapter,
  MySqlAdapter,
  STWAdapterRegistry,
  ShellAdapter
};
