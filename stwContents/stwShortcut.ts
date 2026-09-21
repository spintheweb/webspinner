/**
 * @fileoverview Defines the shortcut content element.
 *
 * Resolves a referenced content element from the shared index and delegates
 * serving to it when both shortcut and target are visible.
 *
 * @author Giancarlo
 * @version 1.0.0
 * @module stwShortcut
 * @license GPL-3.0-or-later
 */

import type { STWSession } from "../stwComponents/stwSession.ts";
import { registerElement } from "../stwComponents/stwFactory.ts";
import { STWContent, ISTWContent } from "../stwElements/stwContent.ts";
import { STWIndex } from "../stwElements/stwIndex.ts";
import { secureResponse } from "../stwComponents/stwResponse.ts";

export interface ISTWShortcut extends ISTWContent {
	ref: string;
}
export class STWShortcut extends STWContent {
	ref: string;

	public constructor(content: ISTWShortcut) {
		super(content);

		this.ref = content.ref;
	}
	
	public override serve(_req: Request, _session: STWSession): Promise<Response> {
		const ref = STWIndex.get(this.ref) as STWContent | undefined;

		if (!(ref instanceof STWContent) || !this.isVisible(_session) || !ref || ref instanceof STWShortcut)
			return new Promise<Response>(resolve => resolve(secureResponse(null, { status: 204 }))); // 204 No content

		console.debug(`${new Date().toISOString()}: ├┬ ${this.type} (${this.pathname(_session)}) @${this.section}.${this.sequence} [${this.uuid}]`);

		return ref.serve(_req, _session, this);
	}
}

registerElement("Shortcut", STWShortcut);