/**
 * @fileoverview Routes signed form actions to CRUD, navigation, script, and
 * session-authentication handlers.
 *
 * Form fields prefixed with `stw` are framework metadata and are never passed
 * to connectors or copied into action placeholders. Other submitted fields are
 * made available to action commands as both `@field` and `@@field`.
 *
 * @author Giancarlo Trevisan
 * @version 1.0.0
 * @module stwActions
 * @note Copilot-assisted
 * @license Apache-2.0
 */
import { STWConnectors } from "./stwConnectors.js";
import { STWSecurity } from "./stwSecurity.js";

/**
 * @typedef {object} ActionContext
 * @property {string} action Requested action name.
 * @property {FormData} formData Submitted form data.
 * @property {object} session Current mutable session.
 * @property {Request} req Originating HTTP request.
 * @property {string} [url] Redirect URL supplied by the action request.
 * @property {object} [content] Content that originated the action.
 * @property {string[]} [args] Action arguments from the signed action token.
 */

/**
 * @typedef {object} ActionResult
 * @property {boolean} ok Whether the action completed successfully.
 * @property {string} [redirect] Optional redirect target.
 * @property {object|string} [data] Optional action result.
 * @property {{name: string, message: string, stack?: string}} [error] Action failure.
 * @property {boolean} [rotateSession] Whether to replace the current session after the action succeeds.
 * @property {boolean} [preserveIdentity] Whether the verified identity moves to the replacement session.
 */

/**
 * Dispatches named actions registered by the application.
 */
class STWActionRouter {
	handlers;

	/**
	 * Creates a router and registers all built-in action handlers.
	 */
	constructor() {
		this.handlers = new Map();
		this.registerDefaultHandlers();
	}

	/**
	 * Registers or replaces a custom action handler.
	 *
	 * @param {string} action Full action name, such as `stwinsert`.
	 * @param {(context: ActionContext) => Promise<ActionResult>} handler Handler implementation.
	 * @returns {void}
	 */
	register(action, handler) {
		this.handlers.set(action, handler);
	}

	/**
	 * Executes a registered action and converts handler failures into a result.
	 *
	 * @param {ActionContext} ctx Action request context.
	 * @returns {Promise<ActionResult>} Action outcome or a structured error.
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
	 * Registers the built-in CRUD, navigation, script, and session handlers.
	 *
	 * @returns {void}
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

	/**
	 * Inserts a submitted record through the configured content connector.
	 *
	 * @param {ActionContext} ctx Action request context.
	 * @returns {Promise<ActionResult>} Insert result.
	 */
	async handleInsert(ctx) {
		return await this.handleCrud(ctx, "insert");
	}

	/**
	 * Updates a submitted record through the configured content connector.
	 *
	 * @param {ActionContext} ctx Action request context.
	 * @returns {Promise<ActionResult>} Update result.
	 */
	async handleUpdate(ctx) {
		return await this.handleCrud(ctx, "update");
	}

	/**
	 * Deletes a submitted record through the configured content connector.
	 *
	 * @param {ActionContext} ctx Action request context.
	 * @returns {Promise<ActionResult>} Delete result.
	 */
	async handleDelete(ctx) {
		return await this.handleCrud(ctx, "delete");
	}

	/**
	 * Executes an insert, update, or delete action. Connector arguments supplied
	 * by the signed action token override the originating content configuration.
	 *
	 * @param {ActionContext} ctx Action request context.
	 * @param {"insert"|"update"|"delete"} operation Requested CRUD operation.
	 * @returns {Promise<ActionResult>} CRUD result or connector error.
	 */
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
			let result;
			if (await STWConnectors.supportsCrud(connector)) {
				let key = content?.key;
				if (!key) {
					const wbll = content?.layout?.get(ctx.session.lang)?.wbll || "";
					const settings = /\\s\('([^']*)'\)/.exec(wbll)?.[1] || "";
					key = /\bkey="([^"]+)"/.exec(settings)?.[1] ||
						/\bWHERE\s+(?:[A-Za-z0-9_$]+\s*\.\s*)?`?([A-Za-z0-9_$]+)`?\s*=/i.exec(query)?.[1];
				}
				result = await STWConnectors.executeCrud(session, { connector, query }, operation, fields, key);
			} else {
				const method = operation === "insert" ? "PUT" : operation === "update" ? "PATCH" : "DELETE";
				result = await STWConnectors.executeAction(session, connector, query, method, fields);
			}
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

	/**
	 * Replaces the request query string with non-framework form fields.
	 *
	 * @param {ActionContext} ctx Action request context.
	 * @returns {Promise<ActionResult>} Redirect to the constructed search URL.
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
	 * Merges non-framework form fields into the current query string. Blank
	 * values remove their corresponding parameters.
	 *
	 * @param {ActionContext} ctx Action request context.
	 * @returns {Promise<ActionResult>} Redirect to the filtered URL.
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
	 * Executes a connector command or a sibling ServerScript/ShellScript.
	 *
	 * A connector argument executes immediately. Without one, the requested
	 * action is resolved against scripts belonging to the originating page.
	 *
	 * @param {ActionContext} ctx Action request context.
	 * @returns {Promise<ActionResult>} Script or connector result.
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

	/**
	 * Authenticates a user using form values or action arguments.
	 *
	 * @param {ActionContext} ctx Action request context.
	 * @returns {Promise<ActionResult>} Authentication result.
	 */
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
		return {
			ok: true,
			redirect: ctx.url || "/",
			data: { user: username },
			rotateSession: true,
			preserveIdentity: true
		};
	}

	/**
	 * Restores the session to its canonical guest identity.
	 *
	 * @param {ActionContext} ctx Action request context.
	 * @returns {Promise<ActionResult>} Redirect after logoff.
	 */
	async handleLogoff(ctx) {
		const { session } = ctx;
		session.placeholders.set("@@stwlogin", "guest");
		session.placeholders.set("@@stwloginname", "Guest");
		session.placeholders.set("@@stwloginid", "-3");
		session.user = "guest";
		session.name = "Guest";
		session.loginId = "-3";
		session.roles = ["guest"];
		session.dev = false;
		return {
			ok: true,
			redirect: ctx.url || "/",
			rotateSession: true
		};
	}

	/**
	 * Replaces the authenticated user's password after confirmation.
	 *
	 * @param {ActionContext} ctx Action request context.
	 * @returns {Promise<ActionResult>} Password-change result.
	 */
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

/**
 * Returns submitted data fields, excluding framework metadata.
 *
 * @param {FormData} formData Submitted form data.
 * @returns {Record<string, string>} User-submitted field values.
 */
function submittedFields(formData) {
	const fields = {};
	for (const [name, value] of formData.entries()) {
		if (!name.startsWith("stw")) fields[name] = value.toString();
	}
	return fields;
}

/**
 * Produces a connector session with submitted fields exposed as WBPL values.
 *
 * @param {object} session Current session.
 * @param {FormData} formData Submitted form data.
 * @returns {object} Session copy containing action-specific placeholders.
 */
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

/**
 * Resolves an action value from a literal argument, form field, or session
 * placeholder, in that order.
 *
 * @param {string|undefined} argument Signed action argument.
 * @param {string} fallbackName Form-field name used when no argument exists.
 * @param {FormData} formData Submitted form data.
 * @param {object} session Current session.
 * @returns {string} Resolved action value.
 */
function actionValue(argument, fallbackName, formData, session) {
	const value = argument || `@@${fallbackName}`;
	const match = /^@@?(.+)$/.exec(value);
	if (match) {
		return formData.get(match[1])?.toString() ?? session.placeholders.get(value)?.toString() ?? "";
	}
	return value;
}
