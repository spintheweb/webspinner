// SPDX-License-Identifier: GPL-3.0-or-later
// Spin the Web component: stwSession

import { getCookies } from "@std/http/cookie";
import { STWSite } from "../stwElements/stwSite.ts";
import { envGet } from "./stwConfig.ts";

export class STWSession {
	sessionId: string;
	remoteAddr: Deno.Addr;
	user: string; // User name
	name!: string; // Full name
	roles: string[]; // Roles played by the user. Note: Security revolves around this aspect!
	lang: string; // Preferred user language (this language is used to render contents based on the accepted and available site languages)
	langs: string[]; // Accepted user languages (Accept-Language)
	tz: string; // Timezone of the user
	placeholders: Map<string, string>;
	timestamp: number; // Session timeout in minutes
	private timer: number = 0;
	dev: boolean; // If true STW Studio  enabled
	site: STWSite;
	public sockets: Map<string, WebSocket> = new Map(); // per-tab sockets
	public states: Map<string, any>;

	public constructor(sessionId: string, remoteAddr: Deno.Addr, site: STWSite) {
		this.sessionId = sessionId;
		this.remoteAddr = remoteAddr;
		this.user = "guest";
		this.roles = ["guests","developers"]; // Default roles
		this.lang = "en";
		this.langs = ["en"];
		this.tz = "UTC"; // Default timezone
		this.placeholders = new Map<string, string>;
		this.timestamp = Date.now();
		this.dev = true;
		this.site = site;
		this.states = new Map<string, any>();
		this.sockets = new Map();

		console.log(`${new Date().toISOString()}: New session ${JSON.stringify(this.remoteAddr)} [${this.sessionId}]`);
	}

	/**
	 * @param name Name of the placeholder, it has to start with either \@ (Cookie or Querystring), \@@ (Record) or \@@@ (Headers)
	 * @returns The value of placeholder
	 */
	getPlaceholder(name: string): string {
		return this.placeholders.get(name) || "";
	}
	/**
	 * Placeholders reppresent server side data accessible to contents. Each request received by the server resets the placeholder,
	 * then, the content being rendered cycles each record of the record set. 
	 * 
	 * @param _obj Can be a request a string or an object (a row of a record set)
	 * @param _value The value assigned _obj it it is a string
	 */
	// deno-lint-ignore no-explicit-any
	setPlaceholders(_obj: Request | string | any, _value: string = ""): void {
		if (_obj instanceof Request) {
			this.placeholders.clear();

			(new URL(_obj.url)).searchParams.forEach((value, key) => this.placeholders.set(`@${key}`, value));

			const cookies = getCookies(_obj.headers);
			Object.keys(cookies).forEach(key => this.placeholders.set(`@${key}`, cookies[key]))

			for (const [key, value] of _obj.headers)
				this.placeholders.set(`@@@${key}`, value);

		} else if (typeof _obj === "string")
			this.placeholders.set(`@@${_obj}`, _value);

		else
			Object.keys(_obj).forEach(key => this.placeholders.set(`@@${key}`, _obj[key]))
	}

	protected timeout(timer: number) {
		clearTimeout(timer);
		console.log(`${new Date().toISOString()}: Want to keep the session [${this.sessionId}] alive?`);

		this.timer = setTimeout(() => this.timeout(this.timer), parseInt(envGet("TIMEOUT") || "15") * 60000); // Session timeout
	}
}
// STWFactory has been moved to stwFactory.ts; import from there where needed.
