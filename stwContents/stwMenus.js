/**
 * @fileoverview Defines the menu content element.
 *
 * Loads nested localized menu options and renders them as a navigable content
 * element.
 *
 * @author Giancarlo
 * @version 1.0.0
 * @module stwMenus
 * @note Copilot-assisted
 * @license Apache-2.0
 */
import { registerElement } from "../stwComponents/stwFactory.js";
import { STWContent } from "../stwElements/stwContent.js";
import { localizedValue } from "../stwComponents/stwLocalization.js";
import { newId } from "../stwComponents/stwIds.js";
import { WBPL } from "../stwComponents/stwWBPL.js";

class STWMenus extends STWContent {
	options = [];

	constructor(content) {
		super(content);
		this.options = loadOptions(content.options || []);
		function loadOptions(options) {
			const _options = [];
			options.forEach(
				(option) => _options.push({
					name: new Map(Object.entries(option.name || {})),
					ref: option.ref || "",
					parameters: option.parameters || "",
					options: loadOptions(option?.options || [])
				})
			);
			return _options;
		}
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

	async render(request, session) {
		let body = "";
		const layout = this.getLayout(session);
		const placeholders = new Map(session.placeholders);
		placeholders.set("@@stworigin", this.uuid);
		const firstRender = await layout.render([], placeholders, session, "", this.uuid, `stwFA${this.uuid}`);
		const settings = firstRender.settings;

		this.options.forEach(option => { subrender(option); });
		if (settings.has("vertical"))
			return `<nav><menu><li style="width:3rem"><div><i class="fa-light fa-bars"></i></div><menu>${body}</menu></li></menu></nav>${firstRender.scripts || ""}`;
		return `<nav><menu>${body}</menu></nav>${firstRender.scripts || ""}`;

		function subrender(option, iteration = false) {
			let element = session.portal.find(session, option.ref || "");
			let href = option.ref;
			const parameters = option.parameters || "";

			if (element && "mainpage" in element && element.mainpage) {
				const mainPage = session.portal.find(session, element.mainpage);
				if (mainPage && (mainPage.isVisible(session) & 1)) {
					element = mainPage;
					href = mainPage.pathname(session);
				} else {
					href = "";
				}
			} else if (element) {
				href = element.pathname(session);
			}

			if (href && parameters) {
				href += `${href.includes("?") ? "&" : "?"}${parameters.replace(/^[?&]/, "")}`;
			}

			const name = WBPL(localizedValue(option?.name, session) || element?.localize(session, "name") || href || "-", placeholders);

			if (name === "-" && settings.has("vertical"))
				body += "<li><hr></li>";
			else if (name === "-")
				body += !iteration ? `<li class="stwNotOption" style="flex-grow:1"><li>` : "";
			else if (!element || (element.isVisible(session) & 1)) {
				if (element instanceof STWContent) {
					const search = new URL(request.url).search;
					const contentSearch = parameters ? `${search}${search ? "&" : "?"}${parameters.replace(/^[?&]/, "")}` : search;
					body += `<li class="stwNotOption"><article id="${newId("c")}" href="${element.uuid}${contentSearch}"></article>`;
				} else if (option.options?.length) {
					body += `<li><div>${!option.options?.length && href ? `<a href="${href}">${name}</a>` : name} <i class="fa-light fa-angle-${iteration || settings.has("vertical") ? "right": "down"}"></i></div>`;
					body += "<menu>", option.options.forEach((option2) => subrender(option2, true)), body += "</menu>";
				} else if (!option.options?.length && href) {
					body += `<li><div><a href="${href}">${name}</a></div>`;
				} else
					body += `<li class="stwNotOption"><div>${name}</div>`;
				body += "</li>";
			}
		}
	}
}

registerElement("Menus", STWMenus);

export {
	STWMenus
};
