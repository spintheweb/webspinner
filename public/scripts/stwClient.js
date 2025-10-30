/**
 * Spin the Web client
 *
 * This file runs in web browser and is responsible for real time communication
 * with the web spinner through web sockets.
 *
 * Language: Javascript
 *
 * MIT License. Copyright (c) 2024 Giancarlo Trevisan
 */
// deno-lint-ignore-file

let stwWS;
let stwReconnectTimer = null;

window.addEventListener("load", () => {
	stwStartWebsocket();
	if (_hasStudioCookie() && !document.getElementById("stwStudio")) {
		_enableStudio();
	}
});

function _newId(uuid) {
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
	return "x" + out;
}

const stwTabId = sessionStorage.getItem("stwTabId") || (() => {
	const raw = crypto.randomUUID
		? crypto.randomUUID()
		: (Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2));
	const id = _newId(raw);
	sessionStorage.setItem("stwTabId", id);
	return id;
})();

// --- Studio helpers ---
function _hasStudioCookie() {
	return document.cookie.split("; ").some((c) => c.startsWith("stwStudio=1"));
}
function _enableStudio() {
	if (document.getElementById("stwStudio")) return;
	const stash = document.createElement("div");
	while (document.body.firstChild) stash.appendChild(document.body.firstChild);
	document.body.insertAdjacentHTML(
		"afterbegin",
		`<div id="stwStudio"><header id="stwMenubar"></header><div><aside id="stwSidebar"></aside><div class="stwSplitter"></div><div id="stwSite"></div></div><footer id="stwStatusbar"></footer></div>`,
	);
	while (stash.firstChild) document.getElementById("stwSite").appendChild(stash.firstChild);
	if (!document.cookie.includes("stwStudio=")) document.cookie = "stwStudio=1; path=/; max-age=31536000";

	// If WS is open, load studio interface; else defer to onopen
	if (stwWS && stwWS.readyState === WebSocket.OPEN) {
		stwWS.send(JSON.stringify({ method: "PATCH", resource: "/stws/interface", options: { recurse: false } }));
	} else {
		// flag for onopen
		window._stwStudioPending = true;
	}
}
function _disableStudio() {
	const stash = document.getElementById("stwSite");
	if (stash) {
		while (stash.firstChild) document.body.appendChild(stash.firstChild);
	}
	document.getElementById("stwStudio")?.remove();
	document.cookie = "stwStudio=; path=/; max-age=0";
}

// Toggle studio mode with Alt+F12
window.addEventListener("keydown", (event) => {
	if (event.altKey && event.key == "F12") {
		event.preventDefault();
		if (document.getElementById("stwStudio")) {
			_disableStudio();
		} else {
			_enableStudio();
		}
	}
});

function stwStartWebsocket() {
	if (stwWS && (stwWS.readyState === WebSocket.OPEN || stwWS.readyState === WebSocket.CONNECTING)) return;

	const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
	const wsUrl = `${protocol}//${window.location.host}/?tab=${encodeURIComponent(stwTabId)}`;
	stwWS = new WebSocket(wsUrl);

	if (stwReconnectTimer) {
		clearTimeout(stwReconnectTimer);
		stwReconnectTimer = null;
	}

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
		}));

		// If studio is active or pending, load its interface
		if (document.getElementById("stwStudio") || window._stwStudioPending || _hasStudioCookie()) {
			window._stwStudioPending = false;
			stwWS.send(JSON.stringify({ method: "PATCH", resource: "/stws/interface", options: { recurse: false } }));
		}

		document.querySelectorAll("[lang]").forEach((element) => element.setAttribute("lang", "en-US"));
	};

	stwWS.onmessage = (event) => {
		// event.data = { method: "GET" | "PUT" | "PATCH" | "DELETE", id: string, section: string, sequence: number, body: string }
		const data = JSON.parse(event.data);

		if (data.method === "PATCH") {
			stwWS.send(
				JSON.stringify({ method: "PATCH", resource: data.id, options: { placeholder: data.placeholder } }),
			);
			return;
		}

		if (data.placeholder) {
			const placeholder = document.getElementById(data.placeholder);
			placeholder?.insertAdjacentHTML("afterend", data.body);
			placeholder?.remove();
		} else {
			// Replace or delete existing element by id first
			if (data.method === "DELETE") {
				document.getElementById(data.id)?.remove();
				return;
			}
			if (data.method === "PUT") {
				const element = document.getElementById(data.id);
				if (element) {
					element.insertAdjacentHTML("afterend", data.body);
					element.remove();
					return; // done
				}
			}

			if (data.section === "stwShowModal" || data.section === "stwShow") {
				// document.querySelector("dialog")?.remove();
				document.body.insertAdjacentHTML("afterbegin", `<dialog onclose="this.remove()">${data.body}</dialog>`);
				if (data.section === "stwShowModal") {
					document.querySelector("dialog")?.showModal();
				} else {
					document.querySelector("dialog")?.show();
				}
			} else {
				let insertion = document.getElementById(data.section);
				insertion?.querySelectorAll("article[data-sequence]").forEach((article) => {
					if (parseFloat(article.getAttribute("data-sequence")) < data.sequence) {
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
				}),
			);
			article.removeAttribute("href");
		});

		// Load content script
		document.body.querySelectorAll("script").forEach((script) => {
			if (document.head.querySelector(`script[name="${script.getAttribute("name")}"]`)) {
				return;
			}

			const loadScript = document.createElement("script");
			loadScript.setAttribute("name", script.getAttribute("name") || "");
			if (script.src) {
				loadScript.src = script.src;
			} else {
				loadScript.textContent = script.textContent;
			}
			document.head.appendChild(loadScript);
			if (typeof script.onload === "function") {
				script.onload();
			}
			script.remove();
		});

		const script = document.getElementById(data.id)?.querySelector("script[onload]");
		if (script) {
			if (typeof window[`fn${script.getAttribute("name")}`] !== "function") {
				const element = document.createElement("script");
				element.insertAdjacentText("afterbegin", script.innerText);
				document.head.append(element);
			}
			script.onload();
			script.remove();
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
function stwToggleCollapse(event) {
	event.preventDefault();
	const el = event.currentTarget;
	el.querySelector("i.fa-light").classList.toggle("fa-angle-down");
	if (el.querySelector("i.fa-light").classList.toggle("fa-angle-right")) {
		el.nextElementSibling.classList.add("stwHide");
	} else {
		el.nextElementSibling.classList.remove("stwHide");
	}
}

// Open content properties when studio mode is enabled with Alt+click
document.addEventListener("click", function (e) {
	const article = e.target.closest("article[id]");
	if (document.getElementById("stwStudio") && article && e.altKey) {
		e.stopPropagation();
		e.preventDefault();
		stwWS.send(
			JSON.stringify({
				method: "PATCH",
				resource: `/stws/editcontent?_id=${article.id}`,
				options: { placeholder: "" },
			}),
		);
	}
});

// Global, capture-phase nav handler (works before/after studio reparenting)
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
	const href = a.getAttribute("href")?.replace(window.location.origin, "");
	if (!href || !href.startsWith("/")) return;

	event.preventDefault();
	if (stwWS && stwWS.readyState === WebSocket.OPEN) {
		stwWS.send(JSON.stringify({ method: "PATCH", resource: href, options: {} }));
	} else {
		window.location.href = a.getAttribute("href");
	}
}

// Attach once, capture
document.addEventListener("click", _stwHandleNavClick, true);

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

/*
let isDragging = false;
let offsetX, offsetY;

const dialog = document.getElementById("dialog");
const handle = document.getElementById("dialogHeader");

handle.addEventListener("mousedown", (e) => {
  offsetX = e.clientX - dialog.offsetLeft;
  offsetY = e.clientY - dialog.offsetTop;
  isDragging = true;
});

document.addEventListener("mousemove", (e) => {
  if (isDragging) {
	 dialog.style.position = "absolute";
	 dialog.style.left = `${e.clientX - offsetX}px`;
	 dialog.style.top = `${e.clientY - offsetY}px`;
  }
});

document.addEventListener("mouseup", () => {
  isDragging = false;
});
*/
