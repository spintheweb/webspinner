// SPDX-License-Identifier: GPL-3.0-or-later
// Spin the Web component: stwResponse

/**
 * Wrapper for Response that ensures proper Server header is set
 * @param body Response body
 * @param init Response initialization options
 * @returns Response with Server header set to "Webspinner"
 */
export function secureResponse(body?: BodyInit | null, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);

  // Minimal exposure
  headers.set("Server", "Webspinner");
  headers.delete("X-Powered-By");

  return new Response(body, { ...init, headers });
}
