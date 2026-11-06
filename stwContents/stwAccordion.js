/**
 * @fileoverview Defines the accordion content element.
 *
 * Renders localized, optionally linked accordion options as a Spin the Web
 * content element.
 *
 * @author Giancarlo
 * @version 1.0.0
 * @module stwAccordion
 * @license GPL-3.0-or-later
 */
import { registerElement } from "../stwComponents/stwFactory.js";
import { STWContent } from "../stwElements/stwContent.js";
import { newId } from "../stwComponents/stwIds.js";
class STWAccordion extends STWContent {
	options = [];
	constructor(content) {
		super(content);
		if (content.options)
			content.options.forEach((option) => {
				this.options.push({ name: new Map(Object.entries(option.name || {})), ref: option.ref || "", parameters: option.parameters || "" });
			});
	}
	toLocalizedJSON(session) {
		return {
			...super.toLocalizedJSON(session),
			options: this.options.map((option) => ({
				...option,
				name: Object.fromEntries(option.name)
			}))
		};
	}
	async render(_req, session) {
		let body = "";
		const search = new URL(_req.url).search;
		this.options.forEach((option, i) => {
			const element = session.portal.find(session, option.ref || "");
			if (element instanceof STWContent && element.isVisible(session)) {
				const name = option.name.get(session.lang) || (element ? element.localize(session, "name") : option.ref);
				const contentSearch = option.parameters ? `${search}${search ? "&" : "?"}${option.parameters.replace(/^[?&]/, "")}` : search;
				body += `<dt data-ref="${element.uuid}"><i class="fa-light fa-angle-${i > 0 ? "right" : "down"}"></i>${name}</dt><dd><article id="${newId()}" href="${option.ref}${contentSearch}"><i class="fa-light fa-loader fa-spin stwLoading"></i></article></dd>`;
			}
		});
		if (body === "")
			return "";
		return `<dl>${body}</dl>
    <script name="STWAccordion" onload="fnSTWAccordion('${this.uuid}')">
		function fnSTWAccordion(id) {
       const accordion = self.document.getElementById(id);
       accordion.querySelector("dl").addEventListener("click", event => {
			event.stopImmediatePropagation();
			const dt = event.target.closest("dt");
			if (!dt || (event.target.tagName === "I" && !event.target.className.includes("fa-angle-"))) return;
			dt.querySelector("i").classList.toggle("fa-angle-down");
			dt.querySelector("i").classList.toggle("fa-angle-right");
			dt.nextElementSibling.style.display = dt.querySelector("i").classList.contains("fa-angle-down") ? 'block' : 'none';
       });
		}
    <\/script>`;
	}
}
registerElement("Accordion", STWAccordion);
export {
	STWAccordion
};
