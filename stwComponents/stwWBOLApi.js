/**
 * @fileoverview HTTP API for reading and modifying the in-memory WBOL webbase.
 *
 * Webbase element routes require the `developer` role and Developer-role RBV,
 * except SEO users may read and edit localized metadata on SEO-visible elements:
 *   - GET /wbol returns the portal tree with effective visibility for `?roles=`;
 *     GET /wbol/:uuid returns one locale-specific element.
 *   - POST/DELETE /wbol/:uuid/block acquires/releases an editor block.
 *   - GET /wbol/content-types lists registered content subtypes for developers.
 *   - POST /wbol creates a child from `{ parentId, element }`.
 *   - POST /wbol/:uuid/move moves an element to Portal, Area, Page, or a
 *     content option; content-option moves retain the source in the webbase.
 *   - PATCH /wbol/:uuid updates an element and can move it among structural
 *     parents with `parentId` and optional `position`. Localized string values
 *     update `?locale=` (default: the Developer's session language); localized
 *     maps merge by locale.
 *     DELETE /wbol/:uuid removes the element and its descendants.
 *   - GET /wbol/:uuid/visibility reads explicit RBV settings; only
 *     `leaddeveloper` may change them, and may not assign `root` or
 *     `administrator`.
 *   - GET /wbol/:uuid/options reads content options; PUT replaces the option tree;
 *     PATCH updates an option name by index path in the selected locale.
 *   - GET/PUT /wbol/:portalUuid/connectors reads or replaces portal connector
 *     values for `root` or `leaddeveloper`.
 *
 * User administration under /wbol/users requires `root` or `administrator`.
 * Custom role administration under /wbol/roles requires `root` or
 * `leaddeveloper`; GET /wbol/roles/visibility lists all roles for developers.
 * LeadDeveloper users may manage `developer` and `seo` assignments through
 * /wbol/users/:user/developer and /wbol/users/:user/seo. Connector configuration under /wbol/connectors
 * requires `root` or `leaddeveloper`, except Node connectors require `root` to
 * create, change or remove. Developers can list names via
 * GET /wbol/connectors/names.
 * GET/PATCH /wbol/configuration reads or updates the active environment file
 * and requires the `root` role. Changes take effect after restart.
 * Request bodies are limited to 2 MiB.
 *
 * Developer routes enforce effective Developer-role visibility; SEO metadata
 * routes enforce effective SEO-role visibility. LeadDeveloper users can manage RBV
 * independently of Developer visibility. The portal grants RBV only to `root`;
 * LeadDeveloper and root can read and edit the portal through this API.
 *
 * @module stwWBOLAPI
 * @note Copilot-assisted
 * @license Apache-2.0
 */
import { STWFactory } from "./stwFactory.js";
import { secureResponse } from "./stwResponse.js";
import { STWContent } from "../stwElements/stwContent.js";
import { normalizeSlug, serializeSTWElement, STWElement } from "../stwElements/stwElement.js";
import { STWArea } from "../stwElements/stwArea.js";
import { STWPage } from "../stwElements/stwPage.js";
import { STWPortal } from "../stwElements/stwPortal.js";
import { STWIndex } from "../stwElements/stwIndex.js";
import { STWConnectors, assertConnectorId } from "./stwConnectors.js";
import { STWSecurity } from "./stwSecurity.js";
import { envGet, readBooleanSetting } from "./stwConfig.js";
import { canDevelopElement, isDeployed, isProtectedWebbaselet, webbaseletKind } from "./stwWebbaselets.js";
import { isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";

const MAX_BODY_SIZE = 2 * 1024 * 1024;
const elementBlocks = new Map();

async function handleWbolApi(request, session) {
	const url = new URL(request.url);
	const segments = url.pathname.split("/").filter(Boolean);
	if (segments.length === 2 && segments[1] === "content-types") {
		if (!session.roles.includes("developer")) return jsonResponse({ error: "Forbidden" }, 403);
		if (request.method !== "GET") return jsonResponse({ error: "Method not allowed" }, 405, { Allow: "GET" });
		const types = Object.entries(STWFactory)
			.filter(([, constructor]) => constructor.prototype instanceof STWContent)
			.map(([value]) => ({ value }))
			.sort((a, b) => a.value.localeCompare(b.value));
		return jsonResponse(types);
	}
	if (segments.length > 1) {
		const adminResponse = await handleWbolAdminApi(request, session, segments.slice(1));
		if (adminResponse) return adminResponse;
	}
	if (segments.length === 3 && segments[2] === "block") {
		const element = STWIndex.get(segments[1]);
		if (!(element instanceof STWElement)) return jsonResponse({ error: "Element not found" }, 404);
		if (typeof session.user !== "string" || !session.user || session.user === "guest")
			return jsonResponse({ error: "Forbidden" }, 403);
		if (request.method === "POST") {
			const canEdit = canEditElement(session, element) ||
				(session.roles.includes("seo") && Boolean(element.isVisible(session, "seo") & 1));
			if (!canEdit) return jsonResponse({ error: "Forbidden" }, 403);
			if (isProtectedWebbaselet(element) || element.blocked && element.blocked !== session.user)
				return jsonResponse({ blocked: element.blocked, token: null });
			const token = randomUUID();
			if (!elementBlocks.has(element.uuid)) elementBlocks.set(element.uuid, new Map());
			elementBlocks.get(element.uuid).set(token, session.user);
			element.blocked = session.user;
			return jsonResponse({ blocked: element.blocked, token });
		}
		if (request.method === "DELETE") {
			const token = url.searchParams.get("token");
			const holders = elementBlocks.get(element.uuid);
			if (!token || holders?.get(token) !== session.user)
				return jsonResponse({ error: "Block not found" }, 404);
			holders.delete(token);
			if (holders.size === 0) {
				elementBlocks.delete(element.uuid);
				if (element.blocked === session.user) element.blocked = "";
			}
			return secureResponse(null, { status: 204 });
		}
		return methodNotAllowed("POST, DELETE");
	}
	if (segments.length === 3 && segments[2] === "visibility") {
		const element = STWIndex.get(segments[1]);
		if (!(element instanceof STWElement)) return jsonResponse({ error: "Element not found" }, 404);
		if (request.method !== "GET" && isProtectedWebbaselet(element))
			return jsonResponse({ error: "Deployed webbaselets are read-only" }, 403);
		return handleVisibilityRoute(request, element, session);
	}
	if (segments.length === 3 && segments[2] === "connectors") {
		if (!session.roles.includes("root") && !session.roles.includes("leaddeveloper")) {
			return jsonResponse({ error: "Forbidden" }, 403);
		}
		const element = STWIndex.get(segments[1]);
		if (!(element instanceof STWPortal)) return jsonResponse({ error: "Portal not found" }, 404);
		return handlePortalConnectorsRoute(request, element, session);
	}
	if (segments.length === 3 && segments[2] === "roles") {
		const element = STWIndex.get(segments[1]);
		if (!(element instanceof STWPortal)) return jsonResponse({ error: "Portal not found" }, 404);
		const canManage = session.roles.includes("root") || session.roles.includes("leaddeveloper");
		if (!canManage && (request.method !== "GET" || !session.roles.includes("developer") ||
			!(element.isVisible(session, "developer") & 1))) {
			return jsonResponse({ error: "Forbidden" }, 403);
		}
		return handlePortalRolesRoute(request);
	}
	const hasDeveloperRole = session.roles.includes("developer");
	const hasSeoRole = session.roles.includes("seo");
	if (segments.length === 3) {
		if (!hasDeveloperRole) return jsonResponse({ error: "Forbidden" }, 403);
		const element = STWIndex.get(segments[1]);
		if (!(element instanceof STWElement)) return jsonResponse({ error: "Element not found" }, 404);
		if (!canDevelopElement(session, element)) return jsonResponse({ error: "Forbidden" }, 403);
		if (request.method !== "GET" && isProtectedWebbaselet(element))
			return jsonResponse({ error: "Deployed webbaselets are read-only" }, 403);
		if (segments[2] === "move") return handleMoveRoute(request, element, session);
		if (segments[2] === "options") return handleOptionsRoute(request, element, session);
		return jsonResponse({ error: "Not found" }, 404);
	}
	if (segments.length > 2) return jsonResponse({ error: "Not found" }, 404);
	if (!hasDeveloperRole && !hasSeoRole) return jsonResponse({ error: "Forbidden" }, 403);
	const id = segments[1];
	const method = request.method.toUpperCase();
	try {
		if (method === "GET") {
			if (!id && url.searchParams.has("uuid")) {
				return jsonResponse({ error: "Use /wbol/:uuid to read an element" }, 400);
			}
			const portal = session.portal instanceof STWPortal ? session.portal : STWPortal.instance;
			const element = id ? STWIndex.get(id) : portal;
			if (!(element instanceof STWElement)) return jsonResponse({ error: "Element not found" }, 404);
			const developerVisible = canEditElement(session, element);
			const seoVisible = hasSeoRole && Boolean(element.isVisible(session, "seo") & 1);
			if (id && !developerVisible && !seoVisible) return jsonResponse({ error: "Forbidden" }, 403);
			if (id) {
				const locale = resolveEditingLocale(url, session);
				const localizedSession = { ...session, lang: locale };
				return jsonResponse(developerVisible
					? serializeLocalizedElement(element, localizedSession)
					: serializeSeoElement(element, localizedSession));
			}
			const roles = url.searchParams.getAll("roles").flatMap((value) => value.trim().split(/\s+/).filter(Boolean));
			const visibilitySession = { portal, roles: roles.length ? roles : session.roles };
			return jsonResponse(filterAccessibleTree(element, session, visibilitySession, true));
		}
		if (method === "POST" && !id) {
			if (!hasDeveloperRole) return jsonResponse({ error: "Forbidden" }, 403);
			const body = await readJson(request);
			if (typeof body.parentId !== "string" || !isRecord(body.element)) {
				return jsonResponse({ error: "Expected parentId and element object" }, 400);
			}
			const parent = STWIndex.get(body.parentId);
			if (!(parent instanceof STWElement) || parent instanceof STWContent) {
				return jsonResponse({ error: "Parent element not found or cannot contain children" }, 400);
			}
			if (isProtectedWebbaselet(parent)) return jsonResponse({ error: "Deployed webbaselets are read-only" }, 403);
			if (!canDevelopElement(session, parent)) return jsonResponse({ error: "Forbidden" }, 403);
			if (blockedByOther(parent, session)) return jsonResponse({ error: "Element is blocked by another user" }, 409);
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
			let element = STWIndex.get(id);
			if (!(element instanceof STWElement)) return jsonResponse({ error: "Element not found" }, 404);
			if (isProtectedWebbaselet(element)) return jsonResponse({ error: "Deployed webbaselets are read-only" }, 403);
			const canDevelop = canEditElement(session, element);
			const canEditSeo = hasSeoRole && Boolean(element.isVisible(session, "seo") & 1);
			if (!canDevelop && !canEditSeo) return jsonResponse({ error: "Forbidden" }, 403);
			const patch = await readJson(request);
			if (!isRecord(patch)) return jsonResponse({ error: "Expected a JSON object" }, 400);
			if (blockedByOther(element, session))
				return jsonResponse({ error: "Element is blocked by another user" }, 409);
			if ("visibility" in patch) {
				return jsonResponse({ error: "Use the visibility route to change role visibility" }, 403);
			}
			const seoOnly = !canDevelop;
			if (seoOnly && Object.keys(patch).some((field) => !["name", "slug", "keywords", "description"].includes(field))) {
				return jsonResponse({ error: "SEO role may update only name, slug, keywords, and description" }, 403);
			}
			const hasLocalizedStrings = ["name", "slug", "keywords", "description"]
				.some((field) => typeof patch[field] === "string");
			const locale = seoOnly && !hasLocalizedStrings
				? null
				: resolveEditingLocale(url, session);
			const localizedUpdates = prepareLocalizedUpdates(patch, locale, getSupportedLocales(session));
			const parentId = patch.parentId;
			const position = patch.position;
			if ((parentId !== void 0 || position !== void 0) &&
				(blockedByOther(element.parent, session) || blockedByOther(STWIndex.get(parentId), session)))
				return jsonResponse({ error: "Element is blocked by another user" }, 409);
			const updates = { ...patch };
			delete updates.parentId;
			delete updates.position;
			for (const field of ["name", "slug", "keywords", "description"]) delete updates[field];
			for (const field of ["uuid", "subtype", "children", "parent", "modified", "blocked"]) {
				if (field in updates) return jsonResponse({ error: `${field} cannot be changed through PATCH` }, 400);
			}
			let replacement;
			if ("type" in updates) {
				if (!(element instanceof STWContent) || typeof updates.type !== "string") {
					return jsonResponse({ error: "type can only be changed on content" }, 400);
				}
				if (updates.type !== element.type) {
					const constructor = STWFactory[updates.type];
					if (!constructor || !(constructor.prototype instanceof STWContent)) {
						return jsonResponse({ error: `Unknown content type: ${updates.type}` }, 400);
					}
					if (!element.parent?.children.includes(element)) {
						return jsonResponse({ error: "Element is detached from the webbase" }, 409);
					}
					const definition = serializeSTWElement(element);
					if (typeof updates.layout === "string") {
						definition.layout = { ...definition.layout, [locale]: updates.layout };
					}
					replacement = new constructor({ ...definition, subtype: updates.type, class: element.cssClass });
					replacement.parent = element.parent;
				}
				delete updates.type;
			}
			let moveTo;
			let movePosition;
			if (parentId !== void 0) {
				if (element instanceof STWPortal) return jsonResponse({ error: "The portal cannot be moved" }, 400);
				if (typeof parentId !== "string") return jsonResponse({ error: "parentId must be a string" }, 400);
				const newParent = STWIndex.get(parentId);
				if (!(newParent instanceof STWPortal || newParent instanceof STWArea || newParent instanceof STWPage)) {
					return jsonResponse({ error: "Parent element not found or cannot contain children" }, 400);
				}
				if (element instanceof STWArea && newParent instanceof STWPage) {
					return jsonResponse({ error: "An area cannot be a child of a page" }, 400);
				}
				if (isProtectedWebbaselet(newParent)) return jsonResponse({ error: "Deployed webbaselets are read-only" }, 403);
				if (!canDevelopElement(session, newParent)) return jsonResponse({ error: "Forbidden" }, 403);
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
			const localizedSession = { ...session, lang: locale };
			if (moveTo && (blockedByOther(moveTo, session) || blockedByOther(element.parent, session)))
				return jsonResponse({ error: "Element is blocked by another user" }, 409);
			if (replacement) replacement.blocked = element.blocked;
			(replacement || element).update(localizedSession, updates);
			if (replacement) {
				const parent = element.parent;
				parent.children[parent.children.indexOf(element)] = replacement;
				STWIndex.set(id, replacement);
				element = replacement;
			}
			applyLocalizedUpdates(element, localizedUpdates);
			if (moveTo) moveElement(element, moveTo, movePosition);
			return jsonResponse(seoOnly ? serializeSeoElement(element, localizedSession) : serializeLocalizedElement(element, localizedSession));
		}
		if (method === "DELETE" && id) {
			const element = STWIndex.get(id);
			if (!(element instanceof STWElement)) return jsonResponse({ error: "Element not found" }, 404);
			if (isProtectedWebbaselet(element)) return jsonResponse({ error: "Deployed webbaselets are read-only" }, 403);
			if (!canDevelopElement(session, element)) return jsonResponse({ error: "Forbidden" }, 403);
			if (treeBlockedByOther(element, session) || blockedByOther(element.parent, session))
				return jsonResponse({ error: "Element is blocked by another user" }, 409);
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
		if (error instanceof AdminApiError) return jsonResponse({ error: error.message }, error.status);
		if (error instanceof SyntaxError || error instanceof TypeError) {
			return jsonResponse({ error: error.message }, 400);
		}
		console.error("WBOL API request failed:", error);
		return jsonResponse({ error: "Internal server error" }, 500);
	}
}

function canEditElement(session, element) {
	return canDevelopElement(session, element) ||
		(element instanceof STWPortal && session.roles.includes("developer") &&
			(session.roles.includes("leaddeveloper") || session.roles.includes("root")));
}

function blockedByOther(element, session) {
	return Boolean(element?.blocked && element.blocked !== session.user);
}

function treeBlockedByOther(element, session) {
	return blockedByOther(element, session) || element.children.some((child) => treeBlockedByOther(child, session));
}

function filterAccessibleTree(element, session, visibilitySession, root = false) {
	if (isDeployed() && webbaseletKind(element) === "studio") return null;
	const developerVisible = canDevelopElement(session, element);
	const seoVisible = session.roles.includes("seo") && Boolean(element.isVisible(session, "seo") & 1);
	if (!root && !developerVisible && !seoVisible) return null;
	let result;
	if (developerVisible || root && session.roles.includes("developer")) {
		result = serializeSTWElement(element);
	} else if (seoVisible) {
		result = serializeSeoElement(element, session);
	} else {
		result = { uuid: element.uuid, type: element.type, subtype: element.subtype || element.type };
	}
	result.blocked = element.blocked;
	result.visibility = element.isVisible(visibilitySession);
	if (element instanceof STWContent) result.section = element.section;
	result.children = element.children
		.map((child) => filterAccessibleTree(child, session, visibilitySession))
		.filter(Boolean);
	return result;
}

function serializeSeoElement(element, session) {
	return {
		uuid: element.uuid,
		type: element.type,
		subtype: element.subtype || element.type,
		blocked: element.blocked,
		...(isProtectedWebbaselet(element) ? { readonly: "true" } : {}),
		name: localizedValue(element, "name", session),
		slug: localizedValue(element, "slug", session),
		keywords: localizedValue(element, "keywords", session),
		description: localizedValue(element, "description", session)
	};
}

function serializeLocalizedElement(element, session) {
	const result = serializeSTWElement(element);
	if (isProtectedWebbaselet(element)) result.readonly = "true";
	for (const field of ["name", "slug", "keywords", "description"]) {
		result[field] = localizedValue(element, field, session);
	}
	if (element instanceof STWContent) {
		result.type = element.type;
		result.subtype = element.subtype || element.type;
		const layout = element.layout?.get(session.lang);
		result.layout = typeof layout === "string" ? layout : layout?.wbll || "";
	}
	return result;
}

function localizedValue(element, field, session) {
	const values = element[field];
	if (!(values instanceof Map)) return "";
	return values.get(session.lang) || values.values().next().value || "";
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
	return normalizeSlug(value);
}

function applyLocalizedUpdates(element, updates) {
	for (const { field, locale, value } of updates) {
		element[field].set(locale, value);
	}
}

async function handleMoveRoute(request, element, session) {
	if (request.method.toUpperCase() !== "POST") return methodNotAllowed("POST");
	try {
		const body = await readJson(request);
		if (!isRecord(body) || typeof body.parentId !== "string" ||
			Object.keys(body).some((key) => !["parentId", "position"].includes(key))) {
			throw new TypeError("Expected { parentId: string, position?: number }");
		}
		if (element instanceof STWPortal) {
			throw new TypeError("The portal cannot be moved");
		}
		const destination = STWIndex.get(body.parentId);
		if (!(destination instanceof STWElement)) {
			return jsonResponse({ error: "Destination element not found" }, 404);
		}
		if (isProtectedWebbaselet(destination)) {
			return jsonResponse({ error: "Deployed webbaselets are read-only" }, 403);
		}
		if (!canDevelopElement(session, destination)) return jsonResponse({ error: "Forbidden" }, 403);
		if (blockedByOther(element, session) || blockedByOther(destination, session) || blockedByOther(element.parent, session))
			return jsonResponse({ error: "Element is blocked by another user" }, 409);
		const sourceParent = element.parent;
		if (!sourceParent || !sourceParent.children.includes(element)) {
			return jsonResponse({ error: "Element is detached from the webbase" }, 409);
		}

		if (destination instanceof STWContent) {
			if (!Array.isArray(destination.options)) {
				return jsonResponse({ error: "Destination content does not support options" }, 400);
			}
			if (wouldCreateOptionCycle(element, destination, session)) {
				return jsonResponse({ error: "Moving this element would create a content option recursion" }, 400);
			}
			if (destination.options.some((option) => resolveOptionReference(option.ref, session) === element)) {
				return jsonResponse({ error: "Element is already an option of the destination" }, 409);
			}
			const position = body.position === void 0 ? destination.options.length : body.position;
			if (!Number.isInteger(position) || position < 0 || position > destination.options.length) {
				return jsonResponse({ error: "position must be a valid option index" }, 400);
			}
			destination.options.splice(position, 0, {
				name: new Map(),
				ref: element.uuid,
				parameters: ""
			});
			destination.modified = Date.now();
			return jsonResponse({
				uuid: element.uuid,
				parentId: destination.uuid,
				position,
				option: true
			});
		}

		if (!(destination instanceof STWPortal || destination instanceof STWArea || destination instanceof STWPage)) {
			return jsonResponse({ error: "Destination must be a Portal, Area, Page, or option-capable Content" }, 400);
		}
		if (element instanceof STWArea && destination instanceof STWPage) {
			return jsonResponse({ error: "An area cannot be a child of a page" }, 400);
		}
		if (destination === element || isDescendantOf(destination, element)) {
			return jsonResponse({ error: "An element cannot be moved into itself or its descendants" }, 400);
		}
		const maxPosition = destination === sourceParent ? sourceParent.children.length - 1 : destination.children.length;
		const position = body.position === void 0 ? maxPosition : body.position;
		if (!Number.isInteger(position) || position < 0 || position > maxPosition) {
			return jsonResponse({ error: "position must be a valid child index" }, 400);
		}
		moveElement(element, destination, position);
		destination.modified = Date.now();
		return jsonResponse({
			uuid: element.uuid,
			parentId: destination.uuid,
			position,
			option: false
		});
	} catch (error) {
		return apiErrorResponse(error, "WBOL element move failed:");
	}
}

async function handleVisibilityRoute(request, element, session) {
	const method = request.method.toUpperCase();
	const isLeadDeveloper = session.roles.includes("leaddeveloper") || session.roles.includes("root");
	if (method === "GET") {
		if (!isLeadDeveloper && !canDevelopElement(session, element)) {
			return jsonResponse({ error: "Forbidden" }, 403);
		}
		return jsonResponse(Object.fromEntries(element.visibility));
	}
	if (method !== "PUT" && method !== "PATCH") return methodNotAllowed("GET, PUT, PATCH");
	if (!isLeadDeveloper) return jsonResponse({ error: "Forbidden" }, 403);
	try {
		const body = await readJson(request);
		if (!isRecord(body)) throw new TypeError("Expected a role-to-visibility object");
		for (const [role, visible] of Object.entries(body)) {
			if (!role || visible !== null && typeof visible !== "boolean") {
				throw new TypeError("Visibility values must be true, false, or null");
			}
			if (role === "root" || role === "administrator") {
				throw new AdminApiError(403, `LeadDeveloper cannot assign the ${role} role`);
			}
			if (visible !== null && !await STWSecurity.isKnownRole(role)) {
				throw new TypeError(`Unknown role: ${role}`);
			}
			if (element instanceof STWPortal && visible === true) {
				throw new AdminApiError(403, "The portal can only grant visibility to the root role");
			}
		}
		if (blockedByOther(element, session)) return jsonResponse({ error: "Element is blocked by another user" }, 409);
		if (method === "PUT") {
			for (const role of element.visibility.keys()) {
				if (role !== "root" && role !== "administrator") element.visibility.delete(role);
			}
		}
		for (const [role, visible] of Object.entries(body)) {
			if (visible === null) element.visibility.delete(role);
			else element.visibility.set(role, visible);
		}
		if (element instanceof STWPortal) element.visibility.set("root", true);
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
			let options = element.options;
			let option;
			for (let depth = 0; depth < patch.path.length; depth++) {
				option = options[patch.path[depth]];
				if (!option) return jsonResponse({ error: "Option path not found" }, 404);
				if (blockedByOther(element, session)) return jsonResponse({ error: "Element is blocked by another user" }, 409);
				if (depth < patch.path.length - 1) {
					if (!Array.isArray(option.options)) return jsonResponse({ error: "Option path not found" }, 404);
					options = option.options;
				}
			}
			if (!option) return jsonResponse({ error: "Option path not found" }, 404);
			if (!(option.name instanceof Map)) option.name = new Map(Object.entries(option.name || {}));
			option.name.set(locale, patch.name);
			element.modified = Date.now();
			return jsonResponse(serializeOptions(element.options));
		}
		const options = await readJson(request);
		if (blockedByOther(element, session)) return jsonResponse({ error: "Element is blocked by another user" }, 409);
		element.options = normalizeOptions(options);
		element.modified = Date.now();
		return jsonResponse(serializeOptions(element.options));
	} catch (error) {
		return apiErrorResponse(error, "WBOL options update failed:");
	}
}

async function handlePortalConnectorsRoute(request, portal, session) {
	const method = request.method.toUpperCase();
	if (method === "GET") return jsonResponse(Object.fromEntries(portal.connectors));
	if (method !== "PUT") return methodNotAllowed("GET, PUT");
	try {
		const connectors = await readJson(request);
		if (!isRecord(connectors) || !Object.values(connectors).every((value) => typeof value === "string")) {
			throw new TypeError("Expected a connector name-to-value object");
		}
		if (blockedByOther(portal, session)) return jsonResponse({ error: "Element is blocked by another user" }, 409);
		portal.connectors = new Map(Object.entries(connectors));
		portal.modified = Date.now();
		return jsonResponse(Object.fromEntries(portal.connectors));
	} catch (error) {
		return apiErrorResponse(error, "WBOL portal connector update failed:");
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
function wouldCreateOptionCycle(source, destination, session) {
	if (!(source instanceof STWContent)) return false;
	const visited = new Set();
	function reachesDestination(content) {
		if (content === destination) return true;
		if (visited.has(content)) return false;
		visited.add(content);
		function visitOptions(options) {
			for (const option of options || []) {
				const referenced = resolveOptionReference(option.ref, session);
				if (referenced instanceof STWContent && reachesDestination(referenced)) return true;
				if (visitOptions(option.options)) return true;
			}
			return false;
		}
		return visitOptions(content.options);
	}
	return reachesDestination(source);
}
function resolveOptionReference(ref, session) {
	if (typeof ref !== "string") return null;
	const target = ref.split(/[?#]/, 1)[0];
	const indexed = STWIndex.get(target);
	if (indexed instanceof STWElement) return indexed;
	return session.portal?.find(session, target) || null;
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
	if ("visibility" in definition) {
		throw new AdminApiError(403, "Use the visibility route to change role visibility");
	}
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
	elementBlocks.delete(element.uuid);
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
const connectorTypes = new Set(["api", "imap", "mysql", "postgres", "mssql", "mongodb", "node", "smtp"]);
async function handleWbolAdminApi(request, session, segments) {
	const [resource, rawId, action] = segments;
	if (!["users", "roles", "connectors", "configuration"].includes(resource || "")) return null;
	const isRoot = session.roles.includes("root");
	const isAdmin = session.roles.includes("administrator");
	const isLeadDeveloper = session.roles.includes("leaddeveloper");
	const isLeadRoleRoute = resource === "users" && segments.length === 3 &&
		["developer", "seo"].includes(action);
	const connectorNames = resource === "connectors" && rawId === "names" && action === void 0 && request.method === "GET";
	const visibilityRoles = resource === "roles" && rawId === "visibility" && action === void 0 && request.method === "GET";
	const authorized = resource === "configuration"
		? isRoot
		: connectorNames || visibilityRoles
			? isRoot || isLeadDeveloper || session.roles.includes("developer")
		: resource === "connectors" || resource === "roles"
			? isRoot || isLeadDeveloper
		: isLeadRoleRoute
			? isRoot || isLeadDeveloper
			: isRoot || isAdmin;
	if (!authorized) {
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
		if (resource === "configuration") {
			if (segments.length !== 1) return jsonResponse({ error: "Not found" }, 404);
			return await configurationRoute(request, method);
		}
		if (resource === "users" && segments.length === 3 && ["developer", "seo"].includes(action)) {
			return await userRoleRoute(request, method, id, action);
		}
		if (resource === "users" && action !== void 0) return jsonResponse({ error: "Not found" }, 404);
		if (resource === "users") return await usersRoute(request, method, id, session);
		if (resource === "roles") {
			if (action !== void 0) return jsonResponse({ error: "Not found" }, 404);
			if (visibilityRoles) return jsonResponse(await STWSecurity.listRoles());
			return await rolesRoute(request, method, id);
		}
		if (resource === "connectors" && rawId === "reconnect" && action === void 0) {
			return await reconnectConnectorsRoute(method);
		}
		if (connectorNames) {
			const configurations = await STWConnectors.getConfigurations();
			const choices = [
				{ id: "json", name: "json" },
				{ id: "wbol", name: "wbol" },
				...configurations.map(({ id, name }) => ({ id, name }))
			];
			if (readBooleanSetting("ALLOW_AI")) {
				choices.push({ id: "assistant", name: "assistant" });
			}
			return jsonResponse(choices);
		}
		if (action !== void 0) return jsonResponse({ error: "Not found" }, 404);
		return await connectorsRoute(request, method, id, isRoot);
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
async function configurationRoute(request, method) {
	if (method === "GET") {
		const configuration = await STWSecurity.readConfiguration();
		const fields = new URL(request.url).searchParams.get("fields");
		if (fields !== null) {
			const names = fields.split(",");
			if (names.some((name) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))) {
				throw new TypeError("Invalid configuration field name");
			}
			const selected = Object.fromEntries(names.map((name) => [
				name, Object.hasOwn(configuration, name) ? configuration[name] : ""
			]));
			return jsonResponse(selected, 200, { "Cache-Control": "no-store" });
		}
		return jsonResponse(configuration, 200, { "Cache-Control": "no-store" });
	}
	if (method === "PATCH") {
		const body = await readAdminJson(request);
		if (!isRecord(body) || !Object.keys(body).length) throw new TypeError("Expected configuration settings");
		await STWSecurity.updateConfiguration(body);
		return jsonResponse({ updated: true }, 200, { "Cache-Control": "no-store" });
	}
	return methodNotAllowed("GET, PATCH");
}
async function usersRoute(request, method, id, session) {
	if (method === "GET" && !id) return jsonResponse(await STWSecurity.listUsers());
	if (method === "POST" && !id) {
		const body = await readAdminJson(request);
		if (!isRecord(body) || typeof body.password !== "string" || !body.password.trim()) {
			throw new AdminApiError(400, "Expected user and password");
		}
		const user = requireNonEmptyString(body.user, "user");
		const password = requireNonEmptyString(body.password, "password");
		const name = optionalString(body.name, "name") ?? user;
		const email = optionalString(body.email, "email") ?? "";
		const roles = await validateRoles(body.roles ?? ["user"]);
		const isRoot = session.roles.includes("root");
		const isLeadDeveloper = session.roles.includes("leaddeveloper");
		if (!isRoot && roles.some((role) => ["root", "leaddeveloper"].includes(role))) {
			throw new AdminApiError(403, "Only root can assign root or leaddeveloper");
		}
		if (!isRoot && !isLeadDeveloper && roles.some((role) => ["developer", "seo"].includes(role))) {
			throw new AdminApiError(403, "Only LeadDeveloper or root can assign developer and SEO roles");
		}
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
		if ("roles" in body) {
			patch.roles = await validateRoles(body.roles);
			await assertProtectedRoleChangesAllowed(id, patch.roles, session);
		}
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
async function userRoleRoute(request, method, id, role) {
	if (!id) return jsonResponse({ error: "User not found" }, 404);
	const user = (await STWSecurity.listUsers()).find((entry) => entry.user === id);
	if (!user) throw new AdminApiError(404, "User not found");
	const roles = new Set(user.roles.split(",").map((role) => role.trim()).filter(Boolean));
	if (method === "GET") return jsonResponse({ user: id, role, enabled: roles.has(role) });
	if (method !== "PATCH") return methodNotAllowed("GET, PATCH");
	const body = await readAdminJson(request);
	if (!isRecord(body) || Object.keys(body).length !== 1 || typeof body.enabled !== "boolean") {
		throw new AdminApiError(400, "Expected { enabled: boolean }");
	}
	if (body.enabled) roles.add(role);
	else roles.delete(role);
	await STWSecurity.updateUser(id, { roles: [...roles] });
	return jsonResponse({ user: id, role, enabled: body.enabled });
}
async function rolesRoute(request, method, id) {
	if (method === "GET" && !id) {
		return jsonResponse(await STWSecurity.listCustomRoles());
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
		assertRoleNotUsedByProtectedWebbaselet(id);
		await STWSecurity.renameRole(id, newRole);
		renameVisibilityRole(id, newRole);
		return jsonResponse({ role: newRole });
	}
	if (method === "DELETE" && id) {
		assertRoleNotUsedByProtectedWebbaselet(id);
		await STWSecurity.deleteRole(id);
		for (const element of STWIndex.values()) {
			if (element instanceof STWElement) element.visibility.delete(id);
		}
		return secureResponse(null, { status: 204 });
	}
	return methodNotAllowed("GET, POST, PATCH, DELETE");
}
function assertRoleNotUsedByProtectedWebbaselet(role) {
	for (const element of STWIndex.values()) {
		if (element instanceof STWElement && element.visibility.has(role) && isProtectedWebbaselet(element)) {
			throw new AdminApiError(403, "Role is used by a deployed read-only webbaselet");
		}
	}
}
async function connectorsRoute(request, method, id, isRoot) {
	if (method === "GET" && !id) {
		return jsonResponse((await STWConnectors.getConfigurations()).map(redactConnector));
	}
	if (method === "POST" && !id) {
		const body = await readAdminJson(request);
		if (!isRecord(body)) throw new AdminApiError(400, "Expected a connector object");
		validateConnectorFields(body);
		const connector = validateConnector({
			...body, name: body.name === void 0 || body.name === "" ? body.id : body.name
		});
		if (connector.type === "node" && !isRoot)
			throw new AdminApiError(403, "Only root can configure Node connectors");
		const configurations = await STWConnectors.getConfigurations();
		if (configurations.some((item) => item.id === connector.id)) {
			throw new AdminApiError(409, "Connector ID already exists");
		}
		configurations.push(connector);
		await STWConnectors.saveConfigurations(configurations);
		return jsonResponse(redactConnector(connector), 201);
	}
	if (method === "PATCH" && id) {
		const body = await readAdminJson(request);
		if (!isRecord(body)) throw new AdminApiError(400, "Expected a JSON object");
		validateConnectorFields(body);
		if (body.id !== void 0 && body.id !== id) {
			throw new AdminApiError(400, "Connector ID cannot be changed through PATCH");
		}
		const configurations = await STWConnectors.getConfigurations();
		const index = configurations.findIndex((item) => item.id === id);
		if (index < 0) throw new AdminApiError(404, "Connector not found");
		const old = configurations[index];
		if (!isRoot && (old.type === "node" || body.type === "node"))
			throw new AdminApiError(403, "Only root can configure Node connectors");
		const updated = validateConnector({ ...old, ...body, id });
		configurations[index] = updated;
		await STWConnectors.saveConfigurations(configurations);
		return jsonResponse(redactConnector(updated));
	}
	if (method === "DELETE" && id) {
		const configurations = await STWConnectors.getConfigurations();
		const index = configurations.findIndex((item) => item.id === id);
		if (index < 0) throw new AdminApiError(404, "Connector not found");
		if (configurations[index].type === "node" && !isRoot)
			throw new AdminApiError(403, "Only root can configure Node connectors");
		if (isConnectorReferenced(id)) {
			throw new AdminApiError(409, "Connector is used by one or more content elements");
		}
		configurations.splice(index, 1);
		await STWConnectors.saveConfigurations(configurations);
		return secureResponse(null, { status: 204 });
	}
	return methodNotAllowed("GET, POST, PATCH, DELETE");
}

async function reconnectConnectorsRoute(method) {
	if (method !== "POST") return methodNotAllowed("POST");
	try {
		return jsonResponse(await STWConnectors.reconnectAll());
	} catch (error) {
		console.error("Failed to reconnect all connectors:", error);
		const errors = error instanceof AggregateError
			? error.errors.map((item) => item instanceof Error ? item.message : String(item))
			: [error instanceof Error ? error.message : String(error)];
		return jsonResponse({
			reconnected: false,
			errors
		}, 503);
	}
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
async function assertProtectedRoleChangesAllowed(userId, replacementRoles, session) {
	if (session.roles.includes("root")) return;
	const users = await STWSecurity.listUsers();
	const user = users.find((entry) => entry.user === userId);
	if (!user) throw new AdminApiError(404, "User not found");
	const previousRoles = new Set(user.roles.split(",").map((role) => role.trim()));
	const nextRoles = new Set(replacementRoles);
	for (const role of ["root", "developer", "leaddeveloper", "seo"]) {
		if (previousRoles.has(role) !== nextRoles.has(role)) {
			throw new AdminApiError(403, `Only root or LeadDeveloper can change the ${role} role`);
		}
	}
}
async function assertAdminWillRemain(userId, replacementRoles) {
	const users = await STWSecurity.listUsers();
	const target = users.find((user) => user.user === userId);
	if (!target) throw new AdminApiError(404, "User not found");
	const isAdmin = (roles) => roles.split(",").some((role) => role === "root" || role === "administrator");
	if (replacementRoles === void 0 || !isAdmin(target.roles) || replacementRoles.some((role) => role === "root" || role === "administrator")) return;
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
function isConnectorReferenced(name) {
	for (const element of STWIndex.values()) {
		if (element instanceof STWContent && element.connector === name) return true;
	}
	return false;
}
function validateConnector(value) {
	const id = requireNonEmptyString(value.id, "id");
	assertConnectorId(id);
	const name = requireNonEmptyString(value.name, "name");
	const type = requireNonEmptyString(value.type, "type");
	if (!connectorTypes.has(type)) throw new AdminApiError(400, `Unsupported connector type: ${type}`);
	const result = { id, name, type };
	for (const key of ["host", "user", "password", "passwordEnv", "database", "contentType", "from"]) {
		if (value[key] !== void 0) result[key] = requireString(value[key], key);
	}
	if (value.windowsAuth !== void 0) {
		if (typeof value.windowsAuth !== "boolean") throw new AdminApiError(400, "windowsAuth must be a boolean");
		if (type !== "mssql") throw new AdminApiError(400, "windowsAuth is only supported for mssql connectors");
		result.windowsAuth = value.windowsAuth;
	}
	if (value.odbcDriver !== void 0) {
		if (type !== "mssql" || result.windowsAuth !== true) {
			throw new AdminApiError(400, "odbcDriver requires Windows authentication on an mssql connector");
		}
		result.odbcDriver = requireNonEmptyString(value.odbcDriver, "odbcDriver");
	}
	if (value.secure !== void 0) {
		if (typeof value.secure !== "boolean") throw new AdminApiError(400, "secure must be a boolean");
		result.secure = value.secure;
	}
	if (value.port !== void 0) {
		if (typeof value.port !== "number" || !Number.isInteger(value.port) || value.port < 1 || value.port > 65535) {
			throw new AdminApiError(400, "port must be an integer from 1 to 65535");
		}
		result.port = value.port;
	}
	const windowsAuth = type === "mssql" && result.windowsAuth === true;
	if (["mysql", "postgres", "mssql"].includes(type) &&
		(!result.host || (!windowsAuth && !result.user) || !result.database)) {
		throw new AdminApiError(400, windowsAuth
			? "mssql connector requires host and database"
			: `${type} connector requires host, user, and database`);
	}
	if (type === "mongodb" && (!result.host || !result.database)) {
		throw new AdminApiError(400, "mongodb connector requires host and database");
	}
	if (type === "api" && !result.host) throw new AdminApiError(400, "api connector requires host");
	if (["imap", "smtp"].includes(type)) {
		if (!result.host || !result.user) throw new AdminApiError(400, `${type} connector requires host and user`);
		if (Boolean(result.password) === Boolean(result.passwordEnv)) {
			throw new AdminApiError(400, `${type} connector requires exactly one of password or passwordEnv`);
		}
		if (result.passwordEnv && !/^[A-Z_][A-Z0-9_]*$/.test(result.passwordEnv)) {
			throw new AdminApiError(400, "passwordEnv must be an environment variable name");
		}
		result.port ??= type === "imap" ? 993 : 465;
		result.secure ??= type === "imap" || result.port === 465;
		if (type === "imap" && !result.secure) {
			throw new AdminApiError(400, "imap connector requires TLS");
		}
		if (type === "smtp" && !result.from) {
			throw new AdminApiError(400, "smtp connector requires a configured from address");
		}
	}
	if (type === "node" && (result.host ? !isAbsolute(result.host) : isDeployed())) {
		throw new AdminApiError(400, "node connector requires an absolute launcher path in host");
	}
	return result;
}
function validateConnectorFields(value) {
	const allowed = new Set(["id", "name", "type", "host", "user", "password", "passwordEnv", "database", "contentType", "port", "secure", "from", "windowsAuth", "odbcDriver"]);
	for (const key of Object.keys(value)) {
		if (!allowed.has(key)) throw new AdminApiError(400, `Unsupported connector field: ${key}`);
	}
}
function redactConnector(configuration) {
	const { password, ...safe } = configuration;
	return { ...safe, hasPassword: typeof password === "string" && password.length > 0 || typeof configuration.passwordEnv === "string" };
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
	handleWbolApi
};
