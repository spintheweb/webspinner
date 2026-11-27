/**
 * @fileoverview Validates and persists assistant-proposed WBOL changes.
 *
 * @author Copilot
 * @module stwAssistantPersistence
 * @license Apache-2.0
 */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { envGet } from "./stwConfig.js";
import { isProtectedWebbaselet } from "./stwWebbaselets.js";
import { WBOL } from "./stwWBOL.js";
import { normalizeSlug, serializeSTWElement, STWElement } from "../stwElements/stwElement.js";
import { STWContent } from "../stwElements/stwContent.js";

const localized = ["name", "slug", "description", "layout"];
const allowed = new Set([...localized, "query"]);
const hash = (value) => createHash("sha256").update(value).digest("hex");

class AssistantConflictError extends Error {}

function children(element, name) {
	return Array.from(element.childNodes).filter((child) =>
		child.nodeType === 1 && (child.localName || child.tagName) === name);
}

function locate(element, uuid, matches) {
	if (element.nodeType !== 1) return;
	if (["webbase", "webbaselet", "area", "page", "content"].includes(element.localName || element.tagName) &&
		element.getAttribute("uuid") === uuid) matches.push(element);
	for (const child of Array.from(element.childNodes)) locate(child, uuid, matches);
}

function sourceFor(uuid) {
	const matches = [];
	const paths = [...new Set([
		envGet("WEBBASE") || "./.data/webbase.wbol",
		envGet("COMMON_WEBBASELET") || "./webbaselets/stwCommon.wbol",
		envGet("STUDIO_WEBBASELET") || "./webbaselets/stwStudio.wbol"
	].filter((path) => !/^https?:\/\//i.test(path)).map((path) => resolve(path)))].filter(existsSync);
	for (const path of paths) {
		const source = readFileSync(path, "utf8");
		const document = new DOMParser({
			errorHandler: {
				warning: (message) => { throw new Error(message); },
				error: (message) => { throw new Error(message); },
				fatalError: (message) => { throw new Error(message); }
			}
		}).parseFromString(source, "application/xml");
		const nodes = [];
		locate(document.documentElement, uuid, nodes);
		for (const node of nodes) matches.push({ path, source, document, node });
	}
	if (matches.length !== 1) throw new Error(matches.length
		? "The element UUID occurs in multiple WBOL sources"
		: "The element has no configured local WBOL source");
	if (envGet("PORTAL_URL") && matches[0].path === resolve(envGet("WEBBASE") || "./.data/webbase.wbol")) {
		throw new Error("The Webbase is downloaded on startup and cannot be saved persistently here");
	}
	return matches[0];
}

function findDefinition(element, uuid) {
	if (element.uuid === uuid) return element;
	for (const child of element.children || []) {
		const found = findDefinition(child, uuid);
		if (found) return found;
	}
	return null;
}

function definitionValue(definition, field, locale) {
	return field === "query" ? definition.query || "" : definition[field]?.[locale] || "";
}

function captureRevision(element) {
	if (isProtectedWebbaselet(element)) throw new Error("Deployed webbaselets are read-only");
	const source = sourceFor(element.uuid);
	return {
		path: source.path,
		sourceHash: hash(source.source),
		elementHash: hash(JSON.stringify(serializeSTWElement(element)))
	};
}

function validateChanges(element, locale, changes) {
	if (!changes || typeof changes !== "object" || Array.isArray(changes) || !Object.keys(changes).length ||
		Object.entries(changes).some(([field, value]) => !allowed.has(field) || typeof value !== "string" || value.length > 20000)) {
		throw new TypeError("Invalid change proposal");
	}
	if (!(element instanceof STWContent) && ("query" in changes || "layout" in changes)) {
		throw new TypeError("Only content elements have a query or layout");
	}
	if (element.type !== "Page" && "description" in changes) {
		throw new TypeError("Description can only be saved on pages");
	}
	if ("slug" in changes && (!changes.slug || changes.slug !== normalizeSlug(changes.slug))) {
		throw new TypeError("Slug must contain only lowercase letters, digits, underscores, hyphens or periods");
	}
	const definition = serializeSTWElement(element);
	definition.children = [];
	const shadow = element instanceof STWContent ? new element.constructor(definition) : new STWElement(definition);
	shadow.update({ lang: locale }, changes);
	for (const field of ["name", "slug", "description"]) {
		if (field in changes) shadow[field].set(locale, changes[field]);
	}
	return shadow;
}

function childOrCreate(document, parent, name) {
	const existing = children(parent, name);
	if (existing.length > 1) throw new Error(`Multiple ${name} elements in source`);
	if (existing.length) return existing[0];
	const node = document.createElementNS(parent.namespaceURI, name);
	parent.appendChild(node);
	return node;
}

function writeLocalized(document, node, field, locale, value) {
	const container = childOrCreate(document, node, field === "slug" ? "name" : field);
	const matches = children(container, "text").filter((text) => (text.getAttribute("xml:lang") || "en") === locale);
	if (matches.length > 1) throw new Error(`Duplicate ${field} locale in source`);
	const text = matches[0] || document.createElementNS(node.namespaceURI, "text");
	if (!matches.length) {
		text.setAttribute("xml:lang", locale);
		container.appendChild(text);
	}
	if (field === "slug") text.setAttribute("slug", value);
	else text.textContent = value;
}

function applyPersistentChanges(element, locale, changes, revision) {
	if (isProtectedWebbaselet(element)) throw new Error("Deployed webbaselets are read-only");
	const shadow = validateChanges(element, locale, changes);
	const source = sourceFor(element.uuid);
	if (source.path !== revision.path || hash(source.source) !== revision.sourceHash ||
		hash(JSON.stringify(serializeSTWElement(element))) !== revision.elementHash) {
		throw new AssistantConflictError("The element or WBOL source changed since the proposal; request a new proposal");
	}
	const definition = findDefinition(WBOL(source.source), element.uuid);
	if (!definition) throw new Error("Element not found in WBOL source");
	for (const field of Object.keys(changes)) {
		const value = field === "query" ? element.query : element[field]?.get(locale);
		const current = field === "query" ? value || "" : typeof value === "string" ? value : value?.wbll || "";
		if (definitionValue(definition, field, locale) !== current) {
			throw new AssistantConflictError(`The running ${field} differs from its WBOL source; save or reload first`);
		}
	}
	for (const [field, value] of Object.entries(changes)) {
		if (field === "query") {
			const query = children(source.node, "query");
			if (query.length !== 1) throw new Error("The source must contain exactly one query to edit it");
			query[0].textContent = value;
		} else {
			writeLocalized(source.document, source.node, field, locale, value);
		}
	}
	const xml = new XMLSerializer().serializeToString(source.document);
	const updated = findDefinition(WBOL(xml), element.uuid);
	if (!updated || Object.entries(changes).some(([field, value]) => definitionValue(updated, field, locale) !== value)) {
		throw new Error("WBOL source did not round-trip the proposed changes");
	}
	const temporary = join(dirname(source.path), `.stw-assistant-${randomUUID()}.tmp`);
	try {
		writeFileSync(temporary, xml, { flag: "wx", mode: statSync(source.path).mode });
		if (hash(readFileSync(source.path, "utf8")) !== revision.sourceHash) throw new AssistantConflictError("WBOL source changed while saving");
		renameSync(temporary, source.path);
	} finally {
		if (existsSync(temporary)) unlinkSync(temporary);
	}
	for (const field of Object.keys(changes)) {
		if (field === "query") element.query = shadow.query;
		else element[field] = shadow[field];
	}
	element.modified = Date.now();
}

export { applyPersistentChanges, AssistantConflictError, captureRevision, validateChanges };
