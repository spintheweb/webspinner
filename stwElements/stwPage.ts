/**
 * @fileoverview Defines the Spin the Web page element.
 *
 * Resolves visible page and ancestor-area contents, serves the configured
 * page template, updates template data, and registers the element as `Page`.
 *
 * @author Giancarlo
 * @version 1.0.0
 * @module stwPage
 * @requires @std/http/file-server
 * @requires ../stwComponents/stwSession.ts
 * @requires ../stwComponents/stwFactory.ts
 * @requires ./stwElement.ts
 * @requires ./stwContent.ts
 * @license GPL-3.0-or-later
 */

import { serveFile } from "@std/http/file-server";
import type { STWSession } from "../stwComponents/stwSession.ts";
import { registerElement } from "../stwComponents/stwFactory.ts";
import { STWElement, ISTWElement } from "./stwElement.ts";
import { STWContent } from "./stwContent.ts";

interface ISTWPage extends ISTWElement {
	template: string;
}
export class STWPage extends STWElement {
	template: string;

	public constructor(page: ISTWPage) {
		super(page);
		this.template = page.template || "/index.html";
	}

	public override toLocalizedJSON(session: STWSession): object {
		return {
			...super.toLocalizedJSON(session),
			template: this.template
		};
	}

	/**
	 * Given a page, determine all the visible contents: these are not only its children, but also 
	 * contents that are direct children of the parents areas up to the portal.
	 * 
	 * @param _session The current session
	 * @returns String array of contents ids
	 */
	public contents(_session: STWSession, recurse: boolean = true): string[] {
		const contents = this.children.filter(content => !/(stwShowModal|stwShow)/.test((content as unknown as STWContent).section) && content.isVisible(_session) & 1).map(content => content.uuid);
		if (recurse)
			climb(this.parent, contents, recurse);
		return contents;

		function climb(element: STWElement, contents: string[], recurse: boolean): void {
			if (element) {
				element.children.filter(content => (content as unknown as STWContent).section && content.isVisible(_session) & 1).map(content => contents.push(content.uuid));
				climb(element.parent, contents, recurse);
			}
		}
	}

	/**
	 * Resolve a {@linkcode Response} with the requested page
	 * 
	 * @param req The server request context
	 * @param session The current session
	 * @returns - A response for the request
	 */
	public override serve(req: Request, session: STWSession): Promise<Response> {
		console.debug(`${new Date().toISOString()}: ${this.type} (${this.pathname(session)}) [${this.uuid}]`);

		return serveFile(req, `./public/${this.template}`);
	}

	public override update(session: STWSession, data: any): void {
		super.update(session, data);
		
		this.template = data.template || this.template;
	}
}

registerElement("Page", STWPage);