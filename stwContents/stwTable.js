/**
 * @fileoverview Defines the table content element.
 *
 * Renders connector fields and rows as a layout-driven HTML table with
 * localized labels, placeholders, and configured actions.
 *
 * @author Giancarlo
 * @version 1.0.0
 * @module stwTable
 * @note Copilot-assisted
 * @license Apache-2.0
 */
import { registerElement } from "../stwComponents/stwFactory.js";
import { STWContent } from "../stwElements/stwContent.js";

class STWTable extends STWContent {
	async render(_request, session, records) {
		if (!records.fields.length)
			return "";

		const placeholders = new Map(session.placeholders);
		placeholders.set("@@stworigin", this.uuid);
		placeholders.set("@@stwuuid", this.uuid);
		const orderKey = `@stwo${Buffer.from(this.uuid, "utf8").toString("hex")}`;
		if (placeholders.has(orderKey))
			placeholders.set("@stworderby", placeholders.get(orderKey) || "");

		records.fields.forEach((field) => placeholders.set(`@@${field.toLowerCase()}`, records.rows[0]?.[field] || ""));
		const layout = this.getLayout(session, "lf".repeat(records.fields.length));
		let { settings, HTML: body } = await layout.render(records.fields, placeholders, session, "thead", this.uuid);
		let row = 0, rows = Number(settings.get("rows"));
		rows = rows > 0 ? rows : 25;
		body = `<thead>${body}</thead><tbody>`;
		while (row < records.rows.length) {
			body += (await layout.render(records.fields, placeholders, session, "tbody", this.uuid)).HTML;
			if (++row >= records.rows.length || row >= rows)
				break;
			records.fields.forEach((field) => placeholders.set(`@@${field.toLowerCase()}`, records.rows[row]?.[field] || ""));
		}
		body += `</tbody><tfoot>${(await layout.render(records.fields, placeholders, session, "tfoot", this.uuid)).HTML}</tfoot>`;

		return `<div style="overflow:auto"><form id="stwFS${this.uuid}"><input type="hidden" name="stwOrigin" value="${this.uuid}"></form><form id="stwFE${this.uuid}"><input type="hidden" name="stwOrigin" value="${this.uuid}"></form><table>${body}</table></div>
<script name="STWTable" onload="fnSTWTable('${this.uuid}')">
 function fnSTWTable(id) {
	const table = self.document.getElementById(id);
	table.addEventListener("click", event => {
		const insertCommand = event.target.closest(".stwTableEditInsert");
		if (insertCommand) {
			const row = table.querySelector("[data-stw-insert-row]");
			if (row) {
				row.hidden = false;
				insertCommand.hidden = true;
				row.querySelector(".stwTableInsertActions")?.removeAttribute("hidden");
			}
			return;
		}
		const editCommand = event.target.closest(".stwTableEditRow");
		if (editCommand) {
			const row = editCommand.closest("tr");
			row.classList.add("stwEditing");
			editCommand.hidden = true;
			row.querySelectorAll("input[hidden],select[hidden],textarea[hidden]").forEach(el => el.removeAttribute("hidden"));
			row.querySelector(".stwTableRowActions")?.removeAttribute("hidden");
		}
	});
	table.querySelector("thead .stwOrderBy")?.closest("tr").addEventListener("click", event => {
    const active = event.target.classList.contains("stwOrdered");
    event.currentTarget.querySelectorAll("i").forEach(el => el.classList.remove("stwOrdered"));
    let orderby = "";
    if (!active) {
		event.target.classList.add("stwOrdered");
		orderby = event.target.closest(".stwOrderBy")?.dataset.orderby || "";
		if (orderby) orderby += event.target.classList.contains("fa-angle-down") ? " desc" : " asc";
    }
    const orderKey = Array.from(new TextEncoder().encode(id), byte => byte.toString(16).padStart(2, "0")).join("");
    document.cookie = \`stwo\${orderKey}=\${orderby}; path=/\`;
	});
 }
<\/script>`;
	}
}

registerElement("Table", STWTable);

export {
	STWTable
};
