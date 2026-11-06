/**
 * @fileoverview Defines the shortcut content element.
 *
 * Resolves a referenced content element from the shared index and delegates
 * serving to it when both shortcut and target are visible.
 *
 * @author Giancarlo
 * @version 1.0.0
 * @module stwShortcut
 * @license GPL-3.0-or-later
 */
import { registerElement } from "../stwComponents/stwFactory.js";
import { STWContent } from "../stwElements/stwContent.js";
import { STWIndex } from "../stwElements/stwIndex.js";
import { secureResponse } from "../stwComponents/stwResponse.js";
import { debugLog } from "../stwComponents/stwConfig.js";
class STWShortcut extends STWContent {
  ref;
  constructor(content) {
    super(content);
    this.ref = content.ref;
  }
  serve(_req, _session) {
    const ref = STWIndex.get(this.ref);
    if (!(ref instanceof STWContent) || !this.isVisible(_session) || !ref || ref instanceof STWShortcut)
      return new Promise((resolve) => resolve(secureResponse(null, { status: 204 })));
    debugLog(`${(/* @__PURE__ */ new Date()).toISOString()}: \u251C\u252C ${this.type} (${this.pathname(_session)}) @${this.section}.${this.sequence} [${this.uuid}]`);
    return ref.serve(_req, _session, this);
  }
}
registerElement("Shortcut", STWShortcut);
export {
  STWShortcut
};
