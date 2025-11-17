export default async function handler(req, res) {
  const { code, state, realmId } = req.query;

  if (!code || !realmId) {
    return res.status(400).send("Missing code or realmId in callback query params.");
  }

  const clientId = process.env.QBO_CLIENT_ID;
  const clientSecret = process.env.QBO_CLIENT_SECRET;
  const redirectUri = process.env.QBO_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    return res.status(500).send("Missing QBO environment variables.");
  }

  const tokenUrl = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri
  });

  try {
    // 1) CODE -> ACCESS TOKEN
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
      res.status(500).setHeader("Content-Type", "text/html; charset=utf-8");
      return res.end(
        `<h1>Token exchange failed</h1><pre>${JSON.stringify(tokenData, null, 2)}</pre>`
      );
    }

    const accessToken = tokenData.access_token;
    const refreshToken = tokenData.refresh_token; // per il futuro
    const expiresIn = tokenData.expires_in;
    const refreshExpiresIn = tokenData.x_refresh_token_expires_in;

    // 2) COMPANY INFO (giusto per avere il nome da mostrare)
    const companyUrl = `https://sandbox-quickbooks.api.intuit.com/v3/company/${realmId}/companyinfo/${realmId}?minorversion=65`;

    const companyResp = await fetch(companyUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json"
      }
    });

    const companyData = await companyResp.json();
    const companyInfo = companyData.CompanyInfo || {};
    const companyName = companyInfo.CompanyName || "Unknown company";

    // 3) INVOICE -> MINI REPORT NEXUS (vendite per stato)
    const queryUrl = `https://sandbox-quickbooks.api.intuit.com/v3/company/${realmId}/query?minorversion=65`;

    // per ora: tutte le Invoice degli ultimi 365 giorni
    const today = new Date();
    const oneYearAgo = new Date(today);
    oneYearAgo.setDate(today.getDate() - 365);

    const yyyy = oneYearAgo.getFullYear();
    const mm = String(oneYearAgo.getMonth() + 1).padStart(2, "0");
    const dd = String(oneYearAgo.getDate()).padStart(2, "0");
    const fromDate = `${yyyy}-${mm}-${dd}`;

    const qboQuery = `select * from Invoice where TxnDate >= '${fromDate}'`;

    const invoicesResp = await fetch(queryUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/text"
      },
      body: qboQuery
    });

    const invoicesData = await invoicesResp.json();

    const invoices =
      (invoicesData.QueryResponse && invoicesData.QueryResponse.Invoice) || [];

    // 4) RAGGRUPPO PER STATO (ShipAddr.CountrySubDivisionCode)
    const totalsByState = {};

    for (const inv of invoices) {
      const shipAddr = inv.ShipAddr || {};
      const stateCode = shipAddr.CountrySubDivisionCode || "N/A";
      const amount = Number(inv.TotalAmt) || 0;

      if (!totalsByState[stateCode]) {
        totalsByState[stateCode] = {
          state: stateCode,
          orders: 0,
          sales: 0
        };
      }

      totalsByState[stateCode].orders += 1;
      totalsByState[stateCode].sales += amount;
    }

    const rows = Object.values(totalsByState).sort((a, b) => b.sales - a.sales);

    const formatMoney = (value) =>
      value.toLocaleString("en-US", {
        style: "currency",
        currency: "USD"
      });

    // 5) HTML PULITO
    res.status(200).setHeader("Content-Type", "text/html; charset=utf-8");

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Nexus Radar – Connection Summary</title>
  <style>
    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      padding: 2rem;
      max-width: 900px;
      margin: 0 auto;
      background: #f5f5f7;
    }
    h1 {
      margin-bottom: 0.25rem;
    }
    h2 {
      margin-top: 2rem;
    }
    .card {
      background: #ffffff;
      border-radius: 12px;
      padding: 1.5rem;
      box-shadow: 0 2px 8px rgba(0,0,0,0.06);
      margin-top: 1rem;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 0.5rem;
    }
    th, td {
      padding: 0.6rem 0.4rem;
      text-align: left;
      border-bottom: 1px solid #e5e5e5;
      font-size: 0.95rem;
    }
    th {
      background: #fafafa;
      font-weight: 600;
    }
    td.num {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .badge {
      display: inline-block;
      padding: 0.15rem 0.6rem;
      border-radius: 999px;
      background: #e6f4ff;
      color: #0957d0;
      font-size: 0.75rem;
      font-weight: 600;
      margin-left: 0.5rem;
    }
    .meta {
      font-size: 0.9rem;
      color: #555;
    }
    details {
      margin-top: 1.5rem;
      font-size: 0.9rem;
    }
    pre {
      background: #111827;
      color: #e5e7eb;
      padding: 1rem;
      border-radius: 8px;
      overflow: auto;
      max-height: 300px;
      font-size: 0.8rem;
    }
  </style>
</head>
<body>
  <h1>Nexus Radar – Connected</h1>
  <p class="meta">
    Company: <strong>${companyName}</strong>
    <span class="badge">Realm ID: ${realmId}</span>
  </p>

  <div class="card">
    <h2>Token status</h2>
    <p class="meta">
      Access token valid for ~${Math.round(expiresIn / 60)} minutes. <br/>
      Refresh token valid for ~${Math.round(refreshExpiresIn / (60 * 60 * 24))} days.
    </p>
  </div>

  <div class="card">
    <h2>Sales by State (Invoice, from ${fromDate})</h2>
    ${
      rows.length === 0
        ? "<p>No invoices found in the selected period.</p>"
        : `
    <table>
      <thead>
        <tr>
          <th>State</th>
          <th class="num">Orders</th>
          <th class="num">Sales</th>
          <th class="num">Avg order</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map((r) => {
            const avg = r.orders ? r.sales / r.orders : 0;
            return `
              <tr>
                <td>${r.state}</td>
                <td class="num">${r.orders}</td>
                <td class="num">${formatMoney(r.sales)}</td>
                <td class="num">${formatMoney(avg)}</td>
              </tr>
            `;
          })
          .join("")}
      </tbody>
    </table>
    `
    }
  </div>

  <details>
    <summary>Debug info (raw company info JSON)</summary>
    <pre>${JSON.stringify(companyInfo, null, 2)}</pre>
  </details>

</body>
</html>`;

    return res.end(html);
  } catch (err) {
    console.error(err);
    res.status(500).setHeader("Content-Type", "text/html; charset=utf-8");
    return res.end(
      `<h1>Unexpected error</h1><pre>${String(err)}</pre>`
    );
  }
}
