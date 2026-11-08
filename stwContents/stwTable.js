/**
 * @fileoverview Defines the table content element.
 *
 * Renders datasource fields and rows as a layout-driven HTML table with
 * localized labels, placeholders, and configured actions.
 *
 * @author Giancarlo
 * @version 1.0.0
 * @module stwTable
 * @license GPL-3.0-or-later
 */
import { registerElement } from "../stwComponents/stwFactory.js";
import { STWContent } from "../stwElements/stwContent.js";

class STWTable extends STWContent {
	constructor(content) {
		super(content);
	}

	async render(_request, session, records) {
		if (!records.fields.length || !records.rows.length)
			return "";

		const placeholders = new Map(session.placeholders);
		placeholders.set("@@stwuuid", this.uuid);
		if (placeholders.has(`@stwO${this.uuid}`))
			placeholders.set("@stworderby", placeholders.get(`@stwO${this.uuid}`) || "");

		records.fields.forEach((field) => placeholders.set(`@@${field}`, records.rows[0]?.[field] || ""));
		const layout = this.getLayout(session, "lf".repeat(records.fields.length));
		let { settings, HTML: body } = await layout.render(records.fields, placeholders, session, "thead");
		let row = 0, rows = Number(settings.get("rows"));
		rows = rows > 0 ? rows : 25;
		body = `<thead>${body}</thead><tbody>`;
		while (true) {
			body += (await layout.render(records.fields, placeholders, session, "tbody")).HTML;
			if (++row >= records.rows.length || row >= rows)
				break;
			records.fields.forEach((field) => placeholders.set(`@@${field}`, records.rows[row]?.[field] || ""));
		}
		body += `</tbody><tfoot>${(await layout.render(records.fields, placeholders, session, "tfoot")).HTML}</tfoot>`;

		return `<div style="overflow:auto"><form id="stwFS${this.uuid}"></form><form id="stwFE${this.uuid}"></form><table>${body}</table></div>
<script name="STWTable" onload="fnSTWTable('${this.uuid}')">
 function fnSTWTable(id) {
	const table = self.document.getElementById(id);
	table.querySelector("thead .stwOrderBy")?.closest("tr").addEventListener("click", event => {
    const active = event.target.classList.contains("stwOrdered");
    event.currentTarget.querySelectorAll("i").forEach(el => el.classList.remove("stwOrdered"));
    let orderby = "";
    if (!active) {
		event.target.classList.add("stwOrdered");
		orderby = event.target.closest(".stwOrderBy")?.dataset.orderby || "";
		if (orderby) orderby += event.target.classList.contains("fa-angle-down") ? " desc" : " asc";
    }
    document.cookie = \`stwO\${id}=\${orderby}; path=/\`;
	});
 }
<\/script>`;
	}
}

registerElement("Table", STWTable);

export {
	STWTable
};
