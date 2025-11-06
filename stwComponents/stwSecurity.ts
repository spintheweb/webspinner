// SPDX-License-Identifier: GPL-3.0-or-later
// Spin the Web component: stwSecurity

import { STWSession } from "./stwSession.ts";
import { envGet } from "./stwConfig.ts";

interface ISTWUser {
	user: string;
	name?: string;
	password?: string; // Stored as `salt:hash`
	roles: string;
	email: string;
}

// Helper function to convert ArrayBuffer/TypedArray to Hex string
const toHex = (buffer: ArrayBuffer | ArrayBufferView): string => {
	const view = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : new Uint8Array(buffer.buffer);
	return [...view].map((b) => b.toString(16).padStart(2, "0")).join("");
};

// Helper function to convert Hex string to Uint8Array
const fromHex = (hex: string): Uint8Array => {
	const bytes = new Uint8Array(hex.length / 2);
	for (let i = 0; i < hex.length; i += 2) {
		bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
	}
	return bytes;
};

const pbkdf2Params = { name: "PBKDF2", iterations: 100000, hash: "SHA-256" };

export const STWSecurity = new class {
	async addUser(user: string, name: string, password: string, roles: string, email: string): Promise<void> {
		const usersDB = envGet("USERS") || "./.data/users.json";
		const users: ISTWUser[] = JSON.parse(Deno.readTextFileSync(usersDB)) || [];

		if (users.find((p) => p.user === user)) {
			throw new Error("User already exists");
		}

		const salt = crypto.getRandomValues(new Uint8Array(16));
		const keyMaterial = await crypto.subtle.importKey(
			"raw",
			new TextEncoder().encode(password),
			{ name: "PBKDF2" },
			false,
			["deriveBits"],
		);
	const derivedBits = await crypto.subtle.deriveBits({ ...pbkdf2Params, salt: salt.buffer as ArrayBuffer }, keyMaterial, 256);

	const hashedPassword = `${toHex(salt.buffer)}:${toHex(derivedBits)}`;
		users.push({ user, name, password: hashedPassword, roles, email });
		Deno.writeTextFileSync(usersDB, JSON.stringify(users, null, 2));
	}

	removeUser(): void {}

	async addRoles(user: string, rolesToAdd: string): Promise<void> {
		const usersDB = envGet("USERS") || "./.data/users.json";
		const users: ISTWUser[] = JSON.parse(await Deno.readTextFile(usersDB));

		const person = users.find((p) => p.user === user);
		if (!person) {
			throw new Error("User not found");
		}

		const existingRoles = new Set(person.roles ? person.roles.split(",") : []);
		const newRoles = rolesToAdd.split(",");

		newRoles.forEach((role) => existingRoles.add(role.trim()));

		person.roles = Array.from(existingRoles).join(",");
		await Deno.writeTextFile(usersDB, JSON.stringify(users, null, 2));
	}

	async removeRoles(user: string, rolesToRemove: string): Promise<void> {
		const usersDB = envGet("USERS") || "./.data/users.json";
		const users: ISTWUser[] = JSON.parse(await Deno.readTextFile(usersDB));

		const person = users.find((p) => p.user === user);
		if (!person || !person.roles) {
			return; // User not found or has no roles
		}

		const existingRoles = new Set(person.roles.split(","));
		const toRemove = rolesToRemove.split(",");

		toRemove.forEach((role) => existingRoles.delete(role.trim()));

		person.roles = Array.from(existingRoles).join(",");
		await Deno.writeTextFile(usersDB, JSON.stringify(users, null, 2));
	}

	async authenticate(session: STWSession, user: string, password: string): Promise<void> {
		if (user === "guest") {
			session.user = "guest";
			session.roles = ["guests"];
			return;
		}

		const usersDB = envGet("USERS") || "./.data/users.json";
		const users: ISTWUser[] = JSON.parse(Deno.readTextFileSync(usersDB));

		const person = users.find((person) => person.user === user);

		if (person?.password) {
			const [saltHex, hashHex] = person.password.split(":");
			if (saltHex && hashHex) {
				const salt = fromHex(saltHex);
				const keyMaterial = await crypto.subtle.importKey(
					"raw",
					new TextEncoder().encode(password),
					{ name: "PBKDF2" },
					false,
					["deriveBits"],
				);
				const derivedBits = await crypto.subtle.deriveBits({ ...pbkdf2Params, salt: salt.buffer as ArrayBuffer }, keyMaterial, 256);

				if (toHex(derivedBits) === hashHex) {
					session.user = person.user;
					session.roles = person.roles.split(",");
					return;
				}
			}
		}

		session.user = "guest";
		session.roles = ["guests"];
	}

	hasRole(session: STWSession, role: string): boolean {
		return session.roles.includes(role);
	}

	lostPassword(): void {}

	changePassword(
		_session: STWSession,
		_user: string,
		_oldPassword: string,
		_newPassword: string,
		_force: boolean = false,
	): void {}
}();
