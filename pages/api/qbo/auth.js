export default function handler(req, res) {
  const clientId = process.env.QBO_CLIENT_ID;
  const redirectUri = process.env.QBO_REDIRECT_URI;
  const scope = process.env.QBO_SCOPE || "com.intuit.quickbooks.accounting";

  if (!clientId || !redirectUri) {
    return res.status(500).json({ error: "Missing QBO env vars" });
  }

  const baseUrl = "https://appcenter.intuit.com/connect/oauth2";

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope,
    state: "test_state_123" // in futuro lo renderemo sicuro/random
  });

  const authUrl = `${baseUrl}?${params.toString()}`;

  // Redirect verso la schermata di login/autorizzazione Intuit
  res.redirect(authUrl);
}
