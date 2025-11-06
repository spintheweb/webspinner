// SPDX-License-Identifier: GPL-3.0-or-later
// Mockup: generic datasource adapter & registry

import { ISTWRecords } from "./stwDBAdapters/adapter.ts";
import { STWSession } from "./stwSession.ts";
import { STWContent } from "../stwElements/stwContent.ts";
import { wbpl } from "./stwWBPL.ts";

// Core shapes
export interface STWAdapterConfig {
  name: string;            // Unique DSN
  type: string;            // Adapter type, e.g., "api", "mysql", "shell", "smtp", ...
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  contentType?: string;
  // Adapter-specific extension bag
  [key: string]: unknown;
}

export interface STWAdapterContext {
  session: STWSession;
  content: STWContent;      // Carries dsn, command, params, cache, etc.
  config: STWAdapterConfig; // Resolved DSN config
}

export interface STWAdapter<C extends STWAdapterConfig = STWAdapterConfig> {
  readonly type: string; // type discriminator
  // Optional lifecycle hooks
  initialize?(config: C): Promise<void> | void;
  dispose?(): Promise<void> | void;
  // Execute WBPL-expanded command and return uniform records
  execute(ctx: STWAdapterContext): Promise<ISTWRecords>;
}

// Registry for pluggable adapters
export class STWAdapterRegistry {
  private static adapters = new Map<string, STWAdapter<any>>();

  static register(adapter: STWAdapter<any>): void {
    this.adapters.set(adapter.type, adapter);
  }

  static get(type: string): STWAdapter<any> | undefined {
    return this.adapters.get(type);
  }

  static execute(ctx: STWAdapterContext): Promise<ISTWRecords> {
    const adapter = this.get(ctx.config.type);
    if (!adapter) {
      return Promise.resolve({ affectedRows: 0, fields: [{ name: "error" }], rows: [{ error: `No adapter for type ${ctx.config.type}` }] });
    }
    return adapter.execute(ctx);
  }
}

// Example adapters (mock implementations)

// API adapter
export const ApiAdapter: STWAdapter<STWAdapterConfig> = {
  type: "api",
  async execute(ctx): Promise<ISTWRecords> {
    const _query = wbpl(ctx.content.command, ctx.session.placeholders);
    const url = `${ctx.config.host}?${wbpl(ctx.content.params, ctx.session.placeholders)}`;
    const response = await fetch(url, { headers: { "Content-Type": ctx.config.contentType || "application/json" } });
    const json = await response.json();

    // Optional JSONata step could be applied here if desired; for mockup we passthrough
    const rows = Array.isArray(json) ? json : [json];
    const first = rows[0] || {};
    const fields = Object.keys(first).map((n) => ({ name: n }));
    return { affectedRows: rows.length, fields, rows };
  },
};

// MySQL adapter (delegates to SQL execution)
export const MySqlAdapter: STWAdapter<STWAdapterConfig> = {
  type: "mysql",
  execute(ctx): Promise<ISTWRecords> {
    // This mockup doesn't open sockets; in real code we’d reuse the MySQL client/pool.
    // Shape only: convert SQL into a stubbed response to show uniform contract.
    const sql = wbpl(ctx.content.command, ctx.session.placeholders);
    return Promise.resolve({ affectedRows: 0, fields: [{ name: "sql" }], rows: [{ sql }] });
  },
};

// Shell adapter
export const ShellAdapter: STWAdapter<STWAdapterConfig> = {
  type: "shell",
  async execute(ctx): Promise<ISTWRecords> {
    const shellName = ctx.config.host || ctx.config.name || ctx.content.dsn;
    const cmdString = wbpl(ctx.content.command, ctx.session.placeholders).trim();
    if (/\bsudo\b/i.test(cmdString)) {
      return { affectedRows: 1, fields: [{ name: "error" }], rows: [{ error: "Forbidden token 'sudo' in shell command" }] };
    }
    let args: string[] = [];
    if (/(bash|sh|zsh)/i.test(shellName || "")) {
      args = ["-c", cmdString];
    } else if (/powershell/i.test(shellName || "")) {
      args = ["-NoProfile", "-Command", cmdString];
    } else {
      return { affectedRows: 0, fields: [{ name: "error" }], rows: [{ error: `Unsupported shell: ${shellName}` }] };
    }

    try {
      const command = new Deno.Command(shellName!, { args });
      const output = await command.output();
      const stdout = new TextDecoder().decode(output.stdout).trim();
      const stderr = new TextDecoder().decode(output.stderr).trim();

      if (stdout) {
        try {
          const parsed = JSON.parse(stdout);
          const rows = Array.isArray(parsed) ? parsed : [parsed];
          const first = rows[0] || {};
          const fields = Object.keys(first).map((n) => ({ name: n }));
          return { affectedRows: rows.length, fields, rows };
        } catch {
          const rows = stdout.split(/\r?\n/).map((value, i) => ({ line: i + 1, value }));
          return { affectedRows: rows.length, fields: [{ name: "line" }, { name: "value" }], rows };
        }
      }
      if (stderr) {
        const rows = stderr.split(/\r?\n/).map((error, i) => ({ line: i + 1, error }));
        return { affectedRows: rows.length, fields: [{ name: "line" }, { name: "error" }], rows };
      }
      return { affectedRows: 0, fields: [], rows: [] };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { affectedRows: 0, fields: [{ name: "error" }], rows: [{ error: msg }] };
    }
  },
};

// Register example adapters (mock)
STWAdapterRegistry.register(ApiAdapter);
STWAdapterRegistry.register(MySqlAdapter);
STWAdapterRegistry.register(ShellAdapter);
