// SPDX-License-Identifier: GPL-3.0-or-later
// Spin the Web module: stwContents/stwTabs.ts

import type { STWSession } from "../stwComponents/stwSession.ts";
import { registerElement } from "../stwComponents/stwFactory.ts";
import { STWContent, ISTWOption, ISTWContentWithOptions } from "../stwElements/stwContent.ts";
import { STWIndex } from "../stwElements/stwIndex.ts";
import { STWLayout } from "../stwComponents/stwWBLL.ts";
import { newId } from "../stwComponents/stwIds.ts";

export class STWTabs extends STWContent {
	options: ISTWOption[] = [];

	public constructor(content: ISTWContentWithOptions) {
		super(content, { mode: "horizontal" });

		if (content.options)
			content.options.forEach((option: ISTWOption) => {
				this.options.push({ name: new Map(Object.entries(option.name || {})), ref: option.ref || "" });
			});
	}

	// deno-lint-ignore require-await
	public override async render(_req: Request, session: STWSession): Promise<string> {
		const layout = this.layout.get(session.lang) as STWLayout;

		let body = "<div>", id = "";
		this.options.forEach(option => {
			if (option.name.get(session.lang) === "-")
				body += `<dt style="flex-grow: 1;"></dt>`;
			else {
				const element = session.site.find(session, option.ref || "");
				if (element instanceof STWContent && element.isVisible(session)) {
					const name = option.name.get(session.lang) || (element ? element.localize(session, "name") : option.ref);
					body += `<dt data-ref="${element._id}"${id ? "" : " class=\"stwSelected\""}>${name}${closable(session, element._id)}</dt>`;
					id = id || element._id;
				}
			}
		});

		if (!id)
			return "";

		body += `</div><dd><article id="${newId()}" href="${id}${(new URL(_req.url)).search}"><i class="fa-light fa-loader fa-spin"></i></article></dd>`;

		// The STWTabs script selects the clicked tab and requests from the spinner the tab content
		const mode = layout.settings.get("mode") || "horizontal";
		return `<dl class="stw${mode[0].toUpperCase()}Tabs">${body}</dl>
			<script name="STWTabs" onload="fnSTWTabs('${this._id}')">
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
								stwWS.send(JSON.stringify({ method: "PATCH", resource: target.getAttribute("data-ref"), options: { placeholder: "refreshSTWTab" } }));
							}
						}
					});
				}
			</script>`;

		function closable(session: STWSession, id: string): string {
			const tab = STWIndex.get(id) as STWContent | undefined;
			if (tab instanceof STWContent && tab.getLayout(session).settings.get("closable") === "true")
				return `&emsp;<i class="fa-light fa-xmark"></i>`;
			return "";
		}
	}
}

registerElement("Tabs", STWTabs);