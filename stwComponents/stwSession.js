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
import { debugLog, envGet } from "./stwConfig.js";

class STWSession {
	sessionId;
	remoteAddr;
	baseurl = ""; // Base URL of the application (used to generate absolute URLs)
	user; // User name
	name; // Full name
	loginId; // Persistent user ID
	roles; // Roles played by the user. IMPORTANT: Security revolves around this aspect!
	lang; // Preferred user language (this language is used to render contents based on the accepted and available portal languages)
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
		this.placeholders = new Map();
		this.setLanguage("en");
		this.langs = ["en"];
		this.tz = "UTC";
		this.setLoginPlaceholders();
		this.dev = false;
		this.portal = portal;
		this.states = new Map();
		this.sockets = new Map();
		debugLog(`${(new Date()).toISOString()}: New session ${JSON.stringify(this.remoteAddr)} [${this.sessionId}]`);
	}

	setLanguage(language) {
		this.lang = language;
		this.placeholders.set("@@stwlanguage", language);
	}

	/**
    * @param name Name of the placeholder, it has to start with either \@ (Querystring parameters or Cookie value), 
    * \@@ (Recordset Field, Session, Application or Server variables)
    * @returns The value of placeholder
    */
	getPlaceholder(name) {
		return this.placeholders.get(name) || "";
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
			this.placeholders.clear();
			const url = new URL(obj.url);
			url.searchParams.forEach((value2, key) => this.placeholders.set(`@${key}`, value2));
			const cookies = getCookies(obj.headers);
			Object.keys(cookies).forEach((key) => this.placeholders.set(`@${key}`, cookies[key]));
			this.placeholders.set("@@query_string", url.search.slice(1));
			for (const [key, value2] of obj.headers)
				this.placeholders.set(`@@${key}`, value2);
			this.setLoginPlaceholders();
			this.placeholders.set("@@stwlanguage", this.lang);
		} else if (typeof obj === "string")
			this.placeholders.set(`@@${obj}`, value);
		else
			Object.keys(obj).forEach((key) => this.placeholders.set(`@@${key}`, obj[key]));
	}
}

export {
	STWSession
};
