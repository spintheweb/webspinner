/**
 * @fileoverview Identifies project webbaselets and enforces deployment access.
 *
 * @author Copilot
 * @module stwWebbaselets
 * @license Apache-2.0
 */
import { envGet } from "./stwConfig.js";

const webbaselets = new WeakMap();

function registerWebbaselet(element, kind) {
	webbaselets.set(element, kind);
}

function webbaseletKind(element) {
	for (let current = element; current; current = current.parent) {
		const kind = webbaselets.get(current);
		if (kind) return kind;
	}
	return undefined;
}

function isDeployed() {
	const value = envGet("DEPLOYED", "true").trim().toLowerCase();
	if (value !== "true" && value !== "false") throw new TypeError('DEPLOYED must be "true" or "false"');
	return value === "true";
}

function isProtectedWebbaselet(element) {
	return isDeployed() && Boolean(webbaseletKind(element));
}

function canDevelopElement(session, element) {
	return session.roles.includes("developer") &&
		(Boolean(webbaseletKind(element)) || Boolean(element.isVisible(session, "developer") & 1));
}

export { registerWebbaselet, webbaseletKind, isDeployed, isProtectedWebbaselet, canDevelopElement };
