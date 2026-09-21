/**
 * @fileoverview Defines the Spin the Web area element.
 *
 * Stores area metadata, serializes and updates its main page and version,
 * delegates requests to the portal's indexed main page, and registers the
 * element as `Area`.
 *
 * @author Giancarlo
 * @version 1.0.0
 * @module stwArea
 * @requires ../stwComponents/stwSession.ts
 * @requires ../stwComponents/stwFactory.ts
 * @requires ./stwElement.ts
 * @requires ./stwPortal.ts
 * @requires ../stwComponents/stwResponse.ts
 * @license GPL-3.0-or-later
 */

import type { STWSession } from "../stwComponents/stwSession.ts";
import { registerElement } from "../stwComponents/stwFactory.ts";
import { ISTWElement, STWElement } from "./stwElement.ts";
import { STWPortal } from "./stwPortal.ts";
import { secureResponse } from "../stwComponents/stwResponse.ts";

export interface ISTWArea extends ISTWElement {
	mainpage: string;
	version: string;
}
export class STWArea extends STWElement {
	mainpage: string;
	version: string;

	public constructor(area: ISTWArea) {
		super(area);

		this.mainpage = area.mainpage;
		this.version = area.version || `v1.0.0 ${new Date().toISOString()}`
	}

	public override toLocalizedJSON(session: STWSession): object {
		return {
			...super.toLocalizedJSON(session),
			mainpage: this.mainpage,
			version: this.version
		};
	}

	public override update(session: STWSession, data: any): void {
		super.update(session, data);
		
		this.mainpage = data.mainpage || this.mainpage;
		this.version = data.version || this.version;
	}

	public override serve(req: Request, session: STWSession): Promise<Response> {
		const page = STWPortal.index.get(this.mainpage);

		return page?.serve(req, session) ||
			new Promise<Response>(resolve => {
				const response = secureResponse(`Area '${this.localize(session, "name")}' main page not found`, { status: 404, statusText: "Not Found" });
				resolve(response);
			});
	}
}

registerElement("Area", STWArea);