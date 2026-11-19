/**
 * @fileoverview Defines the Spin the Web page element.
 *
 * Resolves visible page and ancestor-area contents, serves the configured
 * page template, updates template data, and registers the element as `Page`.
 *
 * @author Giancarlo
 * @version 1.0.0
 * @module stwPage
 * @requires ../stwComponents/stwNode.js
 * @requires ../stwComponents/stwSession.js
 * @requires ../stwComponents/stwFactory.js
 * @requires ./stwElement.js
 * @requires ./stwContent.js
 * @note Copilot-assisted
 * @license Apache-2.0
 */
import { serveFile } from "../stwComponents/stwNode.js";
import { registerElement } from "../stwComponents/stwFactory.js";
import { debugLog } from "../stwComponents/stwConfig.js";
import { secureResponse } from "../stwComponents/stwResponse.js";
import { STWElement } from "./stwElement.js";

class STWPage extends STWElement {
	template;

	constructor(page) {
		super(page);
		this.template = page.template || "index.html";
	}

	toLocalizedJSON(session) {
		return {
			...super.toLocalizedJSON(session),
			template: this.template
		};
	}

	/**
    * Given a page, determine all visible contents from the page and its ancestors.
    * An area with inheritContents=false includes its own direct contents but stops
    * content collection before its parent.
    * 
    * @param session The current session
    * @returns String array of contents ids
    */
	contents(session, recurse = true) {
		if (!(this.isVisible(session) & 1)) return [];
		const contents = this.children.filter((content) => !/(stwOpenModal|stwOpen)/.test(content.section) && content.isVisible(session) & 1).map((content) => content.uuid);
		if (recurse)
			climb(this.parent, contents, recurse);
		return contents;
		function climb(element, contents2, recurse2) {
			if (element) {
				element.children.filter((content) => content.section && !/(stwOpenModal|stwOpen)/.test(content.section) && content.isVisible(session) & 1).map((content) => contents2.push(content.uuid));
				if (element.inheritContents !== false)
					climb(element.parent, contents2, recurse2);
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
	async serve(req, session) {
		if (!(this.isVisible(session) & 1))
			return secureResponse(null, { status: 302, headers: { Location: "/" } });
		debugLog(`${(new Date()).toISOString()}: ${this.type} (${this.pathname(session)}) [${this.uuid}]`);
		const response = await serveFile(req, `./public/${this.template}`);
		if (/^\/stws(?:\/|$)/.test(this.pathname(session)))
			response.headers.append("Content-Security-Policy", "frame-ancestors 'none'");
		return response;
	}

	update(session, data) {
		super.update(session, data);
		this.template = data.template || this.template;
	}
}

registerElement("Page", STWPage);

export {
	STWPage
};
