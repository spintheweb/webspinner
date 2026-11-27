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
		const editor = form.closest("dialog[data-stw-editor]");
		if (editor) {
			editor.close();
			if (typeof _stwRefreshStudioTree === "function") _stwRefreshStudioTree();
			return;
		}
		window.location.assign(response.url || target.href);
	} catch (error) {
		window.alert(error instanceof Error ? error.message : String(error));
	}
});

window.addEventListener("load", () => {
	stwStartWebsocket();
});

function setup() {
	document.body.querySelectorAll("input[type=checkbox]").forEach(checkbox => {
		if (checkbox.tristate) return;
		checkbox.tristate = checkbox.checked ? 1 : 2;
		checkbox.addEventListener("click", e => {
			checkbox.checked = [null, true, false][++checkbox.tristate % 3];
			checkbox.indeterminate = checkbox.tristate % 3 == 0;
		});
	});
	_stwObserveEditorRemoval();
	document.body.querySelectorAll("textarea[data-stw-editor]").forEach(_stwInitializeEditor);
}

function _stwMakeDialogDraggable(dialog) {
	let drag;
	dialog.addEventListener("pointerdown", event => {
		if (drag && !drag.heading.isConnected) {
			drag.heading.classList.remove("stwDragging");
			drag = undefined;
		}
		if (event.button !== 0 || drag) return;
		const heading = event.target.closest("h1");
		if (!heading || heading.parentElement?.localName !== "article" || heading.parentElement.parentElement !== dialog) return;
		const control = event.target.closest("button, a, input, select, textarea, [onclick], [role=button]");
		if (control && control !== heading && heading.contains(control)) return;
		const rect = dialog.getBoundingClientRect();
		drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, rect, heading };
		heading.setPointerCapture(event.pointerId);
		heading.classList.add("stwDragging");
		event.preventDefault();
	});
	dialog.addEventListener("pointermove", event => {
		if (drag?.pointerId !== event.pointerId) return;
		const view = dialog.ownerDocument.defaultView;
		const minLeft = Math.min(0, view.innerWidth - drag.rect.width);
		const maxLeft = Math.max(0, view.innerWidth - drag.rect.width);
		const maxTop = Math.max(0, view.innerHeight - drag.heading.getBoundingClientRect().height);
		const left = Math.max(minLeft, Math.min(maxLeft, drag.rect.left + event.clientX - drag.x));
		const top = Math.max(0, Math.min(maxTop, drag.rect.top + event.clientY - drag.y));
		Object.assign(dialog.style, {
			position: "fixed", margin: "0", left: `${left}px`, top: `${top}px`, right: "auto", bottom: "auto"
		});
	});
	const finish = event => {
		if (drag?.pointerId !== event.pointerId) return;
		drag.heading.classList.remove("stwDragging");
		drag = undefined;
	};
	dialog.addEventListener("pointerup", finish);
	dialog.addEventListener("pointercancel", finish);
	dialog.addEventListener("lostpointercapture", finish);
}

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

		if (data.method === "STW_BLOCK") {
			_stwStudioBlockChanged(data);
			return;
		}

		if (data.method === "STW_EDITOR_ERROR" ||
			(typeof data.studioBlockToken === "string" && (data.method === "DELETE" || !data.body))) {
			if (data.studioBlockToken) {
				try {
					await _stwReleaseBlock(data.studioBlockToken);
				} catch (error) {
					console.error("Could not release the Studio block:", error);
					window.alert(`Could not release the Studio block: ${error.message}`);
				}
			}
			window.alert("Could not open the Studio editor.");
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

		if (data.error === true) {
			if (data.placeholder) document.getElementById(data.placeholder)?.remove();
			const topDocument = window.self !== window.top ? window.top.document : document;
			topDocument.body.insertAdjacentHTML("beforeend", `<dialog onclose="this.remove()">${data.body}</dialog>`);
			const dialog = topDocument.body.lastElementChild;
			if (typeof data.studioBlockToken === "string")
				dialog.dataset.stwBlockToken = data.studioBlockToken;
			dialog.showModal();
			_stwMakeDialogDraggable(dialog);
			return;
		}

		if (data.placeholder) {
			const placeholder = document.getElementById(data.placeholder);
			placeholder?.insertAdjacentHTML("afterend", data.body);
			placeholder?.remove();
		} else if (data.section === "modeless" && typeof data.studioBlockToken === "string") {
			const topDocument = window.self !== window.top ? window.top.document : document;
			topDocument.body.insertAdjacentHTML("beforeend", `<dialog onclose="this.remove()">${data.body}</dialog>`);
			const dialog = topDocument.body.lastElementChild;
			dialog.dataset.stwEditor = "true";
			dialog.dataset.stwBlockToken = data.studioBlockToken;
			dialog.show();
			_stwMakeDialogDraggable(dialog);
		} else {
			// Replace or delete existing element by id first
			const element = data.method === "PUT" ? document.getElementById(data.id) : null;
			if (element) {
				element.insertAdjacentHTML("afterend", data.body);
				element.remove();
			} else if (data.section === "modal" || data.section === "modeless") {
				if (window.self !== window.top && data.pathname.startsWith("/stws/")) return;

				const topDocument = window.self !== window.top ? window.top.document : document;
				topDocument.body.insertAdjacentHTML("afterbegin", `<dialog onclose="this.remove()">${data.body}</dialog>`);
				const dialog = topDocument.querySelector("dialog");
				if (data.section === "modal")
					dialog?.showModal();
				else
					dialog?.show();
				if (dialog) _stwMakeDialogDraggable(dialog);
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

		setup();
		if (typeof _stwStudioApplyBlockStates === "function") _stwStudioApplyBlockStates();

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
	if (_stwLoading[src]) return _stwLoading[src];
	if (document.querySelector(`script[src="${src}"]`)) return Promise.resolve();
	_stwLoading[src] = new Promise((resolve, reject) => {
		const s = document.createElement("script");
		s.src = src;
		s.async = true;
		s.onload = () => resolve();
		s.onerror = () => {
			s.remove();
			delete _stwLoading[src];
			reject(new Error(`Failed to load script: ${src}`));
		};
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
	if (_stwLoading[href]) return _stwLoading[href];
	if (document.querySelector(`link[rel="stylesheet"][href="${href}"]`)) return Promise.resolve();
	_stwLoading[href] = new Promise((resolve, reject) => {
		const l = document.createElement("link");
		l.rel = "stylesheet";
		l.href = href;
		l.onload = () => resolve();
		l.onerror = () => {
			l.remove();
			delete _stwLoading[href];
			reject(new Error(`Failed to load stylesheet: ${href}`));
		};
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
	await _stwLoadScript(snJs);
	_stwLoaded.summernote = true;
};

window.stwLoadAce = function stwLoadAce() {
	if (_stwLoaded.ace) return Promise.resolve();
	const aceJs = "https://cdnjs.cloudflare.com/ajax/libs/ace/1.32.3/ace.min.js";
	return _stwLoadScript(aceJs).then(() => {
		_stwLoaded.ace = true;
	});
};

const _stwEditors = new WeakMap();
let _stwEditorRemovalObserver;

function _stwObserveEditorRemoval() {
	if (_stwEditorRemovalObserver) return;
	_stwEditorRemovalObserver = new MutationObserver(records => {
		for (const record of records) {
			for (const node of record.removedNodes) {
				if (node.nodeType !== 1) continue;
				const inputs = node.matches("textarea[data-stw-editor]") ? [node] : [];
				inputs.push(...node.querySelectorAll("textarea[data-stw-editor]"));
				for (const textarea of inputs) {
					if (textarea.isConnected) continue;
					const initializing = _stwEditors.get(textarea);
					if (initializing) {
						_stwEditors.delete(textarea);
						initializing.then(dispose => dispose?.()).catch(error => {
							console.error("Could not dispose editor:", error);
						});
					}
				}
			}
		}
	});
	_stwEditorRemovalObserver.observe(document.body, { childList: true, subtree: true });
}

function _stwInitializeEditor(textarea) {
	if (_stwEditors.has(textarea)) return;
	const initializing = (async () => {
		const format = textarea.dataset.stwEditor;
		if (format === "wysiwyg") {
			await window.stwLoadSummernote();
			if (!textarea.isConnected || _stwEditors.get(textarea) !== initializing) return;
			const input = window.jQuery(textarea);
			input.summernote({
				callbacks: {
					onChange(contents) {
						if (textarea.value !== contents) {
							textarea.value = contents;
							textarea.dispatchEvent(new Event("input", { bubbles: true }));
						}
					}
				}
			});
			const host = textarea.nextElementSibling;
			const sync = () => {
				if (input.summernote("code") !== textarea.value)
					input.summernote("code", textarea.value);
			};
			textarea.addEventListener("input", sync);
			const unwatch = _stwWatchEditor(textarea, host, () => {
				input.summernote(textarea.disabled || textarea.readOnly ? "disable" : "enable");
			}, () => input.summernote("focus"));
			const unreset = _stwSyncEditorReset(textarea, sync);
			return () => {
				unwatch();
				unreset();
				textarea.removeEventListener("input", sync);
				input.summernote("destroy");
			};
		}
		await window.stwLoadAce();
		if (!textarea.isConnected || _stwEditors.get(textarea) !== initializing) return;
		const host = document.createElement("div");
		host.className = "stwCodeeditor";
		textarea.insertAdjacentElement("afterend", host);
		const editor = window.ace.edit(host);
		editor.session.setMode(`ace/mode/${format}`);
		editor.setValue(textarea.value, -1);
		editor.session.on("change", () => {
			const value = editor.getValue();
			if (textarea.value !== value) {
				textarea.value = value;
				textarea.dispatchEvent(new Event("input", { bubbles: true }));
			}
		});
		const sync = () => {
			if (editor.getValue() !== textarea.value) editor.setValue(textarea.value, -1);
			editor.resize();
		};
		textarea.addEventListener("input", sync);
		const previousDisplay = textarea.style.display;
		textarea.style.display = "none";
		const unwatch = _stwWatchEditor(textarea, host, () => editor.setReadOnly(textarea.disabled || textarea.readOnly), () => editor.focus());
		const unreset = _stwSyncEditorReset(textarea, sync);
		const resizeObserver = new ResizeObserver(() => editor.resize());
		resizeObserver.observe(host);
		return () => {
			unwatch();
			unreset();
			resizeObserver.disconnect();
			textarea.removeEventListener("input", sync);
			editor.destroy();
			host.remove();
			textarea.style.display = previousDisplay;
		};
	})();
	_stwEditors.set(textarea, initializing);
	initializing.catch(error => {
		if (_stwEditors.get(textarea) === initializing) _stwEditors.delete(textarea);
		console.error("Could not initialize editor:", error);
		window.alert(`Could not initialize editor: ${error instanceof Error ? error.message : String(error)}`);
	});
}

function _stwWatchEditor(textarea, host, updateState, focus) {
	const update = () => {
		host.hidden = textarea.hidden;
		updateState();
	};
	update();
	const observer = new MutationObserver(update);
	observer.observe(textarea, { attributes: true, attributeFilter: ["hidden", "disabled", "readonly"] });
	const invalid = event => {
		event.preventDefault();
		focus();
		window.alert(textarea.validationMessage);
	};
	textarea.addEventListener("invalid", invalid);
	return () => {
		observer.disconnect();
		textarea.removeEventListener("invalid", invalid);
	};
}

function _stwSyncEditorReset(textarea, sync) {
	const form = textarea.form;
	const reset = () => queueMicrotask(sync);
	form?.addEventListener("reset", reset);
	return () => form?.removeEventListener("reset", reset);
}
