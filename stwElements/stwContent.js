/**
 * @fileoverview Defines the abstract Spin the Web content element.
 *
 * Provides shared content metadata, localized layout handling, session state,
 * datasource execution, response rendering, visibility behavior, and runtime
 * updates for concrete content elements.
 *
 * @author Giancarlo
 * @version 1.0.0
 * @module stwContent
 * @requires ../stwComponents/stwDBAdapters/adapter.js
 * @requires ../stwComponents/stwDatasources.js
 * @requires ../stwComponents/stwSession.js
 * @requires ./stwElement.js
 * @requires ../stwComponents/stwWBLL.js
 * @requires ../stwComponents/stwWBPL.js
 * @requires ../stwComponents/stwResponse.js
 * @license GPL-3.0-or-later
 */
import { STWDatasources } from "../stwComponents/stwDatasources.js";
import { STWElement } from "./stwElement.js";
import { STWLayout } from "../stwComponents/stwWBLL.js";
import { secureResponse } from "../stwComponents/stwResponse.js";
import { debugLog } from "../stwComponents/stwConfig.js";
class STWContent extends STWElement {
	type;
	cssClass;
	section;
	sequence;
	dsn;
	query;
	params;
	layout;
	stateful;
	cache;
	contentType;
	constructor(content, _settings) {
		super(content);
		this.type = content.subtype;
		this.cssClass = content.class || "";
		this.section = content.section || "";
		this.sequence = content.sequence || 0;
		this.dsn = content.dsn || "";
		this.query = content.query || "";
		this.params = content.params || "";
		this.stateful = content.stateful || false;
		this.cache = content.cache || 0;
		this.contentType = content.contentType || "text/html; charset=utf-8";
		if (!["Text", "ClientScript", "Shortcut"].includes(this.type) && content.layout) {
			this.layout = new Map();
			for (const [lang, wbll] of Object.entries(content.layout)) {
				try {
					this.layout.set(lang, new STWLayout(wbll));
				} catch (error) {
					throw SyntaxError(`${this.type} (${this.name.entries().next().value}) \xA7${this.section}.${this.sequence} [${this.uuid}]
 \u2514 Layout: ${error.message}`);
				}
			}
		} else if (content.layout) {
			this.layout = new Map(Object.entries(content.layout || {}));
		}
	}
	toLocalizedJSON(session) {
		return {
			...super.toLocalizedJSON(session),
			type: this.type,
			cssClass: this.cssClass,
			section: this.section,
			sequence: this.sequence,
			dsn: this.dsn,
			command: this.query,
			params: this.params,
			layout: this.layout.get(session.lang),
			contentType: this.contentType
		};
	}
	getLayout(session, defaultLayout = "") {
		let layout = this.layout?.get(session.lang);
		if (!layout || layout.justSettings && defaultLayout) {
			layout = new STWLayout((layout?.wbll || "") + defaultLayout);
			this.layout = new Map();
			this.layout.set(session.lang, layout);
		}
		return layout;
	}
	localize(session, name, value = "") {
		if (value) {
			value = name === "slug" ? value.replace(/[^a-z0-9_]/gi, "").toLowerCase() : value;
			this[name].set(session.lang, value);
			return value;
		}
		return this[name].get(session.lang) || "";
	}
	/**
    * Retrieves the state of this content for the given session.
    * The state is stored in the session object.
    * @param session The current user session.
    * @returns The state object, or undefined if not stateful or no state is set.
    */
	getState(session) {
		return this.stateful ? session.states?.get(this.uuid) : void 0;
	}
	/**
    * Saves the state of this content for the given session.
    * The state is stored in the session object.
    * @param session The current user session.
    * @param state The state object to save.
    */
	setState(session, state) {
		if (this.stateful) {
			if (!session.states) session.states = new Map();
			session.states.set(this.uuid, state);
		}
	}
	async serve(request, session, ref) {
		if (!ref && !this.isVisible(session))
			return secureResponse(null, { status: 204 });
		if (ref) {
			debugLog(
				`${(new Date()).toISOString()}: ${ref.uuid === this.uuid ? " \u25CF" : "\u2502\u2514"} ${this.type} (${this.pathname(session)}) \xA7${this.section}.${this.sequence} [${this.uuid}]`
			);
		} else {
			debugLog(
				`${(new Date()).toISOString()}: \u251C\u2500 ${this.type} (${this.pathname(session)}) \xA7${this.section}.${this.sequence} [${this.uuid}]`
			);
		}
		let settings, HTML, records;
		const layout = this.getLayout(session);
		try {
			records = await STWDatasources.command(session, this);
			records.fields = records.fields.filter((field) => !field.toLowerCase().startsWith("stw"));
			const placeholders = new Map(session.placeholders);
			if (records.rows.length)
				records.fields.forEach((field) => placeholders.set(`@@${field}`, records.rows[0]?.[field] || ""));
			settings = (await layout.render(records.fields, placeholders, session)).settings;
			if (settings.get("visible") === "false")
				return secureResponse(null, { status: 204 });
			HTML = await this.render(request, session, records);
			if (!HTML) {
				HTML = settings.has("nodata") ? `<article id="${this.uuid}" data-sequence="${this.sequence}" class="stwNoData">${settings.get("nodata") || ""}</article>` : "";
			} else {
				HTML = `<article tabindex="0" id="${this.uuid}" data-sequence="${this.sequence}" class="${(ref || this).cssClass || "stw" + this.type}">
       ${settings.has("caption") ? `<h1${collapsible()}>${settings.get("caption") || ""}${closable(this.section)}</h1>` : ""}
       ${settings.has("header") ? `<header>${settings.get("header") || ""}</header>` : ""}
       ${HTML}
       ${settings.has("footer") ? `<footer>${settings.get("footer") || ""}</footer>` : ""}
		</article>`;
			}
		} catch (error) {
			const safeStringify = (obj) => {
				const keys = ["subtype", "cssClass", "section", "sequence", "dsn", "command", "params", "layout"];
				const filtered = {};
				for (const key of keys) {
					filtered[key] = obj[key];
				}
				return JSON.stringify(filtered, null, 2);
			};
			HTML = `<article tabindex="0" id="${this.uuid}" data-sequence="${this.sequence}" class="stwError">
		<h1><i class="fa-light fa-bug"></i> Error</h1>
		<header>${error.message}</header>
		<pre>${safeStringify(this)}</pre>
    </article>`;
		}
		const data = {
			method: "PUT",
			id: this.uuid,
			section: (ref || this).section,
			sequence: (ref || this).sequence,
			body: HTML
		};
		return secureResponse(JSON.stringify(data), { headers: { "Content-Type": this.contentType } });
		function collapsible() {
			return settings.has("collapsible") ? ` class="stwExpanded" onclick="stwToggleCollapse(event)"` : "";
		}
		function closable(section) {
			return section.startsWith("stwShow") ? ` <i class="fa-light fa-xmark" onclick="this.closest('dialog').close()" style="float:right"></i>` : "";
		}
	}
	async render(_request, _session, _record) {
		return `Render ${this.constructor.name}`;
	}
	update(session, data) {
		super.update(session, data);
		this.cssClass = data.cssClass || this.cssClass;
		this.section = data.section || this.section;
		this.sequence = data.sequence || this.sequence;
		this.dsn = data.dsn || this.dsn;
		this.query = data.command || this.query;
		this.params = data.params || this.params;
		this.contentType = data.contentType || this.contentType;
		if (data.layout) {
			this.layout.set(session.lang, new STWLayout(data.layout));
		}
	}
}
export {
	STWContent
};
