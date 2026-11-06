import assert from "node:assert/strict";
import { test } from "node:test";
import { getCookies, runCommand, serveFile, setCookie } from "../stwComponents/stwNode.js";
import { WBOL } from "../stwComponents/stwWBOL.js";

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
