import { createServer } from "node:http";
const CLIENT_ID = process.env.CIE_CLIENT_ID ?? "INSERISCI_CLIENT_ID";
const CLIENT_SECRET = process.env.CIE_CLIENT_SECRET ?? "INSERISCI_CLIENT_SECRET";
const REDIRECT_URI = process.env.CIE_REDIRECT_URI ?? "https://tuo-portale.it/callback";
const CIE_AUTH_ENDPOINT = "https://idserver.servizicie.interno.gov.it/auth/realms/cie/protocol/openid-connect/auth";
const CIE_TOKEN_ENDPOINT = "https://idserver.servizicie.interno.gov.it/auth/realms/cie/protocol/openid-connect/token";
const CIE_USERINFO_ENDPOINT = "https://idserver.servizicie.interno.gov.it/auth/realms/cie/protocol/openid-connect/userinfo";
function loginHandler(_req) {
  const state = crypto.randomUUID();
  const nonce = crypto.randomUUID();
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: "openid profile",
    state,
    nonce
  });
  const url = `${CIE_AUTH_ENDPOINT}?${params.toString()}`;
  return Response.redirect(url, 302);
}
async function callbackHandler(req) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  if (error) {
    return new Response(`Errore da CIE: ${error}`, { status: 400 });
  }
  if (!code) {
    return new Response("Manca il parametro 'code'", { status: 400 });
  }
  const tokenRes = await fetch(CIE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET
    })
  });
  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    return new Response(`Errore token endpoint: ${tokenRes.status} - ${text}`, {
      status: 500
    });
  }
  const tokenData = await tokenRes.json();
  const accessToken = tokenData.access_token;
  if (!accessToken) {
    return new Response("Access token mancante nella risposta CIE", {
      status: 500
    });
  }
  const userInfoRes = await fetch(CIE_USERINFO_ENDPOINT, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });
  if (!userInfoRes.ok) {
    const text = await userInfoRes.text();
    return new Response(`Errore userinfo endpoint: ${userInfoRes.status} - ${text}`, {
      status: 500
    });
  }
  const user = await userInfoRes.json();
  const fiscalNumber = typeof user["fiscal_number"] === "string" ? user["fiscal_number"] : void 0;
  const codiceFiscale = fiscalNumber?.startsWith("TINIT-") ? fiscalNumber.substring("TINIT-".length) : fiscalNumber;
  const payload = {
    rawUserInfo: user,
    fiscal_number: fiscalNumber,
    codice_fiscale: codiceFiscale
  };
  return new Response(JSON.stringify(payload, null, 2), {
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}
const server = createServer(async (incoming, outgoing) => {
  const url = new URL(incoming.url ?? "/", `http://${incoming.headers.host ?? "localhost"}`);
  const request = new Request(url, { method: incoming.method, headers: incoming.headers });
  let response;
  if (url.pathname === "/login") {
    response = loginHandler(request);
  } else if (url.pathname === "/callback") {
    response = await callbackHandler(request);
  } else {
    response = new Response(
      `CIE OIDC demo attiva.

- /login    \u2192 redirect a "Entra con CIE"
- /callback \u2192 endpoint di ritorno`,
      { headers: { "Content-Type": "text/plain; charset=utf-8" } }
    );
  }
  const headers = Object.fromEntries(response.headers.entries());
  outgoing.writeHead(response.status, headers);
  outgoing.end(await response.text());
});
server.listen(Number(process.env.PORT ?? 8e3), process.env.HOST ?? "127.0.0.1");
