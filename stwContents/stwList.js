/**
 * @fileoverview Defines the list content element.
 *
 * Renders connector records as a localized, layout-driven HTML list with
 * placeholder substitution and no-data handling.
 *
 * @author Giancarlo
 * @version 1.0.0
 * @module stwList
 * @note Copilot-assisted
 * @license Apache-2.0
 */
import { registerElement } from "../stwComponents/stwFactory.js";
import { STWContent } from "../stwElements/stwContent.js";

class STWList extends STWContent {
	async render(request, session, records, contentPlaceholders = session.placeholders) {
		if (!records.fields.length || !records.rows.length)
			return "";

		const placeholders = new Map(contentPlaceholders);
		placeholders.set("@@stworigin", this.uuid);
		records.fields.forEach((field) => placeholders.set(`@@${field.toLowerCase()}`, records.rows[0]?.[field] || ""));
		const layout = this.getLayout(session, "f".repeat(records.fields.length));
		let { settings, HTML: body } = await layout.render(records.fields, placeholders, session, "li", this.uuid, `stwFA${this.uuid}`);
		
		let row = 0, rows = Number(settings.get("rows"));
		rows = rows > 0 ? rows : 25;
		while (true) {
			if (++row >= records.rows.length || row >= rows)
				break;
			records.fields.forEach((field) => placeholders.set(`@@${field.toLowerCase()}`, records.rows[row]?.[field] || ""));
			body += (await layout.render(records.fields, placeholders, session, "li", this.uuid, `stwFA${this.uuid}`)).HTML;
		}

		if (settings.get("rownumber"))
			return `<ol>${body}</ol>`;
		return `<ul>${body}</ul>`;
	}
}

registerElement("List", STWList);

export {
	STWList
};
