// pages/api/qbo/callback.js

import {
  getEconomicNexusRule,
  describeThreshold,
} from "../../../lib/economicNexusRules";

const CLIENT_ID = process.env.QBO_CLIENT_ID || process.env.INTUIT_CLIENT_ID;
const CLIENT_SECRET =
  process.env.QBO_CLIENT_SECRET || process.env.INTUIT_CLIENT_SECRET;
const REDIRECT_URI =
  process.env.QBO_REDIRECT_URI || process.env.INTUIT_REDIRECT_URI;

// sandbox di default
const QBO_ENV = process.env.QBO_ENV || "sandbox";
const QBO_BASE_URL =
  QBO_ENV === "production"
    ? "https://quickbooks.api.intuit.com/v3/company"
    : "https://sandbox-quickbooks.api.intuit.com/v3/company";

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.warn(
    "[QBO] CLIENT_ID / CLIENT_SECRET non trovati nelle env vars. Controlla le impostazioni Vercel.",
  );
}

function basicAuthHeader() {
  const token = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
  return `Basic ${token}`;
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function formatDate(d) {
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

function formatMoney(amount) {
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

// Safely extract state from an address object
function extractState(addr) {
  if (!addr || typeof addr !== "object") return null;
  return addr.CountrySubDivisionCode || addr.State || null;
}

/**
 * Aggrega vendite (Invoice + SalesReceipt) per stato.
 * Ogni documento conta come 1 "ordine".
 *
 * basis:
 *  - "accrual": tutte le Invoice + tutte le SalesReceipt nel periodo
 *  - "cash":    solo Invoice con Balance == 0 (pagate) + tutte le SalesReceipt
 *
 * Restituisce:
 *  - rows:     aggregazione per stato
 *  - csvTxns:  array di tutte le transazioni effettivamente usate nel report
 *              (per CSV di riconciliazione)
 */
function aggregateSalesByState(invoices, receipts, basis) {
  const byState = new Map();
  const csvTxns = [];

  const addTxn = (txn, sourceType) => {
    if (!txn) return;

    const amount = Number(txn.TotalAmt || 0);
    if (!amount) return;

    const ship = txn.ShipAddr || null;
    const bill = txn.BillAddr || null;

    // Nuova logica: ShipAddr se ha lo stato, altrimenti fallback su BillAddr
    let state = extractState(ship) || extractState(bill) || "N/A";

    if (!byState.has(state)) {
      byState.set(state, { state, orders: 0, sales: 0 });
    }
    const entry = byState.get(state);
    entry.orders += 1;
    entry.sales += amount;

    csvTxns.push({
      type: sourceType,
      docNumber: txn.DocNumber || "",
      txnDate: txn.TxnDate || "",
      customer: txn.CustomerRef?.name || "",
      state,
      totalAmt: amount,
      balance: Number(txn.Balance || 0),
    });
  };

  const safeInvoices = Array.isArray(invoices) ? invoices : [];
  const safeReceipts = Array.isArray(receipts) ? receipts : [];

  if (basis === "cash") {
    // CASH BASIS:
    // - Invoice: solo quelle completamente pagate (Balance == 0)
    // - SalesReceipt: sempre incluse (sono già cash)
    safeInvoices.forEach((txn) => {
      const bal = Number(txn.Balance || 0);
      if (bal === 0) {
        addTxn(txn, "Invoice");
      }
    });
    safeReceipts.forEach((txn) => addTxn(txn, "SalesReceipt"));
  } else {
    // ACCRUAL BASIS (default):
    // - tutte le Invoice
    // - tutte le SalesReceipt
    safeInvoices.forEach((txn) => addTxn(txn, "Invoice"));
    safeReceipts.forEach((txn) => addTxn(txn, "SalesReceipt"));
  }

  const rows = Array.from(byState.values()).map((row) => ({
    ...row,
    avgOrder: row.orders ? row.sales / row.orders : 0,
  }));

  rows.sort((a, b) => b.sales - a.sales);

  return { rows, csvTxns };
}

/**
 * Applica le regole di economic nexus (per Stato) alle righe aggregate.
 */
function applyNexusRulesToRows(rows) {
  let statesOverAnyThreshold = 0;
  let statesOverSalesThreshold = 0;

  const withRisk = rows.map((row) => {
    const rule = getEconomicNexusRule(row.state);
    let risk = "Below thresholds";
    let severity = "low";
    let overSales = false;
    let overOrders = false;

    if (!rule) {
      risk = "Rule not configured";
      severity = "info";
    } else if (rule.noStateSalesTax) {
      risk = "No state sales tax";
      severity = "none";
    } else {
      if (rule.thresholdSales != null && row.sales >= rule.thresholdSales) {
        overSales = true;
      }
      if (
        rule.thresholdTransactions != null &&
        row.orders >= rule.thresholdTransactions
      ) {
        overOrders = true;
      }

      const triggered = overSales || overOrders;

      if (triggered) {
        risk = "Likely nexus";
        severity = "high";
      } else {
        const salesRatio =
          rule.thresholdSales != null ? row.sales / rule.thresholdSales : 0;
        const ordersRatio =
          rule.thresholdTransactions != null
            ? row.orders / rule.thresholdTransactions
            : 0;
        const proximity = Math.max(salesRatio, ordersRatio);

        if (proximity >= 0.8) {
          risk = "Getting close";
          severity = "medium";
        } else {
          risk = "Below thresholds";
          severity = "low";
        }
      }
    }

    if (overSales || overOrders) {
      statesOverAnyThreshold += 1;
      if (overSales) statesOverSalesThreshold += 1;
    }

    return {
      ...row,
      rule,
      risk,
      severity,
      overSales,
      overOrders,
      thresholdLabel: rule ? describeThreshold(rule) : "n/a",
    };
  });

  return {
    rows: withRisk,
    statesOverAnyThreshold,
    statesOverSalesThreshold,
  };
}

/**
 * Costruisce il range temporale in base al preset (?range=last12|ytd|lastCalendar)
 */
function buildDateRange(preset) {
  const today = new Date();
  const cleanToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );

  let start;
  let end = cleanToday;
  let label;

  switch (preset) {
    case "ytd": {
      start = new Date(cleanToday.getFullYear(), 0, 1);
      label = `Year to date (${formatDate(start)} → ${formatDate(end)})`;
      break;
    }
    case "lastCalendar": {
      const lastYear = cleanToday.getFullYear() - 1;
      start = new Date(lastYear, 0, 1);
      end = new Date(lastYear, 11, 31);
      label = `Last calendar year (${lastYear})`;
      break;
    }
    case "last12":
    default: {
      start = new Date(cleanToday);
      start.setFullYear(start.getFullYear() - 1);
      start.setDate(start.getDate() + 1);
      label = `Last 12 months (${formatDate(start)} → ${formatDate(end)})`;
      break;
    }
  }

  return { start, end, label, preset: preset || "last12" };
}

// CSV escaping
function csvEscape(value) {
  if (value === null || value === undefined) return '""';
  const s = String(value).replace(/"/g, '""');
  return `"${s}"`;
}

export default async function handler(req, res) {
  try {
    const {
      code,
      state,
      realmId,
      error,
      accessToken: accessTokenFromQuery,
      refreshToken: refreshTokenFromQuery,
    } = req.query;

    if (error) {
      return res
        .status(400)
        .send(`Intuit returned an error: ${error}. Please try again.`);
    }

    if (!realmId) {
      return res.status(400).send("Missing realmId in callback.");
    }

    // basis: "accrual" (default) oppure "cash"
    const basis =
      req.query.basis && req.query.basis.toLowerCase() === "cash"
        ? "cash"
        : "accrual";
    const basisLabel =
      basis === "cash"
        ? "Cash basis (paid Invoices + all Sales Receipts)"
        : "Accrual basis (all Invoices + all Sales Receipts)";

    let accessToken = accessTokenFromQuery || null;
    let refreshToken = refreshTokenFromQuery || null;
    let expiresIn = null;
    let xRefreshExpiresIn = null;

    // Se abbiamo già l'access token nella query (change di periodo / basis),
    // saltiamo lo scambio del "code" con Intuit.
    if (!accessToken) {
      if (!code) {
        return res
          .status(400)
          .send("Missing authorization code or access token.");
      }

      const tokenResp = await fetch(
        "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
        {
          method: "POST",
          headers: {
            Authorization: basicAuthHeader(),
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: REDIRECT_URI,
          }).toString(),
        },
      );

      if (!tokenResp.ok) {
        const text = await tokenResp.text();
        console.error("[QBO] Token exchange failed:", tokenResp.status, text);
        return res
          .status(500)
          .send("Failed to obtain tokens from Intuit. Check server logs.");
      }

      const tokenJson = await tokenResp.json();
      accessToken = tokenJson.access_token;
      refreshToken = tokenJson.refresh_token;
      expiresIn = tokenJson.expires_in;
      xRefreshExpiresIn = tokenJson.x_refresh_token_expires_in;
    } else {
      // accessToken passato via query (seconda chiamata)
      expiresIn = 3600;
      xRefreshExpiresIn = 60 * 60 * 24 * 30;
    }

    // 2) Company info
    const companyInfoResp = await fetch(
      `${QBO_BASE_URL}/${realmId}/companyinfo/${realmId}?minorversion=70`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      },
    );

    if (!companyInfoResp.ok) {
      const text = await companyInfoResp.text();
      console.error(
        "[QBO] CompanyInfo error:",
        companyInfoResp.status,
        text,
      );
    }

    const companyInfoJson = await companyInfoResp.json();
    const companyInfo = companyInfoJson?.CompanyInfo || {};
    const companyName =
      companyInfo.CompanyName ||
      companyInfo.LegalName ||
      "Unknown QuickBooks company";

    // 3) Date range
    const rangePreset = req.query.range || "last12";
    const { start, end, label: periodLabel, preset } =
      buildDateRange(rangePreset);

    const startStr = isoDate(start);
    const endStr = isoDate(end);

    /**
     * Query helper con paginazione.
     * QBO limita a 1000 risultati per query; qui cicliamo tutte le pagine.
     */
    const runQboQuery = async (entityName) => {
      const pageSize = 1000;
      let startPosition = 1;
      let all = [];

      while (true) {
        const q = `select * from ${entityName} where TxnDate >= '${startStr}' and TxnDate <= '${endStr}' startposition ${startPosition} maxresults ${pageSize}`;
        const query = encodeURIComponent(q);
        const url = `${QBO_BASE_URL}/${realmId}/query?minorversion=70&query=${query}`;

        const resp = await fetch(url, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
          },
        });

        if (!resp.ok) {
          const text = await resp.text();
          console.error(
            `[QBO] Query error for ${entityName}:`,
            resp.status,
            text,
          );
          break; // ritorna quello che abbiamo raccolto finora
        }

        const json = await resp.json();
        const chunk = json?.QueryResponse?.[entityName] || [];
        all = all.concat(chunk);

        if (chunk.length < pageSize) {
          break; // ultima pagina
        }

        startPosition += pageSize;
      }

      return all;
    };

    // 4) Invoice + SalesReceipt nel periodo (tutte le pagine)
    const [invoices, salesReceipts] = await Promise.all([
      runQboQuery("Invoice"),
      runQboQuery("SalesReceipt"),
    ]);

    // 5) Aggregazione per stato (basis: accrual / cash) + elenco transazioni per CSV
    const { rows: aggregatedRows, csvTxns } = aggregateSalesByState(
      invoices,
      salesReceipts,
      basis,
    );

    const totalSalesPeriod = aggregatedRows.reduce(
      (sum, r) => sum + r.sales,
      0,
    );
    const totalOrdersPeriod = aggregatedRows.reduce(
      (sum, r) => sum + r.orders,
      0,
    );

    // 6) Applicare regole economic nexus
    const {
      rows: rowsWithRisk,
      statesOverAnyThreshold,
      statesOverSalesThreshold,
    } = applyNexusRulesToRows(aggregatedRows);

    const tokenValidMinutes = Math.round((expiresIn || 3600) / 60);
    const refreshValidDays = Math.round((xRefreshExpiresIn || 0) / 86400);

    const rangeOptions = [
      { value: "last12", label: "Last 12 months" },
      { value: "ytd", label: "Year to date" },
      { value: "lastCalendar", label: "Last calendar year" },
    ];

    const basisOptions = [
      { value: "accrual", label: "Accrual basis" },
      { value: "cash", label: "Cash basis" },
    ];

    // Costruzione CSV per download (solo transazioni realmente usate nel report)
    const csvHeader = [
      "Type",
      "DocNumber",
      "TxnDate",
      "Customer",
      "State",
      "TotalAmt",
      "Balance",
    ].map(csvEscape);
    const csvLines = csvTxns.map((t) =>
      [
        t.type,
        t.docNumber,
        t.txnDate,
        t.customer,
        t.state,
        t.totalAmt,
        t.balance,
      ].map(csvEscape),
    );
    const csvString = [csvHeader, ...csvLines]
      .map((row) => row.join(","))
      .join("\n");
    const csvBase64 = Buffer.from(csvString, "utf8").toString("base64");

    // Debug sample costruito *dopo* aver applicato la stessa logica del report
    const debugSample = {
      basis,
      dateRange: { start: startStr, end: endStr },
      invoiceCountAll: invoices?.length || 0,
      salesReceiptCountAll: salesReceipts?.length || 0,
      invoiceCountInRange: csvTxns.filter((t) => t.type === "Invoice").length,
      salesReceiptCountInRange: csvTxns.filter(
        (t) => t.type === "SalesReceipt",
      ).length,
      sampleUT: [],
      sampleNA: [],
    };

    for (const t of csvTxns) {
      if (t.state === "UT" && debugSample.sampleUT.length < 100) {
        debugSample.sampleUT.push(t);
      }
      if (t.state === "N/A" && debugSample.sampleNA.length < 100) {
        debugSample.sampleNA.push(t);
      }
    }

    const html = /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Nexus Radar – Connected</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    :root {
      color-scheme: light dark;
      --bg: #0b1120;
      --card-bg: #020617;
      --text-main: #e5e7eb;
      --text-muted: #9ca3af;
      --border-subtle: #1f2937;
      --accent: #2563eb;
      --accent-soft: #1d4ed8;
      --danger: #f97373;
      --danger-soft: #7f1d1d;
      --warn: #facc15;
      --warn-soft: #78350f;
      --ok-soft: #14532d;
      --ok: #22c55e;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
        sans-serif;
      background: radial-gradient(circle at top, #1e293b, #020617 55%);
      color: var(--text-main);
      padding: 24px;
    }
    .page {
      max-width: 1100px;
      margin: 0 auto;
    }
    h1 {
      font-size: 28px;
      margin: 0 0 4px;
    }
    .subtitle {
      font-size: 14px;
      color: var(--text-muted);
      margin-bottom: 20px;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      padding: 2px 10px;
      border-radius: 999px;
      font-size: 11px;
      border: 1px solid var(--border-subtle);
      color: var(--text-muted);
      background: rgba(148,163,184,0.08);
      margin-left: 8px;
    }
    .card {
      background: radial-gradient(circle at top left, #111827, #020617 70%);
      border-radius: 16px;
      padding: 18px 20px;
      margin-bottom: 18px;
      box-shadow: 0 18px 40px rgba(15,23,42,0.9);
      border: 1px solid rgba(148,163,184,0.35);
    }
    .card-title {
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 6px;
    }
    .card-sub {
      font-size: 13px;
      color: var(--text-muted);
    }

    .snapshot-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
      margin-bottom: 16px;
    }
    @media (max-width: 900px) {
      .snapshot-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
    @media (max-width: 600px) {
      .snapshot-grid {
        grid-template-columns: 1fr;
      }
    }
    .stat-card {
      padding: 12px 14px;
      border-radius: 12px;
      border: 1px solid var(--border-subtle);
      background: linear-gradient(135deg, #020617, #0f172a);
    }
    .stat-label {
      font-size: 11px;
      letter-spacing: 0.03em;
      text-transform: uppercase;
      color: var(--text-muted);
      margin-bottom: 4px;
    }
    .stat-value {
      font-size: 17px;
      font-weight: 600;
    }

    .filters-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      margin-bottom: 10px;
      flex-wrap: wrap;
    }
    .filters-row form {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      color: var(--text-muted);
      flex-wrap: wrap;
    }
    select {
      font-size: 13px;
      padding: 4px 8px;
      border-radius: 8px;
      border: 1px solid var(--border-subtle);
      background: #020617;
      color: var(--text-main);
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    thead {
      background: rgba(15,23,42,0.8);
    }
    th, td {
      padding: 8px 10px;
      text-align: left;
      border-bottom: 1px solid var(--border-subtle);
      white-space: nowrap;
    }
    th:first-child, td:first-child {
      padding-left: 4px;
    }
    th:last-child, td:last-child {
      padding-right: 4px;
    }
    tbody tr:hover {
      background: rgba(37,99,235,0.18);
    }
    .text-right { text-align: right; }
    .text-muted { color: var(--text-muted); font-size: 12px; }

    .badge {
      display: inline-flex;
      align-items: center;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 500;
      border: 1px solid transparent;
    }
    .badge-high {
      background: rgba(248,113,113,0.18);
      color: #fecaca;
      border-color: rgba(248,113,113,0.6);
    }
    .badge-medium {
      background: rgba(250,204,21,0.16);
      color: #fde68a;
      border-color: rgba(250,204,21,0.6);
    }
    .badge-low {
      background: rgba(52,211,153,0.18);
      color: #bbf7d0;
      border-color: rgba(52,211,153,0.6);
    }
    .badge-none,
    .badge-info {
      background: rgba(148,163,184,0.16);
      color: var(--text-muted);
      border-color: rgba(148,163,184,0.5);
    }

    details {
      margin-top: 8px;
      font-size: 12px;
      color: var(--text-muted);
    }
    summary {
      cursor: pointer;
    }

    .csv-link {
      font-size: 13px;
      text-decoration: none;
      padding: 6px 10px;
      border-radius: 999px;
      border: 1px solid rgba(148,163,184,0.6);
      color: #e5e7eb;
      background: rgba(15,23,42,0.6);
    }
    .csv-link:hover {
      border-color: #60a5fa;
    }
  </style>
</head>
<body>
  <div class="page">
    <header style="margin-bottom:16px;">
      <h1>Nexus Radar – Connected</h1>
      <div class="subtitle">
        Company: <strong>${companyName}</strong>
        <span class="pill">Realm ID: ${realmId}</span>
      </div>
    </header>

    <section class="card">
      <div class="card-title">Token status</div>
      <div class="card-sub">
        Access token valid for ~${tokenValidMinutes} minutes.<br/>
        Refresh token valid for ~${refreshValidDays} days.
      </div>
    </section>

    <section class="card">
      <div class="card-title">Sales Nexus Snapshot</div>
      <div class="card-sub">
        Period: ${periodLabel}<br/>
        Basis: <strong>${basisLabel}</strong><br/>
        Thresholds: per-state economic nexus rules based on
        <a href="https://www.salestaxinstitute.com/resources/economic-nexus-state-guide" target="_blank" rel="noreferrer">
          Sales Tax Institute’s Economic Nexus State Guide
        </a>.
      </div>

      <div class="snapshot-grid" style="margin-top:14px;">
        <div class="stat-card">
          <div class="stat-label">Total sales (period)</div>
          <div class="stat-value">${formatMoney(totalSalesPeriod)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Total orders (period)</div>
          <div class="stat-value">${totalOrdersPeriod}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">States over thresholds (sales or orders)</div>
          <div class="stat-value">${statesOverAnyThreshold}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">States over sales threshold</div>
          <div class="stat-value">${statesOverSalesThreshold}</div>
        </div>
      </div>

      <div class="filters-row">
        <form method="GET">
          <span style="font-size:13px;">Period:</span>
          <select name="range" onchange="this.form.submit()">
            ${rangeOptions
              .map(
                (opt) => `<option value="${opt.value}"${
                  opt.value === preset ? " selected" : ""
                }>${opt.label}</option>`,
              )
              .join("")}
          </select>

          <span style="font-size:13px; margin-left:8px;">Basis:</span>
          <select name="basis" onchange="this.form.submit()">
            ${basisOptions
              .map(
                (opt) => `<option value="${opt.value}"${
                  opt.value === basis ? " selected" : ""
                }>${opt.label}</option>`,
              )
              .join("")}
          </select>

          <input type="hidden" name="realmId" value="${realmId}" />
          <input type="hidden" name="state" value="${state || ""}" />
          <input type="hidden" name="accessToken" value="${accessToken}" />
          <input type="hidden" name="refreshToken" value="${
            refreshToken || ""
          }" />
        </form>

        <a
          class="csv-link"
          href="data:text/csv;base64,${csvBase64}"
          download="nexus_txns_${startStr}_${endStr}_${basis}.csv"
        >
          Download CSV (transactions used in this report)
        </a>
      </div>

      <div class="text-muted" style="margin-bottom:10px;">
        Each row below is based on the same Invoices + Sales Receipts that feed the CSV file.
      </div>

      <div style="overflow-x:auto;">
        <table>
          <thead>
            <tr>
              <th>State</th>
              <th class="text-right">Orders</th>
              <th class="text-right">Sales</th>
              <th class="text-right">Avg order</th>
              <th>Risk</th>
            </tr>
          </thead>
          <tbody>
            ${
              rowsWithRisk.length === 0
                ? `<tr><td colspan="5" class="text-muted" style="padding:14px;">No Invoice or Sales Receipt data found in this period.</td></tr>`
                : rowsWithRisk
                    .map((row) => {
                      const badgeClass =
                        row.severity === "high"
                          ? "badge-high"
                          : row.severity === "medium"
                          ? "badge-medium"
                          : row.severity === "low"
                          ? "badge-low"
                          : row.severity === "info"
                          ? "badge-info"
                          : "badge-none";

                      const noteParts = [];
                      if (row.rule?.noStateSalesTax) {
                        noteParts.push("No state-level sales tax.");
                      }
                      if (row.thresholdLabel && !row.rule?.noStateSalesTax) {
                        noteParts.push("Threshold: " + row.thresholdLabel + ".");
                      }
                      if (row.rule?.notes) {
                        noteParts.push(row.rule.notes);
                      }
                      const noteText = noteParts.join(" ");

                      return `
                        <tr>
                          <td>${row.state}</td>
                          <td class="text-right">${row.orders}</td>
                          <td class="text-right">${formatMoney(row.sales)}</td>
                          <td class="text-right">${formatMoney(row.avgOrder)}</td>
                          <td>
                            <span class="badge ${badgeClass}" title="${noteText.replace(
                              /"/g,
                              "&quot;",
                            )}">
                              ${row.risk}
                            </span>
                          </td>
                        </tr>
                      `;
                    })
                    .join("")
            }
          </tbody>
        </table>
      </div>

      <details>
        <summary>Debug info (UT / N/A samples)</summary>
        <pre>${JSON.stringify(debugSample, null, 2)}</pre>
      </details>
    </section>
  </div>
</body>
</html>`;

    res.status(200).send(html);
  } catch (err) {
    console.error("[QBO callback] Unexpected error:", err);
    res
      .status(500)
      .send("Unexpected error while processing QuickBooks callback.");
  }
}
