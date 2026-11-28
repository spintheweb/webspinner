/**
 * @fileoverview Defines the pivot content element.
 *
 * Provides the pivot content subtype and its current placeholder rendering
 * implementation.
 *
 * @author Giancarlo
 * @version 1.0.0
 * @module stwPivot
 * @note Copilot-assisted
 * @license Apache-2.0
 */
import { registerElement } from "../stwComponents/stwFactory.js";
import { STWContent } from "../stwElements/stwContent.js";

class STWPivot extends STWContent {
	async render(_req, _session, _records) {
		return `TODO: Render ${this.constructor.name} for ${_session.user} <pre>${_records}</pre>`;
	}
}

registerElement("Pivot", STWPivot);

export {
	STWPivot
};
