/**
 * @fileoverview Defines the menu content element.
 *
 * Loads nested localized menu options and renders them as a navigable content
 * element.
 *
 * @author Giancarlo
 * @version 1.0.0
 * @module stwMenus
 * @license GPL-3.0-or-later
 */

import type { STWSession } from "../stwComponents/stwSession.ts";
import { registerElement } from "../stwComponents/stwFactory.ts";
import { STWContent, ISTWContentWithOptions, ISTWOption } from "../stwElements/stwContent.ts";
import { newId } from "../stwComponents/stwIds.ts";

export class STWMenus extends STWContent {
	options: ISTWOption[] = [];

	public constructor(content: ISTWContentWithOptions) {
		super(content);

		this.options = loadOptions(content.options || []);

		function loadOptions(options: ISTWOption[]): ISTWOption[] {
			const _options: ISTWOption[] = [];
			options.forEach((option: ISTWOption) =>
				_options.push({
					name: new Map(Object.entries(option.name || {})),
					ref: option.ref || "",
					parameters: option.parameters || "",
					options: loadOptions(option?.options || [])
				})
			);
			return _options;
		}
	}

	public override toLocalizedJSON(session: STWSession): object {
		return {
			...super.toLocalizedJSON(session),
			options: this.options.map(option => ({
				...option,
				name: Object.fromEntries(option.name)
			}))
		};
	}

	public override async render(request: Request, session: STWSession): Promise<string> {
		let body: string = "";

		const layout = this.getLayout(session);
		const firstRender = await layout.render([], session.placeholders, session);
		const settings = firstRender.settings;

		this.options.forEach(option => subrender(option));
		if (settings.has("vertical"))
			return `<nav><menu><li style="width:2rem"><div><i class="fa-light fa-bars"></i></div><menu>${body}</menu></li></menu></nav>`;
		return `<nav><menu>${body}</menu></nav>`;

		function subrender(option: ISTWOption, iteration: boolean = false): void {
			let element = session.portal.find(session, option.ref || "");
			let href = option.ref;
			const parameters = option.parameters || "";

			// If element is Portal or Area, use its mainpage if available and visible
			if (element && "mainpage" in element && element.mainpage) {
				const mainPage = session.portal.find(session, element.mainpage as string);
				if (mainPage && mainPage.isVisible(session)) {
					element = mainPage;
					href = mainPage.pathname(session);
				} else {
					href = ""; // No visible main page
				}
			} else if (element) {
				href = element.pathname(session);
			}

			if (href && parameters) {
				href += `${href.includes("?") ? "&" : "?"}${parameters.replace(/^[?&]/, "")}`;
			}

			const name = option?.name.get(session.lang) || element?.localize(session, "name") || href;

			if (name === "-") {
				body += iteration ? "<hr>" : "";
			} else if (!element || element.isVisible(session)) {
				if (element instanceof STWContent) {
					const search = new URL(request.url).search;
					const contentSearch = parameters
						? `${search}${search ? "&" : "?"}${parameters.replace(/^[?&]/, "")}`
						: search;
					body += `<li><article id="${newId()}" href="${element.uuid}${contentSearch}"></article>`;
				} else if (option.options?.length) {
					body += `<li><div>${!option.options?.length && href ? `<a href="${href}">${name}</a>` : name}<i class="fa-light fa-angle-right"></i></div>`;
					body += "<menu>", option.options.forEach(option => subrender(option, true)), body += "</menu>";
				} else {
					body += `<li><div>${!option.options?.length && href ? `<a href="${href}">${name}</a>` : name}</div>`;
				}
				body += "</li>";
			}
		}
	}
}

registerElement("Menus", STWMenus);