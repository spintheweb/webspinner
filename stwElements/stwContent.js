/**
 * @fileoverview Defines the abstract Spin the Web content element.
 *
 * Provides shared content metadata, localized layout handling, session state,
 * connector execution, response rendering, visibility behavior, and runtime
 * updates for concrete content elements.
 *
 * @author Giancarlo
 * @version 1.0.0
 * @module stwContent
 * @requires ../stwComponents/stwConnectors.js
 * @requires ../stwComponents/stwSession.js
 * @requires ./stwElement.js
 * @requires ../stwComponents/stwWBLL.js
 * @requires ../stwComponents/stwWBPL.js
 * @requires ../stwComponents/stwResponse.js
 * @note Copilot-assisted
 * @license Apache-2.0
 */
import { STWConnectors } from "../stwComponents/stwConnectors.js";
import { normalizeSlug, STWElement } from "./stwElement.js";
import { STWLayout } from "../stwComponents/stwWBLL.js";
import { secureResponse } from "../stwComponents/stwResponse.js";
import { debugLog } from "../stwComponents/stwConfig.js";
import { localizedEntry, localizedValue } from "../stwComponents/stwLocalization.js";

class STWContent extends STWElement {
	#layoutErrors = new Map();
	type;
	cssClass;
	section;
	sequence;
	connector;
	query;
	params;
	layout;
	stateful;
	contentType;

	constructor(content, _settings) {
		super(content);
		this.type = content.subtype;
		this.cssClass = content.class || "";
		this.section = content.section || "";
		this.sequence = content.sequence || 0;
		this.connector = content.connector || "";
		this.query = content.query || "";
		this.params = content.params || "";
		this.stateful = content.stateful || false;
		this.contentType = content.contentType || "text/html; charset=utf-8";

		if (!["Text", "ClientScript", "Shortcut"].includes(this.type) && content.layout) {
			this.layout = new Map();
			for (const [lang, wbll] of Object.entries(content.layout)) {
				try {
					this.layout.set(lang, new STWLayout(wbll));
				} catch (error) {
					this.layout.set(lang, { wbll });
					this.#layoutErrors.set(lang, new SyntaxError(`${this.type} (${this.name.entries().next().value}) \xA7${this.section}.${this.sequence} [${this.uuid}] \u2514 Layout: ${error.message}`));
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
			connector: this.connector,
			command: this.query,
			params: this.params,
			layout: localizedValue(this.layout, session),
			contentType: this.contentType
		};
	}

	getLayout(session, defaultLayout = "") {
		const [language, selected] = localizedEntry(this.layout, session) || [];
		const layoutError = this.#layoutErrors.get(language);
		if (layoutError) throw layoutError;
		if (!selected || selected.justSettings && defaultLayout)
			return new STWLayout((selected?.wbll || "") + defaultLayout);
		return selected;
	}

	localize(session, name, value = "") {
		if (value) {
			value = name === "slug" ? normalizeSlug(value) : value;
			this[name].set(session.placeholders.get("@@stwlanguage"), value);
			return value;
		}
		return localizedValue(this[name], session) ?? "";
	}

	async serve(request, session, ref) {
		if (!(this.isVisible(session) & 1) || (ref && !(ref.isVisible(session) & 1)))
			return secureResponse(null, { status: 204 });
		if (ref) {
			debugLog(
				`${(new Date()).toISOString()}: ${ref.uuid === this.uuid ? " \u25CF" : "\u2502\u2514"} ${this.pathname(session)}  ${this.type}@${this.section ? `${this.section}.${this.sequence}` : "embedded"} [${this.uuid}]`
			);
		} else {
			debugLog(
				`${(new Date()).toISOString()}: \u251C\u2500 ${this.pathname(session)}  ${this.type}@${this.section ? `${this.section}.${this.sequence}` : "embedded"} [${this.uuid}]`
			);
		}
		let settings, HTML, records;
		try {
			const layout = this.getLayout(session);
			records = await STWConnectors.command(session, this);
			records.fields = records.fields.filter((field) => !field.toLowerCase().startsWith("stw"));
			const placeholders = new Map(session.placeholders);
			placeholders.set("@@stwrows", String(records.rows.length));
			if (records.rows.length)
				records.fields.forEach((field) => {
					const value = records.rows[0]?.[field];
					placeholders.set(`@@${field.toLowerCase()}`, value === 0 ? "0" : value || "");
				});
			settings = (await layout.render(records.fields, placeholders, session)).settings;
			if (settings.get("visible") === "false")
				return secureResponse(null, { status: 204 });
			HTML = await this.render(request, session, records, placeholders);
			if (HTML?.includes("data-stw-action-token") && !/<form\b/i.test(HTML)) {
				HTML = `<form id="stwFA${this.uuid}"><input type="hidden" name="stwOrigin" value="${this.uuid}"></form>${HTML}`;
			}
			if (!HTML) {
				HTML = settings.has("nodata") ? `<article id="${this.uuid}" data-sequence="${this.sequence}" class="stwNoData">${settings.get("nodata") || ""}</article>` : "";
			} else {
				HTML = `<article tabindex="0" id="${this.uuid}" data-sequence="${this.sequence}" class="${(ref || this).cssClass || "stw" + this.type}">\n${settings.has("caption") ? `<h1${collapsible()}>${settings.get("caption")}${closable(this.section)}</h1>` : ""}\n${settings.has("header") ? `<header>${settings.get("header") || ""}</header>` : ""}\n<section>${HTML}</section>\n${settings.has("footer") ? `<footer>${settings.get("footer") || ""}</footer>` : ""}\n</article>`;
			}
		} catch (error) {
			return this.errorResponse(error, session, ref);
		}
		const data = {
			method: "PUT",
			pathname: this.pathname(session),
			id: this.uuid,
			section: (ref || this).section,
			sequence: (ref || this).sequence,
			error: false,
			body: HTML
		};
		return secureResponse(JSON.stringify(data), { headers: { "Content-Type": this.contentType } });
		function collapsible() {
			return settings.has("collapsible") ? ` class="stwExpanded" onclick="stwToggleCollapse(event)"` : "";
		}
		function closable(section) {
			return ["modal", "modeless"].includes(section) ? ` <i class="fa-light fa-xmark" onclick="this.closest('dialog').close()" style="float:right; cursor:pointer;"></i>` : "";
		}
	}

	async errorResponse(error, session, ref) {
		const { errorContent } = await import("../stwContents/stwError.js");
		return errorContent.serve(null, session, {
			content: this,
			section: (ref || this).section,
			sequence: (ref || this).sequence,
			error
		});
	}

	async render(_request, _session, _record) {
		return `Render ${this.constructor.name}`;
	}

	update(session, data) {
		const layout = typeof data.layout === "string"
			? ["Text", "ClientScript", "Shortcut"].includes(this.type) ? data.layout : new STWLayout(data.layout)
			: undefined;
		super.update(session, data);
		this.cssClass = data.cssClass ?? this.cssClass;
		this.section = data.section ?? this.section;
		this.sequence = data.sequence ?? this.sequence;
		this.connector = data.connector ?? this.connector;
		this.query = data.query ?? data.command ?? this.query;
		this.params = data.params ?? this.params;
		this.contentType = data.contentType ?? this.contentType;
		if (layout !== undefined) {
			this.layout ??= new Map();
			this.layout.set(session.placeholders.get("@@stwlanguage"), layout);
			this.#layoutErrors.delete(session.placeholders.get("@@stwlanguage"));
		}
	}
}

export {
	STWContent
};
