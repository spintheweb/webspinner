// SPDX-License-Identifier: GPL-3.0-or-later
// Spin the Web element: stwElement

import type { STWSession } from "../stwComponents/stwSession.ts";
import { STWFactory } from "../stwComponents/stwFactory.ts";
import type { STWContent } from "./stwContent.ts";
import { STWIndex } from "./stwIndex.ts";
import { secureResponse } from "../stwComponents/stwResponse.ts";
import { newId } from "../stwComponents/stwIds.ts";

export type STWRole = string;
export type STWLocalized = Map<string, string>;
export type STWVisibility = Map<STWRole, boolean>;

export interface ISTWElement<TExtra = unknown> {
	_id: string;
	type: string;
	subtype: string;
	name: object;
	slug: object;
	keys: object;
	description: object;
	visibility: object;
	children: ISTWElement<any>[]; // heterogeneous children allowed
	modified: number;
	extra?: TExtra; // optional custom metadata/payload
}
export abstract class STWElement<TExtra = unknown> {
	_id: string;
	type: string;
	protected name: STWLocalized;
	protected slug: STWLocalized;
	protected keywords: STWLocalized;
	protected description: STWLocalized;
	visibility!: STWVisibility;
	parent!: STWElement<any>;
	children: STWElement<any>[] = [];
	modified: number;
	protected extra?: TExtra;

	public constructor(element: ISTWElement<TExtra>) {
		this._id = element._id ? element._id : newId();
		this.type = element.type || this.constructor.name.replace("STW", "");
		this.name = new Map(Object.entries(element.name || { "en": `New ${this.type}` }));
		this.slug = new Map(
			Object.entries(element.slug || { "en": `New ${this.type}`.replace(/[^a-z0-9_]/gi, "").toLowerCase() }),
		);
		this.keywords = new Map(Object.entries(element.keys || {}));
		this.description = new Map(Object.entries(element.description || {}));
		this.visibility = new Map(Object.entries(element.visibility || {}));
		this.modified = element.modified || Date.now();
		this.extra = element.extra;

		for (const child of element.children || []) {
			const constructor = STWFactory[child.subtype || child.type];
			if (constructor) {
				const elementInstance = new constructor(child);
				elementInstance.parent = this as unknown as STWElement<any>;
				this.children.push(elementInstance);

				STWIndex.set(elementInstance._id, elementInstance);
			}
		}
	}

	public getExtra(): TExtra | undefined { return this.extra; }
	public setExtra(extra: TExtra): void { this.extra = extra; this.modified = Date.now(); }

	/**
	 * @param session The session
	 * @returns Return a / separated reverse chain of slugs of this element up to the root element
	 */
	public pathname(session: STWSession): string {
		if (this.parent) {
			return this.parent.pathname(session) + "/" + this.localize(session, "slug");
		}
		return "";
	}

	public localize(
		session: STWSession,
		name: "name" | "slug" | "keywords" | "description",
		value: string = "",
	): string {
		if (value) {
			value = name === "slug" ? value.replace(/[^a-z0-9_]/gi, "").toLowerCase() : value;
			this[name].set(session.lang, value);
			return value;
		}
		return this[name].get(session.lang) || this[name].keys().next().value || "undefined";
	}

	public toLocalizedJSON(session: STWSession): object {
		return {
			_id: this._id,
			type: this.type,
			subtype: (this as any).subtype || this.type,
			name: this.localize(session, "name"),
			slug: this.localize(session, "slug"),
			keywords: this.localize(session, "keywords"),
			description: this.localize(session, "description"),
			visibility: Object.fromEntries(this.visibility),
			modified: this.modified,
			children: this.children.map((child) => child._id),
		};
	}

	/**
	 * Determines the Role Based Visibility of the element climbing up the webbase hierarchy if necessary.
	 * By default an element is not visible except for the site's mainpage. Given the session roles,
	 * apply a logical OR of these roles in element visiblity, if no role applies move to
	 * the element parent.
	 *
	 * @param session The session
	 * @returns Return a number greater than 0 if element visible
	 */
	public isVisible(session: STWSession, recurse: boolean = false): number {
		let ac!: number;

		if (session.site.mainpage === this._id) {
			ac = recurse ? 0b11 : 0b01; // Main site page always visible
		}

		for (let i = 0; ac != 0b01 && i < session.roles.length; ++i) {
			if (this.visibility.has(session.roles[i])) {
				ac |= this.visibility.get(session.roles[i]) ? 0b01 : 0b00;
			}
		}

		if (typeof ac === "undefined") {
			if (this.parent) {
				ac = 0b10 | this.parent.isVisible(session, true);
			} else if (["Site", "Area", "Page"].indexOf(this.type) === -1) { // Content
				ac = 0b10; // NOTE: this covers contents without a parent nor a RBV, it's in limbo!
			}
		}

		return ac || 0b00;
	}

	// Export element as XML
	public export(): string {
		let xml =
			`<${this.type} id="${this._id}" type="${this.type}" subtype="${this.type}" modified="${this.modified}">\n`;
		for (const [key, value] of Object.entries(this)) {
			if (key === "parent" || key === "children") {
				continue;
			}
			if (key === "visibility") {
				xml += `\t<${key}>\n`;
				for (const [role, visible] of Object.entries(value)) {
					xml += `\t\t<${role} ${visible ? 'visible="true"' : 'visible="false"'} />\n`;
				}
				xml += `\t</${key}>\n`;
			} else if (typeof value === "object") {
				xml += `\t<${key}>${JSON.stringify(value)}</${key}>\n`;
			} else {
				xml += `\t<${key}>${value}</${key}>\n`;
			}
		}

		return xml + `</${this.type}>\n`;
	}

	public update(session: STWSession, data: any): void {
		this.localize(session, "name", data.name || "");
		this.localize(session, "slug", data.slug || "");
		this.keywords.set(session.lang, data.keywords || "");
		this.description.set(session.lang, data.description || "");
		this.modified = Date.now();

		if (data.visibility) {
			this.visibility.clear();
			for (const [role, visible] of Object.entries(data?.visibility)) {
				if (typeof visible === "undefined" || visible === null) {
					this.visibility.delete(role);
				} else {
					this.visibility.set(role, true);
				}
			}
		}

		// TODO: children
	}

	public serve(_req: Request, _session: STWSession, _ref?: STWContent): Promise<Response> {
		return Promise.resolve(secureResponse("Not implemented", { status: 501 }));
	}
}
