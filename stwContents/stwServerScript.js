/**
 * @fileoverview Defines the server-script content element.
 *
 * Executes JavaScript stored in content layouts against datasource records
 * with restricted filesystem and datasource helper APIs.
 *
 * @author Giancarlo
 * @version 1.0.0
 * @module stwServerScript
 * @requires node:path
 * @license GPL-3.0-or-later
 */
import { STWContent } from "../stwElements/stwContent.js";
import { STWDatasources } from "../stwComponents/stwDatasources.js";
import { WBPL } from "../stwComponents/stwWBPL.js";
import * as path from "node:path";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";

class SafeFileSystem {
	allowedRoots;

	constructor(allowedRoots = ["public"]) {
		this.allowedRoots = allowedRoots.map((r) => path.resolve(process.cwd(), r));
	}

	/**
    * Validate and resolve a path within allowed roots.
    * Throws if path is outside allowed roots or accesses dot-files/folders.
    */
	validatePath(relPath) {
		const parts = relPath.split(/[/\\]/);
		for (const part of parts) {
			if (part.startsWith(".") && part !== "." && part !== "..") {
				throw new Error(`Access to dot-files and dot-folders is forbidden: \${relPath}`);
			}
		}
		for (const root of this.allowedRoots) {
			const resolved = path.resolve(root, relPath);
			const normalized = path.normalize(resolved);
			const rel = path.relative(root, normalized);
			if (rel === "" || !rel.startsWith("..")) {
				return normalized;
			}
		}
		throw new Error(`Path outside allowed roots: \${relPath}`);
	}

	/**
    * Read text file content.
    */
	async readText(relPath) {
		const fullPath = this.validatePath(relPath);
		return await readFile(fullPath, "utf8");
	}

	/**
    * Write text file content. Creates parent directories as needed.
    */
	async writeText(relPath, content) {
		const fullPath = this.validatePath(relPath);
		await mkdir(path.dirname(fullPath), { recursive: true });
		await writeFile(fullPath, content);
	}

	/**
    * Read JSON file and parse.
    */
	async readJSON(relPath) {
		const text = await this.readText(relPath);
		return JSON.parse(text);
	}

	/**
    * Write JSON file with pretty formatting.
    */
	async writeJSON(relPath, data) {
		await this.writeText(relPath, JSON.stringify(data, null, 2));
	}

	/**
    * Check if file or directory exists.
    */
	async exists(relPath) {
		try {
			const fullPath = this.validatePath(relPath);
			await stat(fullPath);
			return true;
		} catch {
			return false;
		}
	}

	/**
    * List directory contents. Returns array of { name, isFile, isDirectory }.
    */
	async listDir(relPath) {
		const fullPath = this.validatePath(relPath);
		const entries = [];
		for (const entry of await readdir(fullPath, { withFileTypes: true })) {
			if (entry.name.startsWith(".")) continue;
			entries.push({
				name: entry.name,
				isFile: entry.isFile(),
				isDirectory: entry.isDirectory()
			});
		}
		return entries;
	}
	/**
    * Delete a file.
    */
	async remove(relPath) {
		const fullPath = this.validatePath(relPath);
		await rm(fullPath);
	}
}

class DatasourceHelper {
	session;
	constructor(session) {
		this.session = session;
	}
	/**
    * Execute a command on a datasource.
    * Returns the ISTWRecords result.
    */
	async execute(dsn, command, params = "") {
		const tempContent = {
			uuid: `temp-\${Date.now()}`,
			dsn,
			command,
			params,
			cache: 0
		};
		return await STWDatasources.command(this.session, tempContent);
	}
	/**
    * Execute a WBPL-processed command.
    * Placeholders in the command will be replaced before execution.
    */
	async executeWBPL(dsn, command, placeholders) {
		const processedCommand = WBPL(command, placeholders);
		return await this.execute(dsn, processedCommand);
	}
}

class STWServerScript extends STWContent {
	constructor(content, settings) {
		super(content, settings);
	}
	/**
    * Override render to execute the server-side script.
    * The script processes the datasource records and can perform side effects.
    */
	async render(req, session, records) {
		const code = this._extractCode(session);
		if (!code) {
			console.warn(`ServerScript \${this.uuid} has no layout.javascript for lang \${session.lang}`);
			return JSON.stringify({ ok: false, error: "No script found" });
		}
		try {
			const fs = new SafeFileSystem(["public", "data"]);
			const datasources = new DatasourceHelper(session);
			const fn = new Function(
				"placeholders",
				"records",
				"fs",
				"datasources",
				'"use strict";\\nreturn (async function() {\\n' + code + "\\n})();"
			);
			const result = await fn(session.placeholders, records, fs, datasources);
			return JSON.stringify({ ok: true, result });
		} catch (error) {
			console.error(`ServerScript \${this.uuid} execution error:`, error);
			return JSON.stringify({
				ok: false,
				error: {
					name: error?.name ?? "Error",
					message: error?.message ?? String(error),
					stack: error?.stack
				}
			});
		}
	}
	
	/**
    * Extract JavaScript code from the layout for the current session language.
    * For ServerScript, layout is stored as raw javascript, not parsed as WBLL.
    */
	_extractCode(session) {
		const layoutWrapper = this.layout?.get(session.lang);
		if (!layoutWrapper) return null;
		return layoutWrapper.wbll || null;
	}
	/**
    * Override serve to set proper contentType for JSON responses.
    */
	async serve(req, session, ref) {
		this.contentType = "application/json; charset=utf-8";
		return super.serve(req, session, ref);
	}
}

export {
	STWServerScript as default
};
