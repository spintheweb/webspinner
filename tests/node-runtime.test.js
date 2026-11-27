/**
 * @fileoverview Node.js runtime test suite for Webspinner.
 *
 * Verifies session management, WBOL/WBLL/WBPL rendering, action tokens,
 * RBV security, authentication, and database/API connector behavior.
 *
 * @author Giancarlo Trevisan
 * @version 1.0.0
 * @module tests/node-runtime.test
 * @note Copilot-assisted
 * @license Apache-2.0
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import jsonata from "jsonata";
import { getCookies, runCommand, serveFile, setCookie } from "../stwComponents/stwNode.js";
import { WBOL } from "../stwComponents/stwWBOL.js";
import { STWContent } from "../stwElements/stwContent.js";
import { STWElement } from "../stwElements/stwElement.js";
import { STWPortal } from "../stwElements/stwPortal.js";
import { STWArea } from "../stwElements/stwArea.js";
import { STWPage } from "../stwElements/stwPage.js";
import { STWTabs } from "../stwContents/stwTabs.js";
import { STWTable } from "../stwContents/stwTable.js";
import { STWForm } from "../stwContents/stwForm.js";
import { STWText } from "../stwContents/stwText.js";
import { STWTree } from "../stwContents/stwTree.js";
import { STWIndex } from "../stwElements/stwIndex.js";
import { handleWbolApi } from "../stwComponents/stwWBOLApi.js";
import { registerWebbaselet } from "../stwComponents/stwWebbaselets.js";
import { applyPersistentChanges, captureRevision } from "../stwComponents/stwAssistantPersistence.js";
import { STWLayout } from "../stwComponents/stwWBLL.js";
import { signAction, verifyAction } from "../stwComponents/stwActionToken.js";
import { STWActionRouter } from "../stwComponents/stwActions.js";
import { handleHttp } from "../stwComponents/stwHttpHandler.js";
import { STWConnectors } from "../stwComponents/stwConnectors.js";
import { executeImapQuery, executeSmtpAction, parseImapCommand } from "../stwComponents/stwMailConnector.js";
import { STWSecurity } from "../stwComponents/stwSecurity.js";
import { STWSession } from "../stwComponents/stwSession.js";
import { handleWebSocket } from "../stwComponents/stwWebSocket.js";
import { registerStudioConnection } from "../stwComponents/stwStudioEvents.js";
import { executeAssistant } from "../stwComponents/stwAssistant.js";
import { validateChanges } from "../stwComponents/stwAssistantPersistence.js";

test("WBLL multiline inputs select supported editor formats", async () => {
	const placeholders = new Map([["@@value", "<tag>& text"]]);
	const session = { placeholders, baseurl: "", lang: "en", tz: "UTC" };
	const render = async format => (await new STWLayout(`m('${format};body;@@value')`)
		.render([], placeholders, session)).HTML;

	for (const format of ["", "textarea"]) {
		const html = await render(format);
		assert.match(html, /<textarea[^>]*name="body"[^>]*>&lt;tag&gt;&amp; text<\/textarea>/);
		assert.doesNotMatch(html, /data-stw-editor/);
	}
	for (const format of ["wysiwyg", "javascript", "html", "css"])
		assert.match(await render(format), new RegExp(`data-stw-editor="${format}"`));
	await assert.rejects(render("python"), /Unsupported multiline input format: python/);
});

test("Ace multiline editors synchronize their textarea and form reset", async () => {
	const source = await readFile("./public/scripts/stwClient.js", "utf8");
	const form = new EventTarget();
	class Textarea extends EventTarget {
		constructor() {
			super();
			this.dataset = { stwEditor: "html" };
			this.value = "original";
			this.style = {};
			this.isConnected = true;
			this.form = form;
		}
		insertAdjacentElement(_position, host) { this.host = host; }
	}
	const textarea = new Textarea();
	let change;
	let value;
	let mode;
	let destroyed = false;
	const editor = {
		session: {
			setMode: next => { mode = next; },
			on: (_event, handler) => { change = handler; }
		},
		setValue(next) { value = next; change?.(); },
		getValue: () => value,
		setReadOnly() {},
		resize() {},
		focus() {},
		destroy() { destroyed = true; }
	};
	const window = { addEventListener() {}, ace: { edit: () => editor } };
	window.self = window.top = window;
	const document = { addEventListener() {}, createElement: () => ({ remove() {} }) };
	const context = {
		window, document, textarea, Event, queueMicrotask,
		sessionStorage: { getItem: () => "x1" },
		MutationObserver: class { observe() {} disconnect() {} },
		ResizeObserver: class { observe() {} disconnect() {} }
	};
	runInNewContext(source, context);
	window.stwLoadAce = async () => {};
	context._stwInitializeEditor(textarea);
	const dispose = await runInNewContext("_stwEditors.get(textarea)", context);
	assert.equal(mode, "ace/mode/html");
	assert.equal(value, "original");

	editor.setValue("edited");
	assert.equal(textarea.value, "edited");
	textarea.value = "loaded";
	textarea.dispatchEvent(new Event("input"));
	assert.equal(value, "loaded");
	textarea.value = "original";
	form.dispatchEvent(new Event("reset"));
	await new Promise(resolve => queueMicrotask(resolve));
	assert.equal(value, "original");
	dispose();
	assert.equal(destroyed, true);
});

test("WYSIWYG multiline editors synchronize their textarea", async () => {
	const source = await readFile("./public/scripts/stwClient.js", "utf8");
	class Textarea extends EventTarget {
		constructor() {
			super();
			this.dataset = { stwEditor: "wysiwyg" };
			this.value = "<p>initial</p>";
			this.isConnected = true;
			this.nextElementSibling = {};
		}
	}
	const textarea = new Textarea();
	let contents = textarea.value;
	let onChange;
	const input = {
		summernote(command, value) {
			if (typeof command === "object") onChange = command.callbacks.onChange;
			else if (command === "code" && value === undefined) return contents;
			else if (command === "code") { contents = value; onChange(value); }
		}
	};
	const window = { addEventListener() {}, jQuery: () => input };
	window.self = window.top = window;
	const context = {
		window, document: { addEventListener() {} }, textarea, Event,
		sessionStorage: { getItem: () => "x1" },
		MutationObserver: class { observe() {} }
	};
	runInNewContext(source, context);
	window.stwLoadSummernote = async () => {};
	context._stwInitializeEditor(textarea);
	await runInNewContext("_stwEditors.get(textarea)", context);
	contents = "<p>edited</p>";
	onChange(contents);
	assert.equal(textarea.value, "<p>edited</p>");
	textarea.value = "<p>loaded</p>";
	textarea.dispatchEvent(new Event("input"));
	assert.equal(contents, "<p>loaded</p>");
});

test("dialog headings drag within the viewport without intercepting controls", async () => {
	const source = await readFile("./public/scripts/stwClient.js", "utf8");
	const handlers = {};
	const classes = new Set();
	const heading = {
		isConnected: true,
		setPointerCapture: id => { heading.captured = id; },
		contains: element => element === control,
		getBoundingClientRect: () => ({ height: 30 }),
		classList: { add: name => classes.add(name), remove: name => classes.delete(name) }
	};
	const control = {};
	const target = { closest: selector => selector === "h1" ? heading : null };
	const dialog = {
		addEventListener: (type, handler) => { handlers[type] = handler; },
		getBoundingClientRect: () => ({ left: 100, top: 80, width: 300, height: 200 }),
		ownerDocument: { defaultView: { innerWidth: 1000, innerHeight: 700 } },
		style: {}
	};
	heading.parentElement = { localName: "article", parentElement: dialog };
	const window = { addEventListener() {} };
	window.self = window.top = window;
	const context = {
		window, document: { addEventListener() {} },
		sessionStorage: { getItem: () => "x1" }
	};
	runInNewContext(source, context);
	context._stwMakeDialogDraggable(dialog);
	let prevented = false;
	const event = (x, y, overrides = {}) => ({
		button: 0, pointerId: 7, clientX: x, clientY: y, target,
		preventDefault() { prevented = true; }, ...overrides
	});

	handlers.pointerdown(event(400, 300, { target: { closest: selector => selector === "h1" ? heading : control } }));
	assert.equal(heading.captured, undefined);
	handlers.pointerdown(event(400, 300));
	assert.equal(heading.captured, 7);
	assert.ok(prevented);
	assert.ok(classes.has("stwDragging"));
	handlers.pointermove(event(500, 370));
	assert.equal(dialog.style.left, "200px");
	assert.equal(dialog.style.top, "150px");
	assert.equal(dialog.style.position, "fixed");
	handlers.pointermove(event(5000, 5000));
	assert.equal(dialog.style.left, "700px");
	assert.equal(dialog.style.top, "670px");
	handlers.pointercancel(event(5000, 5000));
	assert.ok(!classes.has("stwDragging"));
	handlers.pointermove(event(0, 0));
	assert.equal(dialog.style.left, "700px");
	handlers.pointerdown(event(0, 0, { target: { closest: () => null } }));
	assert.ok(!classes.has("stwDragging"));
});

test("studio splitbars resize panels and respect available space and hidden panels", async () => {
	const source = await readFile("./public/scripts/stwClientStudio.js", "utf8");
	const handlers = {};
	const makeBar = () => ({
		attributes: {},
		handlers: {},
		classList: { add() {} },
		setAttribute(name, value) { this.attributes[name] = value; },
		addEventListener(name, handler) { this.handlers[name] = handler; },
		setPointerCapture() {}
	});
	const leftBar = makeBar();
	const rightBar = makeBar();
	const left = { id: "leftPanel", style: {}, childElementCount: 0, nextElementSibling: leftBar };
	const right = { id: "rightPanel", style: {}, childElementCount: 0, previousElementSibling: rightBar };
	const properties = {};
	const classes = new Set();
	const frame = {
		clientWidth: 1200,
		style: { setProperty: (name, value) => { properties[name] = value; } },
		classList: { toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name) }
	};
	let visibilityChanged;
	const observations = [];
	const document = {
		documentElement: {},
		addEventListener() {},
		getElementById: id => ({ frame, leftPanel: left, rightPanel: right })[id]
	};
	let rootFontSize = 16;
	const window = {
		addEventListener: (name, handler) => { handlers[name] = handler; },
		getComputedStyle: panel => panel === document.documentElement
			? { fontSize: `${rootFontSize}px` }
			: { display: panel.style.display || "flex" }
	};
	const context = {
		window, document,
		MutationObserver: class {
			constructor(callback) { visibilityChanged = callback; }
			observe(target, options) { observations.push({ target, options }); }
		}
	};
	runInNewContext(source, context);
	context._stwSetupSplitters();
	assert.equal(properties["--stw-left-width"], "0px");
	assert.equal(properties["--stw-right-width"], "0px");
	assert.equal(leftBar.hidden, true);
	assert.equal(rightBar.hidden, true);
	left.childElementCount = 1;
	right.childElementCount = 1;
	visibilityChanged();
	assert.equal(properties["--stw-left-width"], "320px");
	assert.equal(properties["--stw-right-width"], "320px");
	assert.equal(properties["--stw-left-bar-width"], "1px");
	assert.equal(leftBar.attributes.role, "separator");
	assert.equal(observations.length, 2);
	assert.ok(observations.every(observation => observation.options.childList));

	const event = (clientX, pointerId = 1) => ({ button: 0, pointerId, clientX, preventDefault() {} });
	leftBar.handlers.pointerdown(event(250));
	leftBar.handlers.pointermove(event(370));
	leftBar.handlers.pointerup(event(370));
	assert.equal(properties["--stw-left-width"], "440px");
	rightBar.handlers.pointerdown(event(950));
	rightBar.handlers.pointermove(event(890));
	rightBar.handlers.pointerup(event(890));
	assert.equal(properties["--stw-right-width"], "380px");
	rightBar.handlers.keydown({ key: "ArrowRight", preventDefault() {} });
	assert.equal(properties["--stw-right-width"], "370px");
	left.childElementCount = 0;
	right.childElementCount = 0;
	visibilityChanged();
	assert.equal(properties["--stw-left-width"], "0px");
	assert.equal(properties["--stw-right-width"], "0px");
	assert.equal(leftBar.hidden, true);
	assert.equal(rightBar.hidden, true);
	left.childElementCount = 1;
	right.childElementCount = 1;
	visibilityChanged();
	assert.equal(properties["--stw-left-width"], "440px");
	assert.equal(properties["--stw-right-width"], "370px");
	assert.equal(leftBar.hidden, false);
	assert.equal(rightBar.hidden, false);
	left.style.display = "none";
	visibilityChanged();
	assert.equal(properties["--stw-left-width"], "0px");
	assert.equal(properties["--stw-left-bar-width"], "0px");
	assert.equal(leftBar.hidden, true);
	left.style.display = "flex";
	visibilityChanged();
	assert.equal(properties["--stw-left-width"], "440px");
	assert.equal(leftBar.hidden, false);

	rightBar.handlers.keydown({ key: "Home", preventDefault() {} });
	assert.equal(properties["--stw-right-width"], "320px");
	rightBar.handlers.keydown({ key: "ArrowLeft", shiftKey: true, preventDefault() {} });
	assert.equal(properties["--stw-right-width"], "370px");
	rightBar.handlers.keydown({ key: "End", preventDefault() {} });
	assert.equal(properties["--stw-right-width"], "558px");

	frame.clientWidth = 500;
	handlers.resize();
	assert.equal(properties["--stw-left-width"], "320px");
	assert.equal(properties["--stw-right-width"], "0px");
	assert.ok(classes.has("stwStudioAutoHideRight"));
	assert.equal(rightBar.hidden, true);
	assert.ok(Number(leftBar.attributes["aria-valuemin"]) <= Number(leftBar.attributes["aria-valuemax"]));
	frame.clientWidth = 1200;
	handlers.resize();
	assert.equal(properties["--stw-right-width"], "558px");
	assert.equal(rightBar.hidden, false);
	assert.ok(!classes.has("stwStudioAutoHideRight"));

	left.childElementCount = 0;
	visibilityChanged();
	frame.clientWidth = 500;
	handlers.resize();
	assert.ok(!rightBar.hidden);
	assert.equal(properties["--stw-right-width"], "320px");
	left.childElementCount = 1;
	visibilityChanged();
	assert.ok(rightBar.hidden);
	frame.clientWidth = 320;
	handlers.resize();
	assert.equal(properties["--stw-left-width"], "0px");
	assert.equal(properties["--stw-right-width"], "0px");
	assert.ok(classes.has("stwStudioAutoHideLeft"));
	frame.clientWidth = 1200;
	rootFontSize = 20;
	handlers.resize();
	assert.equal(properties["--stw-left-width"], "400px");
	assert.equal(properties["--stw-right-width"], "400px");
});

test("Studio search matches editable values in the current language", async () => {
	const source = await readFile("./public/scripts/stwClientStudio.js", "utf8");
	const context = { window: { addEventListener() {} }, document: { addEventListener() {} } };
	runInNewContext(source, context);
	const literal = context._stwStudioSearchMatcher("a.b", false, false, false);
	assert.ok(literal.test("A.B"));
	assert.ok(!literal.test("axb"));
	const regex = context._stwStudioSearchMatcher("a.b", true, true, false);
	assert.ok(regex.test("axb"));
	assert.ok(!regex.test("AXB"));
	const word = context._stwStudioSearchMatcher("cat", false, false, true);
	assert.ok(word.test("(Cat)"));
	assert.ok(!word.test("cats"));
	assert.ok(!word.test("écat"));
	assert.throws(() => context._stwStudioSearchMatcher("[", true, false, false));

	const values = context._stwStudioSearchValues({
		name: { en: "Name", fr: "French only" },
		layout: { en: "layout content", fr: "French layout" },
		query: "select records", visibility: { editor: true },
		options: [{ name: { en: "Option", fr: "French option" }, ref: "reference" }],
		children: [{ name: { en: "child only" } }], blocked: "other user"
	}, "en");
	assert.ok(values.includes("Name") && values.includes("layout content") && values.includes("select records"));
	assert.ok(values.includes("editor") && values.includes("Option") && values.includes("reference"));
	assert.ok(!values.some(value => value.includes("French") || value === "child only" || value === "other user"));
});

test("Studio search refreshes the results content and reports invalid expressions", async () => {
	const source = await readFile("./public/scripts/stwClientStudio.js", "utf8");
	const makeButton = action => ({
		dataset: { stwSearchAction: action }, attributes: { "aria-pressed": "false" },
		classList: { toggle() {} },
		getAttribute(name) { return this.attributes[name]; },
		setAttribute(name, value) { this.attributes[name] = value; }
	});
	const controls = ["case", "word", "regex", "search"].map(makeButton);
	const input = { value: "needle", dataset: { stwLanguage: "en" } };
	const status = { textContent: "" };
	const results = { id: "c7StudioSearchResults01", dataset: {}, hidden: false };
	const article = {
		dataset: {},
		querySelector(selector) {
			return {
				'input[name="search"]': input,
				"[data-stw-search-status]": status,
				'[data-stw-search-results], #c7StudioSearchResults01': results
			}[selector];
		},
		querySelectorAll: () => controls
	};
	const document = { addEventListener() {} };
	const tree = {
		uuid: "portal", type: "Portal", children: [
			{ uuid: "area", type: "Area", name: { en: "Area", fr: "needle" }, children: [] },
			{ uuid: "content", type: "Content", name: { en: "Content" }, children: [] }
		]
	};
	const fetch = async url => {
		if (url === "/wbol") return { ok: true, json: async () => tree };
		if (url === "/wbol/portal?locale=en&fallback=false") return { ok: false, status: 403 };
		if (url === "/wbol/area?locale=en&fallback=false") return { ok: true, json: async () => ({ name: "Area" }) };
		if (url === "/wbol/content?locale=en&fallback=false") return { ok: true, json: async () => ({ query: "select needle" }) };
		throw new Error(`Unexpected URL: ${url}`);
	};
	const sent = [];
	let nextId = 0;
	const context = {
		window: { addEventListener() {} }, document, fetch,
		btoa: value => Buffer.from(value, "binary").toString("base64"),
		crypto: { randomUUID: () => String(++nextId) },
		_newId: id => "placeholder-" + id,
		WebSocket: { OPEN: 1 },
		stwWS: { readyState: 1, send: message => sent.push(JSON.parse(message)) }
	};
	runInNewContext(source, context);
	const trigger = { closest: () => article };
	await context._stwStudioSearch(trigger);
	assert.equal(status.textContent, "1 result");
	assert.equal(sent[0].resource, "c7StudioSearchResults01");
	assert.equal(sent[0].options.placeholder, "placeholder-1");
	assert.ok(Object.hasOwn(results.dataset, "stwSearchResults"));
	const ids = JSON.parse(decodeURIComponent(Buffer.from(sent[0].search.stwSearchIds, "base64url").toString()));
	assert.deepEqual(ids, ["content"]);
	assert.equal(results.hidden, true);
	context._stwStudioSearchToggle(controls[2]);
	input.value = "[";
	await context._stwStudioSearch(trigger);
	assert.match(status.textContent, /^Invalid regular expression:/);
	assert.equal(sent.length, 1);
	input.value = "";
	await context._stwStudioSearch(trigger);
	assert.equal(sent[1].options.placeholder, "placeholder-2");
});

test("studio pages cannot be framed, including when requested by UUID", async () => {
	const area = new STWArea({ uuid: "a-frame-test", slug: { en: "stws" } });
	const page = new STWPage({ uuid: "p7w0adQ8hdI0CUWkSHoOhYj", slug: { en: "interface" }, visibility: { developer: true } });
	area.parent = { pathname: () => "" };
	page.parent = area;
	const session = { roles: ["developer"], lang: "en", portal: { mainpage: "" } };

	const response = await page.serve(new Request("http://localhost/p7w0adQ8hdI0CUWkSHoOhYj"), session);
	assert.equal(response.status, 200);
	assert.equal(response.headers.get("content-security-policy"), "frame-ancestors 'none'");

	area.slug.set("en", "other");
	const ordinaryResponse = await page.serve(new Request("http://localhost/other/interface"), session);
	assert.equal(ordinaryResponse.headers.get("content-security-policy"), null);
});

test("studio preview blocks studio navigation but permits other destinations", async () => {
	const source = await readFile("./public/scripts/stwClient.js", "utf8") + "\n" +
		await readFile("./public/scripts/clientStudio.js", "utf8");
	const frame = { isConnected: true, dataset: { url: "http://localhost/home" }, src: "http://localhost/home" };
	const alerts = [];
	const navigations = [];
	const window = {
		location: { href: "http://localhost/stws", origin: "http://localhost", pathname: "/stws", assign: (url) => navigations.push(url) },
		stwStudioPreviewFrame: frame,
		alert: (message) => alerts.push(message),
		addEventListener() {}
	};
	window.self = window;
	window.top = window;
	const document = { addEventListener() {}, getElementById: () => frame };
	const context = { window, document, sessionStorage: { getItem: () => "x1" }, URL, DOMException };
	runInNewContext(source, context);

	context._stwStudioNavigate("/stws/interface?x=1");
	context._stwStudioNavigate("/stws");
	assert.equal(frame.src, "http://localhost/home");
	assert.equal(window.stwStudioPreviewUrl, undefined);
	assert.equal(alerts.length, 2);
	context._stwStudioNavigate("/customers");
	assert.equal(frame.src, "http://localhost/customers");
	context._stwStudioNavigate("https://example.com/");
	assert.deepEqual(navigations, ["https://example.com/"]);
});

test("studio editor acquires and releases its block when the dialog closes", async () => {
	const source = await readFile("./public/scripts/clientStudio.js", "utf8");
	const listeners = new Map();
	const calls = [];
	const messages = [];
	const document = { addEventListener: (event, handler) => listeners.set(event, handler) };
	const window = { addEventListener() {}, alert: (message) => assert.fail(message) };
	const context = {
		document, window, stwCanStudio: true, stwIsEmbedded: false,
		stwWS: { readyState: 1, send: (message) => messages.push(JSON.parse(message)) },
		WebSocket: { OPEN: 1 },
		fetch: async (url, options) => {
			calls.push({ url, method: options.method });
			return options.method === "POST"
				? { ok: true, json: async () => ({ blocked: "alice", token: "token-1" }) }
				: { ok: true };
		}
	};
	runInNewContext(source, context);
	await context._stwSendEditorRequest("/stws/edit/edit-page", "page-1");
	assert.equal(calls[0].url, "/wbol/page-1/block");
	assert.equal(messages[0].search.stwBlockToken, "token-1");
	listeners.get("close")({ target: { querySelector: () => ({ dataset: { stwBlockToken: "token-1" } }) } });
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(calls[1].url, "/wbol/page-1/block?token=token-1");
	assert.equal(calls[1].method, "DELETE");
});

test("Alt+F12 toggles studio and returns to the page it was opened from", async () => {
	const source = await readFile("./public/scripts/stwClient.js", "utf8") + "\n" +
		await readFile("./public/scripts/clientStudio.js", "utf8");
	const storage = new Map();
	const createContext = (pathname, href, frame) => {
		const listeners = {};
		const navigations = [];
		const window = {
			location: { href, origin: "http://localhost", pathname, assign: (url) => navigations.push(url) },
			addEventListener: (type, listener) => { listeners[type] = listener; }
		};
		window.self = window;
		window.top = window;
		const document = {
			addEventListener() {},
			createElement: () => frame,
			querySelector: () => null,
			getElementById: () => null
		};
		const context = {
			window,
			document,
			sessionStorage: {
				getItem: (key) => storage.get(key) || null,
				setItem: (key, value) => storage.set(key, value),
				removeItem: (key) => storage.delete(key)
			},
			crypto: { randomUUID: () => "test-id" },
			URL,
			DOMException
		};
		runInNewContext(source, context);
		runInNewContext("stwCanStudio = true", context);
		return { context, listeners, navigations };
	};
	storage.set("stwTabId", "x1");
	const originUrl = "http://localhost/customers?sort=name#list";
	const normal = createContext("/customers", originUrl);
	let prevented = false;
	normal.listeners.keydown({ altKey: true, key: "F12", preventDefault: () => { prevented = true; } });
	assert.equal(prevented, true);
	assert.deepEqual(normal.navigations, ["http://localhost/stws"]);
	assert.equal(storage.get("stwStudioReturnUrl"), originUrl);

	const frame = {
		isConnected: true,
		dataset: {},
		contentWindow: { location: { href: originUrl } }
	};
	const studio = createContext("/stws", "http://localhost/stws", frame);
	studio.context._stwStudioAttachPreview({ append() {} });
	assert.equal(frame.src, originUrl);
	studio.listeners.keydown({ altKey: true, key: "F12", preventDefault() {} });
	assert.deepEqual(studio.navigations, [originUrl]);
	assert.equal(storage.has("stwStudioReturnUrl"), false);
});

test("studio links in its preview are sent to the parent instead of loading in the iframe", async () => {
	const source = await readFile("./public/scripts/stwClient.js", "utf8") + "\n" +
		await readFile("./public/scripts/clientStudio.js", "utf8");
	const messages = [];
	const window = {
		location: { href: "http://localhost/home", origin: "http://localhost", pathname: "/home" },
		addEventListener() {}
	};
	window.self = window;
	window.top = {};
	window.parent = {
		document: { getElementById: () => ({ contentWindow: window }) },
		postMessage: (message, origin) => messages.push({ type: message.type, url: message.url, origin })
	};
	const context = { window, document: { addEventListener() {} }, sessionStorage: { getItem: () => "x1" }, URL, DOMException };
	runInNewContext(source, context);
	const anchor = { href: "http://localhost/stws", getAttribute: () => "/stws" };
	const node = { nodeType: 1, closest: () => anchor };
	let prevented = false;
	context._stwHandleNavClick({ composedPath: () => [node], preventDefault: () => { prevented = true; } });
	assert.equal(prevented, true);
	assert.deepEqual(messages, [{ type: "stwStudio:navigate", url: "http://localhost/stws", origin: "http://localhost" }]);
});

test("area content inheritance can stop before the portal", () => {
	const portal = new STWPortal({ uuid: "w-area-boundary", langs: ["en"], mainpage: "p-area-boundary", name: { en: "Portal" } });
	const area = new STWArea({
		uuid: "a-area-boundary",
		name: { en: "Studio" },
		slug: { en: "stws" },
		mainpage: "p-area-boundary",
		inheritContents: "false"
	});
	const page = new STWPage({
		uuid: "p-area-boundary",
		name: { en: "Interface" },
		slug: { en: "interface" },
		visibility: { developer: true }
	});
	const pageContent = new STWContent({ uuid: "c-page-boundary", subtype: "Text", section: "main", visibility: { developer: true } });
	const areaContent = new STWContent({ uuid: "c-area-boundary", subtype: "Text", section: "header", visibility: { developer: true } });
	const portalContent = new STWContent({ uuid: "c-portal-boundary", subtype: "Text", section: "footer", visibility: { developer: true } });
	const elements = [portal, area, page, pageContent, areaContent, portalContent];
	try {
		area.parent = portal;
		page.parent = area;
		page.children = [pageContent];
		area.children = [page, areaContent];
		portal.children = [area, portalContent];
		const session = { portal, roles: ["developer"], lang: "en" };

		assert.equal(area.inheritContents, false);
		assert.deepEqual(page.contents(session), ["c-page-boundary", "c-area-boundary"]);
		area.inheritContents = true;
		assert.deepEqual(page.contents(session), ["c-page-boundary", "c-area-boundary", "c-portal-boundary"]);
	} finally {
		elements.forEach((element) => STWIndex.delete(element.uuid));
	}
});

test("validating a portal proposal does not replace the live portal in the index", () => {
	const portal = new STWPortal({ uuid: "w-assistant-validation", name: { en: "Old" }, slug: { en: "" } });
	try {
		validateChanges(portal, "en", { name: "New" });
		assert.equal(STWIndex.get(portal.uuid), portal);
		assert.equal(portal.name.get("en"), "Old");
	} finally {
		STWIndex.delete(portal.uuid);
	}
});

test("assistant requests are disabled unless ALLOW_AI=true", async () => {
	const oldAllowAi = process.env.ALLOW_AI;
	let requested = false;
	try {
		process.env.ALLOW_AI = "false";
		await assert.rejects(
			executeAssistant(
				{ roles: ["developer"], states: new Map() },
				"/chat",
				"POST",
				{ consent: "yes", message: "Question" },
				async () => {
					requested = true;
					return Response.json({ answer: "Unexpected", changes: {} });
				}
			),
			/ALLOW_AI=true/
		);
		assert.equal(requested, false);
	} finally {
		if (oldAllowAi === undefined) delete process.env.ALLOW_AI;
		else process.env.ALLOW_AI = oldAllowAi;
	}
});

test("assistant reviews and persistently applies authorized changes with conflict detection", async () => {
	const source = `<?xml version="1.0"?>
<webbase xmlns="https://spintheweb.org/schemas/wbol.xsd" uuid="wtest" langs="en it">
<name><text xml:lang="en" slug="">Portal</text></name>
<children><content uuid="ctest" type="Text">
<name><text xml:lang="en" slug="old">Old</text><text xml:lang="it" slug="vecchio">Vecchio</text></name>
<query connector="json">{"value":"old"}</query>
<layout><text xml:lang="en">Old layout</text><text xml:lang="it">Vecchio layout</text></layout>
<visibility><role id="developer" visibility="true"/></visibility>
</content></children></webbase>`;
	const dir = await mkdtemp(join(tmpdir(), "stw-assistant-"));
	const file = join(dir, "webbase.wbol");
	const oldEnv = { ...process.env };
	try {
		await writeFile(file, source);
		process.env.WEBBASE = file;
		process.env.COMMON_WEBBASE = join(dir, "missing-common.wbol");
		process.env.STUDIO_WEBBASE = join(dir, "missing-studio.wbol");
		process.env.STW_ASSISTANT_TOKEN = "x".repeat(32);
		process.env.PORTAL_URL = "";
		process.env.ALLOW_AI = "true";
		const portal = new STWPortal(WBOL(source));
		const session = { roles: ["developer"], portal, lang: "en", states: new Map() };
		const mock = async (url, options) => {
			assert.equal(url, "http://127.0.0.1:11435/chat");
			const body = JSON.parse(options.body);
			assert.equal(body.element.uuid, "ctest");
			assert.ok(["Old", "New"].includes(body.element.name));
			assert.equal(body.element.children, undefined);
			return Response.json({ answer: "Suggested edit", changes: { name: "New", layout: "New layout", query: '{"value":"new"}' } });
		};
		const chat = { consent: "yes", uuid: "ctest", message: "Change it" };
		const run = (user, resource, method, fields) => executeAssistant(user, resource, method, fields, mock);
		await assert.rejects(run({ ...session, roles: ["guest"] }, "/chat", "POST", chat), /Developer access required/);
		await assert.rejects(run(session, "/chat", "POST", { ...chat, consent: "" }), /Confirm local context sharing/);
		await run(session, "/chat", "POST", chat);
		assert.deepEqual(await run(session, "/history", "GET"), [
			{ role: "You", message: "Change it" }, { role: "Assistant", message: "Suggested edit" }
		]);
		assert.deepEqual((await run(session, "/state", "GET"))[0], { uuid: "ctest" });
		const proposal = await run(session, "/proposal", "GET");
		assert.deepEqual(proposal.map((row) => row.field).sort(), ["layout", "name", "query"]);
		assert.equal(proposal.find((row) => row.field === "name").current, "Old");
		assert.equal(await readFile(file, "utf8"), source);
		await assert.rejects(run({ ...session, roles: ["guest"] }, "/apply", "POST"), /Developer access required/);
		process.env.ALLOW_AI = "false";
		await assert.rejects(run(session, "/apply", "POST"), /ALLOW_AI=true/);
		assert.equal(await readFile(file, "utf8"), source);
		process.env.ALLOW_AI = "true";
		await run(session, "/apply", "POST");
		const loaded = WBOL(await readFile(file, "utf8")).children[0];
		assert.equal(loaded.name.en, "New");
		assert.equal(loaded.name.it, "Vecchio");
		assert.equal(loaded.layout.en, "New layout");
		assert.equal(loaded.layout.it, "Vecchio layout");
		assert.equal(loaded.query, '{"value":"new"}');
		assert.equal(STWIndex.get("ctest").name.get("en"), "New");
		assert.deepEqual(await run(session, "/proposal", "GET"), []);
		await assert.rejects(run(session, "/apply", "POST"), /Proposal expired or not found/);

		await run(session, "/chat", "POST", chat);
		await writeFile(file, (await readFile(file, "utf8")) + "\n");
		await assert.rejects(run(session, "/apply", "POST"), /changed/);
		const viaConnector = await STWConnectors.executeAction(session, "assistant", "/history", "GET");
		assert.equal(viaConnector.rows.length, 5);
	} finally {
		STWIndex.delete("ctest");
		STWIndex.delete("wtest");
		for (const key of ["WEBBASE", "COMMON_WEBBASE", "STUDIO_WEBBASE", "STW_ASSISTANT_TOKEN", "PORTAL_URL", "ALLOW_AI"]) {
			if (oldEnv[key] === undefined) delete process.env[key];
			else process.env[key] = oldEnv[key];
		}
		await rm(dir, { recursive: true, force: true });
	}
});

test("cookie helpers parse and set session cookies", () => {
	const cookies = getCookies(new Headers({ cookie: "sessionId=a%20b; theme=dark" }));
	assert.deepEqual(cookies, { sessionId: "a b", theme: "dark" });

	const headers = new Headers();
	setCookie(headers, { name: "sessionId", value: "a b", httpOnly: true, secure: true, sameSite: "Lax" });
	assert.equal(headers.get("set-cookie"), "sessionId=a%20b; Path=/; HttpOnly; Secure; SameSite=Lax");
});

test("session preserves identity WBPL placeholders when request placeholders are reset", () => {
	const session = new STWSession("session", {}, null);
	assert.deepEqual(Object.fromEntries(session.placeholders), {
		"@@stwlanguage": "en",
		"@@stwlogin": "guest",
		"@@stwloginname": "Guest",
		"@@stwloginid": "-3",
		"@@stwALLOW_AI": "false"
	});

	session.user = "alice";
	session.name = "Alice";
	session.loginId = "123";
	session.setLanguage("it");
	assert.equal(session.placeholders.get("@@stwlanguage"), "it");
	assert.equal({ ...session }.lang, "it");
	session.setPlaceholders(new Request("http://localhost/?page=home"));

	assert.equal(session.placeholders.get("@page"), "home");
	assert.equal(session.placeholders.get("@@stwlanguage"), "it");
	assert.equal(session.placeholders.get("@@stwALLOW_AI"), "false");
	assert.deepEqual(Object.fromEntries(
		["@@stwlogin", "@@stwloginname", "@@stwloginid"].map((key) => [key, session.placeholders.get(key)])
	), {
		"@@stwlogin": "alice",
		"@@stwloginname": "Alice",
		"@@stwloginid": "123"
	});
});

test("@@stwALLOW_AI placeholder reflects ALLOW_AI environment setting", () => {
	const oldAllowAi = process.env.ALLOW_AI;
	try {
		process.env.ALLOW_AI = "true";
		const session1 = new STWSession("ai-enabled", {}, null);
		assert.equal(session1.placeholders.get("@@stwALLOW_AI"), "true");
		
		process.env.ALLOW_AI = "false";
		const session2 = new STWSession("ai-disabled", {}, null);
		assert.equal(session2.placeholders.get("@@stwALLOW_AI"), "false");
		
		delete process.env.ALLOW_AI;
		const session3 = new STWSession("ai-default", {}, null);
		assert.equal(session3.placeholders.get("@@stwALLOW_AI"), "false");
	} finally {
		if (oldAllowAi === undefined) delete process.env.ALLOW_AI;
		else process.env.ALLOW_AI = oldAllowAi;
	}
});

test("@@stwALLOW_AI placeholder survives request placeholder reset", () => {
	const oldAllowAi = process.env.ALLOW_AI;
	try {
		process.env.ALLOW_AI = "true";
		const session = new STWSession("ai-reset-test", {}, null);
		session.setPlaceholders(new Request("http://localhost/?page=home"));
		assert.equal(session.placeholders.get("@@stwALLOW_AI"), "true");
		assert.equal(session.placeholders.get("@page"), "home");
	} finally {
		if (oldAllowAi === undefined) delete process.env.ALLOW_AI;
		else process.env.ALLOW_AI = oldAllowAi;
	}
});


test("WebSocket language negotiation synchronizes the session language placeholder", async () => {
	const portal = STWPortal.instance;
	const previousLanguages = portal.langs;
	const session = new STWSession("language-session", {}, portal);
	const handlers = new Map();
	const socket = {
		on: (event, handler) => handlers.set(event, handler),
		send: () => {}
	};
	try {
		portal.langs = ["en", "it"];
		handleWebSocket(new Request("http://localhost/?tab=language"), socket, session, new Map());
		await handlers.get("message")(Buffer.from(JSON.stringify({
			method: "HEAD",
			resource: "/nonexistent",
			options: { lang: "it", langs: ["it"], tz: "UTC" }
		})));
		assert.equal(session.lang, "it");
		assert.equal(session.placeholders.get("@@stwlanguage"), "it");
		session.setPlaceholders(new Request("http://localhost/"));
		assert.equal(session.placeholders.get("@@stwlanguage"), "it");
	} finally {
		portal.langs = previousLanguages;
	}
});

test("WebSocket reports studio access only for development roles", async () => {
	for (const [roles, expected] of [
		[["leaddeveloper"], true],
		[["developer"], true],
		[["seo"], true],
		[["guest"], false],
		[["user"], false]
	]) {
		const session = new STWSession(`studio-${roles[0]}`, {}, STWPortal.instance);
		session.roles = roles;
		const handlers = new Map();
		const messages = [];
		const socket = {
			on: (event, handler) => handlers.set(event, handler),
			send: (message) => messages.push(JSON.parse(message))
		};
		handleWebSocket(new Request("http://localhost/?tab=studio"), socket, session, new Map());
		await handlers.get("message")(Buffer.from(JSON.stringify({
			method: "HEAD",
			resource: "/nonexistent",
			options: { lang: "en", langs: ["en"], tz: "UTC" }
		})));
		assert.deepEqual(messages, [{ method: "AUTH", canStudio: expected }]);
	}
});

test("concurrent WebSocket choice queries preserve session roles and request placeholders", async () => {
	const portal = STWPortal.instance;
	const previousFind = portal.find;
	const hadOwnFind = Object.hasOwn(portal, "find");
	const session = new STWSession("choice-session", {}, portal);
	session.roles = ["developer"];
	session.placeholders.set("@existing", "unchanged");
	const handlers = new Map(), messages = [];
	const socket = {
		on: (event, handler) => handlers.set(event, handler),
		send: message => messages.push(JSON.parse(message))
	};
	let started = 0, release;
	const bothStarted = new Promise(resolve => { release = resolve; });
	const content = {
		section: "main",
		async serve(_request, requestSession) {
			if (++started === 2) release();
			await bothStarted;
			const layout = new STWLayout("D('type;;wbol;/content-types')");
			const html = (await layout.render([], requestSession.placeholders, requestSession)).HTML;
			return new Response(JSON.stringify({
				method: "PUT", id: "choice-runtime", section: "main",
				body: html, requestValue: requestSession.placeholders.get("@uuid")
			}));
		}
	};
	try {
		portal.find = (_session, resource) => resource === "choice-runtime" ? content : undefined;
		handleWebSocket(new Request("http://localhost/?tab=choices"), socket, session, new Map());
		await Promise.all(["first", "second"].map(uuid => handlers.get("message")(Buffer.from(JSON.stringify({
			method: "PATCH", resource: "choice-runtime", options: {}, search: { uuid }
		})))));
		assert.deepEqual(messages.map(message => message.requestValue).sort(), ["first", "second"]);
		assert.ok(messages.every(message => /<option value="Table"/.test(message.body)));
		assert.equal(session.placeholders.get("@existing"), "unchanged");
		assert.equal(session.placeholders.has("@uuid"), false);
	} finally {
		if (hadOwnFind) portal.find = previousFind;
		else delete portal.find;
		session.sockets.delete("choices");
		handlers.get("close")();
	}
});

test("content rendering errors are identified and include a modal close control", async () => {
	const command = STWConnectors.command;
	STWConnectors.command = async () => ({ fields: [], rows: [] });
	try {
		const content = new STWContent({ uuid: "error-content", section: "main" });
		content.isVisible = () => 1;
		content.pathname = () => "/error-content";
		content.getLayout = () => ({ render: async () => { throw new Error("Choice failed"); } });
		const response = await content.serve(new Request("http://localhost/"), {
			dev: false, placeholders: new Map()
		});
		const result = await response.json();
		assert.equal(result.error, true);
		assert.match(result.body, /Choice failed/);
		assert.match(result.body, /this\.closest\('dialog'\)\.close\(\)/);
	} finally {
		STWConnectors.command = command;
	}
});

test("developer content cogs open the Studio editor with the selected content UUID", async () => {
	const command = STWConnectors.command;
	STWConnectors.command = async () => ({ fields: [], rows: [{}] });
	try {
		const content = new STWContent({
			uuid: "c4sHhypzNzBJ7LpOv3ROBvX",
			subtype: "Table",
			section: "main",
			layout: { en: "t('Content')" },
			visibility: { developer: true }
		});
		const session = {
			dev: true,
			lang: "en",
			roles: ["developer"],
			portal: { mainpage: "" },
			placeholders: new Map(),
			baseurl: "",
			tz: "UTC"
		};

		const response = await content.serve(new Request("http://localhost/"), session);
		const { body } = await response.json();

		assert.match(body, /_stwOpenContentEditor\("c4sHhypzNzBJ7LpOv3ROBvX"\)/);
	} finally {
		STWConnectors.command = command;
	}
});

test("static file serving returns content and blocks paths outside public", async () => {
	const response = await serveFile(new Request("http://localhost/index.html"), "./public/index.html");
	assert.equal(response.status, 200);
	assert.match(response.headers.get("content-type") ?? "", /text\/html/);

	const schema = await serveFile(new Request("http://localhost/schemas/wbol.xsd"), "./public/schemas/wbol.xsd");
	assert.equal(schema.status, 200);
	assert.match(schema.headers.get("content-type") ?? "", /application\/xml/);
	assert.match(await schema.text(), /targetNamespace="https:\/\/spintheweb\.org\/schemas\/wbol\.xsd"/);

	const forbidden = await serveFile(new Request("http://localhost/.env"), "./public/../.env");
	assert.equal(forbidden.status, 403);
});

test("runCommand captures output and exit status", async () => {
	const result = await runCommand(process.execPath, ["-e", "process.stdout.write('ready')"]);
	assert.equal(result.code, 0);
	assert.equal(result.stdout, "ready");
	assert.equal(result.stderr, "");
});

test("WBLL buttons carry signed server action metadata and method semantics", async () => {
	const placeholders = new Map([["@@fId", "42"]]);
	const session = { sessionId: "layout-session", placeholders, baseurl: "localhost", lang: "en", tz: "UTC" };
	const layout = new STWLayout("b('/customer;stwupdate;erp;select * from tCustomers where fId=@@fId')p('fId;@@fId')t('Save')");
	const { HTML } = await layout.render([], placeholders, session, "", "customer-content");
	assert.match(HTML, /name="stwAction" value="stwupdate"/);
	assert.doesNotMatch(HTML, /data-stw-(?:action|method)=/);
	assert.match(HTML, /formmethod="POST"/);
	assert.match(HTML, /formaction="\/customer\?fId=42"/);
	assert.match(HTML, />Save<\/button>/);
	const token = /data-stw-action-token="([^"]+)"/.exec(HTML)?.[1];
	assert.ok(token);
	assert.deepEqual(verifyAction(token, session.sessionId), {
		action: "stwupdate",
		args: ["erp", "select * from tCustomers where fId=@@fId"],
		currentUrl: false,
		redirect: "/customer",
		origin: "customer-content",
		params: [["fId", "42"]]
	});

	const search = new STWLayout("b('.;stwsearch')t('Search')");
	const searchHTML = (await search.render([], placeholders, session, "", "search-content")).HTML;
	assert.doesNotMatch(searchHTML, /data-stw-(?:action|method)=/);
	assert.match(searchHTML, /data-stw-current-url="true"/);
	assert.match(searchHTML, />Search<\/button>/);
	const [encoded, signature] = token.split(".");
	assert.equal(verifyAction(`${encoded}.${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`, session.sessionId), null);
	assert.equal(verifyAction(token, "another-session"), null);

	for (const action of ["stwfilter", "stwinsert", "stwdelete", "stwsubmit"]) {
		const actionLayout = new STWLayout(`b('/;${action}')`);
		const actionHTML = (await actionLayout.render([], placeholders, session, "", "action-content")).HTML;
		assert.match(actionHTML, new RegExp(`value="${action}"`));
		assert.doesNotMatch(actionHTML, /data-stw-(?:action|method)=/);
	}
});

test("table actions use shared table forms and reveal row or insert controls on edit", async () => {
	const placeholders = new Map([["@@name", "Ada"]]);
	const session = { sessionId: "table-session", placeholders, baseurl: "localhost", lang: "en", tz: "UTC" };
	const rowLayout = new STWLayout("l('Name')e b('/;stwupdate')b('/;stwdelete')");
	const rowHTML = (await rowLayout.render(["name"], placeholders, session, "tbody", "table-id")).HTML;
	assert.match(rowHTML, /form="stwFEtable-id"/);
	assert.match(rowHTML, /class="stwTableEditRow"/);
	assert.match(rowHTML, /class="stwTableRowActions" hidden/);
	assert.doesNotMatch(rowHTML, /stwFER/);

	const insertLayout = new STWLayout("l('Name')e b('/;stwinsert')");
	const insertHTML = (await insertLayout.render(["name"], placeholders, session, "thead", "table-id")).HTML;
	assert.match(insertHTML, /class="stwTableEditInsert"/);
	assert.match(insertHTML, /data-stw-insert-row hidden/);
	assert.match(insertHTML, /class="stwTableInsertActions" hidden/);
	assert.match(insertHTML, /form="stwFEtable-id"/);

	const searchLayout = new STWLayout("l('Name')e b('/;stwsearch')");
	const searchHTML = (await searchLayout.render(["name"], placeholders, session, "thead", "table-id")).HTML;
	assert.match(searchHTML, /form="stwFStable-id"/);

	const table = new STWTable({
		uuid: "table-id",
		subtype: "Table",
		layout: { en: "l('Name')e b('/;stwupdate')b('/;stwdelete')b('/;stwinsert')" }
	});
	const tableHTML = await table.render(null, session, { fields: ["name"], rows: [{ name: "Ada" }] });
	assert.match(tableHTML, /id="stwFEtable-id"/);
	assert.match(tableHTML, /id="stwFStable-id"/);
	assert.match(tableHTML, /class="stwTableEditRow"/);
	assert.match(tableHTML, /class="stwTableEditInsert"/);
	assert.doesNotMatch(tableHTML, /stwFERtable-id/);
});

test("search and filter actions redirect with the expected query-string behavior", async () => {
	const router = new STWActionRouter();
	const formData = new FormData();
	formData.set("term", "widgets");
	formData.set("page", "3");
	const request = { url: "https://example.test/search?existing=yes" };
	const search = await router.execute({
		action: "stwsearch",
		formData,
		req: request,
		url: request.url
	});
	assert.equal(search.redirect, "https://example.test/search?term=widgets&page=3");

	formData.set("term", "");
	const filter = await router.execute({
		action: "stwfilter",
		formData,
		req: request,
		url: request.url
	});
	assert.equal(filter.redirect, "https://example.test/search?existing=yes&page=3");
});

test("the built-in wbol connector reads and updates WBOL content in-process", async () => {
	const portalId = `wbol-connector-portal-${Date.now()}`;
	const contentId = `wbol-connector-content-${Date.now()}`;
	const portal = new STWPortal({
		uuid: portalId,
		langs: ["en", "it"],
		name: { en: "Portal", it: "Portale" },
		slug: { en: "portal", it: "portale" },
		visibility: { developer: true }
	});
	const content = new STWContent({
		uuid: contentId,
		subtype: "Text",
		name: { en: "Original", it: "Originale" },
		slug: { en: "original", it: "originale" },
		visibility: { developer: true }
	});
	portal.children.push(content);
	content.parent = portal;
	STWIndex.set(contentId, content);
	const session = new STWSession("wbol-connector-session", {}, portal);
	session.roles = ["developer"];
	session.placeholders.set("@uuid", contentId);
	try {
		const read = await STWConnectors.execute(session, { connector: "wbol", query: "$", params: "/@uuid" }, { throwOnError: true });
		assert.equal(read.rows[0].name, "Original");

		session.setLanguage("it");
		const treeQuery = `($lang := "@@stwlanguage"; {
			"uuid": uuid, "type": type, "name": $lookup(name, $lang), "slug": $lookup(slug, $lang),
			"children": [children.{"uuid": uuid, "type": type, "name": $lookup(name, $lang), "slug": $lookup(slug, $lang)}]
		})`;
		const tree = await STWConnectors.execute(session, {
			connector: "wbol",
			params: "/",
			query: treeQuery
		}, { throwOnError: true });
		assert.deepEqual(JSON.parse(JSON.stringify(tree.rows)), [{
			uuid: portalId, type: "Portal", name: "Portale", slug: "portale",
			children: [{ uuid: contentId, type: "Content", name: "Originale", slug: "originale" }]
		}]);
		const treeContent = new STWTree({
			uuid: "wbol-connector-tree", subtype: "Tree", connector: "wbol", params: "/", query: treeQuery,
			layout: { it: "v(';;@@name')" }, visibility: { developer: true }
		});
		const { body: html } = await (await treeContent.serve(new Request("http://localhost/"), session)).json();
		assert.match(html, /Portale/);
		assert.match(html, /Originale/);
		assert.doesNotMatch(html, /\[object Promise\]/);
		assert.doesNotMatch(html, /stwError/);
		portal.children.pop();
		const emptyTree = await STWConnectors.execute(session, {
			connector: "wbol", params: "/", query: treeQuery
		}, { throwOnError: true });
		assert.deepEqual(emptyTree.rows[0].children, []);
		portal.children.push(content);
		const noMatches = await STWConnectors.execute(session, {
			connector: "wbol", params: "/", query: "children[uuid = 'not-found']"
		}, { throwOnError: true });
		assert.deepEqual(noMatches.rows, []);
		await assert.rejects(
			STWConnectors.execute(session, { connector: "wbol", params: "/", query: "{" }, { throwOnError: true })
		);
		session.roles = ["guest"];
		await assert.rejects(
			STWConnectors.execute(session, { connector: "wbol", params: "/", query: "$" }, { throwOnError: true }),
			/Forbidden/
		);
		session.roles = ["developer"];
		session.setLanguage("en");
		const update = await STWConnectors.executeAction(session, "wbol", `/${contentId}`, "PATCH", { name: "Updated" });
		assert.equal(update.rows[0].name, "Updated");
		assert.equal(content.localize(session, "name"), "Updated");
	} finally {
		STWIndex.delete(contentId);
	}
});

test("tree content renders path-based rows using the configured key", async () => {
	const session = new STWSession("tree-path-session", {}, null);
	const tree = new STWTree({ uuid: "tree-path", subtype: "Tree", layout: { en: "\\s('key=\"path\"')v(';;@@name')" } });
	const html = await tree.render(null, session, {
		fields: ["path", "name"],
		rows: [{ path: "parent", name: "Parent" }, { path: "parent/child", name: "Child" }]
	});
	assert.match(html, /parent/);
	assert.match(html, /child/);
	assert.doesNotMatch(html, /\[object Promise\]/);
});

test("Studio webbase tree maps elements to icons and editor routes", async () => {
	const studio = WBOL(await readFile("./webbaselets/stwStudio.wbol", "utf8"));
	const find = (element, slug) => element.slug?.en === slug
		? element
		: (element.children || []).map((child) => find(child, slug)).find(Boolean);
	const definition = find(studio, "webbase");
	assert.ok(definition);
	assert.equal(definition.params, "/");

	const data = await jsonata(definition.query).evaluate({
		uuid: "site-id",
		type: "Portal",
		name: { en: "Site" },
		children: [{
			uuid: "area-id",
			type: "Area",
			name: { en: "Area" },
			children: [{
				uuid: "page-id",
				type: "Page",
				name: { en: "Page" },
				children: [{
					uuid: "content-id",
					type: "Content",
					subtype: "Table",
					section: "main",
					name: { en: "People" },
					children: []
				}]
			}]
		}]
	});
	assert.deepEqual(
		[data.icon, data.url, data.name, data.type],
		["<span class='fa-light fa-fw fa-globe' aria-hidden='true'></span>", "/stws/edit/edit-portal", "Site", "Portal"]
	);
	assert.equal(Array.isArray(data.children), true);
	assert.deepEqual([
		data.children[0].url,
		data.children[0].children[0].url,
		data.children[0].children[0].children[0].url
	], ["/stws/edit/edit-area", "/stws/edit/edit-page", "/stws/edit/edit-content"]);

	const tree = new STWTree(definition);
	const html = await tree.render(null, {
		lang: "en",
		baseurl: "localhost",
		tz: "UTC",
		placeholders: new Map()
	}, { fields: Object.keys(data), rows: [data] });
	assert.match(html, /data-url="\/stws\/edit\/edit-portal"/);
	assert.match(html, /data-uuid="site-id"/);
	assert.match(html, /People/);
});

test("WBOL lists registered content types only for developers", async () => {
	const request = (method = "GET") => new Request("http://localhost/wbol/content-types", { method });
	const response = await handleWbolApi(request(), { roles: ["developer"] });
	assert.equal(response.status, 200);
	const types = await response.json();
	assert.ok(types.some((row) => row.value === "Text"));
	assert.ok(types.some((row) => row.value === "Table"));
	assert.ok(types.every((row) => !["Page", "Portal"].includes(row.value)));
	assert.equal((await handleWbolApi(request(), { roles: ["seo"] })).status, 403);
	assert.equal((await handleWbolApi(request("PATCH"), { roles: ["developer"] })).status, 405);
});

test("Studio search result records retain order and exclude inaccessible elements", async () => {
	const portal = new STWPortal({ uuid: "search-test-portal", langs: ["en", "fr"] });
	const visible = new STWContent({
		uuid: "search-visible", subtype: "Text", name: { en: "Name", fr: "Nom" },
		visibility: { developer: true }
	});
	const hidden = new STWContent({
		uuid: "search-hidden", subtype: "Text", name: { en: "Hidden" },
		visibility: { developer: false, seo: false }
	});
	visible.parent = hidden.parent = portal;
	portal.children.push(visible, hidden);
	STWIndex.set(visible.uuid, visible);
	STWIndex.set(hidden.uuid, hidden);
	const session = { roles: ["developer"], lang: "en", portal };
	const encode = ids => Buffer.from(encodeURIComponent(JSON.stringify(ids))).toString("base64url");
	const call = (ids, requestSession = session) => handleWbolApi(
		new Request(`http://localhost/wbol/search-results?ids=${ids}&locale=fr`), requestSession
	);
	try {
		const response = await call(encode([visible.uuid, hidden.uuid, "missing"]));
		assert.deepEqual(await response.json(), [{ name: "Nom", uuid: visible.uuid, type: "Content" }]);
		const records = await STWConnectors.query(session, "wbol",
			`/search-results?ids=${encode([visible.uuid, hidden.uuid])}&locale=fr`, { throwOnError: true });
		assert.deepEqual(records.fields, ["name", "uuid", "type"]);
		assert.deepEqual(records.rows, [{ name: "Nom", uuid: visible.uuid, type: "Content" }]);
		assert.equal((await call(encode([visible.uuid]), { roles: ["guest"], lang: "en", portal })).status, 403);
		assert.equal((await call("not-valid!")).status, 400);
	} finally {
		STWIndex.delete(visible.uuid);
		STWIndex.delete(hidden.uuid);
		STWIndex.delete(portal.uuid);
	}
});

test("dropdown connector queries render one to three columns and propagate failures", async () => {
	const placeholders = new Map([["@@type", "two"]]);
	const session = { placeholders, baseurl: "", lang: "en", tz: "UTC" };
	const twoColumns = new STWLayout('D(\'type;@@type;json;[{"id":"one","name":"One"},{"id":"two","name":"Two & more"}]\')');
	const html = (await twoColumns.render([], placeholders, session)).HTML;
	assert.match(html, /<option value="two" selected>Two &amp; more<\/option>/);
	assert.doesNotMatch(html, /<option value=""><\/option>/);

	const grouped = new STWLayout('d(\'type;@@type;json;[{"id":"two","name":"Two","group":"A & B"}]\')');
	const groupedHtml = (await grouped.render([], placeholders, session)).HTML;
	assert.match(groupedHtml, /<option value=""><\/option>/);
	assert.match(groupedHtml, /<optgroup label="A &amp; B"><option value="two" selected>Two<\/option><\/optgroup>/);

	const empty = new STWLayout("D('type;@@type;json;[]')");
	assert.match((await empty.render([], placeholders, session)).HTML, /<select[^>]*><\/select>/);
	const tooManyColumns = new STWLayout('D(\'type;@@type;json;[{"a":1,"b":2,"c":3,"d":4}]\')');
	await assert.rejects(tooManyColumns.render([], placeholders, session), /one to three columns/);

	const query = STWConnectors.query;
	STWConnectors.query = async (choiceSession, connector, command) => {
		assert.equal(connector, "example");
		assert.equal(command, 'SELECT "label"; @@type');
		assert.equal(choiceSession.placeholders.get("@@type"), "two");
		return { fields: ["name"], rows: [{ name: "two" }] };
	};
	try {
		const oneColumn = new STWLayout('D(\'type;@@type;example;SELECT "label"; @@type\')');
		assert.match((await oneColumn.render([], placeholders, session)).HTML, /<option value="two" selected>two<\/option>/);
		STWConnectors.query = async () => { throw new Error("Connector unavailable"); };
		const invalid = new STWLayout("D('type;@@type;missing;query')");
		await assert.rejects(invalid.render([], placeholders, session), /Choice query failed: Connector unavailable/);
	} finally {
		STWConnectors.query = query;
	}
});

test("checkboxes, radios and multi-selects use connector choice records", async () => {
	const placeholders = new Map([["@@tags", "one,two"], ["@@choice", "two"]]);
	const session = { placeholders, baseurl: "", lang: "en", tz: "UTC" };
	const render = async (layout) => (await new STWLayout(layout).render([], placeholders, session)).HTML;
	const rows = '[{"value":"one","label":"One & more","group":"A & B"},{"value":"two","label":"Two","group":"A & B"}]';
	const checkbox = await render(`c('tags;@@tags;json;${rows}')`);
	assert.match(checkbox, /<legend>A &amp; B<\/legend>/);
	assert.match(checkbox, /type="checkbox" value="one" checked> One &amp; more/);
	assert.match(checkbox, /type="checkbox" value="two" checked> Two/);
	assert.match(checkbox, /onchange="[^"]*&quot;hidden&quot;[^"]*"/);

	const radio = await render(`r('choice;@@choice;json;${rows}')`);
	assert.match(radio, /type="radio" value="one"> One &amp; more/);
	assert.match(radio, /type="radio" value="two" checked> Two/);

	for (const symbol of ["s", "S"]) {
		const html = await render(`${symbol}('tags;@@tags;json;${rows}')`);
		assert.match(html, /<select[^>]* multiple/);
		assert.match(html, /<optgroup label="A &amp; B">/);
		assert.match(html, /<option value="one" selected>One &amp; more<\/option>/);
		assert.match(html, /<option value="two" selected>Two<\/option>/);
		if (symbol === "s") assert.match(html, /<option value=""><\/option>/);
		else assert.doesNotMatch(html, /<option value=""><\/option>/);
	}

	const oneColumn = await render('c(\'tags;@@tags;json;[{"value":"one"},{"value":"two"}]\')');
	assert.match(oneColumn, /type="checkbox" value="one" checked> one/);
	assert.match(oneColumn, /type="checkbox" value="two" checked> two/);
	const twoColumns = await render('r(\'choice;@@choice;json;[{"value":"two","label":"Two"}]\')');
	assert.match(twoColumns, /type="radio" value="two" checked> Two/);
	const inline = await render("c('tags;1;1;one;two')");
	assert.match(inline, /type="checkbox" value="1"/);

	const query = STWConnectors.query;
	STWConnectors.query = async () => { throw new Error("Connector unavailable"); };
	try {
		for (const symbol of ["c", "r", "s", "S"]) {
			await assert.rejects(render(`${symbol}('tags;@@tags;missing;query')`), /Choice query failed: Connector unavailable/);
		}
	} finally {
		STWConnectors.query = query;
	}
});

test("the Studio content editor submits and updates the selected content", async () => {
	const studio = WBOL(await readFile("./webbaselets/stwStudio.wbol", "utf8"));
	const find = (element) => element.slug?.en === "edit-content"
		? element : (element.children || []).map(find).find(Boolean);
	const definition = find(studio);
	const editor = new STWForm(definition);
	editor.visibility.set("developer", true);
	const portal = new STWPortal({ uuid: "editor-test-portal", langs: ["en", "it"] });
	const originalLayout = '<p>First; second &amp; third</p>';
	const content = new STWText({
		uuid: "editor-test-content",
		subtype: "Text",
		name: { en: "Original", it: "Italiano" },
		slug: { en: "original-content", it: "italiano" },
		section: "main",
		class: "old-class",
		connector: "json",
		query: '{"value":"a;b"}',
		params: "old",
		layout: { en: originalLayout, it: "t('Italiano')" },
		visibility: { developer: true }
	});
	portal.children.push(content, editor);
	content.parent = portal;
	editor.parent = portal;
	STWIndex.set(content.uuid, content);
	STWIndex.set(editor.uuid, editor);
	const session = new STWSession("editor-test-session", {}, portal);
	session.roles = ["user", "developer", "leaddeveloper"];
	session.placeholders.set("@uuid", content.uuid);
	try {
		const rendered = await editor.serve(new Request("http://localhost/stwc/edit-content"), session);
		const { body } = await rendered.json();
		assert.match(body, /name="uuid" value="editor-test-content"/);
		assert.match(body, /name="slug" value="original-content"/);
		assert.match(body, /name="sequence" value="0"/);
		assert.match(body, /<option value="Text" selected>/);
		assert.match(body, /name="query"[^>]*>\{&quot;value&quot;:&quot;a;b&quot;\}<\/textarea>/);
		assert.match(body, /name="layout"[^>]*>&lt;p&gt;First; second &amp;amp; third&lt;\/p&gt;<\/textarea>/);
		const token = /data-stw-action-token="([^"]+)"/.exec(body)?.[1];
		assert.ok(token);
		const fields = {
			uuid: content.uuid, name: "Updated", slug: "original-content", type: "Text",
			section: "header", sequence: "0", cssClass: "", connector: "",
			query: "", params: "", layout: "<p>Updated; & more</p>",
			stwAction: "stwupdate", stwActionToken: token, stwOrigin: editor.uuid,
			stwRedirect: "http://localhost/"
		};
		const submit = async (values) => {
			const formData = new FormData();
			for (const [name, value] of Object.entries(values)) formData.set(name, value);
			return await handleHttp(
				new Request("http://localhost/", { method: "PATCH", body: formData }),
				session, session.sessionId
			);
		};

		const response = await submit(fields);
		assert.equal(response.status, 303);
		assert.equal(content.name.get("en"), "Updated");
		assert.equal(content.slug.get("en"), "original-content");
		assert.equal(content.pathname(session), "/original-content");
		assert.equal(content.section, "header");
		assert.equal(content.sequence, "0");
		assert.equal(content.cssClass, "");
		assert.equal(content.connector, "");
		assert.equal(content.query, "");
		assert.equal(content.params, "");
		assert.equal(content.layout.get("en"), "<p>Updated; & more</p>");
		assert.equal(content.layout.get("it"), "t('Italiano')");
		const reopened = await (await editor.serve(new Request("http://localhost/stwc/edit-content"), session)).json();
		assert.match(reopened.body, /name="slug" value="original-content"/);
		assert.match(reopened.body, /name="sequence" value="0"/);

		const wrongId = await submit({ ...fields, uuid: "other-content" });
		assert.equal(wrongId.status, 400);
		assert.match(await wrongId.text(), /not found|does not match/i);

		const changedType = await submit({ ...fields, type: "Table", layout: "l('Name')e(';name;@@name')" });
		assert.equal(changedType.status, 303);
		const replacement = STWIndex.get(content.uuid);
		assert.ok(replacement instanceof STWTable);
		assert.equal(portal.children[0], replacement);
		assert.equal(replacement.layout.get("en").wbll, "l('Name')e(';name;@@name')");
		assert.equal(replacement.layout.get("it").wbll, "t('Italiano')");

		const invalidType = await submit({ ...fields, type: "NotAContent" });
		assert.equal(invalidType.status, 400);
		assert.match(await invalidType.text(), /Unknown content type/);
		assert.equal(STWIndex.get(content.uuid), replacement);
	} finally {
		STWIndex.delete(content.uuid);
		STWIndex.delete(editor.uuid);
		STWIndex.delete(portal.uuid);
	}
});

test("GET action requests execute on the server and redirect with 303", async () => {
	const id = `action-${Date.now()}`;
	const content = new STWContent({ uuid: id, slug: { en: "action" } });
	content.visibility.set("user", true);
	STWIndex.set(id, content);
	const portal = STWPortal.instance;
	const session = {
		sessionId: "search-session",
		portal,
		roles: ["user"],
		lang: "en",
		placeholders: new Map(),
		sockets: new Map()
	};
	try {
		const layout = new STWLayout("b('.;stwsearch')");
		const html = (await layout.render([], session.placeholders, session, "", id)).HTML;
		const token = /data-stw-action-token="([^"]+)"/.exec(html)?.[1];
		assert.ok(token);
		const parameters = new URLSearchParams({
			stwAction: "stwsearch",
			stwActionToken: token,
			stwOrigin: id,
			stwRedirect: "http://localhost/action?old=1",
			term: "widgets"
		});
		const response = await handleHttp(
			new Request(`http://localhost/action?${parameters}`),
			session,
			session.sessionId
		);
		assert.equal(response.status, 303);
		assert.equal(response.headers.get("location"), "http://localhost/action?term=widgets");
	} finally {
		STWIndex.delete(id);
	}
});

test("POST action requests execute and return a GET redirect", async () => {
	const id = `logout-${Date.now()}`;
	const content = new STWContent({ uuid: id, slug: { en: "logout" } });
	content.visibility.set("user", true);
	STWIndex.set(id, content);
	const portal = STWPortal.instance;
	const session = {
		sessionId: "logout-session",
		portal,
		roles: ["user"],
		lang: "en",
		user: "alice",
		name: "Alice",
		dev: true,
		placeholders: new Map([
			["@@stwlogin", "alice"],
			["@@stwloginname", "Alice"],
			["@@stwloginid", "123"]
		]),
		sockets: new Map()
	};
	try {
		const layout = new STWLayout("b('http://localhost/;stwlogoff')");
		const html = (await layout.render([], session.placeholders, session, "", id)).HTML;
		const token = /data-stw-action-token="([^"]+)"/.exec(html)?.[1];
		assert.ok(token);
		const formData = new FormData();
		formData.set("stwAction", "stwlogoff");
		formData.set("stwActionToken", token);
		formData.set("stwOrigin", id);
		formData.set("stwRedirect", "http://localhost/");
		const response = await handleHttp(
			new Request("http://localhost/logout", { method: "POST", body: formData }),
			session,
			session.sessionId,
			(current, preserveIdentity) => {
				assert.equal(Boolean(preserveIdentity), false);
				return { sessionId: `${current.sessionId}-rotated` };
			}
		);
		assert.equal(response.status, 303);
		assert.equal(response.headers.get("location"), "http://localhost/");
		assert.match(response.headers.get("set-cookie") ?? "", /sessionId=logout-session-rotated/);
		assert.equal(session.user, "guest");
		assert.equal(session.roles[0], "guest");
		assert.deepEqual(Object.fromEntries(
			["@@stwlogin", "@@stwloginname", "@@stwloginid"].map((key) => [key, session.placeholders.get(key)])
		), {
			"@@stwlogin": "guest",
			"@@stwloginname": "Guest",
			"@@stwloginid": "-3"
		});
	} finally {
		STWIndex.delete(id);
	}
});

test("connector-backed form submission returns action errors to the client", async () => {
	const id = `submit-error-${Date.now()}`;
	const content = new STWContent({ uuid: id, subtype: "Form" });
	content.visibility.set("user", true);
	STWIndex.set(id, content);
	const session = {
		sessionId: "submit-error-session",
		portal: STWPortal.instance,
		roles: ["user"],
		lang: "en",
		placeholders: new Map(),
		sockets: new Map()
	};
	const executeAction = STWConnectors.executeAction;
	const consoleError = console.error;
	STWConnectors.executeAction = async () => {
		throw new Error("SMTP unavailable");
	};
	console.error = () => {};
	try {
		const layout = new STWLayout("b('.;stwsubmit;smtpApi;send')");
		const html = (await layout.render([], session.placeholders, session, "", id)).HTML;
		const token = /data-stw-action-token="([^"]+)"/.exec(html)?.[1];
		assert.ok(token);
		const formData = new FormData();
		formData.set("stwAction", "stwsubmit");
		formData.set("stwActionToken", token);
		formData.set("stwOrigin", id);
		formData.set("stwRedirect", "http://localhost/");
		formData.set("to", "user@example.test");
		formData.set("subject", "Test");
		formData.set("text", "Test message");

		const response = await handleHttp(
			new Request("http://localhost/submit", { method: "POST", body: formData }),
			session,
			session.sessionId
		);
		assert.equal(response.status, 400);
		assert.equal(await response.text(), "SMTP unavailable");
	} finally {
		console.error = consoleError;
		STWConnectors.executeAction = executeAction;
		STWIndex.delete(id);
	}
});

test("actions require signed tokens and RBV visibility", async () => {
	const id = `hidden-action-${Date.now()}`;
	const content = new STWContent({ uuid: id, subtype: "Text", slug: { en: "hidden-action" } });
	content.visibility.set("user", true);
	STWIndex.set(id, content);
	const session = {
		sessionId: "hidden-session",
		portal: STWPortal.instance,
		roles: ["guest"],
		lang: "en",
		user: "alice",
		name: "Alice",
		dev: false,
		placeholders: new Map([["USER", "alice"], ["AUTHENTICATED", "true"]]),
		sockets: new Map()
	};
	const token = signAction({
		action: "stwlogoff",
		args: [],
		origin: id,
		redirect: "http://localhost/"
	}, session.sessionId);
	try {
		for (const signed of [true, false]) {
			const formData = new FormData();
			formData.set("stwAction", "stwlogoff");
			formData.set("stwOrigin", id);
			if (signed) formData.set("stwActionToken", token);
			const response = await handleHttp(
				new Request("http://localhost/hidden-action", { method: "POST", body: formData }),
				session,
				session.sessionId
			);
			assert.equal(response.status, signed ? 403 : 400);
			assert.equal(session.user, "alice");
		}
	} finally {
		STWIndex.delete(id);
	}
});

test("WBOL parser loads the portal through Node XML and filesystem APIs", () => {
	const portal = WBOL("./.data/webbase.wbol");
	assert.equal(portal.type, "Portal");
	assert.ok(Array.isArray(portal.children));
});

test("WBOL parser reads connector definitions from the webbase", () => {
	const portal = WBOL(`<webbase uuid="portal" langs="en">
		<name><text xml:lang="en" slug="portal">Portal</text></name>
		<connectors>
			<connector id="main" queryLanguage="SQL" connection-string="mysql://main" />
			<connector id="archive">postgres://archive</connector>
		</connectors>
		<visibility><role id="user" /><role id="developer" /></visibility>
		<children />
	</webbase>`);
	assert.deepEqual(portal.connectors, {
		main: "mysql://main",
		archive: "postgres://archive"
	});
	assert.deepEqual(portal.visibility, { root: true, user: false, developer: false });
});

test("the reserved wbol slug is rejected when elements are created or updated", () => {
	assert.throws(() => new STWElement({ uuid: "reserved-one", slug: { en: "wbol" } }), /slug 'wbol' is reserved/i);
	assert.throws(() => new STWElement({ uuid: "reserved-two", slug: { en: "W-BOL" } }), /slug 'wbol' is reserved/i);

	const element = new STWElement({ uuid: "reserved-element", slug: { en: "home" } });
	assert.throws(() => element.updateLocalizedField({}, "slug", { en: "wbol" }), /slug 'wbol' is reserved/i);
	assert.equal(element.slug.get("en"), "home");

	const content = new STWContent({ uuid: "reserved-content", subtype: "Text", slug: { en: "home" } });
	assert.throws(() => content.localize({ lang: "en" }, "slug", "wbol"), /slug 'wbol' is reserved/i);
	assert.equal(content.slug.get("en"), "home");
	content.localize({ lang: "en" }, "slug", "news-item.v2");
	assert.equal(content.slug.get("en"), "news-item.v2");
	element.updateLocalizedField({}, "slug", { en: "news-item.v2" });
	assert.equal(element.slug.get("en"), "news-item.v2");
	assert.equal(validateChanges(content, "en", { slug: "news-item.v2" }).slug.get("en"), "news-item.v2");
});

test("WBOL element API requires the developer role", async () => {
	const request = new Request("http://localhost/wbol/not-an-element");
	for (const role of ["root", "administrator", "leaddeveloper", "user"]) {
		const response = await handleWbolApi(request, { roles: [role] });
		assert.equal(response.status, 403, `${role} must not grant development access`);
	}

	const developerResponse = await handleWbolApi(request, { roles: ["developer"] });
	assert.equal(developerResponse.status, 404, "developer may access element routes");
});

test("hashPassword creates a salted PBKDF2 password verifier", async () => {
	const verifier = await STWSecurity.hashPassword("password");

	assert.match(verifier, /^[0-9a-f]{32}:[0-9a-f]{64}$/);
});

test("Docker configuration persists in the data directory across restarts", async () => {
	const dir = await mkdtemp(join(tmpdir(), "webspinner-docker-config-"));
	const env = { ...process.env, SPINNER_ENV: "docker" };
	delete env.ALLOW_DEV;
	try {
		await mkdir(join(dir, ".data"));
		await writeFile(join(dir, ".env.docker"), "ALLOW_DEV=true\n");
		await writeFile(join(dir, ".data", ".env.docker"), "ALLOW_DEV=false\n");
		const configUrl = new URL("../stwComponents/stwConfig.js", import.meta.url).href;
		const securityUrl = new URL("../stwComponents/stwSecurity.js", import.meta.url).href;
		const run = (script) => {
			const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
				cwd: dir, env, encoding: "utf8"
			});
			assert.equal(result.status, 0, result.stderr);
			return result.stdout.trim();
		};
		assert.equal(run(`import { envGet } from ${JSON.stringify(configUrl)};
			import { STWSecurity } from ${JSON.stringify(securityUrl)};
			console.log(envGet("ALLOW_DEV"));
			await STWSecurity.updateConfiguration({ ALLOW_DEV: "true" });`), "false");
		assert.equal(run(`import { envGet } from ${JSON.stringify(configUrl)};
			console.log(envGet("ALLOW_DEV"));`), "true");
		assert.match(await readFile(join(dir, ".data", ".env.docker"), "utf8"), /ALLOW_DEV=true/);
		assert.equal(await readFile(join(dir, ".env.docker"), "utf8"), "ALLOW_DEV=true\n");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("successful logon requests a session rotation while preserving the verified identity", async () => {
	const previousUsersPath = process.env.USERS;
	const securityDir = await mkdtemp(join(tmpdir(), "webspinner-logon-rotation-"));
	try {
		process.env.USERS = join(securityDir, "users.json");
		await STWSecurity.createUser("alice", "Alice", "password", ["user"], "");
		const session = { placeholders: new Map() };
		const formData = new FormData();
		formData.set("username", "alice");
		formData.set("password", "password");

		const result = await new STWActionRouter().execute({
			action: "stwlogon",
			args: [],
			formData,
			session,
			url: "http://localhost/"
		});

		assert.equal(result.ok, true);
		assert.equal(result.rotateSession, true);
		assert.equal(result.preserveIdentity, true);
		assert.equal(session.user, "alice");
		assert.deepEqual(session.roles, ["user"]);
	} finally {
		if (previousUsersPath === undefined) delete process.env.USERS;
		else process.env.USERS = previousUsersPath;
		await rm(securityDir, { recursive: true, force: true });
	}
});

test("changePassword verifies the current password and persists the replacement", async () => {
	const previousUsersPath = process.env.USERS;
	const securityDir = await mkdtemp(join(tmpdir(), "webspinner-change-password-"));
	try {
		process.env.USERS = join(securityDir, "users.json");
		await STWSecurity.createUser("alice", "Alice", "old-password", ["user"], "");
		await STWSecurity.changePassword("alice", "old-password", "new-password");

		const session = { placeholders: new Map() };
		assert.equal(await STWSecurity.authenticate(session, "alice", "old-password"), false);
		assert.equal(await STWSecurity.authenticate(session, "alice", "new-password"), true);
	} finally {
		if (previousUsersPath === undefined) delete process.env.USERS;
		else process.env.USERS = previousUsersPath;
		await rm(securityDir, { recursive: true, force: true });
	}
});

test("placeholder user passwords can be replaced with valid verifiers", async () => {
	const usersPath = new URL("../.data/users.json", import.meta.url);
	const users = JSON.parse(await readFile(usersPath, "utf8"));

	for (const user of users) {
		if (user.password === "salt:hash") {
			user.password = await STWSecurity.hashPassword("password");
		}
	}

	assert.ok(users.every((user) => user.password !== "salt:hash"));
});

test("authentication resolves role inheritance and filters privileged roles using default-off security flags", async () => {
	const previousEnvironment = {
		USERS: process.env.USERS,
		ALLOW_DEV: process.env.ALLOW_DEV,
		ALLOW_ROOT: process.env.ALLOW_ROOT
	};
	const securityDir = await mkdtemp(join(tmpdir(), "webspinner-role-gates-"));
	const password = "test-password";
	try {
		process.env.USERS = join(securityDir, "users.json");
		delete process.env.ALLOW_DEV;
		delete process.env.ALLOW_ROOT;
		await STWSecurity.createUser("privileged", "Privileged", password, ["root"], "");
		await STWSecurity.createUser("lead", "Lead", password, ["leaddeveloper"], "");
		const users = JSON.parse(await readFile(process.env.USERS, "utf8"));
		users.find((user) => user.user === "lead").id = 123;
		await writeFile(process.env.USERS, JSON.stringify(users));

		const authenticate = async (user = "privileged") => {
			const session = { placeholders: new Map() };
			assert.equal(await STWSecurity.authenticate(session, user, password), true);
			return session;
		};
		let session = await authenticate();
		assert.deepEqual(session.roles, ["user", "administrator"], "unset flags must disable root and development roles");
		assert.equal(session.dev, false);

		process.env.ALLOW_DEV = "true";
		session = await authenticate();
		assert.deepEqual(session.roles, ["user", "leaddeveloper", "administrator", "developer", "seo"]);
		assert.equal(session.dev, true);

		process.env.ALLOW_DEV = "false";
		process.env.ALLOW_ROOT = "true";
		session = await authenticate();
		assert.deepEqual(session.roles, ["root", "user", "administrator"]);
		assert.equal(session.dev, false);

		process.env.ALLOW_ROOT = "false";
		session = await authenticate("lead");
		assert.deepEqual(session.roles, ["user"], "development roles must be disabled together");
		assert.equal(session.dev, false);

		process.env.ALLOW_DEV = "true";
		session = await authenticate("lead");
		assert.deepEqual(session.roles, ["leaddeveloper", "developer", "seo", "user"]);
		assert.equal(session.dev, true);
		assert.deepEqual(Object.fromEntries(
			["@@stwlogin", "@@stwloginname", "@@stwloginid"].map((key) => [key, session.placeholders.get(key)])
		), {
			"@@stwlogin": "lead",
			"@@stwloginname": "Lead",
			"@@stwloginid": "123"
		});

		const guestSession = { placeholders: new Map() };
		assert.equal(await STWSecurity.authenticate(guestSession, "guest", ""), true);
		assert.deepEqual(Object.fromEntries(guestSession.placeholders), {
			"@@stwlogin": "guest",
			"@@stwloginname": "Guest",
			"@@stwloginid": "-3"
		});

		assert.equal(await STWSecurity.authenticate(session, "lead", "wrong-password"), false);
		assert.deepEqual(Object.fromEntries(
			["@@stwlogin", "@@stwloginname", "@@stwloginid"].map((key) => [key, session.placeholders.get(key)])
		), {
			"@@stwlogin": "guest",
			"@@stwloginname": "Guest",
			"@@stwloginid": "-3"
		});

		process.env.ALLOW_ROOT = "yes";
		await assert.rejects(authenticate(), /ALLOW_ROOT must be "true" or "false"/);
	} finally {
		for (const [name, value] of Object.entries(previousEnvironment)) {
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		}
		await rm(securityDir, { recursive: true, force: true });
	}
});

test("LeadDeveloper and root can edit the portal without changing its visibility", async () => {
	const portal = new STWPortal({
		uuid: "portal-lead-edit-test",
		langs: ["en"],
		name: { en: "Original" },
		slug: { en: "original" },
		mainpage: "original-home"
	});
	const request = (roles, method, body) => handleWbolApi(
		new Request(`http://localhost/wbol/${portal.uuid}`, {
			method,
			headers: body === undefined ? {} : { "Content-Type": "application/json" },
			body: body === undefined ? undefined : JSON.stringify(body)
		}),
		{ roles, lang: "en", portal }
	);
	try {
		for (const roles of [["developer"], ["seo"], ["administrator"], ["leaddeveloper"], ["root"]]) {
			assert.equal((await request(roles, "GET")).status, 403);
			assert.equal((await request(roles, "PATCH", { name: "Denied" })).status, 403);
		}
		for (const roles of [["developer", "leaddeveloper"], ["developer", "root"]]) {
			assert.equal((await request(roles, "GET")).status, 200);
			assert.equal((await request(roles, "PATCH", {
				name: "Updated", slug: "updated", mainpage: "new-home"
			})).status, 200);
			assert.equal((await request(roles, "PATCH", { visibility: { developer: true } })).status, 403);
		}
		assert.equal(portal.name.get("en"), "Updated");
		assert.equal(portal.slug.get("en"), "updated");
		assert.equal(portal.mainpage, "new-home");
		assert.deepEqual(Object.fromEntries(portal.visibility), { root: true });
		assert.equal(portal.isVisible({ roles: ["leaddeveloper", "developer"], portal }, "developer") & 1, 0);
	} finally {
		STWIndex.delete(portal.uuid);
	}
});

test("WBOL developer and LeadDeveloper routes enforce their RBV permissions", async () => {
	const portalId = `portal-${Date.now()}`;
	const tabsId = `tabs-${Date.now()}`;
	const portal = new STWPortal({
		uuid: portalId,
		langs: ["en", "fr", "de"],
		connectors: { main: "json" },
		visibility: { developer: true }
	});
	const tabs = new STWTabs({
		uuid: tabsId,
		subtype: "Tabs",
		name: { en: "Settings", fr: "Parametres" },
		slug: { en: "settings", fr: "reglages" },
		layout: { en: "l('English')", fr: "l('Francais')" },
		visibility: { developer: true },
		options: [{ name: { en: "General" }, ref: "general" }]
	});
	portal.children.push(tabs);
	tabs.parent = portal;
	STWIndex.set(tabsId, tabs);
	const session = { roles: ["developer"], lang: "en", portal };
	const callAs = (requestSession, path, method = "GET", body) => handleWbolApi(
		new Request(`http://localhost/wbol/${path}`, {
			method,
			headers: body === undefined ? {} : { "Content-Type": "application/json" },
			body: body === undefined ? undefined : JSON.stringify(body)
		}),
		requestSession
	);
	const call = (path, method = "GET", body) => callAs(session, path, method, body);
	const previousRolesPath = process.env.ROLES;
	const previousUsersPath = process.env.USERS;
	const securityDir = await mkdtemp(join(tmpdir(), "webspinner-wbol-api-"));

	try {
		process.env.ROLES = join(securityDir, "roles.json");
		process.env.USERS = join(securityDir, "users.json");
		let response = await call(`${tabsId}/visibility`);
		assert.deepEqual(await response.json(), { developer: true });
		response = await call(`${tabsId}/visibility`, "PATCH", { developer: true });
		assert.equal(response.status, 403, "developer users cannot change RBV");
		response = await callAs({ roles: ["leaddeveloper"] }, `${tabsId}/visibility`, "PATCH", { seo: true });
		assert.deepEqual(await response.json(), { developer: true, seo: true });
		response = await call(tabsId, "PATCH", { visibility: { guest: true } });
		assert.equal(response.status, 403, "element updates cannot bypass visibility permissions");
		tabs.visibility.set("root", true);
		tabs.visibility.set("administrator", false);
		response = await callAs({ roles: ["leaddeveloper"] }, `${tabsId}/visibility`, "PUT", { developer: true });
		assert.deepEqual(await response.json(), { developer: true, root: true, administrator: false });
		tabs.visibility.delete("root");
		tabs.visibility.delete("administrator");
		response = await callAs({ roles: ["leaddeveloper"] }, `${portalId}/visibility`);
		assert.deepEqual(await response.json(), { developer: false, root: true });
		response = await callAs({ roles: ["leaddeveloper"] }, `${portalId}/visibility`, "PATCH", { root: true });
		assert.equal(response.status, 403, "LeadDeveloper cannot assign root visibility");
		response = await callAs({ roles: ["leaddeveloper"] }, `${tabsId}/visibility`, "PATCH", { administrator: true });
		assert.equal(response.status, 403, "LeadDeveloper cannot assign administrator visibility");
		response = await callAs({ roles: ["leaddeveloper"] }, `${portalId}/visibility`, "PATCH", { developer: true });
		assert.equal(response.status, 403, "the portal cannot grant visibility to non-root roles");
		response = await callAs({ roles: ["leaddeveloper"] }, `${portalId}/visibility`, "PUT", { developer: false });
		assert.deepEqual(await response.json(), { developer: false, root: true });
		response = await call("");
		assert.equal(response.status, 200);
		assert.deepEqual((await response.json()).children.map((child) => child.uuid), [tabsId]);
		assert.equal((await (await call(`${tabsId}?locale=de`)).json()).name, "Settings");
		assert.equal((await (await call(`${tabsId}?locale=de&fallback=false`)).json()).name, "");

		response = await call(`${tabsId}?locale=fr`, "PATCH", {
			name: "Parametres generaux",
			slug: "preferences"
		});
		assert.equal(response.status, 200);
		let updatedElement = await response.json();
		assert.equal(updatedElement.name, "Parametres generaux");
		assert.equal(updatedElement.slug, "preferences");
		assert.deepEqual(Object.fromEntries(tabs.name), { en: "Settings", fr: "Parametres generaux" });
		assert.deepEqual(Object.fromEntries(tabs.slug), { en: "settings", fr: "preferences" });
		response = await call(`${tabsId}?locale=de`, "PATCH", { name: "Einstellungen" });
		assert.equal(response.status, 200);
		updatedElement = await response.json();
		assert.equal(updatedElement.name, "Einstellungen");
		assert.deepEqual(Object.fromEntries(tabs.name), { en: "Settings", fr: "Parametres generaux", de: "Einstellungen" });
		response = await call(`${tabsId}?locale=it`, "PATCH", { name: "Impostazioni" });
		assert.equal(response.status, 400);
		response = await call(tabsId, "PATCH", { name: "Default locale update" });
		updatedElement = await response.json();
		assert.equal(updatedElement.name, "Default locale update");
		assert.deepEqual(Object.fromEntries(tabs.name), {
			en: "Default locale update",
			fr: "Parametres generaux",
			de: "Einstellungen"
		});

		response = await call(`${tabsId}?locale=fr`);
		const localizedElement = await response.json();
		assert.equal(localizedElement.name, "Parametres generaux");
		assert.equal(localizedElement.slug, "preferences");
		assert.equal(localizedElement.type, "Tabs");
		assert.equal(localizedElement.layout, "l('Francais')");
		response = await call(`?uuid=${tabsId}`);
		assert.equal(response.status, 400);

		response = await call(`${tabsId}/options`);
		assert.deepEqual((await response.json()).map((option) => option.ref), ["general"]);
		response = await call(`${tabsId}/options`, "PUT", [
			{ name: { en: "Details", fr: "Details-fr" }, ref: "details", parameters: "mode=edit" }
		]);
		assert.equal(response.status, 200);
		assert.deepEqual((await response.json()).map((option) => option.name.en), ["Details"]);
		response = await call(`${tabsId}/options?locale=fr`, "PATCH", { path: [0], name: "Details francais" });
		assert.equal(response.status, 200);
		let updatedOptions = await response.json();
		assert.deepEqual(updatedOptions[0].name, { en: "Details", fr: "Details francais" });
		response = await call(`${tabsId}/options?locale=de`, "PATCH", { path: [0], name: "Details deutsch" });
		updatedOptions = await response.json();
		assert.deepEqual(updatedOptions[0].name, { en: "Details", fr: "Details francais", de: "Details deutsch" });

		response = await call(`${portalId}/connectors`);
		assert.equal(response.status, 403, "developer users cannot manage the root-only portal");
		response = await callAs({ roles: ["leaddeveloper"] }, `${portalId}/connectors`);
		assert.deepEqual(await response.json(), { main: "json" });
		response = await callAs({ roles: ["leaddeveloper"] }, `${portalId}/connectors`, "PUT", { main: "objects" });
		assert.deepEqual(await response.json(), { main: "objects" });
		response = await callAs({ roles: ["administrator"] }, `${portalId}/connectors`);
		assert.equal(response.status, 403);

		response = await call(`${portalId}/roles`);
		assert.equal(response.status, 403);
		response = await call(`${portalId}/roles`, "POST", { role: "editors" });
		assert.equal(response.status, 403);
		response = await call(`${portalId}/roles`, "POST", { role: "developer" });
		assert.equal(response.status, 403);
		portal.visibility.set("developer", true);
		response = await call(`${portalId}/roles`);
		assert.ok((await response.json()).includes("developer"));
		response = await call(`${portalId}/roles`, "POST", { role: "blocked" });
		assert.equal(response.status, 403, "portal route cannot bypass role management permissions");
		response = await callAs({ roles: ["leaddeveloper"] }, `${portalId}/roles`, "POST", { role: "portal-role" });
		assert.equal(response.status, 201);
		response = await call("", "POST", {
			parentId: portalId,
			element: { type: "Page", children: [{ type: "Text", visibility: { guest: true } }] }
		});
		assert.equal(response.status, 403, "nested element creation cannot bypass visibility permissions");
		response = await call("", "POST", {
			parentId: portalId,
			element: { type: "Page", visibility: { guest: true } }
		});
		assert.equal(response.status, 403, "element creation cannot bypass visibility permissions");
		portal.visibility.delete("developer");

		tabs.visibility.delete("developer");
		response = await call(`${tabsId}/options`);
		assert.equal(response.status, 403, "a child inherits the portal's Developer-role denial");
	} finally {
		STWIndex.delete(tabsId);
		STWIndex.delete(portalId);
		if (previousRolesPath === undefined) delete process.env.ROLES;
		else process.env.ROLES = previousRolesPath;
		if (previousUsersPath === undefined) delete process.env.USERS;
		else process.env.USERS = previousUsersPath;
		await rm(securityDir, { recursive: true, force: true });
	}
});

test("WBOL tree reports effective visibility for requested roles without changing access", async () => {
	const portal = new STWPortal({ uuid: "tree-visibility-portal" });
	const area = new STWArea({ uuid: "tree-visibility-area", visibility: { developer: true, foo: true, fee: false } });
	const page = new STWPage({ uuid: "tree-visibility-page" });
	const denied = new STWPage({ uuid: "tree-visibility-denied", visibility: { foo: false, fee: false } });
	const content = new STWContent({ uuid: "tree-visibility-content", subtype: "Text", section: "main" });
	const hidden = new STWPage({ uuid: "tree-visibility-hidden", visibility: { developer: false, foo: true } });
	area.parent = portal;
	page.parent = area;
	denied.parent = area;
	content.parent = denied;
	hidden.parent = area;
	portal.children.push(area);
	area.children.push(page, denied, hidden);
	denied.children.push(content);
	content.blocked = "alice";
	const session = { roles: ["developer"], portal, lang: "en" };
	const call = async (query = "") => {
		const response = await handleWbolApi(new Request(`http://localhost/wbol${query}`), session);
		assert.equal(response.status, 200);
		return response.json();
	};
	try {
		const tree = await call("?roles=foo+fee");
		const [returnedArea] = tree.children;
		const [returnedPage, returnedDenied] = returnedArea.children;
		const [returnedContent] = returnedDenied.children;
		assert.equal(tree.visibility, 0);
		assert.equal(returnedArea.visibility, 1);
		assert.equal(returnedPage.visibility, 3);
		assert.equal(returnedDenied.visibility, 0);
		assert.equal(returnedContent.visibility, 2);
		assert.equal(returnedArea.blocked, "");
		assert.equal(returnedContent.blocked, "alice");
		assert.equal(returnedContent.section, "main");
		assert.equal("section" in returnedArea, false);
		assert.deepEqual(returnedArea.children.map((child) => child.uuid), [page.uuid, denied.uuid]);

		const defaultTree = await call();
		assert.equal(defaultTree.children[0].visibility, 1);
		assert.equal(defaultTree.children[0].children[1].children[0].visibility, 3);
		assert.equal((await call("?roles=")).children[0].visibility, 1);
		assert.equal((await call("?roles=fee")).children[0].visibility, 0);
		assert.equal((await call("?roles=fee+foo")).children[0].visibility, 1);
		portal.mainpage = page.uuid;
		assert.equal((await call("?roles=fee")).children[0].children[0].visibility, 1);
		assert.deepEqual(session.roles, ["developer"]);
		const forbidden = await handleWbolApi(new Request("http://localhost/wbol?roles=developer"), { roles: ["guest"], portal });
		assert.equal(forbidden.status, 403);
	} finally {
		STWIndex.delete(portal.uuid);
	}
});

test("tab instances route selections independently and preserve panels when closing other tabs", async () => {
	const tabs = new STWTabs({
		uuid: "isolated-tabs", options: [{ ref: "one" }, { ref: "two" }]
	});
	tabs.getLayout = () => ({ render: async () => ({ settings: new Map() }) });
	const elements = new Map(["one", "two"].map(id => {
		const element = new STWContent({ uuid: id, name: { en: id } });
		element.isVisible = () => 1;
		return [id, element];
	}));
	const session = { lang: "en", placeholders: new Map(), portal: { find: (_, ref) => elements.get(ref) } };
	const request = new Request("http://localhost/");
	const first = await tabs.render(request, session, { fields: [] });
	const second = await tabs.render(request, session, { fields: [] });
	assert.notEqual(first.match(/<article id="([^"]+)"/)[1], second.match(/<article id="([^"]+)"/)[1]);
	const script = first.match(/<script name="STWTabs"[^>]*>([\s\S]*?)<\/script>/)[1];
	const sent = [];
	let counter = 0;
	const context = {
		document: { createElement: () => ({}) },
		crypto: { randomUUID: () => String(++counter) },
		_newId: (id, prefix) => prefix + id,
		stwWS: { send: message => sent.push(JSON.parse(message)) }
	};
	runInNewContext(script, context);
	function makeInstance() {
		const panel = { replacements: [], replaceChildren(...children) { this.replacements.push(children); } };
		let listener;
		function createTab(ref, selected) {
			const node = { selected, removed: false };
			Object.assign(node, {
				classList: {
					contains: name => name === "stwSelected" && node.selected,
					add: () => { node.selected = true; },
					remove: () => { node.selected = false; }
				},
				hasAttribute: name => name === "data-ref", getAttribute: () => ref,
				closest: () => node, remove: () => { node.removed = true; },
				click: () => listener({ target: node, currentTarget: dl, stopImmediatePropagation() {} })
			});
			return node;
		}
		const one = createTab("one", true), two = createTab("two", false);
		one.nextElementSibling = two;
		two.previousElementSibling = one;
		const dl = {
			addEventListener: (_, fn) => { listener = fn; },
			querySelector: selector => selector === "dd" ? panel : [one, two].find(node => node.selected && !node.removed)
		};
		context.fnSTWTabs({ closest: () => ({ querySelector: () => dl }) });
		return { one, two, panel, listener: event => listener({ ...event, currentTarget: dl, stopImmediatePropagation() {} }) };
	}
	const a = makeInstance(), b = makeInstance();
	a.two.click();
	b.two.click();
	assert.deepEqual(sent.map(message => message.options.placeholder), ["c1", "c2"]);
	a.two.click();
	assert.equal(sent.length, 2);
	a.listener({ target: { tagName: "I", classList: { contains: () => true }, closest: () => a.one } });
	assert.equal(a.one.removed, true);
	assert.equal(a.panel.replacements.length, 1);
	assert.equal(b.panel.replacements.length, 1);
	b.listener({ target: { tagName: "I", classList: { contains: () => true }, closest: () => b.two } });
	assert.equal(b.two.removed, true);
	assert.equal(b.one.selected, true);
	assert.equal(sent.at(-1).resource, "one");
});

test("saving a Studio editor closes only that editor and refreshes the tree", async () => {
	const source = await readFile("./public/scripts/stwClient.js", "utf8");
	const listeners = {};
	let closed = 0, refreshed = 0;
	const context = {
		window: { addEventListener() {}, location: { href: "http://localhost/stws", assign: () => assert.fail("page reloaded") } },
		document: { addEventListener: (type, listener) => { listeners[type] = listener; } },
		sessionStorage: { getItem: () => "x1" },
		FormData: class { set() {} has() { return false; } },
		URL, fetch: async () => ({ ok: true }),
		_stwRefreshStudioTree: () => { refreshed++; }
	};
	context.window.self = context.window.top = context.window;
	runInNewContext(source, context);
	await listeners.submit({
		target: { id: "stwFA", querySelector: () => null, closest: () => ({ close: () => { closed++; } }), action: "" },
		submitter: { dataset: { stwActionToken: "token" }, value: "stwupdate", closest: () => null },
		preventDefault() {}
	});
	assert.equal(closed, 1);
	assert.equal(refreshed, 1);
});

test("content rendering errors open modal dialogs without replacing existing editors", async () => {
	const source = await readFile("./public/scripts/stwClient.js", "utf8");
	const dialogs = [];
	let placeholderRemoved = false;
	const body = {
		insertAdjacentHTML() {
			const dialog = {
				dataset: {}, addEventListener() {},
				showModal() { this.modal = true; },
				show() { assert.fail("error was shown modeless"); }
			};
			dialogs.push(dialog);
			this.lastElementChild = dialog;
		}
	};
	const document = {
		body, addEventListener() {},
		getElementById: id => id === "pending" ? { remove: () => { placeholderRemoved = true; } } : null
	};
	const window = { addEventListener() {}, location: { protocol: "http:", host: "localhost" } };
	window.self = window.top = window;
	let socket;
	class FakeWebSocket {
		static OPEN = 1;
		static CONNECTING = 0;
		constructor() { socket = this; }
	}
	const context = { window, document, WebSocket: FakeWebSocket, sessionStorage: { getItem: () => "x1" } };
	runInNewContext(source, context);
	context.stwStartWebsocket();
	await socket.onmessage({ data: JSON.stringify({
		method: "PUT", error: true, placeholder: "pending", body: "<article>Error</article>"
	}) });
	await socket.onmessage({ data: JSON.stringify({
		method: "PUT", error: true, section: "modeless", studioBlockToken: "lock-token", body: "<article>Error</article>"
	}) });
	assert.equal(placeholderRemoved, true);
	assert.equal(dialogs.length, 2);
	assert.ok(dialogs.every(dialog => dialog.modal));
	assert.equal(dialogs[1].dataset.stwBlockToken, "lock-token");
});

test("modeless Studio editors with the same content id open independently", async () => {
	const source = await readFile("./public/scripts/stwClient.js", "utf8");
	const dialogs = [];
	const released = [], alerts = [];
	const body = {
		querySelectorAll: () => [],
		insertAdjacentHTML() {
			const dialog = { dataset: {}, addEventListener() {}, show() { this.open = true; } };
			dialogs.push(dialog);
			this.lastElementChild = dialog;
		}
	};
	const document = {
		body, location: { pathname: "/stws" },
		addEventListener() {}, querySelectorAll: () => [],
		getElementById: () => ({ insertAdjacentHTML: () => assert.fail("existing editor was replaced") })
	};
	const window = {
		addEventListener() {}, alert: message => alerts.push(message),
		location: { protocol: "http:", host: "localhost", search: "" }
	};
	window.self = window.top = window;
	let socket;
	class FakeWebSocket {
		static OPEN = 1;
		static CONNECTING = 0;
		constructor() { socket = this; }
	}
	const context = {
		window, document, WebSocket: FakeWebSocket,
		sessionStorage: { getItem: () => "x1" },
		_stwReleaseBlock: async token => released.push(token),
		MutationObserver: class { observe() {} }
	};
	runInNewContext(source, context);
	context.stwStartWebsocket();
	for (const token of ["first", "second"]) {
		await socket.onmessage({ data: JSON.stringify({
			method: "PUT", id: "editor", section: "modeless", studioBlockToken: token, body: "<article></article>"
		}) });
	}
	assert.equal(dialogs.length, 2);
	assert.deepEqual(dialogs.map(dialog => dialog.dataset.stwBlockToken), ["first", "second"]);
	assert.ok(dialogs.every(dialog => dialog.open && dialog.dataset.stwEditor === "true"));
	await socket.onmessage({ data: JSON.stringify({ method: "DELETE", id: "editor", studioBlockToken: "failed" }) });
	assert.deepEqual(released, ["failed"]);
	assert.deepEqual(alerts, ["Could not open the Studio editor."]);
	assert.equal(dialogs.length, 2);
});

test("Studio broadcasts lock transitions only to authorized connections", async () => {
	const portal = new STWPortal({ uuid: "broadcast-portal", langs: ["en"] });
	const area = new STWArea({ uuid: "broadcast-area", visibility: { developer: true } });
	const page = new STWPage({ uuid: "broadcast-page" });
	area.parent = portal;
	page.parent = area;
	STWIndex.set(page.uuid, page);
	const alice = { user: "alice", roles: ["developer"], portal, lang: "en" };
	const bob = { user: "bob", roles: ["developer"], portal, lang: "en" };
	const guest = { user: "guest", roles: ["guest"], portal, lang: "en" };
	const aliceMessages = [], bobMessages = [], guestMessages = [];
	const connect = (session, messages) => registerStudioConnection({
		readyState: 1,
		send: (message, callback) => { messages.push(JSON.parse(message)); callback(); }
	}, session);
	const disconnect = [connect(alice, aliceMessages), connect(bob, bobMessages), connect(guest, guestMessages)];
	const call = (path, method) => handleWbolApi(new Request(`http://localhost/wbol/${path}`, { method }), alice);
	try {
		const first = await (await call(`${page.uuid}/block`, "POST")).json();
		const second = await (await call(`${page.uuid}/block`, "POST")).json();
		assert.deepEqual(aliceMessages, [{ method: "STW_BLOCK", id: page.uuid, blocked: true, own: true }]);
		assert.deepEqual(bobMessages, [{ method: "STW_BLOCK", id: page.uuid, blocked: true, own: false }]);
		assert.deepEqual(guestMessages, []);
		await call(`${page.uuid}/block?token=${first.token}`, "DELETE");
		assert.equal(bobMessages.length, 1);
		await call(`${page.uuid}/block?token=${second.token}`, "DELETE");
		assert.deepEqual(bobMessages[1], { method: "STW_BLOCK", id: page.uuid, blocked: false, own: false });
	} finally {
		disconnect.forEach(remove => remove());
		STWIndex.delete(page.uuid);
	}
});

test("Studio block updates change the matching tree badge", async () => {
	const source = await readFile("./public/scripts/stwClientStudio.js", "utf8");
	const badge = { hidden: true, setAttribute(name, value) { this[name] = value; } };
	const anchor = {
		dataset: { uuid: "page-1" },
		closest: () => ({ firstElementChild: { querySelector: () => badge } })
	};
	const sent = [];
	let tree = null;
	const context = {
		window: { addEventListener() {}, location: { search: "" } },
		WebSocket: { OPEN: 1 },
		stwWS: { readyState: 1, send: message => sent.push(JSON.parse(message)) },
		document: {
			addEventListener() {},
			getElementById: () => tree
		}
	};
	runInNewContext(source, context);
	context._stwStudioBlockChanged({ id: "page-1", blocked: true, own: false });
	tree = { querySelectorAll: () => [anchor] };
	context._stwStudioApplyBlockStates();
	assert.equal(badge.hidden, false);
	assert.match(badge.className, /fa-lock$/);
	context._stwStudioBlockChanged({ id: "page-1", blocked: true, own: true });
	assert.match(badge.className, /fa-lock-open$/);
	context._stwStudioBlockChanged({ id: "page-1", blocked: false, own: false });
	assert.equal(badge.hidden, true);
	context._stwRefreshStudioTree();
	assert.equal(sent[0].resource, "c6TC0s1xSa5NgDIgMyCbIhL");
});

test("WBOL element blocks protect edits until every owner token is released", async () => {
	const portal = new STWPortal({ uuid: "block-test-portal", langs: ["en"] });
	const area = new STWArea({ uuid: "block-test-area", visibility: { developer: true, seo: true } });
	const page = new STWPage({ uuid: "block-test-page" });
	area.parent = portal;
	page.parent = area;
	portal.children.push(area);
	area.children.push(page);
	STWIndex.set(area.uuid, area);
	STWIndex.set(page.uuid, page);
	const alice = { user: "alice", roles: ["developer"], portal, lang: "en" };
	const bob = { user: "bob", roles: ["developer"], portal, lang: "en" };
	const seo = { user: "seo", roles: ["seo"], portal, lang: "en" };
	const call = (session, path, method = "GET", body) => handleWbolApi(
		new Request(`http://localhost/wbol/${path}`, {
			method,
			headers: body === undefined ? {} : { "Content-Type": "application/json" },
			body: body === undefined ? undefined : JSON.stringify(body)
		}), session
	);
	try {
		const first = await (await call(alice, `${page.uuid}/block`, "POST")).json();
		const second = await (await call(alice, `${page.uuid}/block`, "POST")).json();
		assert.equal(first.blocked, "alice");
		assert.ok(first.token);
		assert.notEqual(first.token, second.token);
		assert.deepEqual(await (await call(bob, `${page.uuid}/block`, "POST")).json(), { blocked: "alice", token: null });
		assert.equal((await (await call(seo, page.uuid)).json()).blocked, "alice");
		assert.equal((await call(bob, page.uuid, "PATCH", { name: "Blocked" })).status, 409);
		assert.equal((await call(bob, area.uuid, "DELETE")).status, 409);
		assert.equal((await call(bob, `${page.uuid}/block?token=${first.token}`, "DELETE")).status, 404);
		assert.equal((await call(alice, `${page.uuid}/block?token=${first.token}`, "DELETE")).status, 204);
		assert.equal(page.blocked, "alice");
		assert.equal((await call(alice, page.uuid, "PATCH", { name: "Allowed" })).status, 200);
		assert.equal((await call(alice, `${page.uuid}/block?token=${second.token}`, "DELETE")).status, 204);
		assert.equal(page.blocked, "");
		assert.equal((await call(bob, page.uuid, "PATCH", { name: "Released" })).status, 200);
		const seoBlock = await (await call(seo, `${page.uuid}/block`, "POST")).json();
		assert.equal(seoBlock.blocked, "seo");
		assert.ok(seoBlock.token);
		assert.equal((await call(seo, `${page.uuid}/block?token=${seoBlock.token}`, "DELETE")).status, 204);
	} finally {
		STWIndex.delete(page.uuid);
		STWIndex.delete(area.uuid);
		STWIndex.delete(portal.uuid);
	}
});

test("SEO users can edit only locale-sensitive metadata on SEO-visible elements", async () => {
	const portalId = `seo-portal-${Date.now()}`;
	const seoId = `seo-content-${Date.now()}`;
	const hiddenId = `hidden-content-${Date.now()}`;
	const portal = new STWPortal({
		uuid: portalId,
		langs: ["en", "fr", "de"],
		visibility: { seo: true }
	});
	const content = new STWContent({
		uuid: seoId,
		subtype: "Text",
		section: "main",
		name: { en: "Original", fr: "Originale" },
		slug: { en: "original", fr: "originale" },
		description: { en: "Old description" },
		visibility: { seo: true }
	});
	const hidden = new STWContent({
		uuid: hiddenId,
		subtype: "Text",
		name: { en: "Hidden" }
	});
	portal.children.push(content, hidden);
	content.parent = portal;
	content.blocked = "editor";
	hidden.parent = portal;
	STWIndex.set(seoId, content);
	STWIndex.set(hiddenId, hidden);
	const session = { user: "editor", roles: ["seo"], lang: "en", portal };
	const call = (path, method = "GET", body) => handleWbolApi(
		new Request(`http://localhost/wbol/${path}`, {
			method,
			headers: body === undefined ? {} : { "Content-Type": "application/json" },
			body: body === undefined ? undefined : JSON.stringify(body)
		}),
		session
	);
	try {
		const treeResponse = await call("");
		assert.equal(treeResponse.status, 200);
		const tree = await treeResponse.json();
		assert.deepEqual(tree.children.map((child) => child.uuid), [seoId]);
		assert.equal(tree.children[0].visibility, 1);
		assert.equal(tree.children[0].blocked, "editor");
		assert.equal(tree.children[0].section, "main");
		assert.equal("options" in tree.children[0], false);
		const otherRoles = await (await call("?roles=guest")).json();
		assert.deepEqual(otherRoles.children.map((child) => child.uuid), [seoId]);
		assert.equal(otherRoles.children[0].visibility, 2);

		let response = await call(seoId);
		assert.equal(response.status, 200);
		assert.equal((await (await call(`${seoId}?locale=de`)).json()).name, "Original");
		const exact = await (await call(`${seoId}?locale=de&fallback=false`)).json();
		assert.equal(exact.name, "");
		assert.equal(exact.slug, "");
		assert.equal(exact.description, "");
		response = await call(seoId, "PATCH", {
			name: { en: "Search optimized", fr: "Optimisee pour la recherche", de: "Suchoptimiert" },
			slug: { en: "search-optimized", fr: "optimisee-recherche", de: "suchoptimiert" },
			description: { en: "Updated description", fr: "Description mise a jour" }
		});
		assert.equal(response.status, 200);
		const updated = await response.json();
		assert.equal(updated.name, "Search optimized");
		assert.equal(updated.slug, "search-optimized");
		assert.equal(updated.description, "Updated description");
		assert.equal("visibility" in updated, false);
		response = await call(`${seoId}?locale=fr`);
		const frenchElement = await response.json();
		assert.equal(frenchElement.name, "Optimisee pour la recherche");
		assert.equal(frenchElement.slug, "optimisee-recherche");
		assert.equal(frenchElement.description, "Description mise a jour");

		response = await call(seoId, "PATCH", { name: { en: "No unauthorized updates" }, position: 0 });
		assert.equal(response.status, 403);
		response = await call(seoId, "PATCH", { visibility: { developer: true } });
		assert.equal(response.status, 403);
		response = await call(hiddenId);
		assert.equal(response.status, 403);
		response = await call(`${seoId}/options`);
		assert.equal(response.status, 403);
		response = await call("", "POST", { parentId: portalId, element: { type: "Area" } });
		assert.equal(response.status, 403);
		response = await call(seoId, "DELETE");
		assert.equal(response.status, 403);
	} finally {
		STWIndex.delete(seoId);
		STWIndex.delete(hiddenId);
		STWIndex.delete(portalId);
	}
});

test("deployed project webbaselets are visible as specified and protected from edits", async () => {
	const oldDeployed = process.env.DEPLOYED;
	const portal = new STWPortal({ uuid: "deployed-test-portal", langs: ["en"] });
	const common = new STWArea({ uuid: "deployed-test-common" });
	const studio = new STWArea({ uuid: "deployed-test-studio", visibility: { developer: true } });
	const commonTabs = new STWTabs({ uuid: "deployed-test-tabs", subtype: "Tabs", options: [] });
	const studioPage = new STWPage({ uuid: "deployed-test-page" });
	common.parent = portal;
	studio.parent = portal;
	commonTabs.parent = common;
	studioPage.parent = studio;
	common.children.push(commonTabs);
	studio.children.push(studioPage);
	portal.children.push(common, studio);
	registerWebbaselet(common, "common");
	registerWebbaselet(studio, "studio");
	for (const element of [common, studio, commonTabs, studioPage]) STWIndex.set(element.uuid, element);
	const session = { roles: ["developer", "leaddeveloper"], portal, lang: "en" };
	const call = (path, method = "GET", body) => handleWbolApi(new Request(`http://localhost/wbol/${path}`, {
		method,
		headers: { "Content-Type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body)
	}), session);
	try {
		process.env.DEPLOYED = "true";
		let tree = await (await call("")).json();
		assert.ok(tree.children.some((item) => item.uuid === common.uuid && item.children[0].uuid === commonTabs.uuid));
		assert.equal(tree.children.some((item) => item.uuid === studio.uuid), false);
		assert.equal((await call(common.uuid)).status, 200);
		const commonResponse = await call(commonTabs.uuid);
		assert.equal(commonResponse.status, 200);
		assert.equal((await commonResponse.json()).readonly, "true");
		assert.equal((await call(commonTabs.uuid, "PATCH", { name: "Changed" })).status, 403);
		assert.equal((await call(studioPage.uuid, "DELETE")).status, 403);
		assert.equal((await call("", "POST", { parentId: common.uuid, element: { type: "Page" } })).status, 403);
		assert.equal((await call(`${commonTabs.uuid}/visibility`, "PATCH", { user: true })).status, 403);
		assert.equal((await call(`${commonTabs.uuid}/options`, "PUT", [])).status, 403);
		assert.throws(() => captureRevision(commonTabs), /read-only/);
		assert.throws(() => applyPersistentChanges(commonTabs, "en", { name: "Changed" }, {}), /read-only/);
		commonTabs.visibility.set("test-managed-role", true);
		assert.equal((await call("roles/test-managed-role", "PATCH", { role: "renamed" })).status, 403);
		assert.equal((await call("roles/test-managed-role", "DELETE")).status, 403);
		process.env.DEPLOYED = "false";
		tree = await (await call("")).json();
		assert.ok(tree.children.some((item) => item.uuid === studio.uuid && item.children[0].uuid === studioPage.uuid));
		assert.equal((await (await call(commonTabs.uuid)).json()).readonly, undefined);
		assert.equal((await call(commonTabs.uuid, "PATCH", { name: "Changed" })).status, 200);
		assert.equal((await call(studioPage.uuid, "PATCH", { name: "Changed" })).status, 200);
		delete process.env.DEPLOYED;
		assert.equal((await call(commonTabs.uuid, "PATCH", { name: "Denied" })).status, 403);
	} finally {
		if (oldDeployed === undefined) delete process.env.DEPLOYED;
		else process.env.DEPLOYED = oldDeployed;
		for (const element of [portal, common, studio, commonTabs, studioPage]) STWIndex.delete(element.uuid);
	}
});

test("role assignments respect administrator, LeadDeveloper, and root boundaries", async () => {
	const previousRolesPath = process.env.ROLES;
	const previousUsersPath = process.env.USERS;
	const directory = await mkdtemp(join(tmpdir(), "webspinner-role-assignment-"));
	const element = new STWContent({ uuid: `role-test-${Date.now()}`, subtype: "Text" });
	STWIndex.set(element.uuid, element);
	try {
		process.env.ROLES = join(directory, "roles.json");
		process.env.USERS = join(directory, "users.json");
		await writeFile(process.env.USERS, "[]");

		const listedRoles = await handleWbolApi(
			new Request("http://localhost/wbol/roles/visibility"),
			{ roles: ["developer"] }
		);
		const roles = await listedRoles.json();
		for (const role of ["root", "administrator", "guest", "user", "developer", "leaddeveloper", "seo"]) {
			assert.ok(roles.includes(role), `mandatory role ${role} is listed`);
		}
		for (const role of ["administrators", "guests", "users", "developers", "leaddevelopers"]) {
			assert.equal(roles.includes(role), false, `legacy role ${role} is no longer listed`);
		}
		assert.ok(roles.includes("seo"));
		assert.equal(roles.includes("translators"), false);

		const request = (path, method, body, roles) => handleWbolApi(
			new Request(`http://localhost/wbol/${path}`, {
				method,
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body)
			}),
			{ roles }
		);
		const managementRoles = await request("roles", "GET", undefined, ["leaddeveloper"]);
		const customRoles = await managementRoles.json();
		for (const role of ["root", "administrator", "guest", "user", "developer", "leaddeveloper", "seo"]) {
			assert.equal(customRoles.includes(role), false, `mandatory role ${role} is hidden in management`);
		}
		for (const role of ["administrator", "developer"]) {
			assert.equal((await request("roles", "GET", undefined, [role])).status, 403);
			assert.equal((await request("roles", "POST", { role: "blocked" }, [role])).status, 403);
		}
		assert.equal((await request("roles/visibility", "GET", undefined, ["guest"])).status, 403);
		assert.equal((await request("roles", "POST", { role: "editors" }, ["leaddeveloper"])).status, 201);
		assert.ok((await (await request("roles", "GET", undefined, ["leaddeveloper"])).json()).includes("editors"));
		assert.ok((await (await request("roles/visibility", "GET", undefined, ["developer"])).json()).includes("editors"));
		assert.equal((await request("users", "POST", { user: "editor", password: "pass", roles: ["editors"] }, ["administrator"])).status, 201);
		assert.equal((await request(`${element.uuid}/visibility`, "PATCH", { editors: true }, ["leaddeveloper"])).status, 200);
		assert.equal((await request("roles/developer", "PATCH", { role: "renamed" }, ["leaddeveloper"])).status, 409);
		assert.equal((await request("roles/developer", "DELETE", undefined, ["leaddeveloper"])).status, 409);
		assert.equal((await request("roles/editors", "PATCH", { role: "writers" }, ["leaddeveloper"])).status, 200);
		assert.equal(element.visibility.get("writers"), true);
		assert.equal((await STWSecurity.listUsers()).find((user) => user.user === "editor").roles, "writers");
		assert.equal((await request("roles/writers", "DELETE", undefined, ["leaddeveloper"])).status, 204);
		assert.equal(element.visibility.has("writers"), false);
		assert.equal((await STWSecurity.listUsers()).find((user) => user.user === "editor").roles, "");
		assert.equal((await request("roles", "POST", { role: "root-managed" }, ["root"])).status, 201);
		assert.equal((await request("roles/root-managed", "DELETE", undefined, ["root"])).status, 204);

		for (const role of ["root", "developer", "leaddeveloper", "seo"]) {
			const response = await request("users", "POST", { user: `admin-${role}`, password: "pass", roles: [role] }, ["administrator"]);
			assert.equal(response.status, 403, `administrator cannot assign ${role}`);
		}

		const created = await request("users", "POST", { user: "developer", password: "pass", roles: ["user"] }, ["administrator"]);
		assert.equal(created.status, 201);
		const assigned = await request("users/developer", "PATCH", { roles: ["developer", "leaddeveloper"] }, ["root"]);
		assert.equal(assigned.status, 200);
		assert.equal((await assigned.json()).roles, "developer,leaddeveloper");

		const rootSeoAssignment = await request("users/developer", "PATCH", { roles: ["developer", "leaddeveloper", "seo"] }, ["root"]);
		assert.equal(rootSeoAssignment.status, 200, "root can manage any role");

		const leadAssignment = await request("users/developer/seo", "PATCH", { enabled: true }, ["leaddeveloper"]);
		assert.deepEqual(await leadAssignment.json(), { user: "developer", role: "seo", enabled: true });
		const administratorRemoval = await request("users/developer", "PATCH", { roles: ["user"] }, ["administrator"]);
		assert.equal(administratorRemoval.status, 403, "administrator cannot revoke SEO assignments");
		const leadDeveloperRevocation = await request("users/developer/developer", "PATCH", { enabled: false }, ["leaddeveloper"]);
		assert.deepEqual(await leadDeveloperRevocation.json(), { user: "developer", role: "developer", enabled: false });
		const leadDeveloperGrant = await request("users/developer/developer", "PATCH", { enabled: true }, ["leaddeveloper"]);
		assert.deepEqual(await leadDeveloperGrant.json(), { user: "developer", role: "developer", enabled: true });
		const leadRevocation = await request("users/developer/seo", "PATCH", { enabled: false }, ["leaddeveloper"]);
		assert.deepEqual(await leadRevocation.json(), { user: "developer", role: "seo", enabled: false });
		const leadGrant = await request("users/developer/seo", "PATCH", { enabled: true }, ["leaddeveloper"]);
		assert.deepEqual(await leadGrant.json(), { user: "developer", role: "seo", enabled: true });
		const administratorSeoRoute = await request("users/developer/seo", "PATCH", { enabled: true }, ["administrator"]);
		assert.equal(administratorSeoRoute.status, 403);
		const administratorDeveloperRoute = await request("users/developer/developer", "PATCH", { enabled: true }, ["administrator"]);
		assert.equal(administratorDeveloperRoute.status, 403);
		const rootSeoRoute = await request("users/developer/seo", "PATCH", { enabled: true }, ["root"]);
		assert.equal(rootSeoRoute.status, 200);
	} finally {
		STWIndex.delete(element.uuid);
		if (previousRolesPath === undefined) delete process.env.ROLES;
		else process.env.ROLES = previousRolesPath;
		if (previousUsersPath === undefined) delete process.env.USERS;
		else process.env.USERS = previousUsersPath;
		await rm(directory, { recursive: true, force: true });
	}
});

test("Node connector runs WBPL-expanded queries and actions and reports failures", async () => {
	const previousConnectorsPath = process.env.CONNECTORS;
	const previousSecret = process.env.STW_TEST_CONNECTOR_SECRET;
	const previousDeployed = process.env.DEPLOYED;
	const directory = await mkdtemp(join(tmpdir(), "webspinner-node-connector-"));
	const connectorsPath = join(directory, "connectors.json");
	await writeFile(connectorsPath, JSON.stringify([{ id: "node", name: "Node scripts", type: "node", host: process.execPath }]));
	process.env.CONNECTORS = connectorsPath;
	process.env.STW_TEST_CONNECTOR_SECRET = "not for the launcher";
	process.env.DEPLOYED = "true";
	try {
		await STWConnectors.resetRuntime();
		const session = { placeholders: new Map([["@value", "hello"]]) };
		const query = await STWConnectors.execute(session, {
			connector: "node",
			query: 'const value = "@value"; console.log(JSON.stringify([{ value }]))'
		});
		assert.deepEqual(query.rows, [{ value: "hello" }]);
		const action = await STWConnectors.executeAction(session, "node",
			'const value = "@value"; console.log(JSON.stringify({ value }))', "POST");
		assert.deepEqual(action.rows, [{ value: "hello" }]);
		const environment = await STWConnectors.execute(session, {
			connector: "node", query: 'console.log(JSON.stringify({ exposed: "STW_TEST_CONNECTOR_SECRET" in process.env }))'
		});
		assert.deepEqual(environment.rows, [{ exposed: false }]);
		await assert.rejects(STWConnectors.execute(session, {
			connector: "node", query: 'throw new Error("node failure")'
		}), /node failure/);
		STWConnectors.connectors.set("unconfigured", { id: "unconfigured", name: "unconfigured", type: "node" });
		await assert.rejects(STWConnectors.execute(session, {
			connector: "unconfigured", query: "console.log(1)"
		}), /requires an absolute launcher path/);
		process.env.DEPLOYED = "false";
		const unrestricted = await STWConnectors.execute(session, {
			connector: "unconfigured",
			query: 'console.log(JSON.stringify({ value: process.env.STW_TEST_CONNECTOR_SECRET }))'
		});
		assert.deepEqual(unrestricted.rows, [{ value: "not for the launcher" }]);
		STWConnectors.connectors.set("ignored-launcher", {
			id: "ignored-launcher", name: "ignored-launcher", type: "node", host: join(directory, "missing-launcher")
		});
		const unrestrictedAction = await STWConnectors.executeAction(session, "ignored-launcher",
			'console.log(JSON.stringify({ value: process.env.STW_TEST_CONNECTOR_SECRET }))', "POST");
		assert.deepEqual(unrestrictedAction.rows, [{ value: "not for the launcher" }]);
		process.env.DEPLOYED = "invalid";
		await assert.rejects(STWConnectors.execute(session, {
			connector: "unconfigured", query: "console.log(1)"
		}), /DEPLOYED must be "true" or "false"/);
	} finally {
		await STWConnectors.resetRuntime();
		if (previousConnectorsPath === undefined) delete process.env.CONNECTORS;
		else process.env.CONNECTORS = previousConnectorsPath;
		if (previousSecret === undefined) delete process.env.STW_TEST_CONNECTOR_SECRET;
		else process.env.STW_TEST_CONNECTOR_SECRET = previousSecret;
		if (previousDeployed === undefined) delete process.env.DEPLOYED;
		else process.env.DEPLOYED = previousDeployed;
		await rm(directory, { recursive: true, force: true });
	}
});

test("only root can configure a Node launcher", async () => {
	const previousConnectorsPath = process.env.CONNECTORS;
	const previousDeployed = process.env.DEPLOYED;
	const directory = await mkdtemp(join(tmpdir(), "webspinner-node-admin-"));
	const connectorsPath = join(directory, "connectors.json");
	await writeFile(connectorsPath, "[]");
	process.env.CONNECTORS = connectorsPath;
	process.env.DEPLOYED = "true";
	try {
		await STWConnectors.resetRuntime();
		const create = (roles, connector) => handleWbolApi(new Request("http://localhost/wbol/connectors", {
			method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(connector)
		}), { roles });
		const connector = { id: "node", name: "node", type: "node", host: process.execPath };
		assert.equal((await create(["leaddeveloper"], connector)).status, 403);
		assert.equal((await create(["root"], { ...connector, host: "node" })).status, 400);
		assert.equal((await create(["root"], { id: "node-local", type: "node" })).status, 400);
		assert.equal((await create(["root"], connector)).status, 201);
		const response = await handleWbolApi(new Request("http://localhost/wbol/connectors/node", {
			method: "PATCH", headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ type: "api", host: "https://example.test" })
		}), { roles: ["leaddeveloper"] });
		assert.equal(response.status, 403);
		const changeLauncher = await handleWbolApi(new Request("http://localhost/wbol/connectors/node", {
			method: "PATCH", headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ host: process.execPath })
		}), { roles: ["leaddeveloper"] });
		assert.equal(changeLauncher.status, 403);
		const remove = await handleWbolApi(new Request("http://localhost/wbol/connectors/node", {
			method: "DELETE"
		}), { roles: ["leaddeveloper"] });
		assert.equal(remove.status, 403);
		process.env.DEPLOYED = "false";
		assert.equal((await create(["root"], { id: "node-local", type: "node" })).status, 201);
	} finally {
		await STWConnectors.resetRuntime();
		if (previousConnectorsPath === undefined) delete process.env.CONNECTORS;
		else process.env.CONNECTORS = previousConnectorsPath;
		if (previousDeployed === undefined) delete process.env.DEPLOYED;
		else process.env.DEPLOYED = previousDeployed;
		await rm(directory, { recursive: true, force: true });
	}
});

test("LeadDeveloper manages non-Node connectors while developers can list names", async () => {
	const previousConnectorsPath = process.env.CONNECTORS;
	const directory = await mkdtemp(join(tmpdir(), "webspinner-connectors-api-"));
	const connectorsPath = join(directory, "connectors.json");
	await writeFile(connectorsPath, JSON.stringify([
		{ id: "sample", name: "Sample API", type: "api", host: "https://api.example.test", password: "secret" }
	]));
	process.env.CONNECTORS = connectorsPath;
	try {
		const response = await handleWbolApi(new Request("http://localhost/wbol/connectors"), { roles: ["root"] });
		assert.equal(response.status, 200);
		assert.deepEqual(await response.json(), [{
			id: "sample",
			name: "Sample API",
			type: "api",
			host: "https://api.example.test",
			hasPassword: true
		}]);
		const names = await handleWbolApi(new Request("http://localhost/wbol/connectors/names"), { roles: ["developer"] });
		assert.equal(names.status, 200);
		assert.deepEqual((await names.json()).filter((item) => item.id !== "assistant"), [
			{ id: "json", name: "json" }, { id: "wbol", name: "wbol" }, { id: "sample", name: "Sample API" }
		]);
		assert.equal((await handleWbolApi(new Request("http://localhost/wbol/connectors/names"), { roles: ["guest"] })).status, 403);
		const lead = { roles: ["leaddeveloper"] };
		assert.equal((await handleWbolApi(new Request("http://localhost/wbol/connectors"), lead)).status, 200);
		const update = (method, path, body) => handleWbolApi(new Request(`http://localhost/wbol/connectors${path}`, {
			method, headers: { "Content-Type": "application/json" },
			...(body === undefined ? {} : { body: JSON.stringify(body) })
		}), lead);
		const created = await update("POST", "", { id: "extra", type: "api", host: "https://example.test" });
		assert.equal(created.status, 201);
		assert.equal((await created.json()).name, "extra");
		assert.equal((await update("POST", "", { id: "extra", name: "Other", type: "api", host: "https://example.test" })).status, 409);
		for (const id of ["json", "wbol", "assistant", "names", "reconnect"]) {
			assert.equal((await update("POST", "", { id, type: "api", host: "https://example.test" })).status, 400);
		}
		assert.equal((await update("PATCH", "/extra", { id: "changed" })).status, 400);
		assert.equal((await update("PATCH", "/extra", { name: "Renamed connector" })).status, 200);
		assert.equal(STWConnectors.connectors.get("extra").name, "Renamed connector");
		assert.equal(STWConnectors.connectors.has("Renamed connector"), false);
		const renamedChoices = await handleWbolApi(new Request("http://localhost/wbol/connectors/names"), { roles: ["developer"] });
		assert.ok((await renamedChoices.json()).some(({ id, name }) => id === "extra" && name === "Renamed connector"));
		assert.equal((await update("POST", "", { id: "another", name: "Renamed connector", type: "api", host: "https://example.test" })).status, 201);
		assert.equal((await update("DELETE", "/another")).status, 204);
		const referencingContent = new STWText({ uuid: "connector-id-reference-test", connector: "extra" });
		STWIndex.set(referencingContent.uuid, referencingContent);
		try {
			assert.equal((await update("DELETE", "/extra")).status, 409);
		} finally {
			STWIndex.delete(referencingContent.uuid);
		}
		assert.equal((await update("PATCH", "/extra", { host: "https://other.example.test" })).status, 200);
		assert.equal((await update("PATCH", "/extra", { type: "node", host: process.execPath })).status, 403);
		assert.equal((await update("DELETE", "/extra")).status, 204);
		const saveConfigurations = STWConnectors.saveConfigurations;
		STWConnectors.saveConfigurations = async (configurations) => {
			await writeFile(connectorsPath, JSON.stringify(configurations));
		};
		try {
			const windowsSql = await update("POST", "", {
				id: "windows-sql", type: "mssql", host: "localhost", database: "AdventureWorks2025",
				windowsAuth: true, odbcDriver: "ODBC Driver 18 for SQL Server"
			});
			assert.equal(windowsSql.status, 201);
			const windowsConfig = await windowsSql.json();
			assert.equal(windowsConfig.windowsAuth, true);
			assert.equal(windowsConfig.odbcDriver, "ODBC Driver 18 for SQL Server");
			assert.equal((await update("POST", "", {
				id: "invalid-windows-auth", type: "api", host: "https://example.test", windowsAuth: true
			})).status, 400);
		} finally {
			STWConnectors.saveConfigurations = saveConfigurations;
		}
		const administratorResponse = await handleWbolApi(
			new Request("http://localhost/wbol/connectors"),
			{ roles: ["administrator"] }
		);
		assert.equal(administratorResponse.status, 403);
		const legacyResponse = await handleWbolApi(
			new Request("http://localhost/wbol/datasources"),
			{ roles: ["leaddeveloper", "developer"] }
		);
		assert.equal(legacyResponse.status, 404);
		await writeFile(connectorsPath, JSON.stringify([
			{ id: "duplicate", name: "First", type: "api", host: "https://example.test" },
			{ id: "duplicate", name: "Second", type: "api", host: "https://example.test" }
		]));
		await assert.rejects(STWConnectors.getConfigurations(), /Duplicate connector ID: duplicate/);
		await STWConnectors.resetRuntime();
		await assert.rejects(STWConnectors.initialize(true), /Duplicate connector ID: duplicate/);
	} finally {
		await STWConnectors.resetRuntime();
		if (previousConnectorsPath === undefined) delete process.env.CONNECTORS;
		else process.env.CONNECTORS = previousConnectorsPath;
		await rm(directory, { recursive: true, force: true });
	}
});

test("IMAP and SMTP connector settings validate and redact credentials", async () => {
	const previousConnectorsPath = process.env.CONNECTORS;
	const directory = await mkdtemp(join(tmpdir(), "webspinner-mail-connectors-"));
	const connectorsPath = join(directory, "connectors.json");
	await writeFile(connectorsPath, "[]");
	process.env.CONNECTORS = connectorsPath;
	try {
		const session = { roles: ["root"] };
		const create = async (value) => await handleWbolApi(
			new Request("http://localhost/wbol/connectors", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(value)
			}),
			session
		);
		const imap = await create({
			id: "imapApi", name: "imapApi",
			type: "imap",
			host: "imap.example.test",
			user: "mailbox@example.test",
			passwordEnv: "WEBSPINNER_TEST_IMAP_PASSWORD"
		});
		assert.equal(imap.status, 201);
		const imapConfiguration = await imap.json();
		assert.equal(imapConfiguration.port, 993);
		assert.equal(imapConfiguration.secure, true);
		assert.equal(imapConfiguration.hasPassword, true);
		assert.equal("password" in imapConfiguration, false);

		const smtp = await create({
			id: "smtpApi", name: "smtpApi",
			type: "smtp",
			host: "smtp.example.test",
			port: 587,
			secure: false,
			user: "mailer",
			passwordEnv: "WEBSPINNER_TEST_SMTP_PASSWORD",
			from: "noreply@example.test"
		});
		assert.equal(smtp.status, 201);
		const smtpConfiguration = await smtp.json();
		assert.equal(smtpConfiguration.secure, false);
		assert.equal(smtpConfiguration.from, "noreply@example.test");
		assert.equal(smtpConfiguration.hasPassword, true);

		const insecureImap = await create({
			id: "insecureImap", name: "insecureImap",
			type: "imap",
			host: "imap.example.test",
			user: "mailbox@example.test",
			password: "secret",
			secure: false
		});
		assert.equal(insecureImap.status, 400);
		const missingFrom = await create({
			id: "missingFrom", name: "missingFrom",
			type: "smtp",
			host: "smtp.example.test",
			user: "mailer",
			password: "secret"
		});
		assert.equal(missingFrom.status, 400);
	} finally {
		await STWConnectors.resetRuntime();
		if (previousConnectorsPath === undefined) delete process.env.CONNECTORS;
		else process.env.CONNECTORS = previousConnectorsPath;
		await rm(directory, { recursive: true, force: true });
	}
});

test("LeadDeveloper connector reconnect resets and attempts every configured connector", async () => {
	const previousConnectorsPath = process.env.CONNECTORS;
	const originalConnectDatabase = STWConnectors.connectDatabase;
	const directory = await mkdtemp(join(tmpdir(), "webspinner-connector-retry-"));
	const connectorsPath = join(directory, "connectors.json");
	const originalConfigurations = [
		{ id: "mysqlsample", name: "mysqlsample", type: "mysql", host: "old-db.example.test", user: "portal", database: "portal" },
		{ id: "pgsample", name: "pgsample", type: "postgres", host: "pg.example.test", user: "portal", database: "portal" }
	];
	await writeFile(connectorsPath, JSON.stringify(originalConfigurations));
	process.env.CONNECTORS = connectorsPath;
	const connectCalls = [];
	const closed = [];
	let failReconnect = false;
	STWConnectors.connectDatabase = async (configuration) => {
		connectCalls.push(configuration);
		if (configuration.name === "mysqlsample" && failReconnect && configuration.host === "new-db.example.test") {
			throw new Error("IP access denied");
		}
		return {
			type: configuration.type,
			client: {
				end: async () => closed.push(configuration.name),
				close: async () => closed.push(configuration.name)
			}
		};
	};
	try {
		await STWConnectors.resetRuntime();
		await STWConnectors.initialize();
		const originalPeerConnection = STWConnectors.connectors.get("pgsample");
		assert.equal(connectCalls.length, 2);

		const rootSession = { roles: ["root"] };
		const leadDeveloperSession = { roles: ["leaddeveloper"] };
		const statusResponse = await handleWbolApi(new Request("http://localhost/wbol/connectors"), rootSession);
		assert.equal(statusResponse.status, 200);
		const [connector] = (await statusResponse.json()).filter(({ name }) => name === "mysqlsample");
		assert.equal("password" in connector, false);
		assert.equal("connectionStatus" in connector, false);

		const administratorResponse = await handleWbolApi(
			new Request("http://localhost/wbol/connectors/reconnect", { method: "POST" }),
			{ roles: ["administrator"] }
		);
		assert.equal(administratorResponse.status, 403);
		const forbidden = await handleWbolApi(
			new Request("http://localhost/wbol/connectors/reconnect", { method: "POST" }),
			{ roles: ["developer"] }
		);
		assert.equal(forbidden.status, 403);

		const changedConfigurations = originalConfigurations.map((configuration) =>
			configuration.name === "mysqlsample"
				? { ...configuration, host: "new-db.example.test" }
				: configuration
		);
		await writeFile(connectorsPath, JSON.stringify(changedConfigurations));
		failReconnect = true;
		const failedReconnect = await handleWbolApi(
			new Request("http://localhost/wbol/connectors/reconnect", { method: "POST" }),
			leadDeveloperSession
		);
		assert.equal(failedReconnect.status, 503);
		assert.deepEqual(await failedReconnect.json(), {
			reconnected: false,
			errors: ['Connector "mysqlsample" failed to initialize: IP access denied']
		});
		assert.equal(STWConnectors.connectors.has("mysqlsample"), false);
		assert.notEqual(STWConnectors.connectors.get("pgsample"), originalPeerConnection);
		assert.equal(STWConnectors.connectors.get("pgsample").type, "postgres");
		assert.deepEqual(connectCalls.slice(2).map(({ name }) => name), ["mysqlsample", "pgsample"]);
		assert.deepEqual(closed, ["mysqlsample", "pgsample"]);

		failReconnect = false;
		const successfulReconnect = await handleWbolApi(
			new Request("http://localhost/wbol/connectors/reconnect", { method: "POST" }),
			leadDeveloperSession
		);
		assert.equal(successfulReconnect.status, 200);
		assert.deepEqual(await successfulReconnect.json(), { reconnected: true });
		assert.deepEqual(connectCalls.slice(4).map(({ name }) => name), ["mysqlsample", "pgsample"]);
		assert.equal(connectCalls[4].host, "new-db.example.test");
		assert.equal(STWConnectors.connectors.get("mysqlsample").type, "mysql");
		assert.equal(STWConnectors.connectors.get("pgsample").type, "postgres");
		assert.deepEqual(closed, ["mysqlsample", "pgsample", "pgsample"]);
	} finally {
		await STWConnectors.resetRuntime();
		STWConnectors.connectDatabase = originalConnectDatabase;
		if (previousConnectorsPath === undefined) delete process.env.CONNECTORS;
		else process.env.CONNECTORS = previousConnectorsPath;
		await rm(directory, { recursive: true, force: true });
	}
});

test("IMAP connector limits reads, parses messages safely, and closes each connection", async () => {
	const queries = [];
	let released = 0;
	let loggedOut = 0;
	let clientOptions;
	const client = {
		usable: false,
		mailbox: { exists: 3 },
		async connect() { this.usable = true; },
		async getMailboxLock(mailbox) {
			assert.equal(mailbox, "INBOX");
			return { release() { released++; } };
		},
		async *fetch(range, query) {
			assert.equal(range, "1:*");
			assert.deepEqual(query, { uid: true, envelope: true, flags: true, internalDate: true, size: true });
			for (const uid of [1, 2, 3]) {
				yield {
					uid,
					envelope: { from: [{ name: "Sender", address: "sender@example.test" }], subject: `<subject ${uid}>`, date: new Date("2026-01-01T00:00:00Z") },
					flags: new Set(["\\Seen"]),
					size: 120
				};
			}
		},
		async fetchOne(uid, query, options) {
			queries.push({ uid, query, options });
			if (query.size) return { uid, size: 120 };
			return {
				uid,
				size: 120,
				envelope: { subject: "Fallback" },
				flags: new Set(),
				internalDate: new Date("2026-01-01T00:00:00Z"),
				source: Buffer.from([
					"From: Sender <sender@example.test>",
					"To: reader@example.test",
					"Subject: <script>alert(1)</script>",
					"Date: Thu, 01 Jan 2026 00:00:00 +0000",
					"Content-Type: text/html; charset=utf-8",
					"",
					"<p>Hello <b>reader</b></p>"
				].join("\r\n"))
			};
		},
		async logout() { this.usable = false; loggedOut++; },
		close() { this.usable = false; }
	};
	const config = { host: "imap.example.test", user: "reader", password: "secret", secure: true };
	const session = { placeholders: new Map([["@uid", "42"]]) };
	const createClient = (options) => {
		clientOptions = options;
		return client;
	};

	const listed = await executeImapQuery(session, config, '{"action":"list","mailbox":"INBOX","limit":3}', { createClient });
	assert.equal(clientOptions.secure, true);
	assert.equal(clientOptions.auth.pass, "secret");
	assert.deepEqual(listed.rows.map(({ uid }) => uid), ["3", "2", "1"]);
	assert.match(listed.rows[0].subject, /&lt;subject 3&gt;/);
	assert.equal(released, 1);
	assert.equal(loggedOut, 1);

	const message = await executeImapQuery(session, config, '{"action":"get","mailbox":"INBOX","uid":"@uid"}', { createClient });
	assert.equal(queries[0].uid, 42);
	assert.equal(queries[0].options.uid, true);
	assert.match(message.rows[0].subject, /&lt;script&gt;/);
	assert.match(message.rows[0].text, /Hello reader/);
	assert.doesNotMatch(message.rows[0].text, /<script>/);
	assert.deepEqual(message.fields.slice(0, 4), ["from", "to", "date", "text"]);
	assert.equal(released, 2);
	assert.equal(loggedOut, 2);

	assert.throws(() => parseImapCommand('{"action":"delete","uid":"42"}'), /must be 'list' or 'get'/);
	assert.throws(() => parseImapCommand('{"action":"list","limit":1000}'), /limit must be an integer/);
	await assert.rejects(executeImapQuery(session, { ...config, secure: false }, '{"action":"list"}', { createClient }), /require TLS/);
});

test("SMTP connector sends constrained plain-text messages with configured identity", async () => {
	let transportOptions;
	let sent;
	let closed = false;
	const result = await executeSmtpAction({
		host: "smtp.example.test",
		port: 587,
		secure: false,
		user: "mailer",
		password: "secret",
		from: "noreply@example.test"
	}, "send", {
		to: "reader@example.test",
		subject: "Hello",
		text: "Message body"
	}, {
		createTransport(options) {
			transportOptions = options;
			return {
				async sendMail(message) {
					sent = message;
					return { messageId: "message@example.test" };
				},
				close() { closed = true; }
			};
		}
	});
	assert.equal(transportOptions.secure, false);
	assert.equal(transportOptions.requireTLS, true);
	assert.equal(sent.from, "noreply@example.test");
	assert.equal(sent.to, "reader@example.test");
	assert.equal(sent.text, "Message body");
	assert.equal("html" in sent, false);
	assert.equal(result.rows[0].status, "sent");
	assert.equal(closed, true);

	await assert.rejects(executeSmtpAction({
		host: "smtp.example.test", user: "mailer", password: "secret", from: "noreply@example.test"
	}, "send", { to: "victim@example.test\r\nBcc: other@example.test", subject: "Hello", text: "Body" }), /single valid email address/);
	await assert.rejects(executeSmtpAction({
		host: "smtp.example.test", user: "mailer", password: "secret", from: "noreply@example.test"
	}, "send", { to: "reader@example.test", subject: "Bad\r\nSubject", text: "Body" }), /no line breaks/);
});

test("Common WBOL mail interface renders a protected inbox, message view, and compose form", async () => {
	const common = WBOL(await readFile("./webbaselets/stwCommon.wbol", "utf8"));
	const page = common.children.find((child) => child.slug?.en === "mail");
	assert.ok(page);
	assert.equal(page.visibility.leaddeveloper, true);
	assert.equal(page.visibility.root, true);
	const inbox = page.children.find((child) => child.slug?.en === "inbox");
	const message = page.children.find((child) => child.slug?.en === "message");
	const compose = page.children.find((child) => child.slug?.en === "compose");
	assert.equal(inbox.connector, "imapApi");
	assert.equal(message.connector, "imapApi");
	assert.equal(compose.connector, "json");
	assert.match(inbox.query, /"action":"list"/);
	assert.match(message.query, /"action":"get"/);
	assert.match(compose.layout.en, /stwsubmit;smtpApi;send/);

	const form = new STWForm(message);
	const placeholders = new Map();
	const rendered = await form.render(new Request("http://localhost/stwc/mail/message"), {
		lang: "en",
		sessionId: "mail-ui-session",
		placeholders,
		baseurl: "",
		tz: "UTC"
	}, {
		fields: ["from", "to", "date", "text", "subject", "truncated", "flags"],
		rows: [{
			from: "Sender &lt;sender@example.test&gt;",
			to: "Reader &lt;reader@example.test&gt;",
			date: "2026-01-01",
			text: "Hello &lt;reader&gt;",
			subject: "Welcome",
			truncated: false,
			flags: ""
		}]
	});
	assert.match(rendered, /Sender &lt;sender@example.test&gt;/);
	assert.match(rendered, /Hello &lt;reader&gt;/);
});

test("CRUD actions use the connector capability instead of a MySQL type check", async () => {
	const originalSupportsCrud = STWConnectors.supportsCrud;
	const originalExecuteCrud = STWConnectors.executeCrud;
	const originalExecuteAction = STWConnectors.executeAction;
	let executed = false;
	STWConnectors.supportsCrud = async () => true;
	STWConnectors.executeCrud = async (session, content, operation) => {
		executed = true;
		assert.equal(content.connector, "relational");
		assert.equal(operation, "insert");
		return { fields: ["name"], affectedRows: 1, keyValue: 42 };
	};
	STWConnectors.executeAction = async () => {
		throw new Error("Database CRUD should not use the API action path");
	};
	try {
		const formData = new FormData();
		formData.set("name", "Ada");
		const session = { placeholders: new Map() };
		const result = await new STWActionRouter().execute({
			action: "stwinsert",
			args: ["relational", "SELECT * FROM customers"],
			content: {},
			formData,
			session,
			url: "/customers",
			req: { url: "/customers" }
		});
		assert.equal(executed, true);
		assert.equal(result.ok, true);
		assert.equal(session.placeholders.get("@@stwKeyValue"), 42);
	} finally {
		STWConnectors.supportsCrud = originalSupportsCrud;
		STWConnectors.executeCrud = originalExecuteCrud;
		STWConnectors.executeAction = originalExecuteAction;
	}
});

test("SQL CRUD generates provider-specific commands for MySQL, PostgreSQL, and SQL Server", async () => {
	const previousPath = process.env.CONNECTORS;
	const directory = await mkdtemp(join(tmpdir(), "webspinner-crud-"));
	const connectorsPath = join(directory, "connectors.json");
	await writeFile(connectorsPath, "[]");
	process.env.CONNECTORS = connectorsPath;
	try {
		for (const type of ["mysql", "postgres", "mssql"]) {
			await STWConnectors.resetRuntime();
			let statement = "";
			let parameters = [];
			const client = createFakeSqlClient(type, (query, values) => {
				statement = query;
				parameters = values;
			});
			STWConnectors.connectors.set(type, { type, client });
			assert.equal(await STWConnectors.supportsCrud(type), true);
			const result = await STWConnectors.executeCrud(
				{ placeholders: new Map() },
				{ connector: type, query: "SELECT * FROM customers" },
				"insert",
				{ name: "Ada" },
				"id"
			);
			assert.deepEqual(result, { fields: { name: "Ada" }, affectedRows: 1, keyValue: 42 });
			assert.deepEqual(parameters, ["Ada"]);
			if (type === "mysql") {
				assert.match(statement, /INSERT INTO `customers` \(`name`\) VALUES \(\?\)/);
			} else if (type === "postgres") {
				assert.match(statement, /INSERT INTO "customers" \("name"\) VALUES \(\$1\) RETURNING "id"/);
			} else {
				assert.match(statement, /INSERT INTO \[customers\] \(\[name\]\) OUTPUT INSERTED\.\[id\] VALUES \(@p0\)/);
			}
			const updated = await STWConnectors.executeCrud(
				{ placeholders: new Map() },
				{ connector: type, query: "SELECT * FROM customers" },
				"update",
				{ id: "42", name: "Ada" },
				"id"
			);
			assert.deepEqual(updated, { fields: { name: "Ada" }, affectedRows: 1, keyValue: "42" });
			assert.deepEqual(parameters, ["Ada", "42"]);
			if (type === "mysql") assert.match(statement, /UPDATE `customers` SET `name` = \? WHERE `id` = \?/);
			else if (type === "postgres") assert.match(statement, /UPDATE "customers" SET "name" = \$1 WHERE "id" = \$2/);
			else assert.match(statement, /UPDATE \[customers\] SET \[name\] = @p0 WHERE \[id\] = @p1/);

			const deleted = await STWConnectors.executeCrud(
				{ placeholders: new Map() },
				{ connector: type, query: "SELECT * FROM customers" },
				"delete",
				{ id: "42" },
				"id"
			);
			assert.deepEqual(deleted, { fields: { id: "42" }, affectedRows: 1, keyValue: "42" });
			assert.deepEqual(parameters, ["42"]);
			if (type === "mysql") assert.match(statement, /DELETE FROM `customers` WHERE `id` = \?/);
			else if (type === "postgres") assert.match(statement, /DELETE FROM "customers" WHERE "id" = \$1/);
			else assert.match(statement, /DELETE FROM \[customers\] WHERE \[id\] = @p0/);
		}
	} finally {
		await STWConnectors.resetRuntime();
		if (previousPath === undefined) delete process.env.CONNECTORS;
		else process.env.CONNECTORS = previousPath;
		await rm(directory, { recursive: true, force: true });
	}
});

test("MongoDB CRUD uses the native collection command and shared key contract", async () => {
	const previousPath = process.env.CONNECTORS;
	const directory = await mkdtemp(join(tmpdir(), "webspinner-mongodb-crud-"));
	const connectorsPath = join(directory, "connectors.json");
	await writeFile(connectorsPath, "[]");
	process.env.CONNECTORS = connectorsPath;
	let update;
	try {
		await STWConnectors.resetRuntime();
		STWConnectors.connectors.set("documents", {
			type: "mongodb",
			client: { close: async () => {} },
			database: {
				collection(name) {
					assert.equal(name, "customers");
					return {
						updateOne: async (filter, changes) => {
							update = { filter, changes };
							return { modifiedCount: 1 };
						}
					};
				}
			}
		});
		assert.equal(await STWConnectors.supportsCrud("documents"), true);
		const result = await STWConnectors.executeCrud(
			{ placeholders: new Map() },
			{ connector: "documents", query: '{"collection":"customers","filter":{"status":"active"}}' },
			"update",
			{ _id: "507f1f77bcf86cd799439011", name: "Ada" }
		);
		assert.deepEqual(result, {
			fields: { name: "Ada" },
			affectedRows: 1,
			keyValue: "507f1f77bcf86cd799439011"
		});
		assert.equal(update.filter.status, "active");
		assert.equal(update.filter._id.toHexString(), "507f1f77bcf86cd799439011");
		assert.deepEqual(update.changes, { $set: { name: "Ada" } });
	} finally {
		await STWConnectors.resetRuntime();
		if (previousPath === undefined) delete process.env.CONNECTORS;
		else process.env.CONNECTORS = previousPath;
		await rm(directory, { recursive: true, force: true });
	}
});

function createFakeSqlClient(type, capture) {
	if (type === "mysql") {
		return {
			execute: async (query, values) => {
				capture(query, values);
				if (query.includes("LIMIT 0")) return [[], [{ name: "id" }, { name: "name" }]];
				return [{ affectedRows: 1, insertId: 42 }, []];
			},
			end: async () => {}
		};
	}
	if (type === "postgres") {
		return {
			query: async (query, values) => {
				capture(query, values);
				if (query.endsWith("LIMIT 0")) {
					return { rowCount: 0, rows: [], fields: [{ name: "id" }, { name: "name" }] };
				}
				return { rowCount: 1, rows: [{ id: 42 }], fields: [{ name: "id" }] };
			},
			end: async () => {}
		};
	}
	return {
		request() {
			const values = [];
			return {
				input(name, value) {
					values.push([name, value]);
					return this;
				},
				query: async (query) => {
					capture(query, values.map(([, value]) => value));
					const recordset = [];
					recordset.columns = query.includes("TOP 0") ? { id: {}, name: {} } : { id: {} };
					if (!query.includes("TOP 0")) recordset.push({ id: 42 });
					return { recordset, rowsAffected: [query.includes("TOP 0") ? 0 : 1] };
				}
			};
		},
		close: async () => {}
	};
}
