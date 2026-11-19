/**
 * @fileoverview Manages file-backed users, roles, password credentials, and
 * session authentication.
 *
 * User records are stored in the JSON file configured by USERS (or
 * `.data/users.json`). Passwords are never stored in plaintext: each value has
 * the format `saltHex:hashHex`, where the hash is a 256-bit PBKDF2-SHA-256
 * derivation using 100,000 iterations and a new random 128-bit salt. Roles are
 * stored separately in the JSON file configured by ROLES (or
 * `.data/roles.json`), in addition to the mandatory built-in roles.
 *
 * Authentication assigns a session's user, name, roles, and development mode.
 * The ALLOW_DEV and ALLOW_ROOT settings may remove the corresponding roles from
 * an otherwise valid authenticated session.
 *
 * @author Giancarlo Trevisan
 * @version 1.0.0
 * @module stwSecurity
 * @note Copilot-assisted
 * @license Apache-2.0
 */
import { envGet } from "./stwConfig.js";
import { dirname } from "node:path";
import { readFileSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { isNotFoundError } from "./stwNode.js";
import { STWElement } from "../stwElements/stwElement.js";
import { STWIndex } from "../stwElements/stwIndex.js";

const mandatoryRoles = ["root", "administrator", "guest", "user", "developer", "leaddeveloper", "seo"];
const roleImplications = new Map([
	["root", ["user"]],
	["administrator", ["user"]],
	["developer", ["user"]],
	["seo", ["user"]],
	["leaddeveloper", ["developer", "seo"]]
]);
const developmentRoles = new Set(["developer", "leaddeveloper", "seo"]);
const guestLogin = { user: "guest", name: "Guest", id: "-3" };

/**
 * Resolves all roles implied by direct role assignments.
 *
 * @param {string[]} roles Directly assigned roles.
 * @returns {string[]} Effective roles.
 */
function resolveRoles(roles) {
	const effectiveRoles = new Set(roles.filter(Boolean));
	if (effectiveRoles.size === 0) effectiveRoles.add("guest");

	for (const role of effectiveRoles) {
		for (const impliedRole of roleImplications.get(role) ?? []) effectiveRoles.add(impliedRole);
	}

	if (effectiveRoles.size > 1) effectiveRoles.delete("guest");
	return [...effectiveRoles];
}

/**
 * Sets WBPL placeholders describing the session's current login identity.
 *
 * @param {{placeholders: Map<string, string>}} session Current session.
 * @param {{user: string, name: string, id: string|number}} login Login identity.
 * @returns {void}
 */
function setLoginPlaceholders(session, login) {
	session.loginId = login.id;
	session.placeholders.set("@@stwlogin", login.user);
	session.placeholders.set("@@stwloginname", login.name);
	session.placeholders.set("@@stwloginid", login.id.toString());
}

/**
 * Encodes an ArrayBuffer or typed-array view as lowercase hexadecimal.
 *
 * @param {ArrayBuffer|ArrayBufferView} buffer Binary data to encode.
 * @returns {string} Hexadecimal representation.
 */
const toHex = (buffer) => {
	const view = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : new Uint8Array(buffer.buffer);
	return [...view].map((b) => b.toString(16).padStart(2, "0")).join("");
};

/**
 * Decodes a hexadecimal string into bytes.
 *
 * @param {string} hex Hexadecimal text.
 * @returns {Uint8Array} Decoded bytes.
 */
const fromHex = (hex) => {
	const bytes = new Uint8Array(hex.length / 2);
	for (let i = 0; i < hex.length; i += 2) {
		bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
	}
	return bytes;
};
const pbkdf2Params = { name: "PBKDF2", iterations: 1e5, hash: "SHA-256" };

/**
 * Reads a strictly formatted boolean environment setting.
 *
 * @param {string} name Environment-setting name.
 * @returns {boolean} Whether the setting is enabled.
 * @throws {TypeError} If the setting is not `true` or `false`.
 */
function readBooleanSetting(name) {
	const value = envGet(name, "false").trim().toLowerCase();
	if (value !== "true" && value !== "false") {
		throw new TypeError(`${name} must be "true" or "false"`);
	}
	return value === "true";
}
const STWSecurity = new class {
	/**
	 * Lists users without their password verifiers.
	 *
	 * @returns {Promise<Array<{user: string, name: string, roles: string, email: string}>>}
	 * Public user records.
	 */
	async listUsers() {
		return (await this.readUsers()).map(({ user, name, roles, email }) => ({ user, name, roles, email }));
	}

	/**
	 * Creates a user and stores a salted password verifier.
	 *
	 * @param {string} user Login name.
	 * @param {string} name Display name.
	 * @param {string} password Initial plaintext password.
	 * @param {string[]} roles Assigned role names.
	 * @param {string} email Email address.
	 * @returns {Promise<void>}
	 * @throws {TypeError} If the login name is invalid or reserved.
	 * @throws {Error} If the login name already exists.
	 */
	async createUser(user, name, password, roles, email) {
		if (user === "guest" || user === "root") throw new TypeError("User name is reserved");
		const usernamePattern = /^[A-Za-z0-9_.]{4,}$/;
		const emailPattern = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;
		if (typeof user !== "string" || /\s/.test(user) || (!usernamePattern.test(user) && !emailPattern.test(user))) {
			throw new TypeError("User name must be at least four letters, digits, underscores or dots, or an email address");
		}
		const users = await this.readUsers();
		if (users.some((person) => person.user === user)) throw new Error("User already exists");
		users.push({ user, name, password: await this.hashPassword(password), roles: roles.join(","), email });
		await this.writeUsers(users);
	}

	/**
	 * Updates the supplied fields of an existing user. A supplied password is
	 * replaced with a newly salted PBKDF2 verifier.
	 *
	 * @param {string} user Login name.
	 * @param {{name?: string, email?: string, password?: string, roles?: string[]}} patch
	 * User fields to update.
	 * @returns {Promise<void>}
	 * @throws {Error} If the user does not exist.
	 */
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

	/**
	 * Replaces an authenticated user's password after verifying the current one.
	 *
	 * @param {string} user Login name.
	 * @param {string} oldPassword Current plaintext password.
	 * @param {string} newPassword Replacement plaintext password.
	 * @returns {Promise<void>}
	 * @throws {Error} If the user is not authenticated, the account is invalid,
	 * or the current password does not match.
	 */
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

	/**
	 * Removes a user record.
	 *
	 * @param {string} user Login name.
	 * @returns {Promise<void>}
	 * @throws {Error} If the user does not exist.
	 */
	async deleteUser(user) {
		const users = await this.readUsers();
		const index = users.findIndex((person) => person.user === user);
		if (index < 0) throw new Error("User not found");
		users.splice(index, 1);
		await this.writeUsers(users);
	}

	/**
	 * Lists mandatory, configured, assigned, and element-visibility roles.
	 *
	 * @returns {Promise<string[]>} Sorted unique role names.
	 */
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

	/**
	 * Adds a custom role to the roles file.
	 *
	 * @param {string} role Role name beginning with a letter and containing only
	 * letters, digits, underscores, or hyphens.
	 * @returns {Promise<void>}
	 */
	async createRole(role) {
		this.validateRole(role);
		const roles = await this.readRoles();
		if ((await this.listRoles()).includes(role)) throw new Error("Role already exists");
		roles.push(role);
		await this.writeRoles(roles);
	}

	/**
	 * Renames a custom role and updates every user's assigned roles atomically
	 * as far as the two backing files allow.
	 *
	 * @param {string} role Existing role name.
	 * @param {string} newRole Replacement role name.
	 * @returns {Promise<void>}
	 */
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

	/**
	 * Deletes a custom role and removes it from all user records.
	 *
	 * @param {string} role Role name.
	 * @returns {Promise<void>}
	 */
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

	/**
	 * Determines whether a role is known from any configured source.
	 *
	 * @param {string} role Role name.
	 * @returns {Promise<boolean>} Whether the role exists.
	 */
	async isKnownRole(role) {
		return (await this.listRoles()).includes(role);
	}

	/**
	 * Reads the user database. A missing database is treated as an empty one.
	 *
	 * @returns {Promise<Array<object>>} User records, including password
	 * verifiers.
	 */
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

	/**
	 * Persists user records to the configured user database.
	 *
	 * @param {Array<object>} users User records to write.
	 * @returns {Promise<void>}
	 */
	async writeUsers(users) {
		const path = envGet("USERS") || "./.data/users.json";
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, JSON.stringify(users, null, 2));
	}

	/**
	 * Reads explicitly configured custom roles. A missing file is treated as no
	 * custom roles.
	 *
	 * @returns {Promise<string[]>} Custom role names.
	 */
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

	/**
	 * Persists explicitly configured custom roles.
	 *
	 * @param {string[]} roles Custom role names to write.
	 * @returns {Promise<void>}
	 */
	async writeRoles(roles) {
		const path = envGet("ROLES") || "./.data/roles.json";
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, JSON.stringify(roles, null, 2));
	}

	/**
	 * Writes roles and users together, restoring their previous contents if one
	 * of the writes fails.
	 *
	 * @param {string[]} roles Custom role names.
	 * @param {Array<object>} users User records.
	 * @returns {Promise<void>}
	 */
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

	/**
	 * Validates the portable role-name syntax used in persisted role data.
	 *
	 * @param {string} role Role name.
	 * @returns {void}
	 * @throws {TypeError} If the role name is invalid.
	 */
	validateRole(role) {
		if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(role)) throw new TypeError("Invalid role name");
	}

	/**
	 * Creates a fresh password verifier in the persisted `saltHex:hashHex`
	 * format.
	 *
	 * @param {string} password Plaintext password to derive.
	 * @returns {Promise<string>} Salt and PBKDF2-SHA-256 verifier.
	 */
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
	/**
	 * Authenticates a user and updates the supplied session. The `guest` user is
	 * always accepted without a password. Failed authentication resets the
	 * session to guest and removes authentication placeholders.
	 *
	 * @param {object} session Mutable session with user, name, roles, dev, and
	 * placeholders properties.
	 * @param {string} user Submitted login name.
	 * @param {string} password Submitted plaintext password.
	 * @returns {Promise<boolean>} Whether authentication succeeded.
	 */
	async authenticate(session, user, password) {
		const allowDev = readBooleanSetting("ALLOW_DEV");
		const allowRoot = readBooleanSetting("ALLOW_ROOT");
		if (user === "guest") {
			session.user = "guest";
			session.roles = ["guest"];
			session.name = guestLogin.name;
			session.dev = false;
			setLoginPlaceholders(session, guestLogin);
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
					session.roles = resolveRoles(person.roles?.split(",").map((role) => role.trim()) ?? [])
						.filter((role) => allowDev || !developmentRoles.has(role))
						.filter((role) => allowRoot || role !== "root");
					session.dev = session.roles.includes("developer");
					setLoginPlaceholders(session, {
						user: person.user,
						name: person.name || person.user,
						id: person.id ?? ""
					});
					return true;
				}
			}
		}
		session.user = "guest";
		session.roles = ["guest"];
		session.name = guestLogin.name;
		session.dev = false;
		setLoginPlaceholders(session, guestLogin);
		return false;
	}

}();

export {
	STWSecurity
};
