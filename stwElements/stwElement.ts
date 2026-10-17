/**
 * @fileoverview Defines the base types and abstract element implementation
 * shared by Spin the Web portal elements.
 *
 * Builds element hierarchies through the factory, maintains localized metadata
 * and paths, evaluates role-based visibility, serializes elements, applies
 * updates, and provides the default response behavior for subclasses.
 *
 * @author Giancarlo
 * @version 1.0.0
 * @module stwElement
 * @requires ../stwComponents/stwSession.ts
 * @requires ../stwComponents/stwFactory.ts
 * @requires ./stwContent.ts
 * @requires ./stwIndex.ts
 * @requires ../stwComponents/stwResponse.ts
 * @requires ../stwComponents/stwIds.ts
 * @license GPL-3.0-or-later
 */

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
	uuid: string;
	type: string;
	subtype: string;
	name: object;
	slug: object;
	keywords: object;
	description: object;
	visibility: object;
	children: ISTWElement<any>[]; // heterogeneous children allowed
	modified: number;
	extra?: TExtra; // optional custom metadata/payload
}
export abstract class STWElement<TExtra = unknown> {
	uuid: string;
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
		this.uuid = element.uuid ? element.uuid : newId();
		this.type = element.type || this.constructor.name.replace("STW", "");
		this.name = new Map(Object.entries(element.name || { "en": `New ${this.type}` }));
		this.slug = new Map(Object.entries(element.slug || { "en": `New ${this.type}`.replace(/[^a-z0-9_]/gi, "").toLowerCase() }));
		this.keywords = new Map(Object.entries(element.keywords || {}));
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

				STWIndex.set(elementInstance.uuid, elementInstance);
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
			uuid: this.uuid,
			type: this.type,
			subtype: (this as any).subtype || this.type,
			name: this.localize(session, "name"),
			slug: this.localize(session, "slug"),
			keywords: this.localize(session, "keywords"),
			description: this.localize(session, "description"),
			visibility: Object.fromEntries(this.visibility),
			modified: this.modified,
			children: this.children.map((child) => child.uuid),
		};
	}

	/**
	 * Determines the Role Based Visibility of the element climbing up the webbase hierarchy if necessary.
	 * By default an element is not visible except for the portal's mainpage. Given the session roles,
	 * apply a logical OR of these roles in element visiblity, if no role applies move to
	 * the element parent.
	 *
	 * @param session The session
	 * @returns Return a number greater than 0 if element visible
	 */
	public isVisible(session: STWSession, recurse: boolean = false): number {
		let ac!: number;

		if (session.portal.mainpage === this.uuid) {
			ac = recurse ? 0b11 : 0b01; // Main portal page always visible
		}

		for (let i = 0; ac != 0b01 && i < session.roles.length; ++i) {
			if (this.visibility.has(session.roles[i])) {
				ac |= this.visibility.get(session.roles[i]) ? 0b01 : 0b00;
			}
		}

		if (typeof ac === "undefined") {
			if (this.parent) {
				ac = 0b10 | this.parent.isVisible(session, true);
			} else if (["Portal", "Area", "Page"].indexOf(this.type) === -1) { // Content
				ac = 0b10; // NOTE: this covers contents without a parent nor a RBV, it's in limbo!
			}
		}

		return ac || 0b00;
	}

	// Export element as XML
	public export(): string {
		let xml =
			`<${this.type} id="${this.uuid}" type="${this.type}" subtype="${this.type}" modified="${this.modified}">\n`;
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
		this.updateLocalizedField(session, "name", data.name);
		this.updateLocalizedField(session, "slug", data.slug);
		this.updateLocalizedField(session, "keywords", data.keywords);
		this.updateLocalizedField(session, "description", data.description);
		this.modified = Date.now();

		if (data.visibility) {
			this.visibility.clear();
			for (const [role, visible] of Object.entries(data?.visibility)) {
				if (typeof visible === "undefined" || visible === null) {
					this.visibility.delete(role);
				} else {
					this.visibility.set(role, Boolean(visible));
				}
			}
		}

		// TODO: children
	}

	private updateLocalizedField(
		session: STWSession,
		field: "name" | "slug" | "keywords" | "description",
		value: unknown,
	): void {
		if (typeof value === "string") {
			if (field === "name" || field === "slug") this.localize(session, field, value);
			else this[field].set(session.lang, value);
			return;
		}
		if (typeof value !== "object" || value === null || Array.isArray(value)) return;

		const entries = Object.entries(value);
		if (!entries.every((entry): entry is [string, string] => typeof entry[1] === "string")) {
			throw new TypeError(`${field} must be a string or a map of language codes to strings`);
		}
		this[field].clear();
		for (const [lang, localizedValue] of entries) {
			this[field].set(
				lang,
				field === "slug" ? localizedValue.replace(/[^a-z0-9_]/gi, "").toLowerCase() : localizedValue,
			);
		}
	}

	public serve(_req: Request, _session: STWSession, _ref?: STWContent): Promise<Response> {
		return Promise.resolve(secureResponse("Not implemented", { status: 501 }));
	}
}

export function serializeSTWElement(element: STWElement): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(element)) {
		if (key === "parent") continue;
		if (key === "children") {
			result.children = element.children.map(serializeSTWElement);
		} else if (key === "type" && "contentType" in element) {
			result.type = "Content";
			result.subtype = value;
		} else {
			result[key] = serializeElementValue(value);
		}
	}
	return result;
}

function serializeElementValue(value: unknown): unknown {
	if (value instanceof Map) {
		return Object.fromEntries([...value].map(([key, entry]) => [key, serializeElementValue(entry)]));
	}
	if (Array.isArray(value)) return value.map(serializeElementValue);
	if (typeof value === "object" && value !== null) {
		if ("wbll" in value && typeof value.wbll === "string") return value.wbll;
		return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, serializeElementValue(entry)]));
	}
	return value;
}
