/**
 * @fileoverview Defines the client-script content element.
 *
 * Provides the content subtype for returning client-side script payloads to
 * the browser.
 *
 * @author Giancarlo
 * @version 1.0.0
 * @module stwClientScript
 * @license GPL-3.0-or-later
 */
import { registerElement } from "../stwComponents/stwFactory.js";
import { STWContent } from "../stwElements/stwContent.js";
import { secureResponse } from "../stwComponents/stwResponse.js";
class STWScript extends STWContent {
	constructor(content) {
		super(content);
	}
	serve(_req, _session) {
		if (!this.isVisible(_session))
			return new Promise((resolve) => resolve(secureResponse(null, { status: 204 })));
		const data = {
			method: "PUT",
			id: this.uuid,
			section: this.section,
			sequence: this.sequence,
			body: this.layout.get(_session.lang)
		};
		return new Promise((resolve) => {
			const response = secureResponse(`<script>${JSON.stringify(data)}<\/script>`);
			resolve(response);
		});
	}
}
registerElement("Script", STWScript);
export {
	STWScript
};
