import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCookies, runCommand, serveFile, setCookie } from "../stwComponents/stwNode.js";
import { WBOL } from "../stwComponents/stwWBOL.js";
import { STWContent } from "../stwElements/stwContent.js";
import { STWElement } from "../stwElements/stwElement.js";
import { STWPortal } from "../stwElements/stwPortal.js";
import { STWTabs } from "../stwContents/stwTabs.js";
import { STWTable } from "../stwContents/stwTable.js";
import { STWIndex } from "../stwElements/stwIndex.js";
import { handleWbolApi } from "../stwComponents/stwWBOLApi.js";
import { STWLayout } from "../stwComponents/stwWBLL.js";
import { signAction, verifyAction } from "../stwComponents/stwActionToken.js";
import { STWActionRouter } from "../stwComponents/stwActions.js";
import { handleHttp } from "../stwComponents/stwHttpHandler.js";
import { STWConnectors } from "../stwComponents/stwConnectors.js";

test("cookie helpers parse and set session cookies", () => {
	const cookies = getCookies(new Headers({ cookie: "sessionId=a%20b; theme=dark" }));
	assert.deepEqual(cookies, { sessionId: "a b", theme: "dark" });

	const headers = new Headers();
	setCookie(headers, { name: "sessionId", value: "a b", httpOnly: true, secure: true, sameSite: "Lax" });
	assert.equal(headers.get("set-cookie"), "sessionId=a%20b; Path=/; HttpOnly; Secure; SameSite=Lax");
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
	const session = { placeholders, baseurl: "localhost", lang: "en", tz: "UTC" };
	const layout = new STWLayout("b('/customer;stwupdate;erp;select * from tCustomers where fId=@@fId')p('fId;@@fId')t('Save')");
	const { HTML } = await layout.render([], placeholders, session, "", "customer-content");
	assert.match(HTML, /name="stwAction" value="stwupdate"/);
	assert.doesNotMatch(HTML, /data-stw-(?:action|method)=/);
	assert.match(HTML, /formmethod="POST"/);
	assert.match(HTML, /formaction="\/customer\?fId=42"/);
	assert.match(HTML, />Save<\/button>/);
	const token = /data-stw-action-token="([^"]+)"/.exec(HTML)?.[1];
	assert.ok(token);
	assert.deepEqual(verifyAction(token), {
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
	assert.equal(verifyAction(`${encoded}.${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`), null);

	for (const action of ["stwfilter", "stwinsert", "stwdelete", "stwsubmit"]) {
		const actionLayout = new STWLayout(`b('/;${action}')`);
		const actionHTML = (await actionLayout.render([], placeholders, session, "", "action-content")).HTML;
		assert.match(actionHTML, new RegExp(`value="${action}"`));
		assert.doesNotMatch(actionHTML, /data-stw-(?:action|method)=/);
	}
});

test("table actions use shared table forms and reveal row or insert controls on edit", async () => {
	const placeholders = new Map([["@@name", "Ada"]]);
	const session = { placeholders, baseurl: "localhost", lang: "en", tz: "UTC" };
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

test("GET action requests execute on the server and redirect with 303", async () => {
	const id = `action-${Date.now()}`;
	const content = new STWContent({ uuid: id, slug: { en: "action" } });
	content.visibility.set("users", true);
	STWIndex.set(id, content);
	const portal = STWPortal.instance;
	const session = {
		portal,
		roles: ["users"],
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
			"session"
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
	content.visibility.set("users", true);
	STWIndex.set(id, content);
	const portal = STWPortal.instance;
	const session = {
		portal,
		roles: ["users"],
		lang: "en",
		user: "alice",
		name: "Alice",
		dev: true,
		placeholders: new Map([["USER", "alice"], ["AUTHENTICATED", "true"]]),
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
			"session"
		);
		assert.equal(response.status, 303);
		assert.equal(response.headers.get("location"), "http://localhost/");
		assert.equal(session.user, "guest");
		assert.equal(session.roles[0], "guests");
		assert.equal(session.placeholders.has("AUTHENTICATED"), false);
	} finally {
		STWIndex.delete(id);
	}
});

test("actions require RBV visibility with or without a signed token", async () => {
	const id = `hidden-action-${Date.now()}`;
	const content = new STWContent({ uuid: id, subtype: "Text", slug: { en: "hidden-action" } });
	content.visibility.set("users", true);
	STWIndex.set(id, content);
	const session = {
		portal: STWPortal.instance,
		roles: ["guests"],
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
	});
	try {
		for (const signed of [true, false]) {
			const formData = new FormData();
			formData.set("stwAction", "stwlogoff");
			formData.set("stwOrigin", id);
			if (signed) formData.set("stwActionToken", token);
			const response = await handleHttp(
				new Request("http://localhost/hidden-action", { method: "POST", body: formData }),
				session,
				"session"
			);
			assert.equal(response.status, 403);
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
		<visibility><role id="users" /></visibility>
		<children />
	</webbase>`);
	assert.deepEqual(portal.connectors, {
		main: "mysql://main",
		archive: "postgres://archive"
	});
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

test("WBOL element API requires the developers role", async () => {
	const request = new Request("http://localhost/wbol/not-an-element");
	for (const role of ["root", "administrators", "users"]) {
		const response = await handleWbolApi(request, { roles: [role] });
		assert.equal(response.status, 403, `${role} must not grant development access`);
	}

	const developerResponse = await handleWbolApi(request, { roles: ["developers"] });
	assert.equal(developerResponse.status, 404, "developers may access element routes");
});

test("WBOL property and portal routes read and update their supported data", async () => {
	const portalId = `portal-${Date.now()}`;
	const tabsId = `tabs-${Date.now()}`;
	const portal = new STWPortal({
		uuid: portalId,
		langs: ["en", "fr", "de"],
		connectors: { main: "json" },
		visibility: { developers: true }
	});
	const tabs = new STWTabs({
		uuid: tabsId,
		subtype: "Tabs",
		name: { en: "Settings", fr: "Parametres" },
		slug: { en: "settings", fr: "reglages" },
		keywords: { en: "general", fr: "general-fr" },
		options: [{ name: { en: "General" }, ref: "general" }]
	});
	portal.children.push(tabs);
	tabs.parent = portal;
	STWIndex.set(tabsId, tabs);
	const session = { roles: ["developers"], lang: "en", portal };
	const call = (path, method = "GET", body) => handleWbolApi(
		new Request(`http://localhost/wbol/${path}`, {
			method,
			headers: body === undefined ? {} : { "Content-Type": "application/json" },
			body: body === undefined ? undefined : JSON.stringify(body)
		}),
		session
	);
	const previousRolesPath = process.env.ROLES;
	const previousUsersPath = process.env.USERS;
	const securityDir = await mkdtemp(join(tmpdir(), "webspinner-wbol-api-"));

	try {
		process.env.ROLES = join(securityDir, "roles.json");
		process.env.USERS = join(securityDir, "users.json");
		let response = await call(`${tabsId}/visibility`);
		assert.deepEqual(await response.json(), {});
		response = await call(`${tabsId}/visibility`, "PATCH", { developers: true });
		assert.deepEqual(await response.json(), { developers: true });

		response = await call(`${tabsId}?locale=fr`, "PATCH", {
			name: "Parametres generaux",
			slug: "preferences",
			keywords: { fr: "configuration" }
		});
		assert.equal(response.status, 200);
		let updatedElement = await response.json();
		assert.deepEqual(updatedElement.name, { en: "Settings", fr: "Parametres generaux" });
		assert.deepEqual(updatedElement.slug, { en: "settings", fr: "preferences" });
		assert.deepEqual(updatedElement.keywords, { en: "general", fr: "configuration" });
		response = await call(`${tabsId}?locale=de`, "PATCH", { name: "Einstellungen" });
		assert.equal(response.status, 200);
		updatedElement = await response.json();
		assert.deepEqual(updatedElement.name, { en: "Settings", fr: "Parametres generaux", de: "Einstellungen" });
		response = await call(`${tabsId}?locale=it`, "PATCH", { name: "Impostazioni" });
		assert.equal(response.status, 400);
		response = await call(tabsId, "PATCH", { name: "Default locale update" });
		updatedElement = await response.json();
		assert.deepEqual(updatedElement.name, {
			en: "Default locale update",
			fr: "Parametres generaux",
			de: "Einstellungen"
		});

		response = await call(`?uuid=${tabsId}&locale=fr`);
		assert.equal((await response.json()).name, "Parametres generaux");

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
		assert.deepEqual(await response.json(), { main: "json" });
		response = await call(`${portalId}/connectors`, "PUT", { main: "WBOLApi" });
		assert.deepEqual(await response.json(), { main: "WBOLApi" });

		response = await call(`${portalId}/roles`);
		assert.equal(response.status, 200);
		assert.ok((await response.json()).includes("developers"));
		response = await call(`${portalId}/roles`, "POST", { role: "editors" });
		assert.equal(response.status, 201);
		assert.deepEqual(await response.json(), { role: "editors" });
		response = await call(`${portalId}/roles`, "POST", { role: "developers" });
		assert.equal(response.status, 409);

		tabs.visibility.delete("developers");
		portal.visibility.set("developers", false);
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

test("connector administration uses the renamed connectors route and configuration", async () => {
	const previousConnectorsPath = process.env.CONNECTORS;
	const directory = await mkdtemp(join(tmpdir(), "webspinner-connectors-api-"));
	const connectorsPath = join(directory, "connectors.json");
	await writeFile(connectorsPath, JSON.stringify([
		{ name: "sample", type: "api", host: "https://api.example.test", password: "secret" }
	]));
	process.env.CONNECTORS = connectorsPath;
	try {
		const session = { roles: ["root", "developers"] };
		const response = await handleWbolApi(new Request("http://localhost/wbol/connectors"), session);
		assert.equal(response.status, 200);
		assert.deepEqual(await response.json(), [{
			name: "sample",
			type: "api",
			host: "https://api.example.test",
			hasPassword: true
		}]);
		const legacyResponse = await handleWbolApi(new Request("http://localhost/wbol/datasources"), session);
		assert.equal(legacyResponse.status, 404);
	} finally {
		if (previousConnectorsPath === undefined) delete process.env.CONNECTORS;
		else process.env.CONNECTORS = previousConnectorsPath;
		await rm(directory, { recursive: true, force: true });
	}
});

test("admin connector reconnect resets and attempts every configured connector", async () => {
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

		const adminSession = { roles: ["root"] };
		const statusResponse = await handleWbolApi(new Request("http://localhost/wbol/connectors"), adminSession);
		assert.equal(statusResponse.status, 200);
		const [connector] = (await statusResponse.json()).filter(({ name }) => name === "mysqlsample");
		assert.equal("password" in connector, false);
		assert.equal("connectionStatus" in connector, false);

		const forbidden = await handleWbolApi(
			new Request("http://localhost/wbol/connectors/reconnect", { method: "POST" }),
			{ roles: ["developers"] }
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
			adminSession
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
			adminSession
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
