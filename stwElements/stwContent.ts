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
 * @requires ../stwComponents/stwDBAdapters/adapter.ts
 * @requires ../stwComponents/stwDatasources.ts
 * @requires ../stwComponents/stwSession.ts
 * @requires ./stwElement.ts
 * @requires ../stwComponents/stwWBLL.ts
 * @requires ../stwComponents/stwWBPL.ts
 * @requires ../stwComponents/stwResponse.ts
 * @license GPL-3.0-or-later
 */

import { ISTWRecords } from "../stwComponents/stwDBAdapters/adapter.ts";
import { STWDatasources } from "../stwComponents/stwDatasources.ts";
import type { STWSession } from "../stwComponents/stwSession.ts";
import { ISTWElement, STWElement, STWLocalized } from "./stwElement.ts";
import { STWLayout } from "../stwComponents/stwWBLL.ts";
import { secureResponse } from "../stwComponents/stwResponse.ts";
import { debugLog } from "../stwComponents/stwConfig.ts";

/**
 * The contents that use this interface are: {@linkcode STWMenus} and {@linkcode STWTabs}
 *
 * @prop name: STWLocalized
 * @prop ref?: string
 * @prop options?: ISTWOption[]
 */
export interface ISTWOption {
	name: STWLocalized;
	ref?: string;
	parameters?: string;
	options?: ISTWOption[];
}
export interface ISTWContentWithOptions extends ISTWContent<any, any, any> {
	options: ISTWOption[];
}

export interface ISTWContent<TRow = Record<string, unknown>, TState = unknown, TRecords extends ISTWRecords = ISTWRecords> extends ISTWElement<any> { // extra handled by base element
	subtype: string;
	cssClass: string;
	section: string;
	sequence: number;
	dsn: string;
	query: string;
	params: string;
	layout: object;
	stateful?: boolean;
	cache?: number; // Cache duration in seconds. -1 for forever, 0 or undefined for no cache.
	contentType?: string; // Optional MIME type override (default text/html)
}
export abstract class STWContent<
	TRow = Record<string, unknown>,
	TState = unknown,
	TRecords extends ISTWRecords = ISTWRecords
> extends STWElement<any> {
	override readonly type: string;
	cssClass: string;
	section: string;
	sequence: number;
	dsn: string;
	query: string;
	params: string;
	protected layout!: Map<string, STWLayout>;
	readonly stateful: boolean;
	readonly cache: number;
	contentType: string;

	public constructor(content: ISTWContent<TRow, TState, TRecords>, _settings?: { [key: string]: string }) {
		super(content);

		this.type = content.subtype;
		this.cssClass = content.cssClass || "";
		this.section = content.section || "";
		this.sequence = content.sequence || 0.0;
		this.dsn = content.dsn || "";
		this.query = content.query || "";
		this.params = content.params || "";
		this.stateful = content.stateful || false;
		this.cache = content.cache || 0;
		this.contentType = content.contentType || "text/html; charset=utf-8"; // marker property used for duck-typing

		if (!["Text", "ClientScript", "Shortcut"].includes(this.type) && content.layout) {
			this.layout = new Map<string, STWLayout>();
			for (const [lang, wbll] of Object.entries(content.layout)) {
				try {
					this.layout.set(lang, new STWLayout(wbll));
				} catch (error) {
					throw SyntaxError(`${this.type} (${this.name.entries().next().value}) §${this.section}.${this.sequence} [${this.uuid}]\n └ Layout: ${(error as Error).message}`);
				}
			}
		} else if (content.layout) {
			this.layout = new Map<string, STWLayout>(Object.entries(content.layout || {}));
		}
	}

	public override toLocalizedJSON(session: STWSession): object {
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
			contentType: this.contentType,
		};
	}

	public getLayout(session: STWSession, defaultLayout = ""): STWLayout {
		let layout = this.layout?.get(session.lang);
		if (!layout || (layout.justSettings && defaultLayout)) {
			layout = new STWLayout((layout?.wbll || "") + defaultLayout);
			this.layout = new Map<string, STWLayout>();
			this.layout.set(session.lang, layout);
		}
		return layout;
	}

	public override localize(
		session: STWSession,
		name: "name" | "slug" | "keywords" | "description",
		value: string = "",
	): string {
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
	public getState(session: STWSession): TState | undefined {
		return this.stateful ? session.states?.get(this.uuid) as TState : undefined;
	}

	/**
	 * Saves the state of this content for the given session.
	 * The state is stored in the session object.
	 * @param session The current user session.
	 * @param state The state object to save.
	 */
	public setState(session: STWSession, state: TState): void {
		if (this.stateful) {
			if (!session.states) session.states = new Map<string, any>();
			session.states.set(this.uuid, state);
		}
	}

	public override async serve(request: Request, session: STWSession, ref: STWContent | undefined): Promise<Response> {
		if (!ref && !this.isVisible(session))
			return secureResponse(null, { status: 204 }); // 204 No content

		if (ref) {
			debugLog(
				`${new Date().toISOString()}: ${ref.uuid === this.uuid ? " ●" : "│└"} ${this.type} (${this.pathname(session)
				}) §${this.section}.${this.sequence} [${this.uuid}]`,
			);
		} else {
			debugLog(
				`${new Date().toISOString()}: ├─ ${this.type} (${this.pathname(session)
				}) §${this.section}.${this.sequence} [${this.uuid}]`,
			);
		}

		let settings: Map<string, string | number | boolean>, HTML: string, records: TRecords;
		const layout = this.getLayout(session);
		try {
			// Load data set
			records = await STWDatasources.command(session, this) as TRecords;

			// Transfer first record to placeholders
			const placeholders = new Map(session.placeholders);
			if (records.rows.length)
				records.fields.forEach(field => placeholders.set(`@@${field}`, records.rows[0]?.[field] || ""));
			
			// Determine content settings
			settings = (await layout.render(records.fields, placeholders, session)).settings;

			// Determine content visibility
			if (settings.get("visible") === "false")
				return secureResponse(null, { status: 204 }); // 204 No content

			// Render
			HTML = await this.render(request, session, records);

			if (!HTML) {
				HTML = settings.has("nodata") ? `<article id="${this.uuid}" data-sequence="${this.sequence}" class="stwNoData">${settings.get("nodata") || ""}</article>` : "";
			} else {
				HTML = `<article tabindex="0" id="${this.uuid}" data-sequence="${this.sequence}" class="${(ref || this).cssClass || "stw" + this.type}">
					${settings.has("caption") ? `<h1>${collapsible()}${settings.get("caption") || ""}${closable(this.section)}</h1>` : "" }
					${settings.has("header") ? `<header>${settings.get("header") || ""}</header>` : ""}
					${HTML}
					${settings.has("footer") ? `<footer>${settings.get("footer") || ""}</footer>` : ""}
				</article>`;
			}
		} catch (error) {
			const safeStringify = (obj: any) => {
				const keys = ["subtype", "cssClass", "section", "sequence", "dsn", "command", "params", "layout"];
				const filtered: Record<string, unknown> = {};
				for (const key of keys) {
					filtered[key] = obj[key];
				}
				return JSON.stringify(filtered, null, 2);
			};
			HTML = `<article tabindex="0" id="${this.uuid}" data-sequence="${this.sequence}" class="stwError">
				<h1><i class="fa-light fa-bug"></i> Error</h1>
				<header>${(error as Error).message}</header>
				<pre>${safeStringify(this)}</pre>
			</article>`;
		}

		const data = {
			method: "PUT",
			id: this.uuid,
			section: (ref || this).section,
			sequence: (ref || this).sequence,
			body: HTML,
		};
		return secureResponse(JSON.stringify(data), { headers: { "Content-Type": this.contentType } });

		function collapsible(): string {
			return settings.has("collapsible")
				? `<i class="fa-light fa-angle-down" onclick="stwToggleCollapse(event)"></i> `
				: "";
		}
		function closable(section: string): string {
			return section.startsWith("stwShow") ? ` <i class="fa-light fa-xmark" onclick="this.closest('dialog').close()" style="float:right"></i>` : "";
		}
	}

	// deno-lint-ignore require-await
	public async render(_request: Request, _session: STWSession, _record: TRecords): Promise<string> {
		return `Render ${this.constructor.name}`;
	}

	public override update(session: STWSession, data: any): void {
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
