import { STWFactory } from "./stwFactory.ts";
import type { STWSession } from "./stwSession.ts";
import { secureResponse } from "./stwResponse.ts";
import { STWContent } from "../stwElements/stwContent.ts";
import { serializeSTWElement, STWElement } from "../stwElements/stwElement.ts";
import { STWPortal } from "../stwElements/stwPortal.ts";
import { STWIndex } from "../stwElements/stwIndex.ts";
import { handleWbolAdminApi } from "./stwWbolAdminApi.ts";

const MAX_BODY_SIZE = 2 * 1024 * 1024;

export async function handleWbolApi(request: Request, session: STWSession): Promise<Response> {
	const isAdmin = session.roles.includes("root") || session.roles.includes("administrators");
	if (!session.roles.includes("developers") && !isAdmin) {
		return jsonResponse({ error: "Forbidden" }, 403);
	}

	const segments = new URL(request.url).pathname.split("/").filter(Boolean);
	if (segments.length > 1) {
		const adminResponse = await handleWbolAdminApi(request, session, segments.slice(1));
		if (adminResponse) return adminResponse;
	}
	if (segments.length > 2) return jsonResponse({ error: "Not found" }, 404);

	const id = segments[1];
	const method = request.method.toUpperCase();

	try {
		if (method === "GET") {
			const element = id ? STWIndex.get(id) : STWPortal.instance;
			if (!(element instanceof STWElement)) return jsonResponse({ error: "Element not found" }, 404);
			return jsonResponse(serializeSTWElement(element));
		}

		if (method === "POST" && !id) {
			const body = await readJson(request) as { parentId?: unknown; element?: unknown };
			if (typeof body.parentId !== "string" || !isRecord(body.element)) {
				return jsonResponse({ error: "Expected parentId and element object" }, 400);
			}
			const parent = STWIndex.get(body.parentId);
			if (!(parent instanceof STWElement) || parent instanceof STWContent) {
				return jsonResponse({ error: "Parent element not found or cannot contain children" }, 400);
			}
			validateDefinitionTree(body.element);
			const definitionIds = collectDefinitionIds(body.element);
			if (
				new Set(definitionIds).size !== definitionIds.length ||
				definitionIds.some((elementId) => STWIndex.has(elementId))
			) {
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
			const patch = await readJson(request);
			if (!isRecord(patch)) return jsonResponse({ error: "Expected a JSON object" }, 400);

			const parentId = patch.parentId;
			const position = patch.position;
			const updates = { ...patch };
			delete updates.parentId;
			delete updates.position;
			for (const field of ["uuid", "type", "subtype", "children", "parent", "modified"]) {
				if (field in updates) return jsonResponse({ error: `${field} cannot be changed through PATCH` }, 400);
			}
			let moveTo: STWElement | undefined;
			let movePosition: number | undefined;

			if (parentId !== undefined) {
				if (element instanceof STWPortal) return jsonResponse({ error: "The portal cannot be moved" }, 400);
				if (typeof parentId !== "string") return jsonResponse({ error: "parentId must be a string" }, 400);
				const newParent = STWIndex.get(parentId);
				if (!(newParent instanceof STWElement) || newParent instanceof STWContent) {
					return jsonResponse({ error: "Parent element not found or cannot contain children" }, 400);
				}
				if (newParent === element || isDescendantOf(newParent, element)) {
					return jsonResponse({ error: "An element cannot be moved into itself or its descendants" }, 400);
				}
				const maxPosition = newParent === element.parent
					? newParent.children.length - 1
					: newParent.children.length;
				if (
					position !== undefined &&
					(typeof position !== "number" || !Number.isInteger(position) || position < 0 ||
						position > maxPosition)
				) {
					return jsonResponse({ error: "position must be a valid child index" }, 400);
				}
				moveTo = newParent;
				movePosition = typeof position === "number" ? position : undefined;
			} else if (position !== undefined) {
				if (element instanceof STWPortal) return jsonResponse({ error: "The portal cannot be moved" }, 400);
				if (
					typeof position !== "number" || !Number.isInteger(position) || !element.parent || position < 0 ||
					position >= element.parent.children.length
				) {
					return jsonResponse({ error: "position must be a valid child index" }, 400);
				}
				moveTo = element.parent;
				movePosition = position;
			}

			element.update(session, updates);
			if (moveTo) moveElement(element, moveTo, movePosition);
			return jsonResponse(serializeSTWElement(element));
		}

		if (method === "DELETE" && id) {
			const element = STWIndex.get(id);
			if (!(element instanceof STWElement)) return jsonResponse({ error: "Element not found" }, 404);
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
			{ Allow: "GET, POST, PATCH, DELETE" },
		);
	} catch (error) {
		if (error instanceof SyntaxError || error instanceof TypeError) {
			return jsonResponse({ error: error.message }, 400);
		}
		console.error("WBOL API request failed:", error);
		return jsonResponse({ error: "Internal server error" }, 500);
	}
}

function createElement(definition: Record<string, unknown>): STWElement {
	const kind = typeof definition.subtype === "string" ? definition.subtype : definition.type;
	if (typeof kind !== "string" || !kind) throw new TypeError("element must specify a registered type");
	if (kind === "Portal") throw new TypeError("Cannot add a portal as a child");
	const constructor = STWFactory[kind];
	if (!constructor) throw new TypeError(`Unknown element type: ${kind}`);

	const previousIds = new Set(STWIndex.keys());
	try {
		return new constructor(definition) as STWElement;
	} catch (error) {
		for (const registeredId of STWIndex.keys()) {
			if (!previousIds.has(registeredId)) STWIndex.delete(registeredId);
		}
		throw error;
	}
}

async function readJson(request: Request): Promise<unknown> {
	const contentLength = Number(request.headers.get("content-length") || 0);
	if (contentLength > MAX_BODY_SIZE) throw new TypeError("Request body is too large");
	const text = await request.text();
	if (new TextEncoder().encode(text).byteLength > MAX_BODY_SIZE) throw new TypeError("Request body is too large");
	return JSON.parse(text);
}

function moveElement(element: STWElement, parent: STWElement, position?: number): void {
	const previousParent = element.parent;
	const previousIndex = previousParent?.children.indexOf(element) ?? -1;
	if (!previousParent || previousIndex < 0) throw new TypeError("Element is detached from the webbase");
	previousParent.children.splice(previousIndex, 1);
	const targetPosition = Math.min(position ?? parent.children.length, parent.children.length);
	parent.children.splice(targetPosition, 0, element);
	element.parent = parent;
}

function isDescendantOf(element: STWElement, ancestor: STWElement): boolean {
	for (let parent = element.parent; parent; parent = parent.parent) {
		if (parent === ancestor) return true;
	}
	return false;
}

function collectDefinitionIds(definition: Record<string, unknown>): string[] {
	const ids = typeof definition.uuid === "string" ? [definition.uuid] : [];
	if (Array.isArray(definition.children)) {
		for (const child of definition.children) {
			if (isRecord(child)) ids.push(...collectDefinitionIds(child));
		}
	}
	return ids;
}

function validateDefinitionTree(definition: Record<string, unknown>): void {
	const kind = typeof definition.subtype === "string" ? definition.subtype : definition.type;
	if (typeof kind !== "string" || !STWFactory[kind] || kind === "Portal") {
		throw new TypeError(`Unknown or unsupported element type: ${String(kind || "")}`);
	}
	if (definition.children === undefined) return;
	if (!Array.isArray(definition.children)) throw new TypeError("element.children must be an array");
	for (const child of definition.children) {
		if (!isRecord(child)) throw new TypeError("Each child element must be an object");
		validateDefinitionTree(child);
	}
}

function indexElementTree(element: STWElement): void {
	STWIndex.set(element.uuid, element);
	for (const child of element.children) indexElementTree(child);
}

function removeElementTree(element: STWElement): void {
	for (const child of element.children) removeElementTree(child);
	STWIndex.delete(element.uuid);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit): Response {
	return secureResponse(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json; charset=utf-8", ...Object.fromEntries(new Headers(headers)) },
	});
}
