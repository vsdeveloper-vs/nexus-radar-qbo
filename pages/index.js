export default function Home() {
  const handleConnectClick = () => {
    // Chiama la nostra API che costruisce l'URL di Intuit e fa il redirect
    window.location.href = "/api/qbo/auth";
  };

  return (
    <main
      style={{
        fontFamily: "system-ui, -apple-system, sans-serif",
        padding: "2rem",
        maxWidth: "640px"
      }}
    >
      <h1>Nexus Radar (Dev)</h1>
      <p style={{ marginTop: "1rem" }}>
        Se vedi questa pagina, Next.js sta girando su Vercel.
      </p>
      <p style={{ marginBottom: "2rem" }}>
        Prossimo step: collega un&apos;azienda QuickBooks in sandbox per iniziare
        a leggere le vendite per stato.
      </p>

      <button
        onClick={handleConnectClick}
        style={{
          padding: "0.75rem 1.5rem",
          fontSize: "1rem",
          borderRadius: "999px",
          border: "none",
          cursor: "pointer",
          fontWeight: 600,
          boxShadow: "0 2px 6px rgba(0,0,0,0.15)"
        }}
      >
        Connect to QuickBooks
      </button>
    </main>
  );
}
