/**
 * @fileoverview Defines the Spin the Web portal element and its singleton
 * lifecycle.
 *
 * Loads the main WBOL document, adds configured webbaselets, indexes portal
 * elements, resolves localized routes, serves pages, and exports the portal
 * back to WBOL. File watching can be enabled for development reloading.
 *
 * @author Giancarlo
 * @version 1.0.0
 * @module stwPortal
 * @requires ../stwComponents/stwSession.ts
 * @requires ../stwComponents/stwResponse.ts
 * @requires ../stwComponents/stwConfig.ts
 * @requires ../stwComponents/stwWBOL.ts
 * @requires ./stwArea.ts
 * @requires ./stwElement.ts
 * @requires ./stwIndex.ts
 * @license GPL-3.0-or-later
 */

import type { STWSession } from "../stwComponents/stwSession.ts";
import { ISTWArea, STWArea } from "./stwArea.ts";
import { ISTWElement, STWElement } from "./stwElement.ts";
import { STWIndex } from "./stwIndex.ts";
import { secureResponse } from "../stwComponents/stwResponse.ts";
import { envGet } from "../stwComponents/stwConfig.ts";
import { WBOL } from "../stwComponents/stwWBOL.ts";

export interface ISTWPortal extends ISTWElement {
	langs: string[];
	datasources: object;
	mainpage: string;
	version: string;
}
export class STWPortal extends STWElement {
	static #instance: STWPortal;
	static index: Map<string, STWElement> = STWIndex as Map<string, STWElement>;

	langs: string[];
	datasources: Map<string, string>;
	mainpage: string;
	version: string;

	private constructor(portal: ISTWPortal) {
		super(portal);

		this.langs = portal.langs || ["en"];
		this.datasources = new Map(Object.entries(portal.datasources || { name: "STW", value: "" }));
		this.mainpage = portal.mainpage;
		this.version = portal.version || `v1.0.0 ${new Date().toISOString()}`;

		STWIndex.set(portal.uuid, this);
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
	 * @returns STWPortal Singleton
	 */
	static get instance(): STWPortal {
		if (!STWPortal.#instance) {
			console.log(`${new Date().toISOString()}: Loading webbase '${envGet("WEBBASE")}'...`);

			const webbase = envGet("WEBBASE") || "./.data/webbase.wbol";
			const wbol: ISTWPortal = WBOL(webbase);
			STWPortal.#instance = new STWPortal(wbol);
			if (!STWPortal.#instance)
				throw new Error(
					`Webbase '${webbase}' not found. Set WEBBASE="<path>" in the .env file or place the webbase in ${webbase}.`,
				);

			STWPortal.#instance.addWebbaselet(envGet("COMMON_WEBBASE") || "./webbaselets/stwCommon.wbol"); // guid = a6T6S55WbZjerBB8QbSCr9y
			STWPortal.#instance.addWebbaselet(envGet("STUDIO_WEBBASE") || "./webbaselets/stwStudio.wbol"); // guid = a6T6S55WbZjerGVamxGi8kA

			if (envGet("DEBUG") === "true")
				STWPortal.watchWebbases();
		}
		return STWPortal.#instance;
	}

	/**
	 * Load Spin the Web Studio webbase, if it's already present, replace it.
	 */
	public addWebbaselet(filepath: string): void {
		console.log(`${new Date().toISOString()}: Adding webbaselet '${filepath}'...`);

		try {
			if (URL.parse(filepath || ""))
				fetch(new URL(filepath || ""))
					.then(response => response.text())
					.then(text => load(WBOL(text) as unknown as ISTWArea))
					.catch(_error => {
						throw _error;
					});
			else
				load(WBOL(filepath) as unknown as ISTWArea);
		} catch (error) {
			console.error(`${(error as Error).name}: ${(error as Error).message}`);
		}

		function load(webbaselet: ISTWArea) {
			const loaded = STWPortal.index.get(webbaselet.uuid);
			if (loaded)
				STWPortal.#instance.remove(loaded.uuid);

			STWPortal.#instance.children.unshift(new STWArea(webbaselet));
			STWPortal.#instance.children[0].parent = STWPortal.#instance;
		}
	}

	/**
	 * Remove the element uuid with all its descendent from the webbase
	 *
	 * @param uuid The UUID of the element to be removed
	 */
	public remove(uuid: string): void {
		const element = STWPortal.index.get(uuid);
		element?.children.forEach((child, i) => {
			this.remove(child.uuid);
			STWPortal.index.delete(child.uuid);
			element.children.splice(i, 1);
		});
	}

	// Find the element given an uuid or permalink
	public find(session: STWSession, ref: string): STWElement | null {
		const target = ref.split(/[?#]/, 1)[0];
		if (target.match(/^[xwapc][0-9a-zA-Z]{21,22}$/i)) {
			return STWPortal.index.get(target) || null;
		}
		if (target === "/") {
			return STWPortal.index.get(STWPortal.#instance.mainpage) || null;
		}
		return STWPortal.#instance.recurse(
			session,
			STWPortal.#instance.children,
			target.split("/"),
		);
	}

	private recurse(session: STWSession, children: STWElement[], slugs: string[], i: number = 1): STWElement | null {
		let result: STWElement | null = null;
		for (const child of children) {
			if (child.localize(session, "slug") === slugs[i]) {
				if (i + 1 === slugs.length) {
					return child;
				}
				result = STWPortal.#instance.recurse(session, child.children, slugs, i + 1);
				if (result) {
					return result;
				}
			}
		}
		return result;
	}

	public override serve(req: Request, session: STWSession): Promise<Response> {
		const page = STWPortal.index.get(this.mainpage);

		return page?.serve(req, session) ||
			new Promise<Response>((resolve) => {
				const response = secureResponse(`Portal ${this.localize(session, "name")} home page not found`, {
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
			'<wbol version="1.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="http://webspinner.org" xsi:schemaLocation="https://webspinner.org/schemas wbol.xsd">\n' +
			`<!--Spin the Web (TM) webbase generated ${(new Date()).toISOString()}-->\n` +
			`<portal uuid="${this.uuid}" langs="${this.langs.join(" ")}" mainpage="${this.mainpage}">\n${super.export()}${fragment}</portal>\n` +
			"</wbol>";
	}

	// Build a sitemap (see sitemaps.org) that includes the URLs of visible portal pages
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
				fragment += `<url><loc>${element.pathname(session)
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
			envGet("WEBBASE") || "./.data/webbase.wbol",
			envGet("COMMON_WEBBASE") || "./webbaselets/stwCommon.wbol",
			envGet("STUDIO_WEBBASE") || "./webbaselets/stwStudio.wbol",
		];
		let reloadTimeout: ReturnType<typeof setTimeout> | undefined;

		(async () => {
			for await (const event of Deno.watchFs(webbasePath)) {
				if (event.kind === "modify" || event.kind === "create") {
					if (reloadTimeout) clearTimeout(reloadTimeout);
					reloadTimeout = setTimeout(() => {
						console.log(`${new Date().toISOString()}: Webbase changed...`);
						STWPortal.#instance = undefined as unknown as STWPortal;
						STWPortal.index.clear();
					}, 200); // Wait 200ms for changes to settle
				}
			}
		})();
	}
}
