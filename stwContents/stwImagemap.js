/**
 * @fileoverview Defines the image-map content element.
 *
 * Provides the image-map content subtype and its current placeholder rendering
 * implementation.
 *
 * @author Giancarlo
 * @version 1.0.0
 * @module stwImagemap
 * @license GPL-3.0-or-later
 */
import { registerElement } from "../stwComponents/stwFactory.js";
import { STWContent } from "../stwElements/stwContent.js";
class STWImagemap extends STWContent {
  constructor(content) {
    super(content);
  }
  // TODO: https://developer.mozilla.org/en-US/docs/Web/HTML/Element/area
  async render(_req, _session) {
    return `TODO: Render ${this.constructor.name} for ${_session.user}`;
  }
}
registerElement("Imagemap", STWImagemap);
export {
  STWImagemap
};
