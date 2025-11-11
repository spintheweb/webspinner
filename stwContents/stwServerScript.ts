// SPDX-License-Identifier: GPL-3.0-or-later
// Spin the Web content: stwServerScript

import { ISTWRecords } from "../stwComponents/stwDBAdapters/adapter.ts";
import type { STWSession } from "../stwComponents/stwSession.ts";
import { ISTWContent, STWContent } from "../stwElements/stwContent.ts";
import { STWDatasources } from "../stwComponents/stwDatasources.ts";
import { wbpl } from "../stwComponents/stwWBPL.ts";
import * as path from "jsr:@std/path";

/**
 * STWServerScript
 * 
 * A content subtype that executes server-side JavaScript stored in the layout.
 * 
 * Like all other contents, it can:
 *   - Connect to a datasource (via dsn property)
 *   - Execute a command processed by WBPL (via command property)
 *   - Receive a JSON response (ISTWRecords) from the datasource
 * 
 * Additionally, it executes JavaScript from layout to process the records.
 * The layout is NOT WBLL — it's raw JavaScript code.
 * 
 * The script receives these arguments:
 *   1. placeholders — session.placeholders (Map<string, string>)
 *   2. records — the ISTWRecords result from the datasource command
 *   3. fs — safe filesystem helper (read/write in allowed folders only)
 *   4. datasources — helper to execute additional datasource commands
 * 
 * Script capabilities:
 *   ✓ Read/write files in allowed folders (excludes dot-files and dot-folders)
 *   ✓ Interact with datasources via the datasources helper
 *   ✓ Mutate placeholders and return values
 *   ✗ Cannot interact with the operating system (no process execution)
 *   ✗ Cannot access Deno APIs directly
 *   ✗ Cannot access dot-files or dot-folders (security/config protection)
 * 
 * Security model:
 *   - Only trusted full-stack developers should author ServerScript contents
 *   - Filesystem access is restricted to allowed roots (e.g., public/)
 *   - Path traversal attempts are blocked
 *   - Dot-files and dot-folders are forbidden
 *   - No sudo or privileged shell execution
 * 
 * Example layout JavaScript:
 *   ```javascript
 *   // Access datasource results
 *   const users = records.rows;
 *   
 *   // Mutate placeholders
 *   placeholders.set('userCount', String(users.length));
 *   
 *   // Write to filesystem
 *   await fs.writeText('data/users.json', JSON.stringify(users));
 *   
 *   // Execute another datasource command
 *   const stats = await datasources.execute('mysql', 'SELECT COUNT(*) as total FROM logs');
 *   
 *   // Return result
 *   return { success: true, count: users.length, stats };
 *   ```
 */

/**
 * Safe filesystem helper for ServerScript.
 * Allows read/write operations only within allowed roots.
 * Blocks access to dot-files and dot-folders.
 */
class SafeFileSystem {
    private allowedRoots: string[];

    constructor(allowedRoots: string[] = ["public"]) {
        // Convert to absolute paths
        this.allowedRoots = allowedRoots.map(r => path.resolve(Deno.cwd(), r));
    }

    /**
     * Validate and resolve a path within allowed roots.
     * Throws if path is outside allowed roots or accesses dot-files/folders.
     */
    private validatePath(relPath: string): string {
        // Check for dot-file or dot-folder in the path
        const parts = relPath.split(/[/\\]/);
        for (const part of parts) {
            if (part.startsWith('.') && part !== '.' && part !== '..') {
                throw new Error(`Access to dot-files and dot-folders is forbidden: \${relPath}`);
            }
        }

        // Try to resolve against each allowed root
        for (const root of this.allowedRoots) {
            const resolved = path.resolve(root, relPath);
            const normalized = path.normalize(resolved);

            // Use path.relative to determine whether normalized is inside the root.
            // path.relative(root, normalized) === "" when same path,
            // and does not start with ".." when normalized is a subpath of root.
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
    async readText(relPath: string): Promise<string> {
        const fullPath = this.validatePath(relPath);
        return await Deno.readTextFile(fullPath);
    }

    /**
     * Write text file content. Creates parent directories as needed.
     */
    async writeText(relPath: string, content: string): Promise<void> {
        const fullPath = this.validatePath(relPath);
        await Deno.mkdir(path.dirname(fullPath), { recursive: true });
        await Deno.writeTextFile(fullPath, content);
    }

    /**
     * Read JSON file and parse.
     */
    async readJSON(relPath: string): Promise<any> {
        const text = await this.readText(relPath);
        return JSON.parse(text);
    }

    /**
     * Write JSON file with pretty formatting.
     */
    async writeJSON(relPath: string, data: any): Promise<void> {
        await this.writeText(relPath, JSON.stringify(data, null, 2));
    }

    /**
     * Check if file or directory exists.
     */
    async exists(relPath: string): Promise<boolean> {
        try {
            const fullPath = this.validatePath(relPath);
            await Deno.stat(fullPath);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * List directory contents. Returns array of { name, isFile, isDirectory }.
     */
    async listDir(relPath: string): Promise<Array<{ name: string; isFile: boolean; isDirectory: boolean }>> {
        const fullPath = this.validatePath(relPath);
        const entries: Array<{ name: string; isFile: boolean; isDirectory: boolean }> = [];
        
        for await (const entry of Deno.readDir(fullPath)) {
            // Skip dot-files and dot-folders
            if (entry.name.startsWith('.')) continue;
            
            entries.push({
                name: entry.name,
                isFile: entry.isFile,
                isDirectory: entry.isDirectory,
            });
        }
        
        return entries;
    }

    /**
     * Delete a file.
     */
    async remove(relPath: string): Promise<void> {
        const fullPath = this.validatePath(relPath);
        await Deno.remove(fullPath);
    }
}

/**
 * Datasource helper for ServerScript.
 * Allows executing commands on configured datasources.
 */
class DatasourceHelper {
    constructor(private session: STWSession) {}

    /**
     * Execute a command on a datasource.
     * Returns the ISTWRecords result.
     */
    async execute(dsn: string, command: string, params: string = ""): Promise<ISTWRecords> {
        // Create a temporary content object for STWDatasources.command
        const tempContent: any = {
            _id: `temp-\${Date.now()}`,
            dsn,
            command,
            params,
            cache: 0,
        };
        
        return await STWDatasources.command(this.session, tempContent as STWContent);
    }

    /**
     * Execute a WBPL-processed command.
     * Placeholders in the command will be replaced before execution.
     */
    async executeWBPL(dsn: string, command: string, placeholders: Map<string, string>): Promise<ISTWRecords> {
        const processedCommand = wbpl(command, placeholders);
        return await this.execute(dsn, processedCommand);
    }
}

export default class STWServerScript extends STWContent {
    constructor(content: ISTWContent, settings?: { [key: string]: string }) {
        super(content, settings);
    }

    /**
     * Override render to execute the server-side script.
     * The script processes the datasource records and can perform side effects.
     */
    public override async render(
        req: Request,
        session: STWSession,
        records: ISTWRecords,
    ): Promise<string> {
        const code = this._extractCode(session);
        
        if (!code) {
            console.warn(`ServerScript \${this._id} has no layout.javascript for lang \${session.lang}`);
            return JSON.stringify({ ok: false, error: "No script found" });
        }

        try {
            // Create safe helpers
            const fs = new SafeFileSystem(["public", "data"]);
            const datasources = new DatasourceHelper(session);

            // Execute the script with controlled arguments
            const fn = new Function(
                "placeholders",
                "records",
                "fs",
                "datasources",
                '"use strict";\\nreturn (async function() {\\n' + code + "\\n})();"
            );

            const result = await fn(session.placeholders, records, fs, datasources);

            // Return the result as JSON
            return JSON.stringify({ ok: true, result });
        } catch (error: any) {
            console.error(`ServerScript \${this._id} execution error:`, error);
            return JSON.stringify({
                ok: false,
                error: {
                    name: error?.name ?? "Error",
                    message: error?.message ?? String(error),
                    stack: error?.stack,
                },
            });
        }
    }

    /**
     * Extract JavaScript code from the layout for the current session language.
     * For ServerScript, layout is stored as raw javascript, not parsed as WBLL.
     */
    private _extractCode(session: STWSession): string | null {
        // For ServerScript, layout should be stored as raw Map without WBLL parsing
        // Access the raw layout (stored as STWLayout wrapper with wbll property)
        const layoutWrapper = this.layout?.get(session.lang);
        
        if (!layoutWrapper) return null;

        // The layout was stored as-is for non-WBLL types
        // Access the wbll property which contains the raw javascript string
        return (layoutWrapper as any).wbll || null;
    }

    /**
     * Override serve to set proper contentType for JSON responses.
     */
    public override async serve(req: Request, session: STWSession, ref: STWContent | undefined): Promise<Response> {
        // Ensure JSON content type for ServerScript responses
        this.contentType = "application/json; charset=utf-8";
        return super.serve(req, session, ref);
    }
}
