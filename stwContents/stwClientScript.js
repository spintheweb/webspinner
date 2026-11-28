/**
 * @fileoverview Defines the client-script content element.
 *
 * Provides the content subtype for returning client-side script payloads to
 * the browser.
 *
 * @author Giancarlo
 * @version 1.0.0
 * @module stwClientScript
 * @note Copilot-assisted
 * @license Apache-2.0
 */
import { registerElement } from "../stwComponents/stwFactory.js";
import { STWContent } from "../stwElements/stwContent.js";
import { secureResponse } from "../stwComponents/stwResponse.js";
import { localizedValue } from "../stwComponents/stwLocalization.js";

class STWScript extends STWContent {
	serve(_request, _session) {
		if (!(this.isVisible(_session) & 1))
			return new Promise((resolve) => resolve(secureResponse(null, { status: 204 })));

		const data = {
			method: "PUT",
			id: this.uuid,
			section: this.section,
			sequence: this.sequence,
			body: localizedValue(this.layout, _session)
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
