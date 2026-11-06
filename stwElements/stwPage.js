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
 * @license GPL-3.0-or-later
 */
import { serveFile } from "../stwComponents/stwNode.js";
import { registerElement } from "../stwComponents/stwFactory.js";
import { debugLog } from "../stwComponents/stwConfig.js";
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
   * Given a page, determine all the visible contents: these are not only its children, but also 
   * contents that are direct children of the parents areas up to the portal.
   * 
   * @param session The current session
   * @returns String array of contents ids
   */
  contents(session, recurse = true) {
    const contents = this.children.filter((content) => !/(stwShowModal|stwShow)/.test(content.section) && content.isVisible(session) & 1).map((content) => content.uuid);
    if (recurse)
      climb(this.parent, contents, recurse);
    return contents;
    function climb(element, contents2, recurse2) {
      if (element) {
        element.children.filter((content) => content.section && content.isVisible(session) & 1).map((content) => contents2.push(content.uuid));
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
  serve(req, session) {
    debugLog(`${(/* @__PURE__ */ new Date()).toISOString()}: ${this.type} (${this.pathname(session)}) [${this.uuid}]`);
    return serveFile(req, `./public/${this.template}`);
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
