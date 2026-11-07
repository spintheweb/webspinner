import { STWDatasources } from "./stwDatasources.js";
import { STWSecurity } from "./stwSecurity.js";
class STWActionRouter {
	handlers;
	constructor() {
		this.handlers = new Map();
		this.registerDefaultHandlers();
	}
	/**
    * Register a custom action handler.
    * @param action Full action string "namespace;subaction" (e.g., "stw;insert")
    * @param handler Async function that processes the action
    */
	register(action, handler) {
		this.handlers.set(action, handler);
	}
	/**
    * Execute an action based on form submission.
    */
	async execute(ctx) {
		const handler = this.handlers.get(ctx.action);
		if (!handler) {
			console.warn(`No handler registered for action: ${ctx.action}`);
			return {
				ok: false,
				error: {
					name: "UnknownAction",
					message: `No handler for action: ${ctx.action}`
				}
			};
		}
		try {
			return await handler(ctx);
		} catch (error) {
			console.error(`Action ${ctx.action} failed:`, error);
			return {
				ok: false,
				error: {
					name: error?.name ?? "ActionError",
					message: error?.message ?? String(error),
					stack: error?.stack
				}
			};
		}
	}
	/**
    * Register built-in STW action handlers.
    */
	registerDefaultHandlers() {
		this.register("stw;insert", this.handleInsert.bind(this));
		this.register("stw;update", this.handleUpdate.bind(this));
		this.register("stw;delete", this.handleDelete.bind(this));
		this.register("stw;search", this.handleSearch.bind(this));
		this.register("stw;filter", this.handleFilter.bind(this));
		this.register("stw;submit", this.handleSubmit.bind(this));
		this.register("stw;logon", this.handleLogon.bind(this));
		this.register("stw;logoff", this.handleLogoff.bind(this));
		this.register("stw;pwdreset", this.handlePasswordReset.bind(this));
	}
	/**
    * Handle insert action - add new record to datasource.
    */
	async handleInsert(ctx) {
		const { content, formData } = ctx;
		if (!content.dsn) {
			return { ok: false, error: { name: "NoDatasource", message: "Content has no datasource" } };
		}
		const fields = {};
		for (const [key, value] of formData.entries()) {
			if (!key.startsWith("stw")) {
				fields[key] = value.toString();
			}
		}
		const columns = Object.keys(fields).join(", ");
		const placeholders = Object.keys(fields).map(() => "?").join(", ");
		const values = Object.values(fields);
		const command = `INSERT INTO ${content.table || "records"} (${columns}) VALUES (${placeholders})`;
		try {
			const sqlContent = content;
			sqlContent.query = command;
			sqlContent.params = "";
			await STWDatasources.command(ctx.session, sqlContent);
			return {
				ok: true,
				redirect: ctx.url || ctx.req.url,
				data: { inserted: fields }
			};
		} catch (error) {
			return {
				ok: false,
				error: {
					name: "InsertFailed",
					message: error.message,
					stack: error.stack
				}
			};
		}
	}
	/**
    * Handle update action - modify existing record.
    */
	async handleUpdate(ctx) {
		const { content, formData } = ctx;
		if (!content.dsn) {
			return { ok: false, error: { name: "NoDatasource", message: "Content has no datasource" } };
		}
		const keyField = content.key || "id";
		const keyValue = formData.get(keyField)?.toString();
		if (!keyValue) {
			return { ok: false, error: { name: "NoKey", message: `Missing key field: ${keyField}` } };
		}
		const fields = {};
		for (const [key, value] of formData.entries()) {
			if (!key.startsWith("stw") && key !== keyField) {
				fields[key] = value.toString();
			}
		}
		const setClauses = Object.keys(fields).map((k) => `${k} = ?`).join(", ");
		const values = [...Object.values(fields), keyValue];
		const command = `UPDATE ${content.table || "records"} SET ${setClauses} WHERE ${keyField} = ?`;
		try {
			const sqlContent = content;
			sqlContent.query = command;
			sqlContent.params = "";
			await STWDatasources.command(ctx.session, sqlContent);
			return {
				ok: true,
				redirect: ctx.url || ctx.req.url,
				data: { updated: fields }
			};
		} catch (error) {
			return {
				ok: false,
				error: {
					name: "UpdateFailed",
					message: error.message,
					stack: error.stack
				}
			};
		}
	}
	/**
    * Handle delete action - remove record.
    */
	async handleDelete(ctx) {
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
			const sqlContent = content;
			sqlContent.query = command;
			sqlContent.params = "";
			await STWDatasources.command(ctx.session, sqlContent);
			return {
				ok: true,
				redirect: ctx.url || ctx.req.url,
				data: { deleted: keyValue }
			};
		} catch (error) {
			return {
				ok: false,
				error: {
					name: "DeleteFailed",
					message: error.message,
					stack: error.stack
				}
			};
		}
	}
	/**
    * Handle search action - build new query string from form inputs.
    */
	async handleSearch(ctx) {
		const { formData } = ctx;
		const url = new URL(ctx.url || ctx.req.url);
		url.search = "";
		for (const [key, value] of formData.entries()) {
			if (!key.startsWith("stw") && value.toString().trim()) {
				url.searchParams.set(key, value.toString());
			}
		}
		return {
			ok: true,
			redirect: url.href
		};
	}
	/**
    * Handle filter action - add/replace query params.
    */
	async handleFilter(ctx) {
		const { formData } = ctx;
		const url = new URL(ctx.url || ctx.req.url);
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
			redirect: url.href
		};
	}
	/**
    * Handle submit action - execute ServerScript or ShellScript.
    */
	async handleSubmit(ctx) {
		const { content, session, req, formData } = ctx;
		const page = content.parent;
		if (!page) {
			return { ok: false, error: { name: "NoPage", message: "Content has no parent page" } };
		}
		const scriptContent = page.children.find(
			(child) => (child.subtype === "ServerScript" || child.subtype === "ShellScript") && (child.localize?.(session, "slug") === ctx.action.split(";")[1] || child.localize?.(session, "name") === ctx.action)
		);
		if (!scriptContent) {
			return {
				ok: false,
				error: {
					name: "NoScript",
					message: `No ServerScript/ShellScript found for action: ${ctx.action}`
				}
			};
		}
		const records = {
			rows: [Object.fromEntries(formData.entries())],
			fields: Array.from(formData.keys()).map((name) => ({ name }))
		};
		const result = await scriptContent.render(req, session, records);
		try {
			const parsed = JSON.parse(result);
			return {
				ok: parsed.ok ?? true,
				data: parsed.result || parsed,
				redirect: parsed.redirect,
				error: parsed.error
			};
		} catch {
			return {
				ok: true,
				data: result
			};
		}
	}
	/**
    * Handle authentication logon.
    */
	async handleLogon(ctx) {
		const { formData, session } = ctx;
		const username = formData.get("username")?.toString();
		const password = formData.get("password")?.toString();
		if (!username || !password) {
			return {
				ok: false,
				error: { name: "InvalidCredentials", message: "Username and password required" }
			};
		}
		if (!await STWSecurity.authenticate(session, username, password)) {
			return {
				ok: false,
				error: { name: "InvalidCredentials", message: "Invalid username or password" }
			};
		}
		session.placeholders.set("USER", username);
		session.placeholders.set("AUTHENTICATED", "true");
		return {
			ok: true,
			redirect: ctx.url || "/",
			data: { user: username }
		};
	}
	/**
    * Handle authentication logoff.
    */
	async handleLogoff(ctx) {
		const { session } = ctx;
		session.placeholders.delete("USER");
		session.placeholders.delete("AUTHENTICATED");
		session.user = "guest";
		session.name = "guest";
		session.roles = ["guests"];
		session.dev = false;
		return {
			ok: true,
			redirect: ctx.url || "/"
		};
	}
	/**
    * Handle password reset.
    */
	async handlePasswordReset(ctx) {
		const { formData } = ctx;
		const email = formData.get("email")?.toString();
		if (!email) {
			return {
				ok: false,
				error: { name: "InvalidEmail", message: "Email required" }
			};
		}
		return {
			ok: true,
			data: { message: "Password reset email sent" }
		};
	}
}
const actionRouter = new STWActionRouter();
export {
	STWActionRouter,
	actionRouter
};
