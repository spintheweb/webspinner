// SPDX-License-Identifier: GPL-3.0-or-later
// Spin the Web component: stwSecurity

import { STWSession } from "./stwSession.ts";
import { envGet } from "./stwConfig.ts";
import { dirname } from "@std/path";
import { STWElement } from "../stwElements/stwElement.ts";
import { STWIndex } from "../stwElements/stwIndex.ts";

interface ISTWUser {
	user: string;
	name?: string;
	password?: string; // Stored as `salt:hash`
	roles: string;
	email: string;
}
export type STWUserSummary = Pick<ISTWUser, "user" | "name" | "roles" | "email">;

const mandatoryRoles = ["root", "administrators", "guests", "users", "developers", "translators", "seo"];

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
	async listUsers(): Promise<STWUserSummary[]> {
		return (await this.readUsers()).map(({ user, name, roles, email }) => ({ user, name, roles, email }));
	}

	async createUser(user: string, name: string, password: string, roles: string[], email: string): Promise<void> {
		const users = await this.readUsers();
		if (users.some((person) => person.user === user)) throw new Error("User already exists");
		users.push({ user, name, password: await this.hashPassword(password), roles: roles.join(","), email });
		await this.writeUsers(users);
	}

	async updateUser(
		user: string,
		patch: { name?: string; email?: string; password?: string; roles?: string[] },
	): Promise<void> {
		const users = await this.readUsers();
		const person = users.find((entry) => entry.user === user);
		if (!person) throw new Error("User not found");
		if (patch.name !== undefined) person.name = patch.name;
		if (patch.email !== undefined) person.email = patch.email;
		if (patch.password !== undefined) person.password = await this.hashPassword(patch.password);
		if (patch.roles !== undefined) person.roles = patch.roles.join(",");
		await this.writeUsers(users);
	}

	async deleteUser(user: string): Promise<void> {
		const users = await this.readUsers();
		const index = users.findIndex((person) => person.user === user);
		if (index < 0) throw new Error("User not found");
		users.splice(index, 1);
		await this.writeUsers(users);
	}

	async listRoles(): Promise<string[]> {
		const roles = new Set(mandatoryRoles);
		for (const role of await this.readRoles()) roles.add(role);
		for (const user of await this.readUsers()) {
			for (const role of user.roles.split(",").map((entry) => entry.trim()).filter(Boolean)) roles.add(role);
		}
		for (const element of STWIndex.values()) {
			if (element instanceof STWElement) {
				for (const role of element.visibility.keys()) roles.add(role);
			}
		}
		return [...roles].sort();
	}

	async createRole(role: string): Promise<void> {
		this.validateRole(role);
		const roles = await this.readRoles();
		if ((await this.listRoles()).includes(role)) throw new Error("Role already exists");
		roles.push(role);
		await this.writeRoles(roles);
	}

	async renameRole(role: string, newRole: string): Promise<void> {
		this.validateRole(newRole);
		if (mandatoryRoles.includes(role)) throw new Error("Mandatory roles cannot be renamed");
		if (!(await this.listRoles()).includes(role)) throw new Error("Role not found");
		if ((await this.listRoles()).includes(newRole)) throw new Error("Role already exists");
		const roles = await this.readRoles();
		const index = roles.indexOf(role);
		if (index >= 0) roles[index] = newRole;
		const users = await this.readUsers();
		for (const user of users) {
			user.roles = user.roles.split(",").map((entry) => entry.trim() === role ? newRole : entry.trim()).filter(
				Boolean,
			).join(",");
		}
		await this.writeRoleUserState(roles, users);
	}

	async deleteRole(role: string): Promise<void> {
		if (mandatoryRoles.includes(role)) throw new Error("Mandatory roles cannot be deleted");
		if (!(await this.listRoles()).includes(role)) throw new Error("Role not found");
		const roles = (await this.readRoles()).filter((entry) => entry !== role);
		const users = await this.readUsers();
		for (const user of users) {
			user.roles = user.roles.split(",").map((entry) => entry.trim()).filter((entry) => entry && entry !== role)
				.join(",");
		}
		await this.writeRoleUserState(roles, users);
	}

	async isKnownRole(role: string): Promise<boolean> {
		return (await this.listRoles()).includes(role);
	}

	private async readUsers(): Promise<ISTWUser[]> {
		const path = envGet("USERS") || "./.data/users.json";
		try {
			const users: unknown = JSON.parse(await Deno.readTextFile(path));
			if (!Array.isArray(users)) throw new TypeError("Users file must contain a JSON array");
			return users as ISTWUser[];
		} catch (error) {
			if (error instanceof Deno.errors.NotFound) return [];
			throw error;
		}
	}

	private async writeUsers(users: ISTWUser[]): Promise<void> {
		const path = envGet("USERS") || "./.data/users.json";
		await Deno.mkdir(dirname(path), { recursive: true });
		await Deno.writeTextFile(path, JSON.stringify(users, null, 2));
	}

	private async readRoles(): Promise<string[]> {
		const path = envGet("ROLES") || "./.data/roles.json";
		try {
			const roles: unknown = JSON.parse(await Deno.readTextFile(path));
			if (!Array.isArray(roles) || !roles.every((role) => typeof role === "string")) {
				throw new TypeError("Roles file must contain an array of role names");
			}
			return roles;
		} catch (error) {
			if (error instanceof Deno.errors.NotFound) return [];
			throw error;
		}
	}

	private async writeRoles(roles: string[]): Promise<void> {
		const path = envGet("ROLES") || "./.data/roles.json";
		await Deno.mkdir(dirname(path), { recursive: true });
		await Deno.writeTextFile(path, JSON.stringify(roles, null, 2));
	}

	private async writeRoleUserState(roles: string[], users: ISTWUser[]): Promise<void> {
		const rolesPath = envGet("ROLES") || "./.data/roles.json";
		const usersPath = envGet("USERS") || "./.data/users.json";
		if (rolesPath === usersPath) throw new TypeError("ROLES and USERS must use different files");
		const previousRoles = await this.readOptionalFile(rolesPath);
		const previousUsers = await this.readOptionalFile(usersPath);
		try {
			await this.writeRoles(roles);
			await this.writeUsers(users);
		} catch (error) {
			const restoreErrors: unknown[] = [];
			for (const [path, contents] of [[rolesPath, previousRoles], [usersPath, previousUsers]] as const) {
				try {
					if (contents === null) {
						await Deno.remove(path);
					} else {
						await Deno.writeTextFile(path, contents);
					}
				} catch (restoreError) {
					if (!(contents === null && restoreError instanceof Deno.errors.NotFound)) {
						restoreErrors.push(restoreError);
					}
				}
			}
			if (restoreErrors.length > 0) {
				throw new AggregateError(
					[error, ...restoreErrors],
					"Role update failed and its previous state could not be fully restored",
				);
			}
			throw error;
		}
	}

	private async readOptionalFile(path: string): Promise<string | null> {
		try {
			return await Deno.readTextFile(path);
		} catch (error) {
			if (error instanceof Deno.errors.NotFound) return null;
			throw error;
		}
	}

	private validateRole(role: string): void {
		if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(role)) throw new TypeError("Invalid role name");
	}

	private async hashPassword(password: string): Promise<string> {
		const salt = crypto.getRandomValues(new Uint8Array(16));
		const keyMaterial = await crypto.subtle.importKey(
			"raw",
			new TextEncoder().encode(password),
			{ name: "PBKDF2" },
			false,
			["deriveBits"],
		);
		const derivedBits = await crypto.subtle.deriveBits(
			{ ...pbkdf2Params, salt: salt.buffer as ArrayBuffer },
			keyMaterial,
			256,
		);
		return `${toHex(salt.buffer)}:${toHex(derivedBits)}`;
	}

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
		const derivedBits = await crypto.subtle.deriveBits(
			{ ...pbkdf2Params, salt: salt.buffer as ArrayBuffer },
			keyMaterial,
			256,
		);

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

	async authenticate(session: STWSession, user: string, password: string): Promise<boolean> {
		if (user === "guest") {
			session.user = "guest";
			session.roles = ["guests"];
			session.name = "guest";
			session.dev = false;
			return true;
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
				const derivedBits = await crypto.subtle.deriveBits(
					{ ...pbkdf2Params, salt: salt.buffer as ArrayBuffer },
					keyMaterial,
					256,
				);

				if (toHex(derivedBits) === hashHex) {
					session.user = person.user;
					session.name = person.name || person.user;
					session.roles = person.roles.split(",").map((role) => role.trim()).filter(Boolean);
					session.dev = session.roles.includes("developers");
					return true;
				}
			}
		}

		session.user = "guest";
		session.roles = ["guests"];
		session.name = "guest";
		session.dev = false;
		session.placeholders.delete("USER");
		session.placeholders.delete("AUTHENTICATED");
		return false;
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
