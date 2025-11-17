// Soglie "tipo nexus" (puoi modificarle)
const SALES_THRESHOLD = 100000; // 100k vendite
const ORDERS_THRESHOLD = 200;   // 200 ordini

function decodeRangeFromState(state) {
  if (!state) return "last12";
  try {
    const json = JSON.parse(Buffer.from(state, "base64").toString("utf8"));
    return json.range || "last12";
  } catch {
    return "last12";
  }
}

function computeDateRange(range) {
  const today = new Date();
  let from, to;

  // normalizziamo a YYYY-MM-DD
  const toDateStr = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };

  if (range === "ytd") {
    // Year-to-date: 1 gennaio anno corrente -> oggi
    const fromDate = new Date(today.getFullYear(), 0, 1);
    from = toDateStr(fromDate);
    to = toDateStr(today);
    return { from, to, label: "Year-to-Date (YTD)" };
  }

  if (range === "lastYear") {
    // Last calendar year: 1 gen anno precedente -> 31 dic anno precedente
    const year = today.getFullYear() - 1;
    const fromDate = new Date(year, 0, 1);
    const toDate = new Date(year, 11, 31);
    from = toDateStr(fromDate);
    to = toDateStr(toDate);
    return { from, to, label: `Last calendar year (${year})` };
  }

  // Default: Last 12 months (365 giorni indietro)
  const fromDate = new Date(today);
  fromDate.setDate(today.getDate() - 365);
  from = toDateStr(fromDate);
  to = toDateStr(today);
  return { from, to, label: "Last 12 months" };
}

export default async function handler(req, res) {
  const { code, state, realmId } = req.query;

  if (!code || !realmId) {
    return res
      .status(400)
      .send("Missing code or realmId in callback query params.");
  }

  const range = decodeRangeFromState(state);
  const { from: fromDate, to: toDate, label: rangeLabel } =
    computeDateRange(range);

  const clientId = process.env.QBO_CLIENT_ID;
  const clientSecret = process.env.QBO_CLIENT_SECRET;
  const redirectUri = process.env.QBO_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    return res.status(500).send("Missing QBO environment variables.");
  }

  const tokenUrl = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString(
    "base64"
  );

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
        `<h1>Token exchange failed</h1><pre>${JSON.stringify(
          tokenData,
          null,
          2
        )}</pre>`
      );
    }

    const accessToken = tokenData.access_token;
    const refreshToken = tokenData.refresh_token; // per il futuro
    const expiresIn = tokenData.expires_in;
    const refreshExpiresIn = tokenData.x_refresh_token_expires_in;

    // 2) COMPANY INFO (nome da mostrare)
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

    // 3) INVOICE + SALES RECEIPT -> MINI REPORT NEXUS (vendite per stato)
    const queryUrl = `https://sandbox-quickbooks.api.intuit.com/v3/company/${realmId}/query?minorversion=65`;

    const whereClause = `TxnDate >= '${fromDate}' AND TxnDate <= '${toDate}'`;

    const invoiceQuery = `select * from Invoice where ${whereClause}`;
    const receiptQuery = `select * from SalesReceipt where ${whereClause}`;

    async function runQuery(q) {
      const resp = await fetch(queryUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          "Content-Type": "application/text"
        },
        body: q
      });
      return resp.json();
    }

    const [invoicesData, receiptsData] = await Promise.all([
      runQuery(invoiceQuery),
      runQuery(receiptQuery)
    ]);

    const invoices =
      (invoicesData.QueryResponse &&
        invoicesData.QueryResponse.Invoice) ||
      [];
    const receipts =
      (receiptsData.QueryResponse &&
        receiptsData.QueryResponse.SalesReceipt) ||
      [];

    const totalsByState = {};

    function accumulate(docs) {
      for (const doc of docs) {
        const shipAddr = doc.ShipAddr || {};
        const stateCode = shipAddr.CountrySubDivisionCode || "N/A";
        const amount = Number(doc.TotalAmt) || 0;

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
    }

    accumulate(invoices);
    accumulate(receipts);

    const rows = Object.values(totalsByState).sort((a, b) => b.sales - a.sales);

    const formatMoney = (value) =>
      value.toLocaleString("en-US", {
        style: "currency",
        currency: "USD"
      });

    const riskLabel = (r) => {
      const overSales = r.sales >= SALES_THRESHOLD;
      const overOrders = r.orders >= ORDERS_THRESHOLD;
      if (overSales && overOrders) return "Sales & Orders";
      if (overSales) return "Sales";
      if (overOrders) return "Orders";
      return "-";
    };

    const statesOverSales = rows.filter(
      (r) => r.sales >= SALES_THRESHOLD
    ).length;
    const statesOverOrders = rows.filter(
      (r) => r.orders >= ORDERS_THRESHOLD
    ).length;
    const statesOverEither = rows.filter(
      (r) => r.sales >= SALES_THRESHOLD || r.orders >= ORDERS_THRESHOLD
    ).length;

    const totalSales = rows.reduce((sum, r) => sum + r.sales, 0);
    const totalOrders = rows.reduce((sum, r) => sum + r.orders, 0);

    // 5) HTML
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
    .risk-row {
      background: #fff5f5;
    }
    .risk-row td {
      border-bottom-color: #f5c2c2;
    }
    .pill {
      display: inline-block;
      padding: 0.1rem 0.6rem;
      border-radius: 999px;
      font-size: 0.75rem;
      font-weight: 600;
    }
    .pill-none {
      background: #e5e7eb;
      color: #374151;
    }
    .pill-risk {
      background: #fee2e2;
      color: #b91c1c;
    }
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 0.75rem;
      margin-top: 0.75rem;
      font-size: 0.9rem;
    }
    .summary-box {
      background: #f9fafb;
      border-radius: 8px;
      padding: 0.75rem 0.9rem;
    }
    .summary-label {
      color: #6b7280;
      font-size: 0.78rem;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      margin-bottom: 0.15rem;
    }
    .summary-value {
      font-weight: 600;
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
      Refresh token valid for ~${Math.round(
        refreshExpiresIn / (60 * 60 * 24)
      )} days.
    </p>
  </div>

  <div class="card">
    <h2>Sales Nexus Snapshot</h2>
    <p class="meta">
      Period: <strong>${rangeLabel}</strong> (${fromDate} → ${toDate})<br/>
      Thresholds: <strong>${formatMoney(
        SALES_THRESHOLD
      )}</strong> sales OR <strong>${ORDERS_THRESHOLD}</strong> orders per state.
    </p>

    <div class="summary-grid">
      <div class="summary-box">
        <div class="summary-label">Total sales (period)</div>
        <div class="summary-value">${formatMoney(totalSales)}</div>
      </div>
      <div class="summary-box">
        <div class="summary-label">Total orders (period)</div>
        <div class="summary-value">${totalOrders}</div>
      </div>
      <div class="summary-box">
        <div class="summary-label">States over thresholds (sales or orders)</div>
        <div class="summary-value">${statesOverEither}</div>
      </div>
      <div class="summary-box">
        <div class="summary-label">States over sales threshold</div>
        <div class="summary-value">${statesOverSales}</div>
      </div>
      <div class="summary-box">
        <div class="summary-label">States over orders threshold</div>
        <div class="summary-value">${statesOverOrders}</div>
      </div>
    </div>

    ${
      rows.length === 0
        ? "<p style=\"margin-top:1rem;\">No sales documents found (Invoice / SalesReceipt) in the selected period.</p>"
        : `
    <table>
      <thead>
        <tr>
          <th>State</th>
          <th class="num">Orders</th>
          <th class="num">Sales</th>
          <th class="num">Avg order</th>
          <th>Risk</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map((r) => {
            const avg = r.orders ? r.sales / r.orders : 0;
            const over =
              r.sales >= SALES_THRESHOLD || r.orders >= ORDERS_THRESHOLD;
            const rowClass = over ? ' class="risk-row"' : "";
            const pillClass = over ? "pill pill-risk" : "pill pill-none";
            const label = riskLabel(r);
            return `
              <tr${rowClass}>
                <td>${r.state}</td>
                <td class="num">${r.orders}</td>
                <td class="num">${formatMoney(r.sales)}</td>
                <td class="num">${formatMoney(avg)}</td>
                <td><span class="${pillClass}">${label}</span></td>
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
    return res.end(`<h1>Unexpected error</h1><pre>${String(err)}</pre>`);
  }
}
