/**
 * @fileoverview Creates hardened HTTP Response objects for Webspinner.
 *
 * Normalizes response headers by setting the Server header and stripping
 * framework-identifying headers such as X-Powered-By.
 *
 * @author Giancarlo Trevisan
 * @version 1.0.0
 * @module stwResponse
 * @note Copilot-assisted
 * @license Apache-2.0
 */
function secureResponse(body, init) {
	const headers = new Headers(init?.headers);
	headers.set("Server", "Webspinner");
	headers.delete("X-Powered-By");
	return new Response(body, { ...init, headers });
}
export {
	secureResponse
};
