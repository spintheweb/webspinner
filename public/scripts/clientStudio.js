/**
 * @fileoverview Studio-specific browser runtime.
 * @license Apache-2.0
 */

const stwStudioReturnUrlKey = "stwStudioReturnUrl";

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
	_stwSendEditorRequest("/stws/edit/edit-content", uuid);
}

function _stwOpenElementEditor(anchor) {
	const type = anchor.dataset.stwEditorType;
	const uuid = anchor.dataset.stwEditorUuid;
	const resource = {
		Portal: "/stws/edit/edit-site",
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

function _stwSendEditorRequest(resource, uuid) {
	if (!stwCanStudio || !stwWS || stwWS.readyState !== WebSocket.OPEN) {
		window.alert("The Studio editor connection is unavailable.");
		return;
	}
	stwWS.send(JSON.stringify({
		method: "PATCH",
		resource: `${resource}?uuid=${encodeURIComponent(uuid)}`,
		options: { placeholder: "" },
		search: window.location.search
	}));
}

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

document.addEventListener("DOMContentLoaded", () => {
	document.body.classList.toggle("stwStudioPage", _isStudioPage());
});

window.addEventListener("keydown", (event) => {
	if (!stwCanStudio || !event.altKey || event.key !== "F12") return;
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