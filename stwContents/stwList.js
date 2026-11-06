/**
 * @fileoverview Defines the list content element.
 *
 * Renders datasource records as a localized, layout-driven HTML list with
 * placeholder substitution and no-data handling.
 *
 * @author Giancarlo
 * @version 1.0.0
 * @module stwList
 * @license GPL-3.0-or-later
 */
import { registerElement } from "../stwComponents/stwFactory.js";
import { STWContent } from "../stwElements/stwContent.js";
class STWList extends STWContent {
  constructor(content) {
    super(content);
  }
  async render(_request, session, records) {
    if (!records.fields.length || !records.rows.length)
      return "";
    const placeholders = new Map(session.placeholders);
    records.fields.forEach((field) => placeholders.set(`@@${field}`, records.rows[0]?.[field] || ""));
    const layout = this.getLayout(session, "f".repeat(records.fields.length));
    let { settings, HTML: body } = await layout.render(records.fields, placeholders, session, "li");
    let row = 0, rows = Number(settings.get("rows"));
    rows = rows > 0 ? rows : 25;
    while (true) {
      if (++row >= records.rows.length || row >= rows)
        break;
      records.fields.forEach((field) => placeholders.set(`@@${field}`, records.rows[row]?.[field] || ""));
      body += (await layout.render(records.fields, placeholders, session, "li")).HTML;
    }
    return `<ul>${body}</ul>`;
  }
}
registerElement("List", STWList);
export {
  STWList
};
