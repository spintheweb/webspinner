/**
 * @fileoverview Defines the form content element.
 *
 * Renders datasource fields through the WBLL layout system and produces
 * regular or modal HTML forms according to the content section.
 *
 * @author Giancarlo
 * @version 1.0.0
 * @module stwForm
 * @license GPL-3.0-or-later
 */
import { registerElement } from "../stwComponents/stwFactory.js";
import { STWContent } from "../stwElements/stwContent.js";
class STWForm extends STWContent {
  constructor(content) {
    super(content);
  }
  async render(_request, session, records) {
    const layout = this.getLayout(session, "l\\tf\\r".repeat(records.fields.length));
    let body = "";
    const placeholders = new Map(session.placeholders);
    for (const row of records.rows) {
      records.fields.forEach((field) => placeholders.set(`@@${field}`, row[field] || ""));
      body += (await layout.render(records.fields, placeholders, session)).HTML;
    }
    if (body === "")
      return "";
    return `<form${this.section === "stwShowModal" ? ` method="dialog"` : ""}>${body}</form>`;
  }
}
registerElement("Form", STWForm);
export {
  STWForm
};
