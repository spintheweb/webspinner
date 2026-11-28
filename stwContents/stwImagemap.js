/**
 * @fileoverview Defines the image-map content element.
 *
 * Provides the image-map content subtype and its current placeholder rendering
 * implementation.
 *
 * @author Giancarlo
 * @version 1.0.0
 * @module stwImagemap
 * @note Copilot-assisted
 * @license Apache-2.0
 */
import { registerElement } from "../stwComponents/stwFactory.js";
import { STWContent } from "../stwElements/stwContent.js";

class STWImagemap extends STWContent {
	// TODO: https://developer.mozilla.org/en-US/docs/Web/HTML/Element/area
	async render(_request, _session) {
		return `TODO: Render ${this.constructor.name} for ${_session.user}`;
	}
}

registerElement("Imagemap", STWImagemap);

export {
	STWImagemap
};
