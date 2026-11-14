/**
 * @fileoverview Holds the server-side state for one Webspinner client session.
 *
 * STWSession tracks the session identity, remote address, user and role defaults,
 * language and timezone preferences, linked portal, and development mode. It also
 * stores per-session placeholders populated from request query parameters, cookies,
 * headers, and rendered records; per-tab WebSocket connections; and stateful content
 * values. The timeout method refreshes the session's inactivity timer using the
 * configured TIMEOUT in minutes (15 minutes by default).
 *
 * @module stwSession
 */
import { getCookies } from "./stwNode.js";
import { debugLog, envGet } from "./stwConfig.js";

class STWSession {
	sessionId;
	remoteAddr;
	baseurl = ""; // Base URL of the application (used to generate absolute URLs)
	user; // User name
	name; // Full name
	roles; // Roles played by the user. IMPORTANT: Security revolves around this aspect!
	lang; // Preferred user language (this language is used to render contents based on the accepted and available portal languages)
	langs; // Accepted user languages (Accept-Language)
	tz; // Timezone of the user
	placeholders;
	timestamp; // Session timeout in minutes
	timer = 0;
	dev; // If true STW Studio enabled
	portal;
	sockets = new Map(); // per-tab sockets
	states;

	constructor(sessionId, remoteAddr, portal) {
		this.sessionId = sessionId;
		this.remoteAddr = remoteAddr;
		this.baseurl = envGet("HOST") || "";
		this.user = "guest";
		this.roles = ["guest"];
		this.lang = "en";
		this.langs = ["en"];
		this.tz = "UTC";
		this.placeholders = new Map();
		this.timestamp = Date.now();
		this.dev = false;
		this.portal = portal;
		this.states = new Map();
		this.sockets = new Map();
		debugLog(`${(new Date()).toISOString()}: New session ${JSON.stringify(this.remoteAddr)} [${this.sessionId}]`);
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
		} else if (typeof obj === "string")
			this.placeholders.set(`@@${obj}`, value);
		else
			Object.keys(obj).forEach((key) => this.placeholders.set(`@@${key}`, obj[key]));
	}
	timeout(timer) {
		clearTimeout(timer);
		debugLog(`${(new Date()).toISOString()}: Want to keep the session [${this.sessionId}] alive?`);
		this.timer = setTimeout(() => this.timeout(this.timer), parseInt(envGet("TIMEOUT") || "15") * 6e4);
	}
}

export {
	STWSession
};
