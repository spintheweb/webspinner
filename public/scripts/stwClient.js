/**
 * @fileoverview Spin the Web browser client runtime.
 *
 * Runs in the browser to handle signed server-action submissions and real-time
 * communication with Webspinner over WebSockets.
 *
 * @author Giancarlo Trevisan
 * @version 1.0.0
 * @module stwClient
 * @note Copilot-assisted
 * @license Apache-2.0
 */

let stwWS;
let stwCanStudio = false;
const stwIsEmbedded = window.self !== window.top;

document.addEventListener("submit", async (event) => {
	const form = event.target;
	const studioUrl = form.querySelector("[data-stw-studio-url]");
	if (studioUrl) {
		event.preventDefault();
		_stwStudioNavigate(studioUrl.value);
		return;
	}

	const button = event.submitter;
	const token = button?.dataset.stwActionToken;

	if (!token) return;

	event.preventDefault();
	const action = button.value || "stwsubmit";
	const method = action === "stwsearch" || action === "stwfilter" ? "GET"
		: action === "stwinsert" ? "PUT"
			: action === "stwupdate" ? "PATCH"
				: action === "stwdelete" ? "DELETE" : "POST";
	const target = button.dataset.stwCurrentUrl === "true"
		? new URL(window.location.href)
		: new URL(button.formAction || form.action || window.location.href, window.location.href);
		
	try {
		for (const [key, value] of JSON.parse(button.dataset.stwParams || "[]")) {
			target.searchParams.set(key, value);
		}
		let formData = new FormData(form, button);
		const tableActions = button.closest(".stwTableRowActions, .stwTableInsertActions");
		if (form.id.startsWith("stwFE") && tableActions) {
			const row = button.closest("tr");
			const tableFormData = new FormData();
			for (const control of row.querySelectorAll("input,select,textarea")) {
				if (control.disabled || !control.name || ["button", "submit", "reset"].includes(control.type)) continue;
				if (["checkbox", "radio"].includes(control.type) && !control.checked) continue;
				if (control instanceof HTMLSelectElement && control.multiple) {
					for (const option of control.selectedOptions) tableFormData.append(control.name, option.value);
				} else if (control instanceof HTMLInputElement && control.type === "file") {
					for (const file of control.files) tableFormData.append(control.name, file);
				} else {
					tableFormData.append(control.name, control.value);
				}
			}
			if (formData.has("stwOrigin")) tableFormData.set("stwOrigin", formData.get("stwOrigin"));
			formData = tableFormData;
		}
		formData.set("stwAction", action);
		formData.set("stwActionToken", token);
		formData.set("stwRedirect", target.href);
		if (!formData.has("stwOrigin") && button.dataset.stwOrigin) {
			formData.set("stwOrigin", button.dataset.stwOrigin);
		}
		let url = new URL(target);
		const request = { method, redirect: "follow" };
		if (method === "GET") {
			for (const [key, value] of formData.entries()) {
				if (!(value instanceof File)) url.searchParams.append(key, value);
			}
		} else {
			request.body = formData;
		}
		const response = await fetch(url, request);
		if (!response.ok) {
			const message = await response.text();
			throw new Error(message || `Action failed (${response.status})`);
		}
		window.location.assign(response.url || target.href);
	} catch (error) {
		window.alert(error instanceof Error ? error.message : String(error));
	}
});

window.addEventListener("load", () => {
	stwStartWebsocket();
});

function _newId(uuid, type = "x") {
	const alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
	const hex = uuid.replace(/-/g, "");

	let n = BigInt("0x" + hex);
	if (n === 0n) return "0";
	let out = "";
	const base = 62n;
	while (n > 0n) {
		const rem = Number(n % base);
		out = alphabet[rem] + out;
		n = n / base;
	}
	return type + out;
}

const stwTabIdKey = stwIsEmbedded ? "stwTabId:embedded" : "stwTabId";
const stwTabId = sessionStorage.getItem(stwTabIdKey) || (() => {
	const raw = crypto.randomUUID
		? crypto.randomUUID()
		: (Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2));
	const id = _newId(raw);
	sessionStorage.setItem(stwTabIdKey, id);
	return id;
})();

function stwStartWebsocket() {
	if (stwWS && (stwWS.readyState === WebSocket.OPEN || stwWS.readyState === WebSocket.CONNECTING)) return;

	const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
	const wsUrl = `${protocol}//${window.location.host}/?tab=${encodeURIComponent(stwTabId)}`;
	stwWS = new WebSocket(wsUrl);

	stwWS.onopen = () => {
		stwWS.send(JSON.stringify({
			method: "HEAD",
			resource: document.location.pathname,
			options: {
				lang: navigator.language,
				langs: navigator.languages,
				tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
				placeholder: "",
			},
			search: window.location.search
		}));

		document.querySelectorAll("[lang]").forEach((element) => element.setAttribute("lang", "en-US"));
	};

	stwWS.onmessage = async (event) => {
		// event.data = { method: "GET" | "PUT" | "PATCH" | "DELETE", id: string, section: string, sequence: number, body: string }
		const data = JSON.parse(event.data);

		if (data.method === "REDIRECT") {
			window.location.assign(data.url);
			return;
		}

		if (data.method === "AUTH") {
			stwCanStudio = data.canStudio === true;
			if (stwIsEmbedded) return;
			if (!stwCanStudio) {
				if (_isStudioPage()) _disableStudio();
				return;
			}
			return;
		}

		if (data.method === "PATCH") {
			stwWS.send(JSON.stringify({ method: "PATCH", resource: data.id, options: { placeholder: data.placeholder }, search: window.location.search }));
			return;
		}

		if (data.method === "DELETE") {
			document.getElementById(data.placeholder || data.id)?.remove();
			return;
		}

		if (data.placeholder) {
			const placeholder = document.getElementById(data.placeholder);
			placeholder?.insertAdjacentHTML("afterend", data.body);
			placeholder?.remove();
		} else {
			// Replace or delete existing element by id first
			if (data.method === "PUT") {
				const element = document.getElementById(data.id);
				if (element) {
					element.insertAdjacentHTML("afterend", data.body);
					element.remove();
					return; // done
				}
			}

			if (data.section === "modal" || data.section === "modeless") {
				document.body.insertAdjacentHTML("afterbegin", `<dialog onclose="this.remove()">${data.body}</dialog>`);
				if (data.section === "modal") {
					document.querySelector("dialog")?.showModal();
				} else {
					document.querySelector("dialog")?.show();
				}
			} else {
				let insertion = document.getElementById(data.section);
				insertion?.querySelectorAll("article[data-sequence]").forEach((article) => {
					if (parseFloat(article.dataset.sequence) < parseFloat(data.sequence)) {
						insertion = article;
					}
				});
				insertion?.insertAdjacentHTML(insertion.id === data.section ? "afterbegin" : "afterend", data.body);
			}
		}

		// Load articles
		document.body.querySelectorAll("article[href]").forEach((article) => {
			stwWS.send(
				JSON.stringify({
					method: "PATCH",
					resource: article.getAttribute("href"),
					options: { placeholder: article.id },
					search: window.location.search
				}),
			);
			article.removeAttribute("href");
		});

		try {
			await _stwLoadContentResources();
		} catch (error) {
			console.error("Failed to load content resources:", error);
		}
	};

	stwWS.onclose = () => {
		setTimeout(stwStartWebsocket, 2000);
	};

	stwWS.onerror = (err) => {
		console.error(err);
		stwWS = null;
		setTimeout(stwStartWebsocket, 5000);
	};
}
// --- Lazy editor loader utilities ---
const _stwLoaded = { jquery: false, summernote: false, ace: false };
const _stwLoading = {};

function _stwLoadScript(src) {
	if (document.querySelector(`script[src="${src}"]`)) return Promise.resolve();
	if (_stwLoading[src]) return _stwLoading[src];
	_stwLoading[src] = new Promise((resolve, reject) => {
		const s = document.createElement("script");
		s.src = src;
		s.async = true;
		s.onload = () => resolve();
		s.onerror = () => reject(new Error(`Failed to load script: ${src}`));
		document.head.appendChild(s);
	});
	return _stwLoading[src];
}

const _stwContentResources = new Map();
const _stwInlineContentScripts = new Set();

async function _stwLoadContentResources() {
	const links = [...document.body.querySelectorAll("link[href]")];
	const scripts = [...document.body.querySelectorAll("script")];
	const externalScripts = scripts.filter((script) => script.src);
	const inlineScripts = scripts.filter((script) => !script.src);

	try {
		await Promise.all(links.map((link) => _stwLoadContentResource("link", link)));
		links.forEach(_stwRunContentLoadHandler);
		for (const script of externalScripts) {
			await _stwLoadContentResource("script", script);
			_stwRunContentLoadHandler(script);
		}

		for (const script of inlineScripts) {
			const name = script.getAttribute("name");
			if (script.textContent && (!name || !_stwInlineContentScripts.has(name))) {
				const loadedScript = document.createElement("script");
				for (const attribute of script.attributes) {
					if (attribute.name !== "onload") loadedScript.setAttribute(attribute.name, attribute.value);
				}
				loadedScript.textContent = script.textContent;
				document.head.appendChild(loadedScript);
				if (name) _stwInlineContentScripts.add(name);
			}
			_stwRunContentLoadHandler(script);
		}
	} finally {
		links.forEach((link) => link.remove());
		scripts.forEach((script) => script.remove());
	}
}

function _stwLoadContentResource(type, source) {
	const attribute = type === "script" ? "src" : "href";
	const url = new URL(source.getAttribute(attribute), document.baseURI).href;
	const name = source.getAttribute("name");
	const keys = [`${type}:url:${url}`];
	if (name) keys.push(`${type}:name:${name}`);
	const cached = keys.map((key) => _stwContentResources.get(key)).find(Boolean);
	if (cached) return cached;

	const existing = [...document.head.querySelectorAll(type)].find((resource) =>
		(name && resource.getAttribute("name") === name) || resource[attribute] === url
	);
	if (existing) {
		const loaded = Promise.resolve();
		keys.forEach((key) => _stwContentResources.set(key, loaded));
		return loaded;
	}

	const resource = document.createElement(type);
	for (const attribute2 of source.attributes) {
		if (attribute2.name !== "onload") resource.setAttribute(attribute2.name, attribute2.value);
	}
	const promise = new Promise((resolve, reject) => {
		resource.addEventListener("load", resolve, { once: true });
		resource.addEventListener("error", () => {
			keys.forEach((key) => _stwContentResources.delete(key));
			reject(new Error(`Failed to load content ${type}: ${url}`));
		}, { once: true });
	});
	keys.forEach((key) => _stwContentResources.set(key, promise));
	document.head.appendChild(resource);
	return promise;
}

function _stwRunContentLoadHandler(script) {
	if (typeof script.onload === "function") script.onload.call(script, new Event("load"));
}

function _stwLoadStyle(href) {
	if (document.querySelector(`link[rel="stylesheet"][href="${href}"]`)) return Promise.resolve();
	if (_stwLoading[href]) return _stwLoading[href];
	_stwLoading[href] = new Promise((resolve) => {
		const l = document.createElement("link");
		l.rel = "stylesheet";
		l.href = href;
		l.onload = () => resolve();
		// stylesheets may not reliably fire onload; resolve after a microtask as a best-effort
		setTimeout(() => resolve(), 50);
		document.head.appendChild(l);
	});
	return _stwLoading[href];
}

window.stwLoadSummernote = async function stwLoadSummernote() {
	if (_stwLoaded.summernote) return Promise.resolve();
	const jqueryCdn = "https://cdnjs.cloudflare.com/ajax/libs/jquery/3.7.1/jquery.min.js";
	const snCss = "https://cdnjs.cloudflare.com/ajax/libs/summernote/0.8.20/summernote-lite.min.css";
	const snJs = "https://cdnjs.cloudflare.com/ajax/libs/summernote/0.8.20/summernote-lite.min.js";
	const ensureJq = window.jQuery ? Promise.resolve() : _stwLoadScript(jqueryCdn).then(() => {
		_stwLoaded.jquery = true;
	});
	await Promise.all([ensureJq, _stwLoadStyle(snCss)]);
	_stwLoadScript(snJs);
	_stwLoaded.summernote = true;
};

window.stwLoadAce = function stwLoadAce() {
	if (_stwLoaded.ace) return Promise.resolve();
	const aceJs = "https://cdnjs.cloudflare.com/ajax/libs/ace/1.32.3/ace.min.js";
	return _stwLoadScript(aceJs).then(() => {
		_stwLoaded.ace = true;
	});
};
