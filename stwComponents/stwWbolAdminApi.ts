import { STWDatasources } from "./stwDatasources.ts";
import { STWSecurity } from "./stwSecurity.ts";
import type { STWSession } from "./stwSession.ts";
import { secureResponse } from "./stwResponse.ts";
import { STWContent } from "../stwElements/stwContent.ts";
import { STWElement } from "../stwElements/stwElement.ts";
import { STWIndex } from "../stwElements/stwIndex.ts";

const datasourceTypes = new Set(["api", "mysql", "shell"]);

export async function handleWbolAdminApi(
	request: Request,
	session: STWSession,
	segments: string[],
): Promise<Response | null> {
	const [resource, rawId] = segments;
	if (!["users", "roles", "datasources"].includes(resource || "")) return null;
	if (!session.roles.includes("root") && !session.roles.includes("administrators")) {
		return jsonResponse({ error: "Forbidden" }, 403);
	}

	let id: string | undefined;
	try {
		id = rawId === undefined ? undefined : decodeURIComponent(rawId);
	} catch {
		return jsonResponse({ error: "Invalid resource identifier" }, 400);
	}
	const method = request.method.toUpperCase();
	try {
		if (resource === "users") return await usersRoute(request, method, id);
		if (resource === "roles") return await rolesRoute(request, method, id);
		return await datasourcesRoute(request, method, id);
	} catch (error) {
		if (error instanceof AdminApiError) return jsonResponse({ error: error.message }, error.status);
		if (error instanceof SyntaxError || error instanceof TypeError) {
			return jsonResponse({ error: error.message }, 400);
		}
		if (error instanceof Error && /already exists/i.test(error.message)) {
			return jsonResponse({ error: error.message }, 409);
		}
		if (error instanceof Error && /not found/i.test(error.message)) {
			return jsonResponse({ error: error.message }, 404);
		}
		if (error instanceof Error && /mandatory roles cannot/i.test(error.message)) {
			return jsonResponse({ error: error.message }, 409);
		}
		console.error(`WBOL ${resource} API request failed:`, error);
		return jsonResponse({ error: "Internal server error" }, 500);
	}
}

async function usersRoute(request: Request, method: string, id?: string): Promise<Response> {
	if (method === "GET" && !id) return jsonResponse(await STWSecurity.listUsers());
	if (method === "POST" && !id) {
		const body = await readJson(request);
		if (!isRecord(body) || !isNonEmptyString(body.password)) {
			throw new AdminApiError(400, "Expected user and password");
		}
		const user = requireNonEmptyString(body.user, "user");
		const password = requireNonEmptyString(body.password, "password");
		const name = optionalString(body.name, "name") ?? user;
		const email = optionalString(body.email, "email") ?? "";
		const roles = await validateRoles(body.roles ?? ["users"]);
		await STWSecurity.createUser(user, name, password, roles, email);
		return jsonResponse({ user, name, roles: roles.join(","), email }, 201);
	}
	if (method === "PATCH" && id) {
		const body = await readJson(request);
		if (!isRecord(body)) throw new AdminApiError(400, "Expected a JSON object");
		for (const key of Object.keys(body)) {
			if (!["name", "email", "password", "roles"].includes(key)) {
				throw new AdminApiError(400, `Unsupported user field: ${key}`);
			}
		}
		const patch: { name?: string; email?: string; password?: string; roles?: string[] } = {};
		if ("name" in body) patch.name = requireString(body.name, "name");
		if ("email" in body) patch.email = requireString(body.email, "email");
		if ("password" in body) patch.password = requireNonEmptyString(body.password, "password");
		if ("roles" in body) patch.roles = await validateRoles(body.roles);
		await assertAdminWillRemain(id, patch.roles);
		await STWSecurity.updateUser(id, patch);
		return jsonResponse((await STWSecurity.listUsers()).find((user) => user.user === id));
	}
	if (method === "DELETE" && id) {
		await assertAdminWillRemain(id, []);
		await STWSecurity.deleteUser(id);
		return secureResponse(null, { status: 204 });
	}
	return methodNotAllowed("GET, POST, PATCH, DELETE");
}

async function rolesRoute(request: Request, method: string, id?: string): Promise<Response> {
	if (method === "GET" && !id) {
		const roles = new Set(await STWSecurity.listRoles());
		for (const element of STWIndex.values()) {
			if (element instanceof STWElement) {
				for (const role of element.visibility.keys()) roles.add(role);
			}
		}
		return jsonResponse([...roles].sort());
	}
	if (method === "POST" && !id) {
		const body = await readJson(request);
		if (!isRecord(body)) throw new AdminApiError(400, "Expected a JSON object");
		const role = requireNonEmptyString(body.role, "role");
		await STWSecurity.createRole(role);
		return jsonResponse({ role }, 201);
	}
	if (method === "PATCH" && id) {
		const body = await readJson(request);
		if (!isRecord(body)) throw new AdminApiError(400, "Expected a JSON object");
		const newRole = requireNonEmptyString(body.role, "role");
		await STWSecurity.renameRole(id, newRole);
		renameVisibilityRole(id, newRole);
		return jsonResponse({ role: newRole });
	}
	if (method === "DELETE" && id) {
		await STWSecurity.deleteRole(id);
		for (const element of STWIndex.values()) {
			if (element instanceof STWElement) element.visibility.delete(id);
		}
		return secureResponse(null, { status: 204 });
	}
	return methodNotAllowed("GET, POST, PATCH, DELETE");
}

async function datasourcesRoute(request: Request, method: string, id?: string): Promise<Response> {
	if (method === "GET" && !id) {
		return jsonResponse((await STWDatasources.getConfigurations()).map(redactDatasource));
	}
	if (method === "POST" && !id) {
		const body = await readJson(request);
		if (!isRecord(body)) throw new AdminApiError(400, "Expected a datasource object");
		validateDatasourceFields(body);
		const datasource = validateDatasource(body);
		const configurations = await STWDatasources.getConfigurations();
		if (configurations.some((item) => item.name === datasource.name)) {
			throw new AdminApiError(409, "Datasource already exists");
		}
		configurations.push(datasource);
		await STWDatasources.saveConfigurations(configurations);
		return jsonResponse(redactDatasource(datasource), 201);
	}
	if (method === "PATCH" && id) {
		const body = await readJson(request);
		if (!isRecord(body)) throw new AdminApiError(400, "Expected a JSON object");
		validateDatasourceFields(body);
		if (body.name !== undefined && body.name !== id) {
			throw new AdminApiError(400, "Datasource name cannot be changed through PATCH");
		}
		const configurations = await STWDatasources.getConfigurations();
		const index = configurations.findIndex((item) => item.name === id);
		if (index < 0) throw new AdminApiError(404, "Datasource not found");
		const old = configurations[index];
		const updated = validateDatasource({ ...old, ...body, name: id });
		configurations[index] = updated;
		await STWDatasources.saveConfigurations(configurations);
		return jsonResponse(redactDatasource(updated));
	}
	if (method === "DELETE" && id) {
		const configurations = await STWDatasources.getConfigurations();
		const index = configurations.findIndex((item) => item.name === id);
		if (index < 0) throw new AdminApiError(404, "Datasource not found");
		if (isDatasourceReferenced(id)) {
			throw new AdminApiError(409, "Datasource is used by one or more content elements");
		}
		configurations.splice(index, 1);
		await STWDatasources.saveConfigurations(configurations);
		return secureResponse(null, { status: 204 });
	}
	return methodNotAllowed("GET, POST, PATCH, DELETE");
}

async function validateRoles(value: unknown): Promise<string[]> {
	if (!Array.isArray(value) || !value.every((role) => typeof role === "string" && role.length > 0)) {
		throw new AdminApiError(400, "roles must be an array of role names");
	}
	const roles = [...new Set(value as string[])];
	for (const role of roles) {
		if (!await STWSecurity.isKnownRole(role)) throw new AdminApiError(400, `Unknown role: ${role}`);
	}
	return roles;
}

async function assertAdminWillRemain(userId: string, replacementRoles?: string[]): Promise<void> {
	const users = await STWSecurity.listUsers();
	const target = users.find((user) => user.user === userId);
	if (!target) throw new AdminApiError(404, "User not found");
	const isAdmin = (roles: string) => roles.split(",").some((role) => role === "root" || role === "administrators");
	if (
		replacementRoles === undefined || !isAdmin(target.roles) ||
		replacementRoles.some((role) => role === "root" || role === "administrators")
	) return;
	if (users.filter((user) => user.user !== userId && isAdmin(user.roles)).length === 0) {
		throw new AdminApiError(409, "Cannot remove the last root or administrator account");
	}
}

function renameVisibilityRole(oldRole: string, newRole: string): void {
	for (const element of STWIndex.values()) {
		if (!(element instanceof STWElement) || !element.visibility.has(oldRole)) continue;
		const allowed = element.visibility.get(oldRole);
		element.visibility.delete(oldRole);
		element.visibility.set(newRole, allowed ?? false);
	}
}

function isDatasourceReferenced(name: string): boolean {
	for (const element of STWIndex.values()) {
		if (element instanceof STWContent && element.dsn === name) return true;
	}
	return false;
}

function validateDatasource(value: Record<string, unknown>): Record<string, unknown> {
	const name = requireNonEmptyString(value.name, "name");
	const type = requireNonEmptyString(value.type, "type");
	if (name === "json" || !/^[A-Za-z0-9_-]+$/.test(name)) {
		throw new AdminApiError(400, "Invalid or reserved datasource name");
	}
	if (!datasourceTypes.has(type)) throw new AdminApiError(400, `Unsupported datasource type: ${type}`);
	const result: Record<string, unknown> = { name, type };
	for (const key of ["host", "user", "password", "database", "contentType"] as const) {
		if (value[key] !== undefined) result[key] = requireString(value[key], key);
	}
	if (value.port !== undefined) {
		if (typeof value.port !== "number" || !Number.isInteger(value.port) || value.port < 1 || value.port > 65535) {
			throw new AdminApiError(400, "port must be an integer from 1 to 65535");
		}
		result.port = value.port;
	}
	if (type === "mysql" && (!result.host || !result.user || !result.database)) {
		throw new AdminApiError(400, "mysql datasources require host, user, and database");
	}
	if (type === "api" && !result.host) throw new AdminApiError(400, "api datasources require host");
	if (type === "shell" && !result.host && !result.name) {
		throw new AdminApiError(400, "shell datasources require an executable in host");
	}
	return result;
}

function validateDatasourceFields(value: Record<string, unknown>): void {
	const allowed = new Set(["name", "type", "host", "user", "password", "database", "contentType", "port"]);
	for (const key of Object.keys(value)) {
		if (!allowed.has(key)) throw new AdminApiError(400, `Unsupported datasource field: ${key}`);
	}
}

function redactDatasource(configuration: Record<string, unknown>): Record<string, unknown> {
	const { password, ...safe } = configuration;
	return { ...safe, hasPassword: typeof password === "string" && password.length > 0 };
}

async function readJson(request: Request): Promise<unknown> {
	const text = await request.text();
	if (new TextEncoder().encode(text).byteLength > 2 * 1024 * 1024) {
		throw new AdminApiError(413, "Request body is too large");
	}
	return JSON.parse(text);
}

function requireString(value: unknown, name: string): string {
	if (typeof value !== "string") throw new AdminApiError(400, `${name} must be a string`);
	return value;
}

function requireNonEmptyString(value: unknown, name: string): string {
	const result = requireString(value, name).trim();
	if (!result) throw new AdminApiError(400, `${name} must not be empty`);
	return result;
}

function optionalString(value: unknown, name: string): string | undefined {
	return value === undefined ? undefined : requireString(value, name);
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function methodNotAllowed(allow: string): Response {
	return jsonResponse({ error: "Method not allowed" }, 405, { Allow: allow });
}

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit): Response {
	return secureResponse(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json; charset=utf-8", ...Object.fromEntries(new Headers(headers)) },
	});
}

class AdminApiError extends Error {
	constructor(public readonly status: number, message: string) {
		super(message);
	}
}
