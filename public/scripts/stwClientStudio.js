/**
 * @fileoverview Studio-specific browser runtime.
 * @license Apache-2.0
 */

const stwStudioReturnUrlKey = "stwStudioReturnUrl";
const stwStudioBlocks = new Map();
const stwStudioBlockStates = new Map();

function _isStudioPage() {
	return /^\/stws(?:\/|$)/.test(window.location.pathname);
}

function _isStudioUrl(url) {
	return url.origin === window.location.origin && /^\/stws(?:\/|$)/.test(url.pathname);
}

function _isStudioPreview() {
	if (!stwIsEmbedded) return false;
	try {
		return window.parent.document.getElementById("stwStudioPreview")?.contentWindow === window;
	} catch (error) {
		if (!(error instanceof DOMException && error.name === "SecurityError")) throw error;
		return false;
	}
}

function _stwStudioReturnUrl() {
	const destination = sessionStorage.getItem(stwStudioReturnUrlKey);
	if (!destination) return null;
	const url = new URL(destination, window.location.origin);
	return url.origin === window.location.origin && !_isStudioUrl(url) ? url.href : null;
}

function _stwStudioFrame() {
	return window.stwStudioPreviewFrame?.isConnected
		? window.stwStudioPreviewFrame
		: document.getElementById("stwStudioPreview");
}

function _stwStudioSyncUrl() {
	const frame = _stwStudioFrame();
	const input = document.querySelector("[data-stw-studio-url]");
	if (!frame) return;
	try {
		const url = frame.contentWindow.location.href;
		frame.dataset.url = url;
		window.stwStudioPreviewUrl = url;
		if (input) input.value = url;
	} catch (error) {
		if (!(error instanceof DOMException && error.name === "SecurityError")) throw error;
	}
}

function _stwStudioAttachPreview(host) {
	if (!host) return;
	let frame = _stwStudioFrame();
	if (!frame) {
		frame = document.createElement("iframe");
		frame.id = "stwStudioPreview";
		frame.title = "Webspinner portal preview";
		window.stwStudioPreviewUrl ||= _stwStudioReturnUrl() || new URL("/", window.location.origin).href;
		frame.src = window.stwStudioPreviewUrl;
	}
	window.stwStudioPreviewFrame = frame;
	host.append(frame);
	frame.onload = _stwStudioSyncUrl;
	_stwStudioSyncUrl();
}

function _stwStudioNavigate(destination) {
	const frame = _stwStudioFrame();
	let url;
	try {
		const base = frame?.dataset.url || window.stwStudioPreviewUrl || window.location.href;
		url = new URL(String(destination || "").trim() || base, base);
	} catch {
		return;
	}
	if (_isStudioUrl(url)) {
		window.alert("Studio cannot be opened inside the portal preview.");
		return;
	}
	window.stwStudioPreviewUrl = url.href;
	if (url.origin !== window.location.origin) {
		window.location.assign(url.href);
		return;
	}
	if (frame) frame.src = url.href;
	else window.location.assign(url.href);
}

function _stwStudioBack() {
	const frame = _stwStudioFrame();
	if (frame?.contentWindow) frame.contentWindow.history.back();
}

function _stwStudioForward() {
	const frame = _stwStudioFrame();
	if (frame?.contentWindow) frame.contentWindow.history.forward();
}

function _stwStudioRefresh() {
	const frame = _stwStudioFrame();
	if (frame?.contentWindow) frame.contentWindow.location.reload();
}

function _disableStudio() {
	const wasEnabled = _isStudioPage();
	let destination = window.stwStudioPreviewUrl || _stwStudioReturnUrl() || window.location.href;
	const preview = _stwStudioFrame();
	if (wasEnabled && preview?.contentWindow) {
		try {
			const previewUrl = new URL(preview.contentWindow.location.href);
			if (previewUrl.origin === window.location.origin) destination = previewUrl.href;
		} catch (error) {
			if (!(error instanceof DOMException && error.name === "SecurityError")) throw error;
		}
	}
	if (wasEnabled) {
		sessionStorage.removeItem(stwStudioReturnUrlKey);
		window.location.assign(destination);
	}
}

function _stwToggleStudio() {
	if (!stwCanStudio) return;
	if (_isStudioPage()) {
		_disableStudio();
		return;
	}
	sessionStorage.setItem(stwStudioReturnUrlKey, window.location.href);
	window.location.assign(new URL("/stws", window.location.origin).href);
}

function _stwOpenContentEditor(uuid) {
	if (stwIsEmbedded) {
		window.parent.postMessage({ type: "stwStudio:editContent", uuid }, window.location.origin);
	} else {
		_stwSendEditorRequest("/stws/edit/edit-content", uuid);
	}
}

function _stwOpenElementEditor(anchor) {
	const type = anchor.dataset.stwEditorType;
	const uuid = anchor.dataset.stwEditorUuid;
	const resource = {
		Portal: "/stws/edit/edit-portal",
		Area: "/stws/edit/edit-area",
		Page: "/stws/edit/edit-page",
		Content: "/stws/edit/edit-content"
	}[type];
	if (!resource) {
		window.alert(`No Studio editor is available for ${type || "this element"}.`);
		return;
	}
	_stwSendEditorRequest(resource, uuid);
}

function _stwStudioSearchMatcher(query, regex, matchCase, wholeWord) {
	const pattern = regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const source = wholeWord ? `(?<![\\p{L}\\p{N}_])(?:${pattern})(?![\\p{L}\\p{N}_])` : pattern;
	return new RegExp(source, matchCase ? "u" : "iu");
}

function _stwStudioSearchValues(element, language) {
	const fields = [
		"name", "slug", "description", "visibility", "subtype", "section", "sequence",
		"cssClass", "connector", "query", "params", "layout", "contentType", "options",
		"ref", "template", "mainpage", "version", "inheritContents", "langs", "connectors", "extra"
	];
	const localized = new Set(["name", "slug", "description", "layout"]);
	const values = [];
	const collect = (value, key) => {
		if (value === null || value === undefined) return;
		if (typeof value !== "object") {
			values.push(String(value));
		} else if (Array.isArray(value)) {
			value.forEach(item => collect(item));
		} else if (localized.has(key)) {
			collect(value[language]);
		} else {
			for (const [nestedKey, nestedValue] of Object.entries(value)) {
				if (key === "visibility" || key === "connectors") values.push(nestedKey);
				collect(nestedValue, nestedKey);
			}
		}
	};
	fields.forEach(field => collect(element[field], field));
	return values;
}

const stwStudioSearchGenerations = new WeakMap();

function _stwStudioSearchToggle(button) {
	const pressed = button.getAttribute("aria-pressed") !== "true";
	button.setAttribute("aria-pressed", String(pressed));
	button.classList.toggle("stwSelected", pressed);
}

function _stwStudioSearchKey(event, input) {
	if (event.key !== "Enter") return;
	event.preventDefault();
	_stwStudioSearch(input);
}

function _stwStudioShowSearchResults(article, ids, language) {
	const list = article.querySelector('[data-stw-search-results], #c7StudioSearchResults01');
	if (!list) throw new Error("The search results list is not available.");
	if (!stwWS || stwWS.readyState !== WebSocket.OPEN)
		throw new Error("The Studio connection is unavailable.");
	const encoded = btoa(encodeURIComponent(JSON.stringify(ids)))
		.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
	const uuid = crypto.randomUUID ? crypto.randomUUID() :
		Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2);
	list.dataset.stwSearchResults = "";
	list.id = _newId(uuid, "c");
	stwWS.send(JSON.stringify({
		method: "PATCH", resource: "c7StudioSearchResults01",
		options: { placeholder: list.id },
		search: { stwSearchIds: encoded, stwSearchLocale: language }
	}));
}

async function _stwStudioSearch(control) {
	const article = control.closest("article");
	const input = article.querySelector('input[name="search"]');
	const language = input.dataset.stwLanguage;
	const status = article.querySelector("[data-stw-search-status]");
	const controls = Object.fromEntries([...article.querySelectorAll("[data-stw-search-action]")]
		.map(button => [button.dataset.stwSearchAction, button]));
	const current = (stwStudioSearchGenerations.get(article) || 0) + 1;
	stwStudioSearchGenerations.set(article, current);
	status.textContent = "";
	const previousResults = article.querySelector('[data-stw-search-results], #c7StudioSearchResults01');
	if (previousResults) previousResults.hidden = true;
	let matcher;
	try {
		if (!input.value) {
			_stwStudioShowSearchResults(article, [], language);
			return;
		}
		matcher = _stwStudioSearchMatcher(input.value,
			controls.regex.getAttribute("aria-pressed") === "true",
			controls.case.getAttribute("aria-pressed") === "true",
			controls.word.getAttribute("aria-pressed") === "true");
	} catch (error) {
		status.textContent = error instanceof SyntaxError
			? `Invalid regular expression: ${error.message}` : error.message;
		return;
	}
	status.textContent = "Searching...";
	try {
		const response = await fetch("/wbol");
		if (!response.ok) throw new Error(`Search request failed (${response.status}): ${await response.text()}`);
		const tree = await response.json();
		const entries = [];
		const visit = node => {
			entries.push(node);
			(node.children || []).forEach(visit);
		};
		visit(tree);
		let next = 0;
		const matches = new Array(entries.length);
		const worker = async () => {
			while (next < entries.length) {
				const index = next++;
				const node = entries[index];
				const response = await fetch(`/wbol/${encodeURIComponent(node.uuid)}?locale=${encodeURIComponent(language)}&fallback=false`);
				if (index === 0 && response.status === 403) continue;
				if (!response.ok) throw new Error(`Search request failed (${response.status}): ${await response.text()}`);
				const element = await response.json();
				matches[index] = _stwStudioSearchValues(element, language).some(value => matcher.test(value));
			}
		};
		await Promise.all(Array.from({ length: Math.min(6, entries.length) }, worker));
		if (current !== stwStudioSearchGenerations.get(article)) return;
		const ids = entries.filter((_node, index) => matches[index]).map(node => node.uuid);
		_stwStudioShowSearchResults(article, ids, language);
		status.textContent = ids.length ? `${ids.length} result${ids.length === 1 ? "" : "s"}` : "No results.";
	} catch (error) {
		if (current === stwStudioSearchGenerations.get(article))
			status.textContent = error instanceof Error ? error.message : String(error);
	}
}

async function _stwSendEditorRequest(resource, uuid) {
	if (!stwCanStudio || !stwWS || stwWS.readyState !== WebSocket.OPEN) {
		window.alert("The Studio editor connection is unavailable.");
		return;
	}
	let token;
	try {
		const response = await fetch(`/wbol/${encodeURIComponent(uuid)}/block`, { method: "POST" });
		if (!response.ok) throw new Error(`Could not block element (${response.status}): ${await response.text()}`);
		const block = await response.json();
		if (!block || typeof block.blocked !== "string" ||
			(block.token !== null && (typeof block.token !== "string" || !block.token)))
			throw new Error("Invalid block response from Webspinner.");
		token = block.token;
		if (token) stwStudioBlocks.set(token, uuid);
		if (!stwWS || stwWS.readyState !== WebSocket.OPEN) throw new Error("The Studio editor connection is unavailable.");
		stwWS.send(JSON.stringify({
			method: "PATCH",
			resource,
			options: { placeholder: "", recurse: false, studioBlockToken: token || "" },
			search: { uuid, stwBlockToken: token || "" }
		}));
	} catch (error) {
		if (token) {
			try {
				await _stwReleaseBlock(token);
			} catch (releaseError) {
				console.error("Could not release the Studio block:", releaseError);
			}
		}
		window.alert(error instanceof Error ? error.message : String(error));
	}
}

async function _stwReleaseBlock(token) {
	const uuid = stwStudioBlocks.get(token);
	if (!uuid) return;
	const response = await fetch(`/wbol/${encodeURIComponent(uuid)}/block?token=${encodeURIComponent(token)}`, {
		method: "DELETE", keepalive: true
	});
	if (!response.ok && response.status !== 404) throw new Error(`Could not release block (${response.status}): ${await response.text()}`);
	stwStudioBlocks.delete(token);
}

document.addEventListener("close", (event) => {
	const token = event.target.dataset?.stwBlockToken ||
		event.target.querySelector?.('input[name="uuid"][data-stw-block-token]')?.dataset.stwBlockToken;
	if (!token || !stwStudioBlocks.has(token)) return;
	_stwReleaseBlock(token).catch((error) => {
		console.error("Could not release the Studio block:", error);
		window.alert(error.message);
	});
}, true);

function _stwStudioBlockChanged(data) {
	stwStudioBlockStates.set(data.id, { blocked: data.blocked, own: data.own });
	_stwStudioApplyBlockStates();
}

function _stwStudioApplyBlockStates() {
	if (!stwStudioBlockStates.size) return;
	const tree = document.getElementById("c6TC0s1xSa5NgDIgMyCbIhL");
	if (!tree) return;
	for (const anchor of tree.querySelectorAll("a[data-uuid]")) {
		const state = stwStudioBlockStates.get(anchor.dataset.uuid);
		if (!state) continue;
		const badge = anchor.closest("li")?.firstElementChild?.querySelector("[data-stw-lock]");
		if (!badge) continue;
		badge.hidden = !state.blocked;
		badge.className = `fa-light fa-fw ${state.own ? "fa-lock-open" : "fa-lock"}`;
		badge.setAttribute("aria-label", state.own ? "Locked by you" : "Locked by another user");
	}
}

function _stwRefreshStudioTree() {
	if (!document.getElementById("c6TC0s1xSa5NgDIgMyCbIhL")) return;
	if (!stwWS || stwWS.readyState !== WebSocket.OPEN) {
		window.alert("The Studio tree could not be refreshed because the connection is unavailable.");
		return;
	}
	stwWS.send(JSON.stringify({
		method: "PATCH", resource: "c6TC0s1xSa5NgDIgMyCbIhL",
		options: { placeholder: "" }, search: window.location.search
	}));
}

window.addEventListener("pagehide", () => {
	for (const token of stwStudioBlocks.keys()) {
		_stwReleaseBlock(token).catch((error) => console.error("Could not release the Studio block:", error));
	}
});

window.addEventListener("message", (event) => {
	if (event.origin !== window.location.origin || event.source !== _stwStudioFrame()?.contentWindow) return;
	const message = event.data;
	if (message?.type === "stwStudio:toggle") {
		_stwToggleStudio();
	} else if (message?.type === "stwStudio:editContent" &&
		typeof message.uuid === "string" &&
		message.uuid.length > 0 &&
		message.uuid.length <= 128) {
		_stwOpenContentEditor(message.uuid);
	} else if (message?.type === "stwStudio:navigate" && typeof message.url === "string") {
		_stwStudioNavigate(message.url);
	}
});

function _stwSetupSplitters() {
	const frame = document.getElementById("frame");
	const left = document.getElementById("leftPanel");
	const right = document.getElementById("rightPanel");
	const leftBar = left?.nextElementSibling;
	const rightBar = right?.previousElementSibling;
	if (!frame || !left || !right || !leftBar || !rightBar) return;

	let leftWidth = Math.min(250, frame.clientWidth / 4);
	let rightWidth = leftWidth;
	const bounds = () => {
		const minimum = 20 * parseFloat(window.getComputedStyle(document.documentElement).fontSize);
		const leftRequested = left.childElementCount > 0 && !left.hidden && window.getComputedStyle(left).display !== "none";
		const rightRequested = right.childElementCount > 0 && !right.hidden && window.getComputedStyle(right).display !== "none";
		const hideRight = leftRequested && rightRequested && frame.clientWidth < 2 * minimum + 2;
		const hideLeft = leftRequested && frame.clientWidth < minimum + 1;
		const hideOnlyRight = !leftRequested && rightRequested && frame.clientWidth < minimum + 1;
		const leftVisible = leftRequested && !hideLeft;
		const rightVisible = rightRequested && !hideRight && !hideOnlyRight;
		const visibleCount = Number(leftVisible) + Number(rightVisible);
		const barWidth = visibleCount ? 1 : 0;
		const space = Math.max(0, frame.clientWidth - visibleCount * barWidth);
		const available = space - Math.min(200, Math.max(0, space - visibleCount * minimum));
		return { available, minimum, barWidth, leftVisible, rightVisible, hideLeft, hideRight: hideRight || hideOnlyRight };
	};
	const update = () => {
		const { available, minimum, barWidth, leftVisible, rightVisible, hideLeft, hideRight } = bounds();
		frame.classList.toggle("stwStudioAutoHideLeft", hideLeft);
		frame.classList.toggle("stwStudioAutoHideRight", hideRight);
		if (leftVisible) leftWidth = Math.max(minimum, Math.min(leftWidth, available - (rightVisible ? minimum : 0)));
		if (rightVisible) rightWidth = Math.max(minimum, Math.min(rightWidth, available - (leftVisible ? leftWidth : 0)));
		frame.style.setProperty("--stw-left-width", `${leftVisible ? leftWidth : 0}px`);
		frame.style.setProperty("--stw-right-width", `${rightVisible ? rightWidth : 0}px`);
		frame.style.setProperty("--stw-left-bar-width", `${leftVisible ? barWidth : 0}px`);
		frame.style.setProperty("--stw-right-bar-width", `${rightVisible ? barWidth : 0}px`);
		leftBar.hidden = !leftVisible;
		rightBar.hidden = !rightVisible;
		for (const [bar, value, other] of [[leftBar, leftWidth, rightVisible ? rightWidth : 0], [rightBar, rightWidth, leftVisible ? leftWidth : 0]]) {
			bar.setAttribute("aria-valuemin", String(Math.round(minimum)));
			bar.setAttribute("aria-valuemax", String(Math.round(available - other)));
			bar.setAttribute("aria-valuenow", String(Math.round(value)));
		}
	};
	for (const [bar, panel, side] of [[leftBar, left, "left"], [rightBar, right, "right"]]) {
		bar.classList.add("stwStudioSplitter");
		bar.tabIndex = 0;
		bar.setAttribute("role", "separator");
		bar.setAttribute("aria-orientation", "vertical");
		bar.setAttribute("aria-label", `${side === "left" ? "Left" : "Right"} panel width`);
		bar.setAttribute("aria-controls", panel.id);
		const resize = value => {
			const { available, minimum, leftVisible, rightVisible } = bounds();
			if (side === "left") leftWidth = Math.max(minimum, Math.min(value, available - (rightVisible ? rightWidth : 0)));
			else rightWidth = Math.max(minimum, Math.min(value, available - (leftVisible ? leftWidth : 0)));
			update();
		};
		let drag;
		bar.addEventListener("pointerdown", event => {
			if (event.button !== 0) return;
			drag = { pointerId: event.pointerId, start: event.clientX, width: side === "left" ? leftWidth : rightWidth };
			bar.setPointerCapture(event.pointerId);
			event.preventDefault();
		});
		bar.addEventListener("pointermove", event => {
			if (drag?.pointerId !== event.pointerId) return;
			resize(drag.width + (event.clientX - drag.start) * (side === "left" ? 1 : -1));
		});
		bar.addEventListener("pointerup", event => {
			if (drag?.pointerId === event.pointerId) drag = undefined;
		});
		bar.addEventListener("lostpointercapture", () => { drag = undefined; });
		bar.addEventListener("keydown", event => {
			const width = side === "left" ? leftWidth : rightWidth;
			if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
				const direction = event.key === "ArrowRight" ? 1 : -1;
				resize(width + direction * (side === "left" ? 1 : -1) * (event.shiftKey ? 50 : 10));
			} else if (event.key === "Home") resize(0);
			else if (event.key === "End") resize(bounds().available);
			else return;
			event.preventDefault();
		});
	}
	update();
	window.addEventListener("resize", update);
	const visibilityObserver = new MutationObserver(update);
	visibilityObserver.observe(left, { childList: true, attributes: true, attributeFilter: ["style", "hidden", "class"] });
	visibilityObserver.observe(right, { childList: true, attributes: true, attributeFilter: ["style", "hidden", "class"] });
}

document.addEventListener("DOMContentLoaded", () => {
	document.body.classList.toggle("stwStudioPage", _isStudioPage());
	if (_isStudioPage()) _stwSetupSplitters();
});

window.addEventListener("keydown", (event) => {
	if (!stwCanStudio || !event.altKey || event.key !== "F12") 
		return;
	event.preventDefault();
	if (stwIsEmbedded) {
		window.parent.postMessage({ type: "stwStudio:toggle" }, window.location.origin);
	} else {
		_stwToggleStudio();
	}
});

document.addEventListener("click", (event) => {
	const article = event.target.closest("article[id]");
	const inStudio = stwCanStudio && (stwIsEmbedded || _isStudioPage());
	if (article && event.altKey && inStudio) {
		event.stopPropagation();
		event.preventDefault();
		if (stwIsEmbedded) {
			window.parent.postMessage({ type: "stwStudio:editContent", uuid: article.id }, window.location.origin);
		} else {
			_stwOpenContentEditor(article.id);
		}
	}
});

function _stwHandleNavClick(event) {
	const path = typeof event.composedPath === "function" ? event.composedPath() : [event.target];
	let a = null;
	for (const n of path) {
		if (n && n.nodeType === 1 && typeof n.closest === "function") {
			a = n.closest("a[href]");
			if (a) break;
		}
	}
	if (!a) return;
	const href = a.getAttribute("href");
	if (!href) return;
	let target;
	try {
		target = new URL(a.href, window.location.href);
	} catch {
		return;
	}
	if (_isStudioPreview() && _isStudioUrl(target)) {
		event.preventDefault();
		window.parent.postMessage({ type: "stwStudio:navigate", url: target.href }, window.location.origin);
		return;
	}
	if (stwIsEmbedded && target.origin !== window.location.origin) {
		event.preventDefault();
		window.parent.postMessage({ type: "stwStudio:navigate", url: target.href }, window.location.origin);
		return;
	}
	const relativeHref = href.replace(window.location.origin, "");
	if (!relativeHref.startsWith("/")) return;

	event.preventDefault();
	window.location.href = a.getAttribute("href");
}

document.addEventListener("click", _stwHandleNavClick, true);