export default function Home() {
  const startConnect = (range) => {
    // range: "last12", "ytd", "lastYear"
    window.location.href = `/api/qbo/auth?range=${encodeURIComponent(range)}`;
  };

  const buttonStyle = {
    padding: "0.75rem 1.5rem",
    fontSize: "0.95rem",
    borderRadius: "999px",
    border: "none",
    cursor: "pointer",
    fontWeight: 600,
    boxShadow: "0 2px 6px rgba(0,0,0,0.12)",
    background: "#111827",
    color: "white",
    marginRight: "0.75rem",
    marginBottom: "0.75rem"
  };

  return (
    <main
      style={{
        fontFamily: "system-ui, -apple-system, sans-serif",
        padding: "2rem",
        maxWidth: "720px"
      }}
    >
      <h1>Nexus Radar (Dev)</h1>
      <p style={{ marginTop: "1rem" }}>
        Collega una company QuickBooks (sandbox) e genera un mini report di
        vendite per Stato.
      </p>
      <p style={{ marginBottom: "1.5rem" }}>
        Puoi scegliere il periodo da analizzare: Last 12 months, Year-to-Date
        (YTD) oppure Last calendar year.
      </p>

      <h2 style={{ fontSize: "1.1rem", marginBottom: "0.75rem" }}>
        Connect to QuickBooks by period
      </h2>

      <div>
        <button
          style={buttonStyle}
          onClick={() => startConnect("last12")}
        >
          Last 12 months
        </button>

        <button
          style={buttonStyle}
          onClick={() => startConnect("ytd")}
        >
          Year-to-Date (YTD)
        </button>

        <button
          style={buttonStyle}
          onClick={() => startConnect("lastYear")}
        >
          Last calendar year
        </button>
      </div>
    </main>
  );
}
