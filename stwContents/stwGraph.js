/**
 * @fileoverview Defines the graph content element.
 *
 * Provides the graph content subtype and its current placeholder rendering
 * implementation.
 *
 * @author Giancarlo
 * @version 1.0.0
 * @module stwGraph
 * @note Copilot-assisted
 * @license Apache-2.0
 */
import { registerElement } from "../stwComponents/stwFactory.js";
import { STWContent } from "../stwElements/stwContent.js";

class STWGraph extends STWContent {
	async render(_request, _session, _records) {
		return `TODO: Render ${this.constructor.name} <pre>${_records}</pre>`;
	}
}

registerElement("Graph", STWGraph);

export {
	STWGraph
};
