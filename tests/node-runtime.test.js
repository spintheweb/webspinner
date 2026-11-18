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
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCookies, runCommand, serveFile, setCookie } from "../stwComponents/stwNode.js";
import { WBOL } from "../stwComponents/stwWBOL.js";
import { STWContent } from "../stwElements/stwContent.js";
import { STWElement } from "../stwElements/stwElement.js";
import { STWPortal } from "../stwElements/stwPortal.js";
import { STWTabs } from "../stwContents/stwTabs.js";
import { STWTable } from "../stwContents/stwTable.js";
import { STWForm } from "../stwContents/stwForm.js";
import { STWText } from "../stwContents/stwText.js";
import { STWTree } from "../stwContents/stwTree.js";
import { STWIndex } from "../stwElements/stwIndex.js";
import { handleWbolApi } from "../stwComponents/stwWBOLApi.js";
import { STWLayout } from "../stwComponents/stwWBLL.js";
import { signAction, verifyAction } from "../stwComponents/stwActionToken.js";
import { STWActionRouter } from "../stwComponents/stwActions.js";
import { handleHttp } from "../stwComponents/stwHttpHandler.js";
import { STWConnectors } from "../stwComponents/stwConnectors.js";
import { STWSecurity } from "../stwComponents/stwSecurity.js";
import { STWSession } from "../stwComponents/stwSession.js";
import { handleWebSocket } from "../stwComponents/stwWebSocket.js";

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
		"@@stwloginid": "-3"
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
	assert.deepEqual(Object.fromEntries(
		["@@stwlogin", "@@stwloginname", "@@stwloginid"].map((key) => [key, session.placeholders.get(key)])
	), {
		"@@stwlogin": "alice",
		"@@stwloginname": "Alice",
		"@@stwloginid": "123"
	});
});

test("WebSocket language negotiation synchronizes the session language placeholder", async () => {
	const portal = STWPortal.instance;
	const previousLanguages = portal.langs;
	const session = new STWSession("language-session", {}, portal);
	const handlers = new Map();
	const socket = { on: (event, handler) => handlers.set(event, handler) };
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

test("developer content cogs open the Common editor with the selected content UUID", async () => {
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

		assert.match(body, /resource: "\/stwc\/edit-content"/);
		assert.match(body, /search: \{ uuid: "c4sHhypzNzBJ7LpOv3ROBvX" \}/);
	} finally {
		STWConnectors.command = command;
	}
});

test("static file serving returns content and blocks paths outside public", async () => {
	const response = await serveFile(new Request("http://localhost/index.html"), "./public/index.html");
	assert.equal(response.status, 200);
	assert.match(response.headers.get("content-type") ?? "", /text\/html/);

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
			subtype: "Tree", connector: "wbol", params: "/", query: treeQuery,
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
	const tree = new STWTree({ subtype: "Tree", layout: { en: "\\s('key=\"path\"')v(';;@@name')" } });
	const html = await tree.render(null, session, {
		fields: ["path", "name"],
		rows: [{ path: "parent", name: "Parent" }, { path: "parent/child", name: "Child" }]
	});
	assert.match(html, /parent/);
	assert.match(html, /child/);
	assert.doesNotMatch(html, /\[object Promise\]/);
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

test("the Common content editor submits and updates the selected content", async () => {
	const definition = WBOL(await readFile("./webbaselets/stwCommon.wbol", "utf8"))
		.children.find((child) => child.slug?.en === "edit-content");
	const editor = new STWForm(definition);
	const portal = new STWPortal({ uuid: "editor-test-portal", langs: ["en", "it"] });
	const originalLayout = '<p>First; second &amp; third</p>';
	const content = new STWText({
		uuid: "editor-test-content",
		subtype: "Text",
		name: { en: "Original", it: "Italiano" },
		slug: { en: "original", it: "italiano" },
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
		assert.match(body, /<option value="Text" selected>/);
		assert.match(body, /name="query"[^>]*>\{&quot;value&quot;:&quot;a;b&quot;\}<\/textarea>/);
		assert.match(body, /name="layout"[^>]*>&lt;p&gt;First; second &amp;amp; third&lt;\/p&gt;<\/textarea>/);
		const token = /data-stw-action-token="([^"]+)"/.exec(body)?.[1];
		assert.ok(token);
		const fields = {
			uuid: content.uuid, name: "Updated", slug: "updated", type: "Text",
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
		assert.equal(content.slug.get("en"), "updated");
		assert.equal(content.section, "header");
		assert.equal(content.sequence, "0");
		assert.equal(content.cssClass, "");
		assert.equal(content.connector, "");
		assert.equal(content.query, "");
		assert.equal(content.params, "");
		assert.equal(content.layout.get("en"), "<p>Updated; & more</p>");
		assert.equal(content.layout.get("it"), "t('Italiano')");

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
	assert.throws(() => new STWElement({ slug: { en: "wbol" } }), /slug 'wbol' is reserved/i);
	assert.throws(() => new STWElement({ slug: { en: "W-BOL" } }), /slug 'wbol' is reserved/i);

	const element = new STWElement({ slug: { en: "home" } });
	assert.throws(() => element.updateLocalizedField({}, "slug", { en: "wbol" }), /slug 'wbol' is reserved/i);
	assert.equal(element.slug.get("en"), "home");

	const content = new STWContent({ subtype: "Text", slug: { en: "home" } });
	assert.throws(() => content.localize({ lang: "en" }, "slug", "wbol"), /slug 'wbol' is reserved/i);
	assert.equal(content.slug.get("en"), "home");
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

test("default users replace placeholder passwords with valid verifiers", async () => {
	const usersPath = new URL("../.data/users.json", import.meta.url);
	const users = JSON.parse(await readFile(usersPath, "utf8"));
	let updated = false;

	for (const user of users) {
		if (user.password === "salt:hash") {
			user.password = await STWSecurity.hashPassword("password");
			updated = true;
		}
	}

	if (updated) await writeFile(usersPath, JSON.stringify(users, null, 2));
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
		assert.deepEqual(session.roles, ["user"], "unset flags must disable privileged roles");
		assert.equal(session.dev, false);

		process.env.ALLOW_DEV = "true";
		session = await authenticate();
		assert.deepEqual(session.roles, ["user"], "root must not grant development access");
		assert.equal(session.dev, false);

		process.env.ALLOW_DEV = "false";
		process.env.ALLOW_ROOT = "true";
		session = await authenticate();
		assert.deepEqual(session.roles, ["root", "user"]);
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
		keywords: { en: "general", fr: "general-fr" },
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
		response = await callAs({ roles: ["leaddeveloper"] }, `${portalId}/visibility`);
		assert.deepEqual(await response.json(), { developer: false, root: true });
		response = await callAs({ roles: ["leaddeveloper"] }, `${portalId}/visibility`, "PATCH", { root: true });
		assert.equal(response.status, 403, "LeadDeveloper cannot assign root visibility");
		response = await callAs({ roles: ["leaddeveloper"] }, `${portalId}/visibility`, "PATCH", { developer: true });
		assert.equal(response.status, 403, "the portal cannot grant visibility to non-root roles");
		response = await callAs({ roles: ["leaddeveloper"] }, `${portalId}/visibility`, "PUT", { developer: false });
		assert.deepEqual(await response.json(), { developer: false, root: true });
		response = await call("");
		assert.equal(response.status, 200);
		assert.deepEqual((await response.json()).children.map((child) => child.uuid), [tabsId]);

		response = await call(`${tabsId}?locale=fr`, "PATCH", {
			name: "Parametres generaux",
			slug: "preferences",
			keywords: { fr: "configuration" }
		});
		assert.equal(response.status, 200);
		let updatedElement = await response.json();
		assert.equal(updatedElement.name, "Parametres generaux");
		assert.equal(updatedElement.slug, "preferences");
		assert.equal(updatedElement.keywords, "configuration");
		assert.deepEqual(Object.fromEntries(tabs.name), { en: "Settings", fr: "Parametres generaux" });
		assert.deepEqual(Object.fromEntries(tabs.slug), { en: "settings", fr: "preferences" });
		assert.deepEqual(Object.fromEntries(tabs.keywords), { en: "general", fr: "configuration" });
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
		name: { en: "Original", fr: "Originale" },
		slug: { en: "original", fr: "originale" },
		keywords: { en: "old" },
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
	hidden.parent = portal;
	STWIndex.set(seoId, content);
	STWIndex.set(hiddenId, hidden);
	const session = { roles: ["seo"], lang: "en", portal };
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
		assert.equal("visibility" in tree.children[0], false);
		assert.equal("options" in tree.children[0], false);

		let response = await call(seoId);
		assert.equal(response.status, 200);
		response = await call(seoId, "PATCH", {
			name: { en: "Search optimized", fr: "Optimisee pour la recherche", de: "Suchoptimiert" },
			slug: { en: "search-optimized", fr: "optimisee-recherche", de: "suchoptimiert" },
			keywords: { en: "search, metadata" },
			description: { en: "Updated description", fr: "Description mise a jour" }
		});
		assert.equal(response.status, 200);
		const updated = await response.json();
		assert.equal(updated.name, "Search optimized");
		assert.equal(updated.slug, "searchoptimized");
		assert.equal(updated.keywords, "search, metadata");
		assert.equal(updated.description, "Updated description");
		assert.equal("visibility" in updated, false);
		response = await call(`${seoId}?locale=fr`);
		const frenchElement = await response.json();
		assert.equal(frenchElement.name, "Optimisee pour la recherche");
		assert.equal(frenchElement.slug, "optimiseerecherche");
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

test("role assignments respect administrator, LeadDeveloper, and root boundaries", async () => {
	const previousRolesPath = process.env.ROLES;
	const previousUsersPath = process.env.USERS;
	const directory = await mkdtemp(join(tmpdir(), "webspinner-role-assignment-"));
	try {
		process.env.ROLES = join(directory, "roles.json");
		process.env.USERS = join(directory, "users.json");
		await writeFile(process.env.USERS, "[]");

		const listedRoles = await handleWbolApi(
			new Request("http://localhost/wbol/roles"),
			{ roles: ["root"] }
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
		if (previousRolesPath === undefined) delete process.env.ROLES;
		else process.env.ROLES = previousRolesPath;
		if (previousUsersPath === undefined) delete process.env.USERS;
		else process.env.USERS = previousUsersPath;
		await rm(directory, { recursive: true, force: true });
	}
});

test("LeadDeveloper users can manage connector configuration", async () => {
	const previousConnectorsPath = process.env.CONNECTORS;
	const directory = await mkdtemp(join(tmpdir(), "webspinner-connectors-api-"));
	const connectorsPath = join(directory, "connectors.json");
	await writeFile(connectorsPath, JSON.stringify([
		{ name: "sample", type: "api", host: "https://api.example.test", password: "secret" }
	]));
	process.env.CONNECTORS = connectorsPath;
	try {
		const session = { roles: ["leaddeveloper"] };
		const response = await handleWbolApi(new Request("http://localhost/wbol/connectors"), session);
		assert.equal(response.status, 200);
		assert.deepEqual(await response.json(), [{
			name: "sample",
			type: "api",
			host: "https://api.example.test",
			hasPassword: true
		}]);
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
	} finally {
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
		{ name: "mysqlsample", type: "mysql", host: "old-db.example.test", user: "portal", database: "portal" },
		{ name: "pgsample", type: "postgres", host: "pg.example.test", user: "portal", database: "portal" }
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
