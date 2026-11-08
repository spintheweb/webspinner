import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCookies, runCommand, serveFile, setCookie } from "../stwComponents/stwNode.js";
import { WBOL } from "../stwComponents/stwWBOL.js";
import { STWContent } from "../stwElements/stwContent.js";
import { STWElement } from "../stwElements/stwElement.js";
import { STWPortal } from "../stwElements/stwPortal.js";
import { STWTabs } from "../stwContents/stwTabs.js";
import { STWIndex } from "../stwElements/stwIndex.js";
import { handleWbolApi } from "../stwComponents/stwWBOLApi.js";

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

test("WBOL parser loads the portal through Node XML and filesystem APIs", () => {
	const portal = WBOL("./.data/webbase.wbol");
	assert.equal(portal.type, "Portal");
	assert.ok(Array.isArray(portal.children));
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
		datasources: { main: "json" },
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

		response = await call(`${portalId}/datasources`);
		assert.deepEqual(await response.json(), { main: "json" });
		response = await call(`${portalId}/datasources`, "PUT", { main: "WBOLApi" });
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
