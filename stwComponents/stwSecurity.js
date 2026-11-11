import { envGet } from "./stwConfig.js";
import { dirname } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { isNotFoundError } from "./stwNode.js";
import { STWElement } from "../stwElements/stwElement.js";
import { STWIndex } from "../stwElements/stwIndex.js";
const mandatoryRoles = ["root", "administrators", "guests", "users", "developers", "translators", "seo"];
const toHex = (buffer) => {
	const view = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : new Uint8Array(buffer.buffer);
	return [...view].map((b) => b.toString(16).padStart(2, "0")).join("");
};
const fromHex = (hex) => {
	const bytes = new Uint8Array(hex.length / 2);
	for (let i = 0; i < hex.length; i += 2) {
		bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
	}
	return bytes;
};
const pbkdf2Params = { name: "PBKDF2", iterations: 1e5, hash: "SHA-256" };
const STWSecurity = new class {
	async listUsers() {
		return (await this.readUsers()).map(({ user, name, roles, email }) => ({ user, name, roles, email }));
	}
	async createUser(user, name, password, roles, email) {
		const users = await this.readUsers();
		if (users.some((person) => person.user === user)) throw new Error("User already exists");
		users.push({ user, name, password: await this.hashPassword(password), roles: roles.join(","), email });
		await this.writeUsers(users);
	}
	async updateUser(user, patch) {
		const users = await this.readUsers();
		const person = users.find((entry) => entry.user === user);
		if (!person) throw new Error("User not found");
		if (patch.name !== void 0) person.name = patch.name;
		if (patch.email !== void 0) person.email = patch.email;
		if (patch.password !== void 0) person.password = await this.hashPassword(patch.password);
		if (patch.roles !== void 0) person.roles = patch.roles.join(",");
		await this.writeUsers(users);
	}
	async changePassword(user, oldPassword, newPassword) {
		if (!user || user === "guest") throw new Error("You must be logged in to change your password");
		const users = await this.readUsers();
		const person = users.find((entry) => entry.user === user);
		if (!person?.password) throw new Error("User not found");
		const [saltHex, hashHex] = person.password.split(":");
		if (!saltHex || !hashHex) throw new Error("Stored password is invalid");
		const salt = fromHex(saltHex);
		const keyMaterial = await crypto.subtle.importKey(
			"raw",
			new TextEncoder().encode(oldPassword),
			{ name: "PBKDF2" },
			false,
			["deriveBits"]
		);
		const derivedBits = await crypto.subtle.deriveBits(
			{ ...pbkdf2Params, salt: salt.buffer },
			keyMaterial,
			256
		);
		if (toHex(derivedBits) !== hashHex) throw new Error("Current password is incorrect");
		person.password = await this.hashPassword(newPassword);
		await this.writeUsers(users);
	}
	async deleteUser(user) {
		const users = await this.readUsers();
		const index = users.findIndex((person) => person.user === user);
		if (index < 0) throw new Error("User not found");
		users.splice(index, 1);
		await this.writeUsers(users);
	}
	async listRoles() {
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
	async createRole(role) {
		this.validateRole(role);
		const roles = await this.readRoles();
		if ((await this.listRoles()).includes(role)) throw new Error("Role already exists");
		roles.push(role);
		await this.writeRoles(roles);
	}
	async renameRole(role, newRole) {
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
				Boolean
			).join(",");
		}
		await this.writeRoleUserState(roles, users);
	}
	async deleteRole(role) {
		if (mandatoryRoles.includes(role)) throw new Error("Mandatory roles cannot be deleted");
		if (!(await this.listRoles()).includes(role)) throw new Error("Role not found");
		const roles = (await this.readRoles()).filter((entry) => entry !== role);
		const users = await this.readUsers();
		for (const user of users) {
			user.roles = user.roles.split(",").map((entry) => entry.trim()).filter((entry) => entry && entry !== role).join(",");
		}
		await this.writeRoleUserState(roles, users);
	}
	async isKnownRole(role) {
		return (await this.listRoles()).includes(role);
	}
	async readUsers() {
		const path = envGet("USERS") || "./.data/users.json";
		try {
			const users = JSON.parse(await readFile(path, "utf8"));
			if (!Array.isArray(users)) throw new TypeError("Users file must contain a JSON array");
			return users;
		} catch (error) {
			if (isNotFoundError(error)) return [];
			throw error;
		}
	}
	async writeUsers(users) {
		const path = envGet("USERS") || "./.data/users.json";
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, JSON.stringify(users, null, 2));
	}
	async readRoles() {
		const path = envGet("ROLES") || "./.data/roles.json";
		try {
			const roles = JSON.parse(await readFile(path, "utf8"));
			if (!Array.isArray(roles) || !roles.every((role) => typeof role === "string")) {
				throw new TypeError("Roles file must contain an array of role names");
			}
			return roles;
		} catch (error) {
			if (isNotFoundError(error)) return [];
			throw error;
		}
	}
	async writeRoles(roles) {
		const path = envGet("ROLES") || "./.data/roles.json";
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, JSON.stringify(roles, null, 2));
	}
	async writeRoleUserState(roles, users) {
		const rolesPath = envGet("ROLES") || "./.data/roles.json";
		const usersPath = envGet("USERS") || "./.data/users.json";
		if (rolesPath === usersPath) throw new TypeError("ROLES and USERS must use different files");
		const previousRoles = await this.readOptionalFile(rolesPath);
		const previousUsers = await this.readOptionalFile(usersPath);
		try {
			await this.writeRoles(roles);
			await this.writeUsers(users);
		} catch (error) {
			const restoreErrors = [];
			for (const [path, contents] of [[rolesPath, previousRoles], [usersPath, previousUsers]]) {
				try {
					if (contents === null) {
						await rm(path);
					} else {
						await writeFile(path, contents);
					}
				} catch (restoreError) {
					if (!(contents === null && isNotFoundError(restoreError))) {
						restoreErrors.push(restoreError);
					}
				}
			}
			if (restoreErrors.length > 0) {
				throw new AggregateError(
					[error, ...restoreErrors],
					"Role update failed and its previous state could not be fully restored"
				);
			}
			throw error;
		}
	}
	async readOptionalFile(path) {
		try {
			return await readFile(path, "utf8");
		} catch (error) {
			if (isNotFoundError(error)) return null;
			throw error;
		}
	}
	validateRole(role) {
		if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(role)) throw new TypeError("Invalid role name");
	}
	async hashPassword(password) {
		const salt = crypto.getRandomValues(new Uint8Array(16));
		const keyMaterial = await crypto.subtle.importKey(
			"raw",
			new TextEncoder().encode(password),
			{ name: "PBKDF2" },
			false,
			["deriveBits"]
		);
		const derivedBits = await crypto.subtle.deriveBits(
			{ ...pbkdf2Params, salt: salt.buffer },
			keyMaterial,
			256
		);
		return `${toHex(salt.buffer)}:${toHex(derivedBits)}`;
	}
	async addUser(user, name, password, roles, email) {
		const usersDB = envGet("USERS") || "./.data/users.json";
		const users = JSON.parse(readFileSync(usersDB, "utf8")) || [];
		if (users.find((p) => p.user === user)) {
			throw new Error("User already exists");
		}
		const salt = crypto.getRandomValues(new Uint8Array(16));
		const keyMaterial = await crypto.subtle.importKey(
			"raw",
			new TextEncoder().encode(password),
			{ name: "PBKDF2" },
			false,
			["deriveBits"]
		);
		const derivedBits = await crypto.subtle.deriveBits(
			{ ...pbkdf2Params, salt: salt.buffer },
			keyMaterial,
			256
		);
		const hashedPassword = `${toHex(salt.buffer)}:${toHex(derivedBits)}`;
		users.push({ user, name, password: hashedPassword, roles, email });
		writeFileSync(usersDB, JSON.stringify(users, null, 2));
	}
	removeUser() {
	}
	async addRoles(user, rolesToAdd) {
		const usersDB = envGet("USERS") || "./.data/users.json";
		const users = JSON.parse(await readFile(usersDB, "utf8"));
		const person = users.find((p) => p.user === user);
		if (!person) {
			throw new Error("User not found");
		}
		const existingRoles = new Set(person.roles ? person.roles.split(",") : []);
		const newRoles = rolesToAdd.split(",");
		newRoles.forEach((role) => existingRoles.add(role.trim()));
		person.roles = Array.from(existingRoles).join(",");
		await writeFile(usersDB, JSON.stringify(users, null, 2));
	}
	async removeRoles(user, rolesToRemove) {
		const usersDB = envGet("USERS") || "./.data/users.json";
		const users = JSON.parse(await readFile(usersDB, "utf8"));
		const person = users.find((p) => p.user === user);
		if (!person || !person.roles) {
			return;
		}
		const existingRoles = new Set(person.roles.split(","));
		const toRemove = rolesToRemove.split(",");
		toRemove.forEach((role) => existingRoles.delete(role.trim()));
		person.roles = Array.from(existingRoles).join(",");
		await writeFile(usersDB, JSON.stringify(users, null, 2));
	}
	async authenticate(session, user, password) {
		if (user === "guest") {
			session.user = "guest";
			session.roles = ["guests"];
			session.name = "guest";
			session.dev = false;
			return true;
		}
		const usersDB = envGet("USERS") || "./.data/users.json";
		const users = JSON.parse(readFileSync(usersDB, "utf8"));
		const person = users.find((person2) => person2.user === user);
		if (person?.password) {
			const [saltHex, hashHex] = person.password.split(":");
			if (saltHex && hashHex) {
				const salt = fromHex(saltHex);
				const keyMaterial = await crypto.subtle.importKey(
					"raw",
					new TextEncoder().encode(password),
					{ name: "PBKDF2" },
					false,
					["deriveBits"]
				);
				const derivedBits = await crypto.subtle.deriveBits(
					{ ...pbkdf2Params, salt: salt.buffer },
					keyMaterial,
					256
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
	hasRole(session, role) {
		return session.roles.includes(role);
	}
	lostPassword() {
	}
	changePassword(_session, _user, _oldPassword, _newPassword, _force = false) {
	}
}();
export {
	STWSecurity
};
