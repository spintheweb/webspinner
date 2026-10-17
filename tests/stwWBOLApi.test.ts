import { assert, assertEquals } from "@std/assert";
import type { STWSession } from "../stwComponents/stwSession.ts";
import { handleWbolApi } from "../stwComponents/stwWBOLApi.ts";

Deno.test("WBOL API rejects sessions without the developers role", async () => {
	const session = { roles: ["guests"] } as STWSession;
	const response = await handleWbolApi(
		new Request("https://example.com/wbol"),
		session,
	);

	assertEquals(response.status, 403);
	assertEquals(await response.json(), { error: "Forbidden" });
});

Deno.test("WBOL account and configuration endpoints require root or administrator", async () => {
	const session = { roles: ["developers"] } as STWSession;
	const response = await handleWbolApi(
		new Request("https://example.com/wbol/users"),
		session,
	);

	assertEquals(response.status, 403);
	assertEquals(await response.json(), { error: "Forbidden" });
});

Deno.test("WBOL root and administrator sessions can reach management routes", async () => {
	for (const role of ["root", "administrators"]) {
		const response = await handleWbolApi(
			new Request("https://example.com/wbol/users", { method: "OPTIONS" }),
			{ roles: [role] } as STWSession,
		);

		assertEquals(response.status, 405);
		assertEquals(response.headers.get("allow"), "GET, POST, PATCH, DELETE");
	}
});

Deno.test("WBOL management redacts credentials and keeps role and datasource updates consistent", async () => {
	const directory = await Deno.makeTempDir();
	const envNames = ["USERS", "ROLES", "DATASOURCES"];
	const previousValues = new Map(envNames.map((name) => [name, Deno.env.get(name)]));
	for (const name of envNames) Deno.env.set(name, `${directory}\\${name.toLowerCase()}.json`);

	try {
		const session = { roles: ["root"] } as STWSession;
		const call = async (path: string, method: string, body?: unknown) => {
			return await handleWbolApi(
				new Request(`https://example.com/wbol/${path}`, {
					method,
					headers: body === undefined ? undefined : { "content-type": "application/json" },
					body: body === undefined ? undefined : JSON.stringify(body),
				}),
				session,
			);
		};

		assertEquals((await call("roles", "POST", { role: "writers" })).status, 201);
		assertEquals(
			(await call("users", "POST", {
				user: "alice",
				password: "test-secret",
				roles: ["writers"],
			})).status,
			201,
		);
		const usersResponse = await call("users", "GET");
		const users = await usersResponse.json();
		assertEquals(users[0].password, undefined);
		const persistedUsers = JSON.parse(await Deno.readTextFile(`${directory}\\users.json`));
		assert(persistedUsers[0].password.includes(":"));
		assert(!persistedUsers[0].password.includes("test-secret"));

		assertEquals((await call("roles/writers", "PATCH", { role: "editors" })).status, 200);
		assertEquals((await (await call("users", "GET")).json())[0].roles, "editors");
		assertEquals((await call("roles/editors", "DELETE")).status, 204);
		assertEquals((await call("roles/root", "DELETE")).status, 409);
		assertEquals(
			(await call("users", "POST", {
				user: "sole-root",
				password: "root-secret",
				roles: ["root"],
			})).status,
			201,
		);
		assertEquals((await call("users/sole-root", "DELETE")).status, 409);

		assertEquals(
			(await call("datasources", "POST", {
				name: "catalog",
				type: "api",
				host: "https://example.com/data",
				password: "datasource-secret",
			})).status,
			201,
		);
		const datasource = (await (await call("datasources", "GET")).json())[0];
		assertEquals(datasource.password, undefined);
		assertEquals(datasource.hasPassword, true);
		assertEquals(
			(await call("datasources/catalog", "PATCH", { host: "https://example.com/updated" })).status,
			200,
		);
		const updatedDatasource = (await (await call("datasources", "GET")).json())[0];
		assertEquals(updatedDatasource.hasPassword, true);
		assertEquals(updatedDatasource.host, "https://example.com/updated");
		const persistedDatasources = JSON.parse(await Deno.readTextFile(`${directory}\\datasources.json`));
		assertEquals(persistedDatasources[0].password, "datasource-secret");
		assertEquals((await call("datasources/catalog", "DELETE")).status, 204);
		assertEquals((await call("datasources", "POST", { name: "unsupported", type: "mongodb" })).status, 400);
	} finally {
		for (const [name, value] of previousValues) {
			if (value === undefined) Deno.env.delete(name);
			else Deno.env.set(name, value);
		}
		await Deno.remove(directory, { recursive: true });
	}
});
