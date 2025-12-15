// file: cie_oidc_deno.ts

// Configurazione (usa Deno.env per produzione)
const CLIENT_ID = Deno.env.get("CIE_CLIENT_ID") ?? "INSERISCI_CLIENT_ID";
const CLIENT_SECRET = Deno.env.get("CIE_CLIENT_SECRET") ?? "INSERISCI_CLIENT_SECRET";
const REDIRECT_URI = Deno.env.get("CIE_REDIRECT_URI") ?? "https://tuo-portale.it/callback";

// Endpoint OIDC CIE
const CIE_AUTH_ENDPOINT =
  "https://idserver.servizicie.interno.gov.it/auth/realms/cie/protocol/openid-connect/auth";
const CIE_TOKEN_ENDPOINT =
  "https://idserver.servizicie.interno.gov.it/auth/realms/cie/protocol/openid-connect/token";
const CIE_USERINFO_ENDPOINT =
  "https://idserver.servizicie.interno.gov.it/auth/realms/cie/protocol/openid-connect/userinfo";

// Handler /login → redirect verso CIE
function loginHandler(_req: Request): Response {
  const state = crypto.randomUUID();
  const nonce = crypto.randomUUID();

  // In produzione salva state/nonce in sessione (cookie, redis, ecc.)
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: "openid profile",
    state,
    nonce,
  });

  const url = `${CIE_AUTH_ENDPOINT}?${params.toString()}`;
  return Response.redirect(url, 302);
}

// Handler /callback → scambia code, chiama /userinfo, estrae CF
async function callbackHandler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    return new Response(`Errore da CIE: ${error}`, { status: 400 });
  }
  if (!code) {
    return new Response("Manca il parametro 'code'", { status: 400 });
  }

  // Scambio code → token
  const tokenRes = await fetch(CIE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    return new Response(`Errore token endpoint: ${tokenRes.status} - ${text}`, {
      status: 500,
    });
  }

  const tokenData = await tokenRes.json();
  const accessToken = tokenData.access_token;
  if (!accessToken) {
    return new Response("Access token mancante nella risposta CIE", {
      status: 500,
    });
  }

  // Chiamata allo UserInfo endpoint
  const userInfoRes = await fetch(CIE_USERINFO_ENDPOINT, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!userInfoRes.ok) {
    const text = await userInfoRes.text();
    return new Response(`Errore userinfo endpoint: ${userInfoRes.status} - ${text}`, {
      status: 500,
    });
  }

  const user = await userInfoRes.json() as Record<string, unknown>;

  // Estrazione codice fiscale
  const fiscalNumber = typeof user["fiscal_number"] === "string"
    ? (user["fiscal_number"] as string)
    : undefined;

  const codiceFiscale = fiscalNumber?.startsWith("TINIT-")
    ? fiscalNumber.substring("TINIT-".length)
    : fiscalNumber;

  const payload = {
    rawUserInfo: user,
    fiscal_number: fiscalNumber,
    codice_fiscale: codiceFiscale,
  };

  return new Response(JSON.stringify(payload, null, 2), {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

// Server Deno minimale
Deno.serve((req) => {
  const url = new URL(req.url);

  if (url.pathname === "/login") {
    return loginHandler(req);
  }

  if (url.pathname === "/callback") {
    return callbackHandler(req);
  }

  return new Response(
    `CIE OIDC demo attiva.\n\n- /login    → redirect a "Entra con CIE"\n- /callback → endpoint di ritorno`,
    { headers: { "Content-Type": "text/plain; charset=utf-8" } },
  );
});
