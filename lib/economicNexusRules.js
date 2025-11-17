// lib/economicNexusRules.js

// Helper per creare una regola standard
const createRule = (sales, transactions, options = {}) => ({
  thresholdSales: sales ?? null, // in USD
  thresholdTransactions: transactions ?? null,
  noStateSalesTax: !!options.noStateSalesTax,
  notes: options.notes || "",
  source: "Sales Tax Institute – Economic Nexus State Guide",
});

/**
 * Regole di economic nexus per ciascuno Stato.
 *
 * NB: I numeri (100k, 200, 500k, ecc.) sono allineati
 * alla Economic Nexus State Guide del Sales Tax Institute. :contentReference[oaicite:0]{index=0}
 * Alcuni stati hanno rimosso la soglia per numero di transazioni:
 * in quei casi thresholdTransactions è null.
 *
 * Stati senza sales tax a livello statale (DE, MT, NH, OR)
 * sono marcati con noStateSalesTax: true.
 */
export const ECONOMIC_NEXUS_RULES = {
  // Alabama – $250k, niente soglia transazioni
  AL: createRule(250000, null, {
    notes: "More than $250,000 in the previous 12-month period.",
  }),

  // Alaska – nessuna sales tax statale (solo locali)
  AK: createRule(null, null, {
    noStateSalesTax: true,
    notes:
      "No statewide sales tax. Local jurisdictions may have their own economic nexus rules.",
  }),

  // Arizona – 100k o 200 transazioni
  AZ: createRule(100000, 200),

  // Arkansas – 100k o 200 transazioni
  AR: createRule(100000, 200),

  // California – 500k solo vendite
  CA: createRule(500000, null, {
    notes:
      "Sales of tangible personal property into CA in the current or prior calendar year.",
  }),

  // Colorado – 100k solo vendite
  CO: createRule(100000, null),

  // Connecticut – 100k + 200 vendite
  CT: createRule(100000, 200, {
    notes: "Threshold is $100,000 in sales AND 200 or more retail transactions.",
  }),

  // District of Columbia – 100k o 200
  DC: createRule(100000, 200),

  // Delaware – nessuna sales tax
  DE: createRule(null, null, {
    noStateSalesTax: true,
    notes: "No sales tax at the state level.",
  }),

  // Florida – 100k solo vendite
  FL: createRule(100000, null),

  // Georgia – 100k o 200
  GA: createRule(100000, 200),

  // Hawaii – 100k solo vendite (GET)
  HI: createRule(100000, null),

  // Idaho – 100k o 200
  ID: createRule(100000, 200),

  // Illinois – 100k o 200
  IL: createRule(100000, 200),

  // Indiana – 100k o 200
  IN: createRule(100000, 200),

  // Iowa – 100k solo vendite (la soglia transazioni è stata rimossa)
  IA: createRule(100000, null),

  // Kansas – 100k solo vendite
  KS: createRule(100000, null),

  // Kentucky – 100k o 200
  KY: createRule(100000, 200),

  // Louisiana – 100k solo vendite
  LA: createRule(100000, null),

  // Maine – 100k o 200
  ME: createRule(100000, 200),

  // Maryland – 100k o 200
  MD: createRule(100000, 200),

  // Massachusetts – 100k solo vendite
  MA: createRule(100000, null),

  // Michigan – 100k o 200
  MI: createRule(100000, 200),

  // Minnesota – 100k o 200 retail sales
  MN: createRule(100000, 200),

  // Mississippi – > $250k
  MS: createRule(250000, null),

  // Missouri – 100k solo vendite
  MO: createRule(100000, null),

  // Montana – no sales tax
  MT: createRule(null, null, {
    noStateSalesTax: true,
    notes: "No sales tax at the state level.",
  }),

  // Nebraska – 100k o 200
  NE: createRule(100000, 200),

  // Nevada – 100k o 200
  NV: createRule(100000, 200),

  // New Hampshire – no sales tax
  NH: createRule(null, null, {
    noStateSalesTax: true,
    notes: "No sales tax at the state level.",
  }),

  // New Jersey – 100k o 200
  NJ: createRule(100000, 200),

  // New Mexico – 100k solo vendite
  NM: createRule(100000, null),

  // New York – 500k + più di 100 vendite
  NY: createRule(500000, 100, {
    notes:
      "More than $500,000 in sales of tangible personal property AND more than 100 sales.",
  }),

  // North Carolina – 100k, soglia transazioni rimossa
  NC: createRule(100000, null, {
    notes: "Transaction threshold removed effective July 1, 2024.",
  }),

  // North Dakota – 100k, soglia transazioni rimossa
  ND: createRule(100000, null, {
    notes: "Transaction threshold removed effective December 31, 2018.",
  }),

  // Ohio – 100k o 200
  OH: createRule(100000, 200),

  // Oklahoma – 100k solo vendite di TPP
  OK: createRule(100000, null),

  // Oregon – no sales tax
  OR: createRule(null, null, {
    noStateSalesTax: true,
    notes: "No sales tax at the state level.",
  }),

  // Pennsylvania – 100k solo vendite (periodo rolling 12 mesi)
  PA: createRule(100000, null),

  // Rhode Island – 100k o 200
  RI: createRule(100000, 200),

  // South Carolina – 100k solo vendite
  SC: createRule(100000, null),

  // South Dakota – 100k, soglia transazioni rimossa
  SD: createRule(100000, null, {
    notes: "Transaction threshold removed effective July 1, 2023.",
  }),

  // Tennessee – 100k solo vendite
  TN: createRule(100000, null),

  // Texas – 500k solo vendite
  TX: createRule(500000, null),

  // Utah – 100k, soglia transazioni rimossa (luglio 2025)
  UT: createRule(100000, null, {
    notes: "Transaction threshold removed effective July 1, 2025.",
  }),

  // Vermont – 100k o 200
  VT: createRule(100000, 200),

  // Virginia – 100k o 200
  VA: createRule(100000, 200),

  // Washington – 100k solo gross income, no transaction threshold
  WA: createRule(100000, null, {
    notes:
      "Uses a $100,000 gross income threshold. Transaction threshold removed.",
  }),

  // West Virginia – 100k o 200
  WV: createRule(100000, 200),

  // Wisconsin – 100k, soglia transazioni rimossa
  WI: createRule(100000, null, {
    notes: "Transaction threshold removed effective February 20, 2021.",
  }),

  // Wyoming – 100k, soglia transazioni rimossa
  WY: createRule(100000, null, {
    notes: "Transaction threshold removed effective July 1, 2024.",
  }),

  // Puerto Rico – 100k o 200 transazioni
  PR: createRule(100000, 200, {
    notes: "Puerto Rico – seller’s accounting/fiscal year.",
  }),
};

/**
 * Restituisce la regola per uno stato (es. "CA"), oppure null se non impostata.
 */
export function getEconomicNexusRule(stateCode) {
  if (!stateCode) return null;
  return ECONOMIC_NEXUS_RULES[stateCode] || null;
}

/**
 * Testo leggibile della soglia, da usare in tooltip / note.
 * Es: "$100,000 or 200 orders", "$500,000", "No state sales tax", "n/a".
 */
export function describeThreshold(rule) {
  if (!rule) return "n/a";
  if (rule.noStateSalesTax) return "No state sales tax";

  const parts = [];
  if (rule.thresholdSales != null) {
    parts.push(
      `$${rule.thresholdSales.toLocaleString("en-US", {
        maximumFractionDigits: 0,
      })}`,
    );
  }
  if (rule.thresholdTransactions != null) {
    parts.push(`${rule.thresholdTransactions} orders`);
  }
  if (!parts.length) return "n/a";
  return parts.join(" or ");
}
