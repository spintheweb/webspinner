// SPDX-License-Identifier: MIT
// Spin the Web element: stwSite

import type { STWSession } from "../stwComponents/stwSession.ts";
import { ISTWArea, STWArea } from "./stwArea.ts";
import { ISTWElement, STWElement } from "./stwElement.ts";
import { STWIndex } from "./stwIndex.ts";
import { secureResponse } from "../stwComponents/stwResponse.ts";
import { envGet } from "../stwComponents/stwConfig.ts";

interface ISTWSite extends ISTWElement {
	langs: string[];
	roles: object;
	datasources: object;
	mainpage: string;
	version: string;
}
export class STWSite extends STWElement {
	static #wbdl: ISTWSite;
	static #instance: STWSite;
	static index: Map<string, STWElement> = STWIndex as Map<string, STWElement>;

	langs: string[];
	datasources: Map<string, string>;
	mainpage: string;
	version: string;

	private constructor(site: ISTWSite) {
		super(site);

		this.langs = site.langs || ["en"];
		this.datasources = new Map(Object.entries(site.datasources || { name: "STW", value: "" }));
		this.mainpage = site.mainpage;
		this.version = site.version || `v1.0.0 ${new Date().toISOString()}`;

		STWIndex.set(site._id, this);
	}

	public override toLocalizedJSON(session: STWSession): object {
		return {
			...super.toLocalizedJSON(session),
			langs: this.langs,
			datasources: Object.fromEntries(this.datasources),
			mainpage: this.mainpage,
			version: this.version,
		};
	}

	/**
	 * Loads webbase in memory if not loaded and return the singleton.
	 *
	 * @returns STWSite Singleton
	 */
	static get instance(): STWSite {
		if (!STWSite.#instance) {
			console.log(`${new Date().toISOString()}: Loading webbase '${envGet("WEBBASE")}'...`);

			const webbase = envGet("WEBBASE") || "./.data/webbase.wbdl";
			this.#wbdl = JSON.parse(Deno.readTextFileSync(webbase));
			STWSite.#instance = new STWSite(this.#wbdl);
			if (!STWSite.#instance) {
				throw new Error(
					`Webbase '${webbase}' not found. Set WEBBASE="<path>" in the .env file or place the webbase in ${webbase}.`,
				);
			}

			STWSite.#instance.addWebbaselet(envGet("COMMON_WEBBASE") || "./webbaselets/stwCommon.wbdl"); // uuid = 169ecfb1-2916-11ee-ad92-6bd31f953e80
			STWSite.#instance.addWebbaselet(envGet("STUDIO_WEBBASE") || "./webbaselets/stwStudio.wbdl"); // uuid = e258daa0-293a-11ee-9729-21da0b1a268c

			if (envGet("DEBUG") === "true") {
				STWSite.watchWebbases();
			}
		}
		return STWSite.#instance;
	}

	static get wbdl(): ISTWSite {
		return this.#wbdl;
	}

	/**
	 * Load Spin the Web Studio webbase, if it's already present, replace it.
	 */
	public addWebbaselet(filepath: string): void {
		console.log(`${new Date().toISOString()}: Adding webbaselet '${filepath}'...`);

		try {
			if (URL.parse(filepath || "")) {
				fetch(new URL(filepath || ""))
					.then((response) => response.json())
					.then((webbaselet) => load(webbaselet))
					.catch((_error) => {
						throw _error;
					});
			} else {
				load(JSON.parse(Deno.readTextFileSync(filepath)));
			}
		} catch (error) {
			console.error(`${(error as Error).name}: ${(error as Error).message}`);
		}

		function load(webbaselet: ISTWArea) {
			const studio = STWSite.index.get(webbaselet._id);
			if (studio) {
				STWSite.#instance.remove(studio._id);
			}

			STWSite.#instance.children.unshift(new STWArea(webbaselet));
			STWSite.#instance.children[0].parent = STWSite.#instance;
		}
	}

	/**
	 * Remove the element _id with all its descendent from the webbase
	 *
	 * @param _id The UUID of the element to be removed
	 */
	public remove(_id: string): void {
		const element = STWSite.index.get(_id);
		element?.children.forEach((child, i) => {
			this.remove(child._id);
			STWSite.index.delete(child._id);
			element.children.splice(i, 1);
		});
	}

	// Find the element given an _id or permalink
	public find(session: STWSession, ref: string): STWElement | null {
		if (ref.match(/^x[0-9a-zA-Z]{21,22}/i)) {
			return STWSite.index.get(ref) || null;
		}
		if (ref === "/") {
			return STWSite.index.get(STWSite.#instance.mainpage) || null;
		}
		return STWSite.#instance.recurse(
			session,
			STWSite.#instance.children,
			ref.indexOf("?") < 0 ? ref.split("/") : ref.substring(0, ref.indexOf("?")).split("/"),
		);
	}

	private recurse(session: STWSession, children: STWElement[], slugs: string[], i: number = 1): STWElement | null {
		let result: STWElement | null = null;
		for (const child of children) {
			if (child.localize(session, "slug") === slugs[i]) {
				if (i + 1 === slugs.length) {
					return child;
				}
				result = STWSite.#instance.recurse(session, child.children, slugs, i + 1);
				if (result) {
					return result;
				}
			}
		}
		return result;
	}

	public override serve(req: Request, session: STWSession): Promise<Response> {
		const page = STWSite.index.get(this.mainpage);

		return page?.serve(req, session) ||
			new Promise<Response>((resolve) => {
				const response = secureResponse(`Site ${this.localize(session, "name")} home page not found`, {
					status: 404,
					statusText: "Not Found",
				});
				resolve(response);
			});
	}

	public override update(session: STWSession, data: any): void {
		super.update(session, data);

		this.langs = data.langs || this.langs;
		this.datasources = new Map(Object.entries(data.datasources || {}));
		this.mainpage = data.mainpage || this.mainpage;
		this.version = data.version || this.version;
	}

	public override export(): string {
		let fragment: string = "";
		this.children.forEach((child) => fragment += child.export());

		return '<?xml version="1.0" encoding="utf-8"?>\n' +
			'<wbdl version="1.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="http://webspinner.org" xsi:schemaLocation="https://webspinner.org/schemas wbdl.xsd">\n' +
			`<!--Spin the Web (TM) webbase generated ${(new Date()).toISOString()}-->\n` +
			`<site id="${this._id}" language="${
				this.langs[0]
			}" languages="${this.langs}" mainpage="${this.mainpage}">\n${super.export()}${fragment}</site>\n` +
			"</wbdl>";
	}

	// Build a site map (see sitemaps.org) that includes the urls of the visible pages in the site
	public sitemap(session: STWSession): Promise<Response> {
		let fragment = "";
		_url(this);

		return new Promise<Response>((resolve) =>
			resolve(
				secureResponse(
					`<?xml version="1.0" encoding="utf-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${fragment}</urlset>`,
				),
			)
		);

		function _url(element: STWElement) {
			if (element.type === "Area" && element.children.length > 0) {
				element.children.forEach((child) => _url(child));
			} else if (element.type === "Page" && element.isVisible(session) & 1) {
				fragment += `<url><loc>${
					element.pathname(session)
				}</loc><lastmod>${element.modified}</lastmod><priority>0.5</priority></url>\n`;
			}
		}
	}

	// Watch webbase files for changes and reload when they are modified. In production this code should not be used.
	// It is useful for development purposes to see changes in real time.
	static #watcherStarted = false;
	static watchWebbases() {
		if (this.#watcherStarted) return;
		this.#watcherStarted = true;

		const webbasePath = [
			envGet("WEBBASE") || "./.data/webbase.wbdl",
			envGet("COMMON_WEBBASE") || "./webbaselets/stwCommon.wbdl",
			envGet("STUDIO_WEBBASE") || "./webbaselets/stwStudio.wbdl",
		];
		let reloadTimeout: number | undefined;

		(async () => {
			for await (const event of Deno.watchFs(webbasePath)) {
				if (event.kind === "modify" || event.kind === "create") {
					if (reloadTimeout) clearTimeout(reloadTimeout);
					reloadTimeout = setTimeout(() => {
						console.log(`${new Date().toISOString()}: Webbase changed...`);
						STWSite.#instance = undefined as unknown as STWSite;
						STWSite.index.clear();
					}, 200); // Wait 200ms for changes to settle
				}
			}
		})();
	}
}
