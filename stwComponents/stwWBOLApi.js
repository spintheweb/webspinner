/**
 * @fileoverview HTTP API for reading and modifying the in-memory WBOL webbase.
 *
 * Webbase element routes require the `developers` role:
 *   - GET /wbol returns the portal tree; GET /wbol/:uuid returns one element.
 *   - GET /wbol?uuid=:uuid returns WBOL content metadata for a content element.
 *   - POST /wbol creates a child from `{ parentId, element }`.
 *   - PATCH /wbol/:uuid updates an element and can move it with `parentId` and
 *     optional `position`. Localized string values update `?locale=` (default:
 *     the Developer's session language); localized maps merge by locale.
 *     DELETE /wbol/:uuid removes the element and its descendants.
 *   - GET /wbol/:uuid/visibility reads explicit RBV settings; PUT replaces them
 *     and PATCH merges them (`null` removes a role override).
 *   - GET /wbol/:uuid/options reads content options; PUT replaces the option tree;
 *     PATCH updates an option name by index path in the selected locale.
 *   - GET/PUT /wbol/:portalUuid/datasources reads or replaces portal datasource
 *     values; GET/POST /wbol/:portalUuid/roles lists or creates roles.
 *
 * Administrative routes under /wbol/users, /wbol/roles, and /wbol/datasources
 * require `root` or `administrators` and are checked separately from development
 * access. Request bodies are limited to 2 MiB.
 *
 * Element routes enforce effective Developer-role visibility. Property routes
 * expose visibility for every element and options for content types that define
 * them. Portal-scoped routes expose portal datasources and role creation.
 *
 * @module stwWBOLAPI
 * @license GPL-3.0-or-later
 */
import { STWFactory } from "./stwFactory.js";
import { secureResponse } from "./stwResponse.js";
import { STWContent } from "../stwElements/stwContent.js";
import { assertSlugAllowed, serializeSTWElement, STWElement } from "../stwElements/stwElement.js";
import { STWPortal } from "../stwElements/stwPortal.js";
import { STWIndex } from "../stwElements/stwIndex.js";
import { STWDatasources } from "./stwDatasources.js";
import { STWSecurity } from "./stwSecurity.js";

const MAX_BODY_SIZE = 2 * 1024 * 1024;

async function handleWbolApi(request, session) {
	const url = new URL(request.url);
	const segments = url.pathname.split("/").filter(Boolean);
	if (segments.length > 1) {
		const adminResponse = await handleWbolAdminApi(request, session, segments.slice(1));
		if (adminResponse) return adminResponse;
	}
	if (!session.roles.includes("developers")) {
		return jsonResponse({ error: "Forbidden" }, 403);
	}
	if (segments.length === 3) {
		const element = STWIndex.get(segments[1]);
		if (!(element instanceof STWElement)) return jsonResponse({ error: "Element not found" }, 404);
		if (!isDeveloperVisible(element)) return jsonResponse({ error: "Forbidden" }, 403);
		if (segments[2] === "visibility") return handleVisibilityRoute(request, element);
		if (segments[2] === "options") return handleOptionsRoute(request, element, session);
		if (segments[2] === "datasources" && element instanceof STWPortal) return handlePortalDatasourcesRoute(request, element);
		if (segments[2] === "roles" && element instanceof STWPortal) return handlePortalRolesRoute(request);
		return jsonResponse({ error: "Not found" }, 404);
	}
	if (segments.length > 2) return jsonResponse({ error: "Not found" }, 404);
	const queryId = segments.length === 1 ? url.searchParams.get("uuid") : null;
	const id = segments[1] || queryId;
	const method = request.method.toUpperCase();
	try {
		if (method === "GET") {
			const element = id ? STWIndex.get(id) : STWPortal.instance;
			if (!(element instanceof STWElement)) return jsonResponse({ error: "Element not found" }, 404);
			if (!isDeveloperVisible(element)) return jsonResponse({ error: "Forbidden" }, 403);
			if (queryId) {
				const locale = resolveEditingLocale(url, session);
				const content = getWbolContent(queryId, { ...session, lang: locale });
				if (!content) return jsonResponse({ error: "Content not found" }, 404);
				return jsonResponse({ ...content, locale });
			}
			return jsonResponse(filterDeveloperVisibleTree(element));
		}
		if (method === "POST" && !id) {
			const body = await readJson(request);
			if (typeof body.parentId !== "string" || !isRecord(body.element)) {
				return jsonResponse({ error: "Expected parentId and element object" }, 400);
			}
			const parent = STWIndex.get(body.parentId);
			if (!(parent instanceof STWElement) || parent instanceof STWContent) {
				return jsonResponse({ error: "Parent element not found or cannot contain children" }, 400);
			}
			if (!isDeveloperVisible(parent)) return jsonResponse({ error: "Forbidden" }, 403);
			validateDefinitionTree(body.element);
			const definitionIds = collectDefinitionIds(body.element);
			if (new Set(definitionIds).size !== definitionIds.length || definitionIds.some((elementId) => STWIndex.has(elementId))) {
				return jsonResponse({ error: "Element UUID already exists" }, 409);
			}
			const element = createElement(body.element);
			if (element instanceof STWPortal) return jsonResponse({ error: "Cannot add a portal as a child" }, 400);
			const index = parent.children.length;
			parent.children.splice(index, 0, element);
			element.parent = parent;
			indexElementTree(element);
			return jsonResponse(serializeSTWElement(element), 201);
		}
		if (method === "PATCH" && id) {
			const element = STWIndex.get(id);
			if (!(element instanceof STWElement)) return jsonResponse({ error: "Element not found" }, 404);
			if (!isDeveloperVisible(element)) return jsonResponse({ error: "Forbidden" }, 403);
			const patch = await readJson(request);
			if (!isRecord(patch)) return jsonResponse({ error: "Expected a JSON object" }, 400);
			const locale = resolveEditingLocale(url, session);
			const localizedUpdates = prepareLocalizedUpdates(patch, locale, getSupportedLocales(session));
			const parentId = patch.parentId;
			const position = patch.position;
			const updates = { ...patch };
			delete updates.parentId;
			delete updates.position;
			for (const field of ["name", "slug", "keywords", "description"]) delete updates[field];
			for (const field of ["uuid", "type", "subtype", "children", "parent", "modified"]) {
				if (field in updates) return jsonResponse({ error: `${field} cannot be changed through PATCH` }, 400);
			}
			let moveTo;
			let movePosition;
			if (parentId !== void 0) {
				if (element instanceof STWPortal) return jsonResponse({ error: "The portal cannot be moved" }, 400);
				if (typeof parentId !== "string") return jsonResponse({ error: "parentId must be a string" }, 400);
				const newParent = STWIndex.get(parentId);
				if (!(newParent instanceof STWElement) || newParent instanceof STWContent) {
					return jsonResponse({ error: "Parent element not found or cannot contain children" }, 400);
				}
				if (!isDeveloperVisible(newParent)) return jsonResponse({ error: "Forbidden" }, 403);
				if (newParent === element || isDescendantOf(newParent, element)) {
					return jsonResponse({ error: "An element cannot be moved into itself or its descendants" }, 400);
				}
				const maxPosition = newParent === element.parent ? newParent.children.length - 1 : newParent.children.length;
				if (position !== void 0 && (typeof position !== "number" || !Number.isInteger(position) || position < 0 || position > maxPosition)) {
					return jsonResponse({ error: "position must be a valid child index" }, 400);
				}
				moveTo = newParent;
				movePosition = typeof position === "number" ? position : void 0;
			} else if (position !== void 0) {
				if (element instanceof STWPortal) return jsonResponse({ error: "The portal cannot be moved" }, 400);
				if (typeof position !== "number" || !Number.isInteger(position) || !element.parent || position < 0 || position >= element.parent.children.length) {
					return jsonResponse({ error: "position must be a valid child index" }, 400);
				}
				moveTo = element.parent;
				movePosition = position;
			}
			element.update(session, updates);
			applyLocalizedUpdates(element, localizedUpdates);
			if (moveTo) moveElement(element, moveTo, movePosition);
			return jsonResponse(serializeSTWElement(element));
		}
		if (method === "DELETE" && id) {
			const element = STWIndex.get(id);
			if (!(element instanceof STWElement)) return jsonResponse({ error: "Element not found" }, 404);
			if (!isDeveloperVisible(element)) return jsonResponse({ error: "Forbidden" }, 403);
			if (element instanceof STWPortal) return jsonResponse({ error: "Cannot delete the portal" }, 405);
			const parent = element.parent;
			const index = parent?.children.indexOf(element) ?? -1;
			if (!parent || index < 0) return jsonResponse({ error: "Element is detached from the webbase" }, 409);
			parent.children.splice(index, 1);
			removeElementTree(element);
			return secureResponse(null, { status: 204 });
		}
		return jsonResponse(
			{ error: "Method not allowed" },
			405,
			{ Allow: "GET, POST, PATCH, DELETE" }
		);
	} catch (error) {
		if (error instanceof SyntaxError || error instanceof TypeError) {
			return jsonResponse({ error: error.message }, 400);
		}
		console.error("WBOL API request failed:", error);
		return jsonResponse({ error: "Internal server error" }, 500);
	}
}

function isDeveloperVisible(element) {
	for (let current = element; current; current = current.parent) {
		const visibility = current.visibility.get("developers");
		if (typeof visibility === "boolean") return visibility;
	}
	return true;
}

function filterDeveloperVisibleTree(element) {
	const result = serializeSTWElement(element);
	result.children = element.children
		.filter(isDeveloperVisible)
		.map(filterDeveloperVisibleTree);
	return result;
}

function resolveEditingLocale(url, session) {
	const locales = getSupportedLocales(session);
	const locale = url.searchParams.has("locale") ? url.searchParams.get("locale") : session.lang;
	if (!locale || !locales.includes(locale)) {
		throw new TypeError(`Unsupported editing locale: ${locale || ""}`);
	}
	return locale;
}

function getSupportedLocales(session) {
	const portal = session.portal instanceof STWPortal ? session.portal : STWPortal.instance;
	return portal.langs;
}

function prepareLocalizedUpdates(patch, defaultLocale, supportedLocales) {
	const updates = [];
	for (const field of ["name", "slug", "keywords", "description"]) {
		if (!(field in patch)) continue;
		const value = patch[field];
		if (typeof value === "string") {
			updates.push({ field, locale: defaultLocale, value: normalizeLocalizedValue(field, value) });
			continue;
		}
		if (!isRecord(value)) {
			throw new TypeError(`${field} must be a string or locale-to-string object`);
		}
		for (const [locale, localizedValue] of Object.entries(value)) {
			if (typeof localizedValue !== "string") {
				throw new TypeError(`${field} values must be strings`);
			}
			if (!supportedLocales.includes(locale)) {
				throw new TypeError(`Unsupported editing locale: ${locale}`);
			}
			updates.push({
				field,
				locale,
				value: normalizeLocalizedValue(field, localizedValue)
			});
		}
	}
	return updates;
}

function normalizeLocalizedValue(field, value) {
	if (field !== "slug") return value;
	const slug = value.replace(/[^a-z0-9_]/gi, "").toLowerCase();
	return assertSlugAllowed(slug);
}

function applyLocalizedUpdates(element, updates) {
	for (const { field, locale, value } of updates) {
		element[field].set(locale, value);
	}
}

async function handleVisibilityRoute(request, element) {
	const method = request.method.toUpperCase();
	if (method === "GET") return jsonResponse(Object.fromEntries(element.visibility));
	if (method !== "PUT" && method !== "PATCH") return methodNotAllowed("GET, PUT, PATCH");
	try {
		const body = await readJson(request);
		if (!isRecord(body)) throw new TypeError("Expected a role-to-visibility object");
		for (const [role, visible] of Object.entries(body)) {
			if (!role || visible !== null && typeof visible !== "boolean") {
				throw new TypeError("Visibility values must be true, false, or null");
			}
			if (visible !== null && !await STWSecurity.isKnownRole(role)) {
				throw new TypeError(`Unknown role: ${role}`);
			}
		}
		if (method === "PUT") element.visibility.clear();
		for (const [role, visible] of Object.entries(body)) {
			if (visible === null) element.visibility.delete(role);
			else element.visibility.set(role, visible);
		}
		element.modified = Date.now();
		return jsonResponse(Object.fromEntries(element.visibility));
	} catch (error) {
		return apiErrorResponse(error, "WBOL visibility update failed:");
	}
}

async function handleOptionsRoute(request, element, session) {
	if (!(element instanceof STWContent) || !Array.isArray(element.options)) {
		return jsonResponse({ error: "Options are not supported for this element" }, 404);
	}
	const method = request.method.toUpperCase();
	if (method === "GET") return jsonResponse(serializeOptions(element.options));
	if (method !== "PUT" && method !== "PATCH") return methodNotAllowed("GET, PUT, PATCH");
	try {
		if (method === "PATCH") {
			const locale = resolveEditingLocale(new URL(request.url), session);
			const patch = await readJson(request);
			if (!isRecord(patch) || !Array.isArray(patch.path) || !patch.path.length ||
				!patch.path.every((index) => Number.isInteger(index) && index >= 0) ||
				typeof patch.name !== "string" ||
				Object.keys(patch).some((key) => !["path", "name"].includes(key))) {
				throw new TypeError("Expected { path: number[], name: string }");
			}
			const option = getOptionAtPath(element.options, patch.path);
			if (!option) return jsonResponse({ error: "Option path not found" }, 404);
			if (!(option.name instanceof Map)) option.name = new Map(Object.entries(option.name || {}));
			option.name.set(locale, patch.name);
			element.modified = Date.now();
			return jsonResponse(serializeOptions(element.options));
		}
		const options = await readJson(request);
		element.options = normalizeOptions(options);
		element.modified = Date.now();
		return jsonResponse(serializeOptions(element.options));
	} catch (error) {
		return apiErrorResponse(error, "WBOL options update failed:");
	}
}

function getOptionAtPath(options, path) {
	let currentOptions = options;
	let option;
	for (let depth = 0; depth < path.length; depth++) {
		const index = path[depth];
		option = currentOptions[index];
		if (!option) return null;
		if (depth < path.length - 1) {
			if (!Array.isArray(option.options)) return null;
			currentOptions = option.options;
		}
	}
	return option;
}

async function handlePortalDatasourcesRoute(request, portal) {
	const method = request.method.toUpperCase();
	if (method === "GET") return jsonResponse(Object.fromEntries(portal.datasources));
	if (method !== "PUT") return methodNotAllowed("GET, PUT");
	try {
		const datasources = await readJson(request);
		if (!isRecord(datasources) || !Object.values(datasources).every((value) => typeof value === "string")) {
			throw new TypeError("Expected a datasource name-to-value object");
		}
		portal.datasources = new Map(Object.entries(datasources));
		portal.modified = Date.now();
		return jsonResponse(Object.fromEntries(portal.datasources));
	} catch (error) {
		return apiErrorResponse(error, "WBOL portal datasource update failed:");
	}
}

async function handlePortalRolesRoute(request) {
	const method = request.method.toUpperCase();
	if (method !== "GET" && method !== "POST") return methodNotAllowed("GET, POST");
	try {
		if (method === "GET") return jsonResponse(await STWSecurity.listRoles());
		const body = await readJson(request);
		if (!isRecord(body)) throw new TypeError("Expected a role object");
		const role = requireNonEmptyString(body.role, "role");
		if (await STWSecurity.isKnownRole(role)) throw new AdminApiError(409, "Role already exists");
		await STWSecurity.createRole(role);
		return jsonResponse({ role }, 201);
	} catch (error) {
		return apiErrorResponse(error, "WBOL portal role creation failed:");
	}
}

function normalizeOptions(value) {
	if (!Array.isArray(value)) throw new TypeError("Options must be an array");
	return value.map((option) => {
		if (!isRecord(option)) throw new TypeError("Each option must be an object");
		for (const key of Object.keys(option)) {
			if (!["name", "ref", "parameters", "options"].includes(key)) {
				throw new TypeError(`Unsupported option field: ${key}`);
			}
		}
		const name = option.name ?? {};
		if (!isRecord(name) || !Object.values(name).every((text) => typeof text === "string")) {
			throw new TypeError("Option name must be a language-to-string object");
		}
		const ref = option.ref ?? "";
		const parameters = option.parameters ?? "";
		if (typeof ref !== "string" || typeof parameters !== "string") {
			throw new TypeError("Option ref and parameters must be strings");
		}
		const result = { name: new Map(Object.entries(name)), ref, parameters };
		if (option.options !== void 0) result.options = normalizeOptions(option.options);
		return result;
	});
}

function serializeOptions(options) {
	return options.map((option) => ({
		...option,
		name: option.name instanceof Map ? Object.fromEntries(option.name) : option.name,
		...(Array.isArray(option.options) ? { options: serializeOptions(option.options) } : {})
	}));
}

function apiErrorResponse(error, context) {
	if (error instanceof SyntaxError || error instanceof TypeError || error instanceof AdminApiError) {
		return jsonResponse({ error: error.message }, error.status ?? 400);
	}
	if (error instanceof Error && /already exists/i.test(error.message)) {
		return jsonResponse({ error: error.message }, 409);
	}
	console.error(context, error);
	return jsonResponse({ error: "Internal server error" }, 500);
}

function createElement(definition) {
	const kind = typeof definition.subtype === "string" ? definition.subtype : definition.type;
	if (typeof kind !== "string" || !kind) throw new TypeError("element must specify a registered type");
	if (kind === "Portal") throw new TypeError("Cannot add a portal as a child");
	const constructor = STWFactory[kind];
	if (!constructor) throw new TypeError(`Unknown element type: ${kind}`);
	const previousIds = new Set(STWIndex.keys());
	try {
		return new constructor(definition);
	} catch (error) {
		for (const registeredId of STWIndex.keys()) {
			if (!previousIds.has(registeredId)) STWIndex.delete(registeredId);
		}
		throw error;
	}
}
async function readJson(request) {
	const contentLength = Number(request.headers.get("content-length") || 0);
	if (contentLength > MAX_BODY_SIZE) throw new TypeError("Request body is too large");
	const text = await request.text();
	if (new TextEncoder().encode(text).byteLength > MAX_BODY_SIZE) throw new TypeError("Request body is too large");
	return JSON.parse(text);
}
function moveElement(element, parent, position) {
	const previousParent = element.parent;
	const previousIndex = previousParent?.children.indexOf(element) ?? -1;
	if (!previousParent || previousIndex < 0) throw new TypeError("Element is detached from the webbase");
	previousParent.children.splice(previousIndex, 1);
	const targetPosition = Math.min(position ?? parent.children.length, parent.children.length);
	parent.children.splice(targetPosition, 0, element);
	element.parent = parent;
}
function isDescendantOf(element, ancestor) {
	for (let parent = element.parent; parent; parent = parent.parent) {
		if (parent === ancestor) return true;
	}
	return false;
}
function collectDefinitionIds(definition) {
	const ids = typeof definition.uuid === "string" ? [definition.uuid] : [];
	if (Array.isArray(definition.children)) {
		for (const child of definition.children) {
			if (isRecord(child)) ids.push(...collectDefinitionIds(child));
		}
	}
	return ids;
}
function validateDefinitionTree(definition) {
	const kind = typeof definition.subtype === "string" ? definition.subtype : definition.type;
	if (typeof kind !== "string" || !STWFactory[kind] || kind === "Portal") {
		throw new TypeError(`Unknown or unsupported element type: ${String(kind || "")}`);
	}
	if (definition.children === void 0) return;
	if (!Array.isArray(definition.children)) throw new TypeError("element.children must be an array");
	for (const child of definition.children) {
		if (!isRecord(child)) throw new TypeError("Each child element must be an object");
		validateDefinitionTree(child);
	}
}
function indexElementTree(element) {
	STWIndex.set(element.uuid, element);
	for (const child of element.children) indexElementTree(child);
}
function removeElementTree(element) {
	for (const child of element.children) removeElementTree(child);
	STWIndex.delete(element.uuid);
}
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function jsonResponse(body, status = 200, headers) {
	return secureResponse(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json; charset=utf-8", ...Object.fromEntries(new Headers(headers)) }
	});
}
function getWbolContent(uuid, session) {
	const element = STWIndex.get(uuid);
	if (!(element instanceof STWContent) || !isDeveloperVisible(element)) return null;
	return {
		contents: serializeSTWElement(element),
		name: element.localize(session, "name"),
		slug: element.localize(session, "slug"),
		section: element.section,
		sequence: element.sequence,
		datasource: element.dsn
	};
}

const datasourceTypes = new Set(["api", "mysql", "shell"]);
async function handleWbolAdminApi(request, session, segments) {
	const [resource, rawId] = segments;
	if (!["users", "roles", "datasources"].includes(resource || "")) return null;
	if (!session.roles.includes("root") && !session.roles.includes("administrators")) {
		return jsonResponse({ error: "Forbidden" }, 403);
	}
	let id;
	try {
		id = rawId === void 0 ? void 0 : decodeURIComponent(rawId);
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
async function usersRoute(request, method, id) {
	if (method === "GET" && !id) return jsonResponse(await STWSecurity.listUsers());
	if (method === "POST" && !id) {
		const body = await readAdminJson(request);
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
		const body = await readAdminJson(request);
		if (!isRecord(body)) throw new AdminApiError(400, "Expected a JSON object");
		for (const key of Object.keys(body)) {
			if (!["name", "email", "password", "roles"].includes(key)) {
				throw new AdminApiError(400, `Unsupported user field: ${key}`);
			}
		}
		const patch = {};
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
async function rolesRoute(request, method, id) {
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
		const body = await readAdminJson(request);
		if (!isRecord(body)) throw new AdminApiError(400, "Expected a JSON object");
		const role = requireNonEmptyString(body.role, "role");
		await STWSecurity.createRole(role);
		return jsonResponse({ role }, 201);
	}
	if (method === "PATCH" && id) {
		const body = await readAdminJson(request);
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
async function datasourcesRoute(request, method, id) {
	if (method === "GET" && !id) {
		return jsonResponse((await STWDatasources.getConfigurations()).map(redactDatasource));
	}
	if (method === "POST" && !id) {
		const body = await readAdminJson(request);
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
		const body = await readAdminJson(request);
		if (!isRecord(body)) throw new AdminApiError(400, "Expected a JSON object");
		validateDatasourceFields(body);
		if (body.name !== void 0 && body.name !== id) {
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
async function validateRoles(value) {
	if (!Array.isArray(value) || !value.every((role) => typeof role === "string" && role.length > 0)) {
		throw new AdminApiError(400, "roles must be an array of role names");
	}
	const roles = [...new Set(value)];
	for (const role of roles) {
		if (!await STWSecurity.isKnownRole(role)) throw new AdminApiError(400, `Unknown role: ${role}`);
	}
	return roles;
}
async function assertAdminWillRemain(userId, replacementRoles) {
	const users = await STWSecurity.listUsers();
	const target = users.find((user) => user.user === userId);
	if (!target) throw new AdminApiError(404, "User not found");
	const isAdmin = (roles) => roles.split(",").some((role) => role === "root" || role === "administrators");
	if (replacementRoles === void 0 || !isAdmin(target.roles) || replacementRoles.some((role) => role === "root" || role === "administrators")) return;
	if (users.filter((user) => user.user !== userId && isAdmin(user.roles)).length === 0) {
		throw new AdminApiError(409, "Cannot remove the last root or administrator account");
	}
}
function renameVisibilityRole(oldRole, newRole) {
	for (const element of STWIndex.values()) {
		if (!(element instanceof STWElement) || !element.visibility.has(oldRole)) continue;
		const allowed = element.visibility.get(oldRole);
		element.visibility.delete(oldRole);
		element.visibility.set(newRole, allowed ?? false);
	}
}
function isDatasourceReferenced(name) {
	for (const element of STWIndex.values()) {
		if (element instanceof STWContent && element.dsn === name) return true;
	}
	return false;
}
function validateDatasource(value) {
	const name = requireNonEmptyString(value.name, "name");
	const type = requireNonEmptyString(value.type, "type");
	if (name === "json" || !/^[A-Za-z0-9_-]+$/.test(name)) {
		throw new AdminApiError(400, "Invalid or reserved datasource name");
	}
	if (!datasourceTypes.has(type)) throw new AdminApiError(400, `Unsupported datasource type: ${type}`);
	const result = { name, type };
	for (const key of ["host", "user", "password", "database", "contentType"]) {
		if (value[key] !== void 0) result[key] = requireString(value[key], key);
	}
	if (value.port !== void 0) {
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
function validateDatasourceFields(value) {
	const allowed = new Set(["name", "type", "host", "user", "password", "database", "contentType", "port"]);
	for (const key of Object.keys(value)) {
		if (!allowed.has(key)) throw new AdminApiError(400, `Unsupported datasource field: ${key}`);
	}
}
function redactDatasource(configuration) {
	const { password, ...safe } = configuration;
	return { ...safe, hasPassword: typeof password === "string" && password.length > 0 };
}
async function readAdminJson(request) {
	const text = await request.text();
	if (new TextEncoder().encode(text).byteLength > MAX_BODY_SIZE) {
		throw new AdminApiError(413, "Request body is too large");
	}
	return JSON.parse(text);
}
function requireString(value, name) {
	if (typeof value !== "string") throw new AdminApiError(400, `${name} must be a string`);
	return value;
}
function requireNonEmptyString(value, name) {
	const result = requireString(value, name).trim();
	if (!result) throw new AdminApiError(400, `${name} must not be empty`);
	return result;
}
function optionalString(value, name) {
	return value === void 0 ? void 0 : requireString(value, name);
}
function isNonEmptyString(value) {
	return typeof value === "string" && value.trim().length > 0;
}
function methodNotAllowed(allow) {
	return jsonResponse({ error: "Method not allowed" }, 405, { Allow: allow });
}
class AdminApiError extends Error {
	constructor(status, message) {
		super(message);
		this.status = status;
	}
}
export {
	getWbolContent,
	handleWbolApi
};
