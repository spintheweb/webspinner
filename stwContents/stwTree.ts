// SPDX-License-Identifier: GPL-3.0-or-later
// Spin the Web module: stwContents/stwTree.ts

import type { STWSession } from "../stwComponents/stwSession.ts";
import { registerElement } from "../stwComponents/stwFactory.ts";
import { STWContent, ISTWContent } from "../stwElements/stwContent.ts";
import { STWLayout } from "../stwComponents/stwWBLL.ts";
import { ISTWRecords } from "../stwComponents/stwDBAdapters/adapter.ts";
import { wbpl } from "../stwComponents/stwWBPL.ts";

export class STWTree extends STWContent {
	public constructor(content: ISTWContent) {
		super(content);
	}

	public override async render(request: Request, session: STWSession, records: ISTWRecords): Promise<string> {
		let layout = this.getLayout(session);

		if (!records.fields?.length || !records.rows?.length) 
			return layout.settings.get("nodata") || "";

		const fields = records.fields.map(f => f.name) || Object.keys(records.rows[0] || {});
		if (!layout.hasTokens) {
			this.layout.set(session.lang, new STWLayout(layout.wbll + "f".repeat(fields.length)));
			layout = this.getLayout(session);
		}

		// Detect data format and convert to hierarchical if needed
		if (!this.isHierarchicalData(records.rows) && !fields.includes(layout.settings.get("key") || "path"))
			throw new Error("In order to construct a tree from flat data, 'key' must be set to a valid field name containing path information&mdash;the path separator must be /.");

		const treeData = this.isHierarchicalData(records.rows) ? records.rows[0] : this.buildTreeFromPaths(records.rows, String(layout.settings.get("key")));

		const renderNode = (node: any, depth: number = 0): string => {
			const placeholders = new Map(session.placeholders);
			Object.entries(node).forEach(([key, value]) => placeholders.set(`@@${key}`, String(value))); // Merge record and session placeholders

			const hasChildren = node.children?.length > 0;
			const toggle = `<span style="display:inline-block;width:${depth}rem"></span>${hasChildren ? `<i class="fa-light fa-angle-down"></i> ` : ""}`;
			const children = hasChildren ? `<ul>${node.children.map((child: any) => renderNode(child, depth + 1)).join("")}</ul>` : "";

			return `<li ${wbpl(layout.groupAttributes, placeholders)}><div ${wbpl(layout.blockAttributes, placeholders)}>${toggle} ${layout?.render(request, session, fields, placeholders)}</div>${children}</li>`;
		};

		let body = "";
		if (treeData)
			body = `<ul>${renderNode(treeData)}</ul>
			<script name="STWTree" onload="fnSTWTree('${this._id}')">
				function fnSTWTree(id) {
					self.document.getElementById(id).addEventListener("click", event => {
						event.stopImmediatePropagation();
						const li = event.target.closest("li");
						if (!li) return;
						const i = li.querySelector("i");
						event.currentTarget.querySelector("div.stwSelected")?.classList.remove("stwSelected");
						li.firstElementChild?.classList.add("stwSelected");
						if (event.target.tagName !== "I") return;
						if (li.querySelector("ul") && i) {
							event.preventDefault();
							li.querySelector("ul").style.display = i.classList.contains("fa-angle-down") ? "none" : "block";
							i.classList.toggle("fa-angle-down");
							i.classList.toggle("fa-angle-right");
						}
					});
				}
			</script>`;

		// Ensure async contract maintained with a microtask await (lint requirement)
		await Promise.resolve();
		return body;
	}

	private isHierarchicalData(rows: any[]): boolean {
		return rows.length > 0 && 'children' in rows[0] && Array.isArray(rows[0].children);
	}

	/**
	 * Build a tree structure from flat data with path indicators /
	 * @param rows - Array of records with path information
	 * @param pathField - Field name containing the path (e.g., "path")
	 */
	private buildTreeFromPaths(rows: any[], pathField: string): any {
		const root = { children: [] as any[] };
		const nodeMap = new Map<string, any>();

		// Sort rows by path to ensure parents are processed before children
		const sortedRows = rows.sort((a, b) => {
			const pathA = a[pathField] || '';
			const pathB = b[pathField] || '';
			return pathA.localeCompare(pathB);
		});

		for (const row of sortedRows) {
			const path = row[pathField];
			if (!path) continue;

			const parts = path.split("/").filter((part: string) => part.trim() !== '');
			let currentNode = root;
			let currentPath = '';

			for (let i = 0; i < parts.length; i++) {
				const part = parts[i];
				currentPath += (currentPath ? "/" : '') + part;

				// Check if this node already exists
				let existingNode = nodeMap.get(currentPath);
				if (!existingNode) {
					// Create new node
					existingNode = {
						name: part, // Set the node name to the current path part
						path: currentPath,
						children: []
					};

					// If this is a leaf node (last part), merge all row data
					if (i === parts.length - 1) {
						Object.assign(existingNode, row);
						existingNode.name = part; // Preserve the name
						existingNode.path = currentPath; // Preserve the path
					}

					nodeMap.set(currentPath, existingNode);
					currentNode.children.push(existingNode);
				}

				currentNode = existingNode;
			}
		}

		// Return the first child if there's only one root, otherwise return root with all children
		return root.children.length === 1 ? root.children[0] : root;
	}
}

registerElement("Tree", STWTree);