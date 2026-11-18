/**
 * @fileoverview Defines the tree content element.
 *
 * Converts hierarchical or path-based connector records into a localized
 * tree rendered through the configured WBLL layout.
 *
 * @author Giancarlo
 * @version 1.0.0
 * @module stwTree
 * @license GPL-3.0-or-later
 */
import { registerElement } from "../stwComponents/stwFactory.js";
import { STWContent } from "../stwElements/stwContent.js";

class STWTree extends STWContent {
	constructor(content) {
		super(content);
	}

	async render(_request, session, records) {
		if (!records.fields?.length || !records.rows?.length)
			return "";

		const fields = records.fields;
		const layout = this.getLayout(session, "f".repeat(fields.length));
		const initialPlaceholders = new Map(session.placeholders);
		initialPlaceholders.set("@@stwOrigin", this.uuid);
		for (const [key, value] of Object.entries(records.rows[0]))
			if (value === null || typeof value !== "object")
				initialPlaceholders.set(`@@${key}`, String(value ?? ""));
		const { settings } = await layout.render(fields, initialPlaceholders, session, "", this.uuid);
		const pathField = String(settings.get("key") || "path");
		if (!this.isHierarchicalData(records.rows) && !fields.includes(pathField))
			throw new Error("In order to construct a tree from flat data, 'key' must be set to a valid field name containing path information&mdash;the path separator must be /.");
		const treeData = this.isHierarchicalData(records.rows) ? records.rows[0] : this.buildTreeFromPaths(records.rows, pathField);
		const renderNode = async (node, depth = 0) => {
			const placeholders = new Map(session.placeholders);
			placeholders.set("@@stwOrigin", this.uuid);
			for (const [key, value] of Object.entries(node))
				if (value === null || typeof value !== "object")
					placeholders.set(`@@${key}`, String(value ?? ""));
			const hasChildren = node.children?.length > 0;
			const toggle = `<span style="display:inline-block;width:${depth}rem"></span>${hasChildren ? `<i class="fa-light fa-angle-down"></i> ` : ""}`;
			const html = (await layout.render(fields, placeholders, session, "", this.uuid)).HTML;
			let children = "";
			if (hasChildren) {
				for (const child of node.children) children += await renderNode(child, depth + 1);
				children = `<ul>${children}</ul>`;
			}
			return `<li><div>${toggle} ${html}</div>${children}</li>`;
		};
		let body = "";
		if (treeData)
			body = `<ul>${await renderNode(treeData)}</ul>
<script name="STWTree" onload="fnSTWTree('${this.uuid}')">
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
<\/script>`;
		return body;
	}

	isHierarchicalData(rows) {
		return rows.length > 0 && "children" in rows[0] && Array.isArray(rows[0].children);
	}

	/**
    * Build a tree structure from flat data with path indicators /
    * @param rows - Array of records with path information
    * @param pathField - Field name containing the path (e.g., "path")
    */
	buildTreeFromPaths(rows, pathField) {
		const root = { children: [] };
		const nodeMap = new Map();
		const sortedRows = rows.sort((a, b) => {
			const pathA = a[pathField] || "";
			const pathB = b[pathField] || "";
			return pathA.localeCompare(pathB);
		});
		for (const row of sortedRows) {
			const path = row[pathField];
			if (!path) continue;
			const parts = path.split("/").filter((part) => part.trim() !== "");
			let currentNode = root;
			let currentPath = "";
			for (let i = 0; i < parts.length; i++) {
				const part = parts[i];
				currentPath += (currentPath ? "/" : "") + part;
				let existingNode = nodeMap.get(currentPath);
				if (!existingNode) {
					existingNode = {
						name: part,
						// Set the node name to the current path part
						path: currentPath,
						children: []
					};
					if (i === parts.length - 1) {
						Object.assign(existingNode, row);
						existingNode.name = part;
						existingNode.path = currentPath;
					}
					nodeMap.set(currentPath, existingNode);
					currentNode.children.push(existingNode);
				}
				currentNode = existingNode;
			}
		}
		return root.children.length === 1 ? root.children[0] : root;
	}
}

registerElement("Tree", STWTree);

export {
	STWTree
};
