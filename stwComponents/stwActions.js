import { STWConnectors } from "./stwConnectors.js";
import { STWSecurity } from "./stwSecurity.js";

class STWActionRouter {
	handlers;

	constructor() {
		this.handlers = new Map();
		this.registerDefaultHandlers();
	}
	/**
	 * Register a custom action handler.
	 * @param action Full action name (e.g., "stwinsert")
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
		this.register("stwinsert", this.handleInsert.bind(this));
		this.register("stwupdate", this.handleUpdate.bind(this));
		this.register("stwdelete", this.handleDelete.bind(this));
		this.register("stwsearch", this.handleSearch.bind(this));
		this.register("stwfilter", this.handleFilter.bind(this));
		this.register("stwsubmit", this.handleSubmit.bind(this));
		this.register("stwlogon", this.handleLogon.bind(this));
		this.register("stwlogoff", this.handleLogoff.bind(this));
		this.register("stwpwdreset", this.handlePasswordReset.bind(this));
	}

	async handleInsert(ctx) {
		return await this.handleCrud(ctx, "insert");
	}

	async handleUpdate(ctx) {
		return await this.handleCrud(ctx, "update");
	}

	async handleDelete(ctx) {
		return await this.handleCrud(ctx, "delete");
	}

	async handleCrud(ctx, operation) {
		const { content, formData } = ctx;
		const actionName = operation[0].toUpperCase() + operation.slice(1);
		ctx.session.placeholders.set("@@stwKeyValue", "");
		const fail = (name, message, error) => ({
			ok: false,
			error: { name, message, ...(error?.stack ? { stack: error.stack } : {}) }
		});
		const connector = ctx.args?.[0] || content?.connector;
		const query = ctx.args?.length > 1 ? ctx.args.slice(1).join(";") : content?.query;
		if (!connector || !query) {
			return fail("NoConnector", "Content has no connector");
		}
		try {
			const fields = submittedFields(formData);
			const session = actionSession(ctx.session, formData);
			const result = await STWConnectors.supportsCrud(connector)
				? await STWConnectors.executeCrud(session, { connector, query }, operation, fields, content?.key || getKeyField(content, ctx.session) || getKeyFieldFromQuery(query))
				: await STWConnectors.executeAction(session, connector, query, operationMethod(operation), fields);
			ctx.session.placeholders.set("@@stwKeyValue", result.keyValue ?? "");
			const data = operation === "insert"
				? { inserted: result.fields, affectedRows: result.affectedRows }
				: operation === "update"
					? { updated: result.fields, affectedRows: result.affectedRows }
					: { deleted: result.keyValue, affectedRows: result.affectedRows };
			return { ok: true, redirect: ctx.url || ctx.req.url, data };
		} catch (error) {
			return fail(`${actionName}Failed`, error instanceof Error ? error.message : String(error), error);
		}
	}

	// build new query string from form inputs
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

	// add/replace query string params
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
		const connector = ctx.args?.[0];
		if (connector) {
			const command = ctx.args.slice(1).join(";");
			const result = await STWConnectors.executeAction(actionSession(session, formData), connector, command, "POST", submittedFields(formData));
			return { ok: true, redirect: ctx.url || req.url, data: result };
		}
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

	async handleLogon(ctx) {
		const { formData, session } = ctx;
		const username = actionValue(ctx.args?.[0], "username", formData, session);
		const password = actionValue(ctx.args?.[1], "password", formData, session);
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

	async handleLogoff(ctx) {
		const { session } = ctx;
		session.placeholders.delete("USER");
		session.placeholders.delete("AUTHENTICATED");
		session.user = "guest";
		session.name = "guest";
		session.roles = ["guest"];
		session.dev = false;
		return {
			ok: true,
			redirect: ctx.url || "/"
		};
	}

	async handlePasswordReset(ctx) {
		const { formData, session } = ctx;
		const oldPassword = actionValue(ctx.args?.[0], "old", formData, session);
		const newPassword = actionValue(ctx.args?.[1], "new1", formData, session);
		const confirmation = actionValue(ctx.args?.[2], "new2", formData, session);
		if (!oldPassword || !newPassword || !confirmation) {
			return {
				ok: false,
				error: { name: "InvalidPassword", message: "Current password and both new password fields are required" }
			};
		}
		if (newPassword !== confirmation) {
			return { ok: false, error: { name: "PasswordMismatch", message: "New passwords do not match" } };
		}
		await STWSecurity.changePassword(session.user, oldPassword, newPassword);
		return {
			ok: true,
			redirect: ctx.url || ctx.req.url,
			data: { message: "Password changed" }
		};
	}
}

const actionRouter = new STWActionRouter();
export {
	STWActionRouter,
	actionRouter
};

function getTableFromQuery(query) {
	const match = /^\s*SELECT\b[\s\S]*?\bFROM\s+((?:`[^`]+`|[A-Za-z0-9_$]+)(?:\s*\.\s*(?:`[^`]+`|[A-Za-z0-9_$]+))?)([\s\S]*)$/i.exec(query ?? "");
	if (!match) {
		throw new TypeError("CUD actions require a SELECT query with a single table source");
	}
	const table = match[1].replaceAll("`", "").replace(/\s*\.\s*/g, ".");
	if (!/^[A-Za-z0-9_$]+(?:\.[A-Za-z0-9_$]+)?$/.test(table)) {
		throw new TypeError("The SELECT query contains an unsupported table identifier");
	}
	if (/^\s*(?:(?:AS\s+)?[A-Za-z0-9_$]+)?\s*(?:,|\bJOIN\b)/i.test(match[2])) {
		throw new TypeError("CUD actions require a SELECT query with a single table source");
	}
	return table;
}
function getKeyField(content, session) {
	const wbll = content?.layout?.get(session.lang)?.wbll || "";
	const settings = /\\s\('([^']*)'\)/.exec(wbll)?.[1] || "";
	return /\bkey="([^"]+)"/.exec(settings)?.[1];
}
function getKeyFieldFromQuery(query) {
	return /\bWHERE\s+(?:[A-Za-z0-9_$]+\s*\.\s*)?`?([A-Za-z0-9_$]+)`?\s*=/i.exec(query)?.[1];
}
function submittedFields(formData) {
	const fields = {};
	for (const [name, value] of formData.entries()) {
		if (!name.startsWith("stw")) fields[name] = value.toString();
	}
	return fields;
}
function actionSession(session, formData) {
	const placeholders = new Map(session.placeholders);
	for (const [name, value] of formData.entries()) {
		if (!name.startsWith("stw") && typeof value === "string") {
			placeholders.set(`@@${name}`, value);
			placeholders.set(`@${name}`, value);
		}
	}
	return { ...session, placeholders };
}
function actionValue(argument, fallbackName, formData, session) {
	const value = argument || `@@${fallbackName}`;
	const match = /^@@?(.+)$/.exec(value);
	if (match) {
		return formData.get(match[1])?.toString() ?? session.placeholders.get(value)?.toString() ?? "";
	}
	return value;
}
function operationMethod(operation) {
	return operation === "insert" ? "PUT" : operation === "update" ? "PATCH" : "DELETE";
}
