export default function Loading() {
  return (
    <main className="page" aria-busy="true" aria-label="Loading page">
      <p role="status">Loading Doot…</p>
      <div className="card" style={{ padding: 20, display: "grid", gap: 16 }}>
        <div className="skeleton" style={{ height: 24, width: "45%" }} />
        <div className="skeleton" style={{ height: 16 }} />
        <div className="skeleton" style={{ height: 16, width: "80%" }} />
      </div>
    </main>
  );
}
