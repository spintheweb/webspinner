// SPDX-License-Identifier: GPL-3.0-or-later
// Spin the Web module: stwContents/stwAccordion.ts

import type { STWSession } from "../stwComponents/stwSession.ts";
import { registerElement } from "../stwComponents/stwFactory.ts";
import { STWContent, ISTWOption, ISTWContentWithOptions } from "../stwElements/stwContent.ts";
import { newId } from "../stwComponents/stwIds.ts";

export class STWAccordion extends STWContent {
	options: ISTWOption[] = [];

	public constructor(content: ISTWContentWithOptions) {
		super(content);

		if (content.options)
			content.options.forEach((option: ISTWOption) => {
				this.options.push({ name: new Map(Object.entries(option.name || {})), ref: option.ref || "" });
			});
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

	// deno-lint-ignore require-await
	public override async render(_req: Request, session: STWSession): Promise<string> {
		let body = "";

		this.options.forEach((option, i) => {
			const element = session.site.find(session, option.ref || "");
			if (element instanceof STWContent && element.isVisible(session)) {
				const name = option.name.get(session.lang) || (element ? element.localize(session, "name") : option.ref);
				body += `<dt data-ref="${element._id}"><i class="fa-light fa-angle-${i > 0 ? "right" : "down"}"></i>${name}</dt><dd><article id="${newId()}" href="${option.ref}${(new URL(_req.url)).search}"><i class="fa-light fa-loader fa-spin"></i></article></dd>`;
			}
		});

		if (body === "")
			return "";

		// The STWAccordion script toggles the clicked accordion element
		return `<dl>${body}</dl>
			<script name="STWAccordion" onload="fnSTWAccordion('${this._id}')">
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
			</script>`;
	}
}

registerElement("Accordion", STWAccordion);