/**
 * @fileoverview Holds the server-side state for one Webspinner client session.
 *
 * STWSession tracks the session identity, remote address, user and role defaults,
 * language and timezone preferences, linked portal, and development mode. It also
 * stores per-session placeholders populated from request query parameters, cookies,
 * headers, and rendered records; per-tab WebSocket connections; and stateful content
 * values. Sessions are removed after their final WebSocket closes and the grace
 * period expires, if no socket reconnects.
 *
 * @author Giancarlo Trevisan
 * @version 1.0.0
 * @module stwSession
 * @note Copilot-assisted
 * @license Apache-2.0
 */
import { getCookies } from "./stwNode.js";
import { debugLog, envGet, readBooleanSetting } from "./stwConfig.js";
import { PlaceholderMap } from "./stwWBPL.js";

class STWSession {
	sessionId;
	remoteAddr;
	baseurl = ""; // Base URL of the application (used to generate absolute URLs)
	user; // User name
	name; // Full name
	loginId; // Persistent user ID
	roles; // Roles played by the user. IMPORTANT: Security revolves around this aspect!
	langs; // Accepted user languages (Accept-Language)
	tz; // Timezone of the user
	placeholders;
	dev; // If true STW Studio enabled
	portal;
	sockets = new Map(); // per-tab sockets
	states;

	constructor(sessionId, remoteAddr, portal) {
		this.sessionId = sessionId;
		this.remoteAddr = remoteAddr;
		this.baseurl = envGet("HOST") || "";
		this.user = "guest";
		this.name = "Guest";
		this.loginId = "-3";
		this.roles = ["guest"];
		this.placeholders = new PlaceholderMap();
		this.portal = portal;
		this.setLanguage(portal?.langs?.[0] || "en", false);
		this.setApplicationPlaceholders();
		this.langs = ["en"];
		this.tz = "UTC";
		this.setLoginPlaceholders();
		this.dev = false;
		this.states = new Map();
		this.sockets = new Map();
		debugLog(`${(new Date()).toISOString()}: New session ${JSON.stringify(this.remoteAddr)} [${this.sessionId}]`);
	}

	setLanguage(language, explicit) {
		this.placeholders.set("@@stwlanguage", language);
		this.placeholders.set("@@stwdefaultlanguage", this.portal?.langs?.[0] || "en");
		if (explicit !== undefined)
			this.languageExplicit = explicit;
	}

	setApplicationPlaceholders() {
		this.placeholders.set("@@stwallow_ai", readBooleanSetting("ALLOW_AI") ? "true" : "false");
	}

	/**
    * @param name Name of the placeholder, it has to start with either \@ (Querystring parameters or Cookie value), 
    * \@@ (Recordset Field, Session, Application or Server variables)
    * @returns The value of placeholder
    */
	getPlaceholder(name) {
		return this.placeholders.get(name.toLowerCase()) || "";
	}

	/**
	 * Adds the always-defined WBPL placeholders for the current login identity.
	 *
	 * @returns {void}
	 */
	setLoginPlaceholders() {
		this.placeholders.set("@@stwlogin", this.user);
		this.placeholders.set("@@stwloginname", this.name);
		this.placeholders.set("@@stwloginid", this.loginId.toString());
	}

	/**
    * Placeholders reppresent server side data accessible to contents. Each request received by the server resets the placeholder,
    * then, the content being rendered cycles each record of the record set. 
    * 
    * @param obj Can be a request a string or an object (a row of a record set)
    * @param value The value assigned obj if it is a string
    */
	setPlaceholders(obj, value = "") {
		if (obj instanceof Request) {
			const language = this.placeholders.get("@@stwlanguage");
			this.placeholders.clear();
			const url = new URL(obj.url);
			url.searchParams.forEach((value2, key) => this.placeholders.set(`@${key.toLowerCase()}`, value2));
			const cookies = getCookies(obj.headers);
			Object.keys(cookies).forEach((key) => this.placeholders.set(`@${key.toLowerCase()}`, cookies[key]));
			this.placeholders.set("@@query_string", url.search.slice(1));
			for (const [key, value2] of obj.headers)
				this.placeholders.set(`@@${key.toLowerCase()}`, value2);
			this.setLoginPlaceholders();
			this.setLanguage(language);
			this.setApplicationPlaceholders();
		} else if (typeof obj === "string")
			this.placeholders.set(`@@${obj.toLowerCase()}`, value);
		else
			Object.keys(obj).forEach((key) => this.placeholders.set(`@@${key.toLowerCase()}`, obj[key]));
	}
}

export {
	STWSession
};
