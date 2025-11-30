// SPDX-License-Identifier: GPL-3.0-or-later
// Spin the Web element: stwContent

import { ISTWRecords } from "../stwComponents/stwDBAdapters/adapter.ts";
import { STWDatasources } from "../stwComponents/stwDatasources.ts";
import type { STWSession } from "../stwComponents/stwSession.ts";
import { ISTWElement, STWElement, STWLocalized } from "./stwElement.ts";
import { STWLayout } from "../stwComponents/stwWBLL.ts";
import { wbpl } from "../stwComponents/stwWBPL.ts";
import { secureResponse } from "../stwComponents/stwResponse.ts";

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
	command: string;
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
	command: string;
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
		this.command = content.command || "";
		this.params = content.params || "";
		this.stateful = content.stateful || false;
		this.cache = content.cache || 0;
		this.contentType = content.contentType || "text/html; charset=utf-8"; // marker property used for duck-typing

		if (!["Text", "ClientScript", "Shortcut"].includes(this.type) && content.layout) {
			this.layout = new Map();
			for (const [lang, wbll] of Object.entries(content.layout)) {
				try {
					this.layout.set(lang, new STWLayout(wbll));
				} catch (error) {
					throw SyntaxError(
						`${this.type} (${this.name.entries().next().value}) §${this.section}.${this.sequence} [${this._id}]\n └ Layout: ${
							(error as Error).message
						}`,
					);
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
			command: this.command,
			params: this.params,
			layout: this.layout.get(session.lang)?.wbll || "",
			contentType: this.contentType,
		};
	}

	public getLayout(session: STWSession): STWLayout {
		return this.layout.get(session.lang) || new STWLayout("");
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
		return this.stateful ? session.states?.get(this._id) as TState : undefined;
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
			session.states.set(this._id, state);
		}
	}

	public override async serve(req: Request, session: STWSession, ref: STWContent | undefined): Promise<Response> {
		if (!ref && !this.isVisible(session)) {
			return new Promise<Response>((resolve) => resolve(secureResponse(null, { status: 204 }))); // 204 No content
		}

		if (ref) {
			console.debug(
				`${new Date().toISOString()}: ${ref._id === this._id ? " ●" : "│└"} ${this.type} (${
					this.pathname(session)
				}) §${this.section}.${this.sequence} [${this._id}]`,
			);
		} else {
			console.debug(
				`${new Date().toISOString()}: ├─ ${this.type} (${
					this.pathname(session)
				}) §${this.section}.${this.sequence} [${this._id}]`,
			);
		}

		const layout = this.layout?.get(session.lang);

		let bodyHtml = "", records: TRecords;
		try {
			records = await STWDatasources.command(session, this) as TRecords;

			const placeholders = new Map(session.placeholders);
			if (records.rows?.length) {
				for (const [name, value] of Object.entries(records.rows[0])) {
					placeholders.set(`@@${name}`, String(value));
				}
			}

			bodyHtml = await this.render(req, session, records);

			if (!bodyHtml) {
				bodyHtml = layout?.settings.has("nodata")
					? `<article id="${this._id}" data-sequence="${this.sequence}" class="stwNoData">${
						wbpl(layout?.settings.get("nodata") || "", placeholders)
					}</article>`
					: "";
			} else {
				bodyHtml = `<article tabindex="0" id="${this._id}" data-sequence="${this.sequence}" class="${
					(ref || this).cssClass || "stw" + this.type
				}">
					${
					layout?.settings.has("caption")
						? `<h1>${collapsible()}${wbpl(layout?.settings.get("caption") || "", placeholders)}${
							closable(this.section)
						}</h1>`
						: ""
				}
					<div>
					${
					layout?.settings.has("header")
						? `<header>${wbpl(layout?.settings.get("header") || "", placeholders)}</header>`
						: ""
				}
					${bodyHtml}
					${
					layout?.settings.has("footer")
						? `<footer>${wbpl(layout?.settings.get("footer") || "", placeholders)}</footer>`
						: ""
				}
					</div>
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
			bodyHtml = `<article tabindex="0" id="${this._id}" data-sequence="${this.sequence}" class="stwError">
				<h1><i class="fa-light fa-bug"></i> Error</h1>
				<header>${(error as Error).message}</header>
				<pre>${safeStringify(this)}</pre>
			</article>`;
		}

		const data = {
			method: "PUT",
			id: this._id,
			section: (ref || this).section,
			sequence: (ref || this).sequence,
			body: bodyHtml,
		};
		if (layout?.settings.get("visible") === "false") {
			return new Promise<Response>((resolve) => resolve(secureResponse(null, { status: 204 }))); // 204 No content
		}
		return new Promise<Response>((resolve) =>
			resolve(secureResponse(JSON.stringify(data), { headers: { "Content-Type": this.contentType } }))
		);

		function collapsible(): string {
			return layout?.settings.has("collapsible")
				? `<i class="fa-light fa-angle-down" onclick="stwToggleCollapse(event)"></i> `
				: "";
		}
		function closable(section: string): string {
			return section.startsWith("stwShow")
				? ` <i class="fa-light fa-xmark" onclick="this.closest('dialog').close()" style="float:right"></i>`
				: "";
		}
	}

	public async render(_req: Request, _session: STWSession, _record: TRecords): Promise<string> {
		return await Promise.resolve(`Render ${this.constructor.name}`);
	}

	public override update(session: STWSession, data: any): void {
		super.update(session, data);

		this.cssClass = data.cssClass || this.cssClass;
		this.section = data.section || this.section;
		this.sequence = data.sequence || this.sequence;
		this.dsn = data.dsn || this.dsn;
		this.command = data.command || this.command;
		this.params = data.params || this.params;
		this.contentType = data.contentType || this.contentType;

		if (data.layout) {
			this.layout.set(session.lang, new STWLayout(data.layout));
		}
	}
}
