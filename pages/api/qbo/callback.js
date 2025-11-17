export default async function handler(req, res) {
  const { code, state, realmId } = req.query;

  if (!code || !realmId) {
    return res.status(400).json({
      error: "Missing code or realmId in callback query params",
      query: req.query
    });
  }

  const clientId = process.env.QBO_CLIENT_ID;
  const clientSecret = process.env.QBO_CLIENT_SECRET;
  const redirectUri = process.env.QBO_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    return res.status(500).json({ error: "Missing QBO env vars" });
  }

  const tokenUrl = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

  // Basic Auth header: base64(clientId:clientSecret)
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri
  });

  try {
    // 1) SCAMBIO CODE → ACCESS TOKEN
    const tokenResp = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: body.toString()
    });

    const tokenData = await tokenResp.json();

    if (!tokenResp.ok) {
      return res.status(500).json({
        error: "Token exchange failed",
        details: tokenData
      });
    }

    const accessToken = tokenData.access_token;
    const refreshToken = tokenData.refresh_token;

    // 2) PRIMA CHIAMATA API A QUICKBOOKS (company info di test)
    const apiUrl = `https://sandbox-quickbooks.api.intuit.com/v3/company/${realmId}/companyinfo/${realmId}?minorversion=65`;

    const apiResp = await fetch(apiUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json"
      }
    });

    const apiData = await apiResp.json();

    // Risposta di debug (per ora includiamo solo info utili, NON tutti i token)
    return res.status(200).json({
      message: "Tokens obtained and test API call executed.",
      state,
      realmId,
      tokenInfo: {
        expires_in: tokenData.expires_in,
        x_refresh_token_expires_in: tokenData.x_refresh_token_expires_in
      },
      companyInfo: apiData
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: "Unexpected error in callback handler",
      details: String(err)
    });
  }
}
