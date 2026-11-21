/**
 * @fileoverview Client helpers for Studio panels and user management.
 *
 * @author Copilot
 * @module client
 * @license Apache-2.0
 */
function toggleSidebar(event) {
	const sidebar = document.getElementById(event.target.className.indexOf("flip") === -1 ? "leftPanel" : "rightPanel");
	sidebar.style.display = sidebar.style.display === "none" ? "flex" : "none";
}

const stwUsersUrl = new URL(window.location.href);
if (stwUsersUrl.searchParams.has("manageduser")) {
	stwUsersUrl.searchParams.delete("manageduser");
	history.replaceState(history.state, "", stwUsersUrl);
}

document.addEventListener("click", event => {
	const edit = event.target.closest("#c7UserManagementRoles01 .stwTableEditRow");
	edit?.closest("tr").querySelector(".stwTableRowActions button[hidden]")?.removeAttribute("hidden");
});

async function stwUpdateManagedRoles(button) {
	const roles = button.closest("tr").querySelector('[name="roles"]').value
		.split(",").map(role => role.trim()).filter(Boolean);
	button.disabled = true;
	try {
		const response = await fetch("/wbol/users/" + button.dataset.user, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ roles })
		});
		if (!response.ok) {
			const result = await response.json();
			throw new Error(result.error || "Unable to update roles.");
		}
		window.location.reload();
	} catch (error) {
		window.alert(error instanceof Error ? error.message : String(error));
		button.disabled = false;
	}
}

function stwToggleCollapse(event) {
	event.preventDefault();
	const el = event.currentTarget;
	el.classList.replace('stwCollapsed', 'stwExpanded') || el.classList.replace('stwExpanded', 'stwCollapsed');
	if (el.classList.contains("stwCollapsed"))
		el.closest("article").querySelectorAll(":scope>:not(h1)").forEach(child => child.classList.add("stwHide"));
	else
		el.closest("article").querySelectorAll(":scope>:not(h1)").forEach(child => child.classList.remove("stwHide"));
}