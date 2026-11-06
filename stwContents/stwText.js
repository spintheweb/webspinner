/**
 * @fileoverview Defines the text content element.
 *
 * Executes the text content datasource command, applies WBPL placeholders,
 * and serves localized text responses with the configured content type.
 *
 * @author Giancarlo
 * @version 1.0.0
 * @module stwText
 * @license GPL-3.0-or-later
 */
import { registerElement } from "../stwComponents/stwFactory.js";
import { STWContent } from "../stwElements/stwContent.js";
import { STWDatasources } from "../stwComponents/stwDatasources.js";
import { WBPL } from "../stwComponents/stwWBPL.js";
import { secureResponse } from "../stwComponents/stwResponse.js";
import { debugLog } from "../stwComponents/stwConfig.js";
class STWText extends STWContent {
  constructor(content) {
    super(content);
  }
  async serve(req, session, ref) {
    if (!ref && !this.isVisible(session)) {
      return new Promise((resolve) => resolve(secureResponse(null, { status: 204 })));
    }
    if (ref) {
      debugLog(
        `${(/* @__PURE__ */ new Date()).toISOString()}: ${ref.uuid === this.uuid ? " \u25CF" : "\u2502\u2514"} Text (${this.pathname(session)}) @${this.section}.${this.sequence} [${this.uuid}]`
      );
    } else {
      debugLog(
        `${(/* @__PURE__ */ new Date()).toISOString()}: \u251C\u2500 Text (${this.pathname(session)}) @${this.section}.${this.sequence} [${this.uuid}]`
      );
    }
    const data = {
      method: "PUT",
      id: this.uuid,
      section: (ref || this).section,
      sequence: (ref || this).sequence,
      body: await this.render(req, session, await STWDatasources.command(session, this))
    };
    return new Promise((resolve) => resolve(secureResponse(JSON.stringify(data))));
  }
  async render(_req, session, records) {
    const layoutValue = this.layout?.get(session.lang);
    let layoutText = typeof layoutValue === "string" ? layoutValue : layoutValue?.toString?.() ?? "";
    if (!layoutText) {
      if (this.contentType === "application/json") {
        return JSON.stringify(records ?? { rows: [] });
      } else if (this.contentType.startsWith("text/")) {
        return records?.rows?.map((row) => row.value).join("\n") ?? "";
      } else {
        return "";
      }
    } else
      layoutText = `<article tabindex="0" id="${this.uuid}" data-sequence="${this.sequence}" class="${this.cssClass || "stwText"}">${layoutText}</article>`;
    if (records?.rows?.length) {
      return records.rows.map((row) => {
        const mergedObj = { ...Object.fromEntries(session.placeholders), ...row };
        const mergedMap = new Map(Object.entries(mergedObj).map(([k, v]) => [k, String(v)]));
        return WBPL(layoutText, mergedMap);
      }).join("");
    }
    return WBPL(layoutText, new Map(session.placeholders));
  }
}
registerElement("Text", STWText);
export {
  STWText
};
