// SPDX-License-Identifier: GPL-3.0-or-later

import { ISTWRecords } from "./stwDBAdapters/adapter.ts";
import { STWSession } from "./stwSession.ts";
import { STWDatasources } from "./stwDatasources.ts";
import { ACTIONS } from "./stwWBLL.ts";
import type { STWContent } from "../stwElements/stwContent.ts";

export interface ActionContext {
  req: Request;
  session: STWSession;
  content: STWContent;
  formData: FormData;
  action: string; // Full action string "namespace;subaction"
  url?: string;   // Target URL from button args[0]
}

export interface ActionResult {
  ok: boolean;
  redirect?: string;
  data?: any;
  error?: { name: string; message: string; stack?: string };
}

/**
 * Action handler registry and dispatcher.
 * Handles all button-triggered actions (CRUD, auth, custom).
 */
export class STWActionRouter {
  private handlers: Map<string, (ctx: ActionContext) => Promise<ActionResult>>;

  constructor() {
    this.handlers = new Map();
    this.registerDefaultHandlers();
  }

  /**
   * Register a custom action handler.
   * @param action Full action string "namespace;subaction" (e.g., "stw;insert")
   * @param handler Async function that processes the action
   */
  register(action: string, handler: (ctx: ActionContext) => Promise<ActionResult>): void {
    this.handlers.set(action, handler);
  }

  /**
   * Execute an action based on form submission.
   */
  async execute(ctx: ActionContext): Promise<ActionResult> {
    const handler = this.handlers.get(ctx.action);
    
    if (!handler) {
      console.warn(`No handler registered for action: ${ctx.action}`);
      return {
        ok: false,
        error: {
          name: "UnknownAction",
          message: `No handler for action: ${ctx.action}`,
        },
      };
    }

    try {
      return await handler(ctx);
    } catch (error: any) {
      console.error(`Action ${ctx.action} failed:`, error);
      return {
        ok: false,
        error: {
          name: error?.name ?? "ActionError",
          message: error?.message ?? String(error),
          stack: error?.stack,
        },
      };
    }
  }

  /**
   * Register built-in STW action handlers.
   */
  private registerDefaultHandlers(): void {
    // CRUD operations
    this.register("stw;insert", this.handleInsert.bind(this));
    this.register("stw;update", this.handleUpdate.bind(this));
    this.register("stw;delete", this.handleDelete.bind(this));
    
    // Search/filter
    this.register("stw;search", this.handleSearch.bind(this));
    this.register("stw;filter", this.handleFilter.bind(this));
    
    // ServerScript/ShellScript execution
    this.register("stw;submit", this.handleSubmit.bind(this));
    
    // Authentication
    this.register("stw;logon", this.handleLogon.bind(this));
    this.register("stw;logoff", this.handleLogoff.bind(this));
    this.register("stw;pwdreset", this.handlePasswordReset.bind(this));
  }

  /**
   * Handle insert action - add new record to datasource.
   */
  private async handleInsert(ctx: ActionContext): Promise<ActionResult> {
    const { content, formData } = ctx;
    
    if (!content.dsn) {
      return { ok: false, error: { name: "NoDatasource", message: "Content has no datasource" } };
    }

    // Build INSERT command from form fields
    const fields: Record<string, string> = {};
    for (const [key, value] of formData.entries()) {
      if (!key.startsWith("stw")) { // Skip internal fields
        fields[key] = value.toString();
      }
    }

    const columns = Object.keys(fields).join(", ");
    const placeholders = Object.keys(fields).map(() => "?").join(", ");
    const values = Object.values(fields);
    
    const command = `INSERT INTO ${content.table || "records"} (${columns}) VALUES (${placeholders})`;
    
    try {
      const datasources = new STWDatasources(ctx.session);
      await datasources.command(content.dsn, command, values);
      
      return {
        ok: true,
        redirect: ctx.url || ctx.req.url,
        data: { inserted: fields },
      };
    } catch (error: any) {
      return {
        ok: false,
        error: {
          name: "InsertFailed",
          message: error.message,
          stack: error.stack,
        },
      };
    }
  }

  /**
   * Handle update action - modify existing record.
   */
  private async handleUpdate(ctx: ActionContext): Promise<ActionResult> {
    const { content, formData } = ctx;
    
    if (!content.dsn) {
      return { ok: false, error: { name: "NoDatasource", message: "Content has no datasource" } };
    }

    const keyField = content.key || "id";
    const keyValue = formData.get(keyField)?.toString();
    
    if (!keyValue) {
      return { ok: false, error: { name: "NoKey", message: `Missing key field: ${keyField}` } };
    }

    const fields: Record<string, string> = {};
    for (const [key, value] of formData.entries()) {
      if (!key.startsWith("stw") && key !== keyField) {
        fields[key] = value.toString();
      }
    }

    const setClauses = Object.keys(fields).map(k => `${k} = ?`).join(", ");
    const values = [...Object.values(fields), keyValue];
    
    const command = `UPDATE ${content.table || "records"} SET ${setClauses} WHERE ${keyField} = ?`;
    
    try {
      const datasources = new STWDatasources(ctx.session);
      await datasources.command(content.dsn, command, values);
      
      return {
        ok: true,
        redirect: ctx.url || ctx.req.url,
        data: { updated: fields },
      };
    } catch (error: any) {
      return {
        ok: false,
        error: {
          name: "UpdateFailed",
          message: error.message,
          stack: error.stack,
        },
      };
    }
  }

  /**
   * Handle delete action - remove record.
   */
  private async handleDelete(ctx: ActionContext): Promise<ActionResult> {
    const { content, formData } = ctx;
    
    if (!content.dsn) {
      return { ok: false, error: { name: "NoDatasource", message: "Content has no datasource" } };
    }

    const keyField = content.key || "id";
    const keyValue = formData.get(keyField)?.toString();
    
    if (!keyValue) {
      return { ok: false, error: { name: "NoKey", message: `Missing key field: ${keyField}` } };
    }

    const command = `DELETE FROM ${content.table || "records"} WHERE ${keyField} = ?`;
    
    try {
      const datasources = new STWDatasources(ctx.session);
      await datasources.command(content.dsn, command, [keyValue]);
      
      return {
        ok: true,
        redirect: ctx.url || ctx.req.url,
        data: { deleted: keyValue },
      };
    } catch (error: any) {
      return {
        ok: false,
        error: {
          name: "DeleteFailed",
          message: error.message,
          stack: error.stack,
        },
      };
    }
  }

  /**
   * Handle search action - build new query string from form inputs.
   */
  private async handleSearch(ctx: ActionContext): Promise<ActionResult> {
    const { formData } = ctx;
    const url = new URL(ctx.url || ctx.req.url);
    
    // Clear existing search params
    url.search = "";
    
    // Add all form fields as query params
    for (const [key, value] of formData.entries()) {
      if (!key.startsWith("stw") && value.toString().trim()) {
        url.searchParams.set(key, value.toString());
      }
    }
    
    return {
      ok: true,
      redirect: url.href,
    };
  }

  /**
   * Handle filter action - add/replace query params.
   */
  private async handleFilter(ctx: ActionContext): Promise<ActionResult> {
    const { formData } = ctx;
    const url = new URL(ctx.url || ctx.req.url);
    
    // Merge form fields into existing query params
    for (const [key, value] of formData.entries()) {
      if (!key.startsWith("stw")) {
        if (value.toString().trim()) {
          url.searchParams.set(key, value.toString());
        } else {
          url.searchParams.delete(key);
        }
      }
    }
    
    return {
      ok: true,
      redirect: url.href,
    };
  }

  /**
   * Handle submit action - execute ServerScript or ShellScript.
   */
  private async handleSubmit(ctx: ActionContext): Promise<ActionResult> {
    const { content, session, req, formData } = ctx;
    
    // Find ServerScript or ShellScript content on the same page
    const page = content.parent;
    if (!page) {
      return { ok: false, error: { name: "NoPage", message: "Content has no parent page" } };
    }

    // Look for ServerScript/ShellScript with matching slug or action name
    const scriptContent = page.children.find(child => 
      (child.subtype === "ServerScript" || child.subtype === "ShellScript") &&
      (child.slug === ctx.action.split(";")[1] || child.name === ctx.action)
    );

    if (!scriptContent) {
      return {
        ok: false,
        error: {
          name: "NoScript",
          message: `No ServerScript/ShellScript found for action: ${ctx.action}`,
        },
      };
    }

    // Convert FormData to records format
    const records: ISTWRecords = {
      rows: [Object.fromEntries(formData.entries())],
      fields: Array.from(formData.keys()),
    };

    // Execute the script
    const result = await scriptContent.render(req, session, records);
    
    try {
      const parsed = JSON.parse(result);
      return {
        ok: parsed.ok ?? true,
        data: parsed.result || parsed,
        redirect: parsed.redirect,
        error: parsed.error,
      };
    } catch {
      return {
        ok: true,
        data: result,
      };
    }
  }

  /**
   * Handle authentication logon.
   */
  private async handleLogon(ctx: ActionContext): Promise<ActionResult> {
    const { formData, session } = ctx;
    const username = formData.get("username")?.toString();
    const password = formData.get("password")?.toString();
    
    if (!username || !password) {
      return {
        ok: false,
        error: { name: "InvalidCredentials", message: "Username and password required" },
      };
    }

    // TODO: Implement actual authentication logic
    // For now, stub implementation
    session.placeholders.set("USER", username);
    session.placeholders.set("AUTHENTICATED", "true");
    
    return {
      ok: true,
      redirect: ctx.url || "/",
      data: { user: username },
    };
  }

  /**
   * Handle authentication logoff.
   */
  private async handleLogoff(ctx: ActionContext): Promise<ActionResult> {
    const { session } = ctx;
    
    session.placeholders.delete("USER");
    session.placeholders.delete("AUTHENTICATED");
    
    return {
      ok: true,
      redirect: ctx.url || "/",
    };
  }

  /**
   * Handle password reset.
   */
  private async handlePasswordReset(ctx: ActionContext): Promise<ActionResult> {
    const { formData } = ctx;
    const email = formData.get("email")?.toString();
    
    if (!email) {
      return {
        ok: false,
        error: { name: "InvalidEmail", message: "Email required" },
      };
    }

    // TODO: Implement password reset logic (send email, etc.)
    
    return {
      ok: true,
      data: { message: "Password reset email sent" },
    };
  }
}

// Global singleton router instance
export const actionRouter = new STWActionRouter();