export default function handler(req, res) {
  const clientId = process.env.QBO_CLIENT_ID;
  const redirectUri = process.env.QBO_REDIRECT_URI;
  const scope = process.env.QBO_SCOPE || "com.intuit.quickbooks.accounting";

  if (!clientId || !redirectUri) {
    return res.status(500).json({ error: "Missing QBO env vars" });
  }

  // range può essere "last12", "ytd", "lastYear" (default last12)
  const rangeParam = req.query.range;
  const range = Array.isArray(rangeParam)
    ? rangeParam[0]
    : rangeParam || "last12";

  // Mettiamo il preset dentro lo state (base64 di un piccolo JSON)
  const statePayload = { range };
  const state = Buffer.from(JSON.stringify(statePayload)).toString("base64");

  const baseUrl = "https://appcenter.intuit.com/connect/oauth2";

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope,
    state
  });

  const authUrl = `${baseUrl}?${params.toString()}`;

  res.redirect(authUrl);
}
