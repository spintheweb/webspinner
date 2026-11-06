function secureResponse(body, init) {
  const headers = new Headers(init?.headers);
  headers.set("Server", "Webspinner");
  headers.delete("X-Powered-By");
  return new Response(body, { ...init, headers });
}
export {
  secureResponse
};
