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
 * @requires ../stwComponents/stwSession.js
 * @requires ../stwComponents/stwFactory.js
 * @requires ./stwElement.js
 * @requires ./stwPortal.js
 * @requires ../stwComponents/stwResponse.js
 * @license GPL-3.0-or-later
 */
import { registerElement } from "../stwComponents/stwFactory.js";
import { STWElement } from "./stwElement.js";
import { STWPortal } from "./stwPortal.js";
import { secureResponse } from "../stwComponents/stwResponse.js";
class STWArea extends STWElement {
	mainpage;
	version;
	constructor(area) {
		super(area);
		this.mainpage = area.mainpage;
		this.version = area.version || `v1.0.0 ${(new Date()).toISOString()}`;
	}
	toLocalizedJSON(session) {
		return {
			...super.toLocalizedJSON(session),
			mainpage: this.mainpage,
			version: this.version
		};
	}
	update(session, data) {
		super.update(session, data);
		this.mainpage = data.mainpage || this.mainpage;
		this.version = data.version || this.version;
	}
	serve(req, session) {
		const page = STWPortal.index.get(this.mainpage);
		return page?.serve(req, session) || new Promise((resolve) => {
			const response = secureResponse(`Area '${this.localize(session, "name")}' main page not found`, { status: 404, statusText: "Not Found" });
			resolve(response);
		});
	}
}
registerElement("Area", STWArea);
export {
	STWArea
};
