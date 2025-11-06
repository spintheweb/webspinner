// SPDX-License-Identifier: GPL-3.0-or-later
// Test suite: wbpl.test

import { assertEquals } from "@std/assert";
import { wbpl } from "../stwComponents/stwWBPL.ts";

const placeholders: Map<string, string> = new Map([
	["@user", "alice"],
	["@role", "admin"],
	["@status", "active"],
	["@@email", "alice@example.com"],
	["@site", "Webbase"],
	["@@phone", "+123456789"],
	["@@session", ""],
	["@@@token", "jwt-token-987654"],
	["@@@lastLogin", "2024-06-19T10:00:00Z"],
	["@numbers", "1,2,3,4,5,6,7,8,9,0"],
	["@string", "Hello ' World"],
	["@string2", "Hello \" World"],
]);

const examples = [
	{ phrase: `select * from users {where [session = '@string2'] and [status = '@status']}`, parsedPhrase: `select * from users where session = 'Hello " World' and status = 'active'` },
	{ phrase: `select * from users {where [session = "@string2"] and [status = '@status']}`, parsedPhrase: `select * from users where session = "Hello "" World" and status = 'active'` },
	{ phrase: `I will {[@go]; go! [@site]}`, parsedPhrase: `I will ; go! Webbase` },
	{ phrase: `[ @@session ], foo`, parsedPhrase: `, foo` },
	{ phrase: `well? [ hello @@session ], foo`, parsedPhrase: `well? , foo` },
	{ phrase: `Hello [[\\@@user]], welcome to @site!`, parsedPhrase: `Hello [@alice], welcome to Webbase!` },
	{ phrase: `Hello @user, welcome to @site!`, parsedPhrase: `Hello alice, welcome to Webbase!` },
	{ phrase: `Hello \\@@user, welcome to @site!`, parsedPhrase: `Hello @alice, welcome to Webbase!` },
	{ phrase: `Hello [ @@session ]`, parsedPhrase: `Hello ` },
	{ phrase: `{Hello [ @@session ]}, foo`, parsedPhrase: `, foo` },
	{ phrase: `{[@user] Hello [ @@session ]}, foo`, parsedPhrase: `alice Hello , foo` },
	{ phrase: `Hello { [@foo] and [ @@session ]     \n     }`, parsedPhrase: `Hello ` },
	{ phrase: `[number in ('@numbers'...)] and`, parsedPhrase: `number in ('1','2','3','4','5','6','7','8','9','0') and` },
	{ phrase: `[number in ("@numbers"...)] and`, parsedPhrase: `number in ("1","2","3","4","5","6","7","8","9","0") and` },
	{ phrase: `Hello [ @@session ]`, parsedPhrase: `Hello ` },
	{ phrase: `'@string'`, parsedPhrase: `'Hello '' World'` },
	{ phrase: `select * from users where [session = '@session'] and role = '@role'`, parsedPhrase: `select * from users where  role = 'admin'` },
	{ phrase: `I will [@go]; go!`, parsedPhrase: `I will ; go!` },
	{ phrase: `I will {[@go]; go!}`, parsedPhrase: `I will ` },
	{ phrase: `($tree:=function($node){{"_id":_id,"slug":$node.slug.en?$node.slug.en:"","type":$node.subtype?$node.subtype:$node.type,"name":$node.name.en,"children":$node.children?$map($node.children,$tree):[]}};$tree($))`, parsedPhrase: `($tree:=function($node){{"_id":_id,"slug":$node.slug.en?$node.slug.en:"","type":$node.subtype?$node.subtype:$node.type,"name":$node.name.en,"children":$node.children?$map($node.children,$tree):[]}};$tree($))` },
	{ phrase: `[]`, parsedPhrase: `[]` },
];

Deno.test("examples", async () => {
	let fails = 0;

	let log = `wbpl test failures: ${new Date().toISOString()}\n\nPlaceholders:\n`;
	for (const [key, value] of placeholders)
		log += `\t${key}: ${value || "EMPTY"}\n`;
	log += "\nFailures:\n";

	for (const [_i, ex] of examples.entries()) {
		const actual = wbpl(ex.phrase, placeholders);
		if (actual != ex.parsedPhrase) {
			++fails;
			log += `Phrase:   "${ex.phrase}"\nExpected: "${ex.parsedPhrase}"\nActual:   "${actual}"\n\n`;
		}
	}
	await Deno.writeTextFile("./tests/wbpl.test.log", log + (fails ? "" : "All tests passed!\n"));
	assertEquals(fails, 0, `${fails} test(s) failed!`);
});
