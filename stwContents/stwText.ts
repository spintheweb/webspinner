/**
 * @fileoverview Defines the text content element.
 *
 * Executes the text content datasource command, applies WBPL placeholders,
 * and serves localized text responses with the configured content type.
 *
 * @author Giancarlo
 * @version 1.0.0
 * @module stwText
 * @license GPL-3.0-or-later
 */

import type { STWSession } from "../stwComponents/stwSession.ts";
import { registerElement } from "../stwComponents/stwFactory.ts";
import { ISTWContent, STWContent } from "../stwElements/stwContent.ts";
import { ISTWRecords } from "../stwComponents/stwDBAdapters/adapter.ts";
import { STWDatasources } from "../stwComponents/stwDatasources.ts";
import { WBPL } from "../stwComponents/stwWBPL.ts";
import { secureResponse } from "../stwComponents/stwResponse.ts";
import { debugLog } from "../stwComponents/stwConfig.ts";

export class STWText extends STWContent {
	public constructor(content: ISTWContent) {
		super(content);
	}

	public override async serve(req: Request, session: STWSession, ref: STWContent | undefined): Promise<Response> {
		if (!ref && !this.isVisible(session)) {
			return new Promise<Response>((resolve) => resolve(secureResponse(null, { status: 204 }))); // 204 No content
		}

		if (ref) {
			debugLog(
				`${new Date().toISOString()}: ${ref.uuid === this.uuid ? " ●" : "│└"} Text (${
					this.pathname(session)
				}) @${this.section}.${this.sequence} [${this.uuid}]`,
			);
		} else {
			debugLog(
				`${new Date().toISOString()}: ├─ Text (${
					this.pathname(session)
				}) @${this.section}.${this.sequence} [${this.uuid}]`,
			);
		}

		const data = {
			method: "PUT",
			id: this.uuid,
			section: (ref || this).section,
			sequence: (ref || this).sequence,
			body: await this.render(req, session, await STWDatasources.command(session, this)),
		};
		return new Promise<Response>((resolve) => resolve(secureResponse(JSON.stringify(data))));
	}

	// deno-lint-ignore require-await
	public override async render(_req: Request, session: STWSession, records: ISTWRecords): Promise<string> {
		const layoutValue = this.layout?.get(session.lang);
		let layoutText = typeof layoutValue === "string" ? layoutValue : (layoutValue?.toString?.() ?? "");

		if (!layoutText) {
			if (this.contentType === "application/json") {
				return JSON.stringify(records ?? { rows: [] });
			} else if (this.contentType.startsWith("text/")) {
				return records?.rows?.map((row) => row.value).join("\n") ?? "";
			} else {
				return "";
			}
		} else
			layoutText = `<article tabindex="0" id="${this.uuid}" data-sequence="${this.sequence}" class="${this.cssClass || "stwText"}">${layoutText}</article>`;

		if (records?.rows?.length) {
			return records.rows.map((row) => {
				const mergedObj = { ...Object.fromEntries(session.placeholders), ...row };
				const mergedMap = new Map<string, string>(Object.entries(mergedObj).map(([k, v]) => [k, String(v)]));
				return WBPL(layoutText, mergedMap);
			}).join("");
		}
		return WBPL(layoutText, new Map(session.placeholders));
	}
}
registerElement("Text", STWText);
