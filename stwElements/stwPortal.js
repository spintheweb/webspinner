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
 * @requires ../stwComponents/stwSession.js
 * @requires ../stwComponents/stwResponse.js
 * @requires ../stwComponents/stwConfig.js
 * @requires ../stwComponents/stwWBOL.js
 * @requires ./stwArea.js
 * @requires ./stwElement.js
 * @requires ./stwIndex.js
 * @license GPL-3.0-or-later
 */
import { STWArea } from "./stwArea.js";
import { STWElement } from "./stwElement.js";
import { STWIndex } from "./stwIndex.js";
import { secureResponse } from "../stwComponents/stwResponse.js";
import { envGet } from "../stwComponents/stwConfig.js";
import { WBOL } from "../stwComponents/stwWBOL.js";
import { watch } from "node:fs";
import { basename, dirname, resolve } from "node:path";
class STWPortal extends STWElement {
	static #instance;
	static index = STWIndex;
	langs;
	datasources;
	mainpage;
	version;
	constructor(portal) {
		super(portal);
		this.langs = portal.langs || ["en"];
		this.datasources = new Map(Object.entries(portal.datasources || { name: "STW", value: "" }));
		this.mainpage = portal.mainpage;
		this.version = portal.version || `v1.0.0 ${(/* @__PURE__ */ new Date()).toISOString()}`;
		STWIndex.set(portal.uuid, this);
	}
	toLocalizedJSON(session) {
		return {
			...super.toLocalizedJSON(session),
			langs: this.langs,
			datasources: Object.fromEntries(this.datasources),
			mainpage: this.mainpage,
			version: this.version
		};
	}
	/**
    * Loads webbase in memory if not loaded and return the singleton.
    *
    * @returns STWPortal Singleton
    */
	static get instance() {
		if (!STWPortal.#instance) {
			console.log(`${(/* @__PURE__ */ new Date()).toISOString()}: Loading webbase '${envGet("WEBBASE")}'...`);
			const webbase = envGet("WEBBASE") || "./.data/webbase.wbol";
			const wbol = WBOL(webbase);
			STWPortal.#instance = new STWPortal(wbol);
			if (!STWPortal.#instance)
				throw new Error(
					`Webbase '${webbase}' not found. Set WEBBASE="<path>" in the .env file or place the webbase in ${webbase}.`
				);
			STWPortal.#instance.addWebbaselet(envGet("COMMON_WEBBASE") || "./webbaselets/stwCommon.wbol");
			STWPortal.#instance.addWebbaselet(envGet("STUDIO_WEBBASE") || "./webbaselets/stwStudio.wbol");
			if (envGet("DEBUG") === "true")
				STWPortal.watchWebbases();
		}
		return STWPortal.#instance;
	}
	/**
    * Load Spin the Web Studio webbase, if it's already present, replace it.
    */
	addWebbaselet(filepath) {
		console.log(`${(/* @__PURE__ */ new Date()).toISOString()}: Adding webbaselet '${filepath}'...`);
		try {
			if (URL.parse(filepath || ""))
				fetch(new URL(filepath || "")).then((response) => response.text()).then((text) => load(WBOL(text))).catch((_error) => {
					throw _error;
				});
			else
				load(WBOL(filepath));
		} catch (error) {
			console.error(`${error.name}: ${error.message}`);
		}
		function load(webbaselet) {
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
	remove(uuid) {
		const element = STWPortal.index.get(uuid);
		element?.children.forEach((child, i) => {
			this.remove(child.uuid);
			STWPortal.index.delete(child.uuid);
			element.children.splice(i, 1);
		});
	}
	// Find the element given an uuid or permalink
	find(session, ref) {
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
			target.split("/")
		);
	}
	recurse(session, children, slugs, i = 1) {
		let result = null;
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
	serve(req, session) {
		const page = STWPortal.index.get(this.mainpage);
		return page?.serve(req, session) || new Promise((resolve2) => {
			const response = secureResponse(`Portal ${this.localize(session, "name")} home page not found`, {
				status: 404,
				statusText: "Not Found"
			});
			resolve2(response);
		});
	}
	update(session, data) {
		super.update(session, data);
		this.langs = data.langs || this.langs;
		if (data.datasources) this.datasources = new Map(Object.entries(data.datasources));
		this.mainpage = data.mainpage || this.mainpage;
		this.version = data.version || this.version;
	}
	export() {
		let fragment = "";
		this.children.forEach((child) => fragment += child.export());
		return `<?xml version="1.0" encoding="utf-8"?>
<wbol version="1.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="http://webspinner.org" xsi:schemaLocation="https://webspinner.org/schemas wbol.xsd">
<!--Spin the Web (TM) webbase generated ${(/* @__PURE__ */ new Date()).toISOString()}-->
<portal uuid="${this.uuid}" langs="${this.langs.join(" ")}" mainpage="${this.mainpage}">
${super.export()}${fragment}</portal>
</wbol>`;
	}
	// Build a sitemap (see sitemaps.org) that includes the URLs of visible portal pages
	sitemap(session) {
		let fragment = "";
		_url(this);
		return new Promise(
			(resolve2) => resolve2(
				secureResponse(
					`<?xml version="1.0" encoding="utf-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${fragment}</urlset>`
				)
			)
		);
		function _url(element) {
			if (element.type === "Area" && element.children.length > 0) {
				element.children.forEach((child) => _url(child));
			} else if (element.type === "Page" && element.isVisible(session) & 1) {
				fragment += `<url><loc>${element.pathname(session)}</loc><lastmod>${element.modified}</lastmod><priority>0.5</priority></url>
`;
			}
		}
	}
	// Watch webbase files for changes and reload when they are modified. In production this code should not be used.
	// It is useful for development purposes to see changes in real time.
	static #watcherStarted = false;
	static #watchers = [];
	static watchWebbases() {
		if (this.#watcherStarted) return;
		this.#watcherStarted = true;
		const webbasePaths = [
			envGet("WEBBASE") || "./.data/webbase.wbol",
			envGet("COMMON_WEBBASE") || "./webbaselets/stwCommon.wbol"
		];
		let reloadTimeout;
		for (const webbasePath of webbasePaths) {
			const path = resolve(webbasePath);
			const watcher = watch(dirname(path), { persistent: false }, (_event, filename) => {
				if (filename && filename.toString() !== basename(path)) return;
				if (reloadTimeout) clearTimeout(reloadTimeout);
				reloadTimeout = setTimeout(() => {
					console.log(`${(/* @__PURE__ */ new Date()).toISOString()}: Webbase changed...`);
					STWPortal.#instance = void 0;
					STWPortal.index.clear();
				}, 200);
			});
			watcher.on("error", (error) => console.error(`Webbase watcher failed for ${path}:`, error));
			this.#watchers.push(watcher);
		}
	}
}
export {
	STWPortal
};
