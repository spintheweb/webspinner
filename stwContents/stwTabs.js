/**
 * @fileoverview Defines the tabs content element.
 *
 * Loads localized tab options, resolves referenced content through the shared
 * index, and renders the selected content panels.
 *
 * @author Giancarlo
 * @version 1.0.0
 * @module stwTabs
 * @license GPL-3.0-or-later
 */
import { registerElement } from "../stwComponents/stwFactory.js";
import { STWContent } from "../stwElements/stwContent.js";
import { STWIndex } from "../stwElements/stwIndex.js";
import { newId } from "../stwComponents/stwIds.js";

class STWTabs extends STWContent {
	options = [];

	constructor(content) {
		super(content, { mode: "horizontal" });
		if (content.options)
			content.options.forEach(
				(option) => this.options.push({ name: new Map(Object.entries(option.name || {})), ref: option.ref || "", parameters: option.parameters || "" })
			);
	}

	async render(request, session, records) {
		const layout = this.getLayout(session);
		const settings = (await layout.render(records.fields, session.placeholders, session)).settings;
		const search = new URL(request.url).search;
		let body = "<div>", id = "", href = "";
		for (const option of this.options) {
			if (option.name.get(session.lang) === "-")
				body += `<dt style="flex-grow: 1;"></dt>`;
			else {
				const element = session.portal.find(session, option.ref || "");
				if (element instanceof STWContent && element.isVisible(session)) {
					const name = option.name.get(session.lang) || (element ? element.localize(session, "name") : option.ref);
					const contentSearch = option.parameters ? `${search}${search ? "&" : "?"}${option.parameters.replace(/^[?&]/, "")}` : search;
					const contentHref = `${element.uuid}${contentSearch}`;
					body += `<dt data-ref="${element.uuid}" data-href="${contentHref}"${id ? "" : ' class="stwSelected"'}>${name}${await closable(session, element.uuid)}</dt>`;
					if (!id) {
						id = element.uuid;
						href = contentHref;
					}
				}
			}
		}
		if (!id)
			return "";
		body += `</div><dd><article id="${newId()}" href="${href}"><i class="fa-light fa-loader fa-spin stwLoading"></i></article></dd>`;
		const mode = settings.get("mode") || "horizontal";
		return `<dl class="stw${String(mode)[0].toUpperCase()}Tabs">${body}</dl>
<script name="STWTabs" onload="fnSTWTabs('${this.uuid}')">
 function fnSTWTabs(id) {
	const tabs = self.document.getElementById(id);
	tabs.querySelector("dl").addEventListener("click", event => {
    event.stopImmediatePropagation();
    
    if (event.target.tagName === "I" && event.target.classList.contains("fa-xmark")) {
		event.currentTarget.querySelector("article").remove();
		event.target.closest("dt").previousElementSibling?.click();
		event.target.closest("dt").remove();
		return;
    }

    const target = event.target.closest("dt");
    if (target && target.hasAttribute("data-ref")) {
		event.currentTarget.querySelector("dd").innerHTML = '<article id="refreshSTWTab"></article>';
		if (target.classList.contains("stwSelected"))
       target.classList.remove("stwSelected");
		else {
       event.currentTarget.querySelector("dt.stwSelected")?.classList.remove("stwSelected");
       target.classList.add("stwSelected");
       stwWS.send(JSON.stringify({ method: "PATCH", resource: target.getAttribute("data-href"), options: { placeholder: "refreshSTWTab" } }));
		}
    }
	});
 }
<\/script>`;

		async function closable(session2, id2) {
			const tab = STWIndex.get(id2);
			if (tab instanceof STWContent) {
				const layout2 = tab.getLayout(session2);
				const settings2 = (await layout2.render([], session2.placeholders, session2)).settings;
				if (settings2.get("closable") === true)
					return `&emsp;<i class="fa-light fa-xmark"></i>`;
			}
			return "";
		}
	}
}

registerElement("Tabs", STWTabs);

export {
	STWTabs
};
