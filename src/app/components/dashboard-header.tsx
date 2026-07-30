import { useEffect, useState } from "react";

const clientLogoSrc = "/brand/union-north-logo.png";

// ─── Inline SVG icons ─────────────────────────────────────────────────────────
function IconSearch() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="#8B90A0" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14, flexShrink: 0 }}>
      <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function IconBell() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="#4B5063" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ width: 17, height: 17 }}>
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

function IconUser() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16 }}>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function LiveDot() {
  return (
    <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: "#16A34A", animation: "glpulse 2s infinite", flexShrink: 0 }} />
  );
}

// ─── Component ────────────────────────────────────────────────────────────────
export function DashboardHeader() {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const timeStr = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const dateStr = now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'DM Sans', system-ui, sans-serif; background: #F5F6F8; color: #111318; }
        @keyframes glpulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
        .header-search:focus { outline: none; border-color: #263574 !important; background: #FFFFFF !important; }
        .header-bell:hover { background: #F5F6F8 !important; }
      `}</style>

      <header style={{ position: "sticky", top: 0, zIndex: 100, background: "#FFFFFF", borderBottom: "1px solid #E2E4EA", fontFamily: "'DM Sans', system-ui, sans-serif" }}>
        <div style={{ padding: "14px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>

          {/* ── Left: branding + date ── */}
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <img
              src={clientLogoSrc}
              alt=""
              style={{
                width: 34,
                height: 34,
                borderRadius: "50%",
                objectFit: "cover",
                boxShadow: "0 12px 22px rgba(38, 53, 116, 0.18)",
              }}
            />
            <div style={{ fontSize: 15, fontWeight: 600, color: "#111318", letterSpacing: "-0.2px", whiteSpace: "nowrap" }}>
              Line<span style={{ color: "#263574" }}>Matrix</span> — Operations Centre
            </div>
            <div style={{ width: 1, height: 20, background: "#CACDD8", flexShrink: 0 }} />
            <div style={{ fontSize: 12, color: "#8B90A0", whiteSpace: "nowrap" }}>{dateStr}</div>
          </div>

          {/* ── Right: search + actions ── */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>

            {/* Search */}
            <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
              <span style={{ position: "absolute", left: 10, display: "flex", alignItems: "center", pointerEvents: "none" }}>
                <IconSearch />
              </span>
              <input
                type="text"
                placeholder="Search workers, lines…"
                className="header-search"
                style={{ paddingLeft: 30, paddingRight: 12, paddingTop: 7, paddingBottom: 7, width: 260, border: "1px solid #E2E4EA", borderRadius: 10, background: "#F5F6F8", fontSize: 12, color: "#111318", fontFamily: "'DM Sans', system-ui, sans-serif", transition: "border-color 0.15s, background 0.15s" }}
              />
            </div>

            {/* Live badge */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 10px", borderRadius: 20, background: "#DCFCE7", fontSize: 12, fontWeight: 500, color: "#14532D" }}>
              <LiveDot /> Live
            </div>

            {/* Clock */}
            <div style={{ fontSize: 12, color: "#8B90A0", fontFamily: "monospace" }}>{timeStr}</div>

            {/* Bell */}
            <button
              className="header-bell"
              style={{ position: "relative", width: 34, height: 34, borderRadius: 10, border: "1px solid #E2E4EA", background: "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, transition: "background 0.15s" }}
            >
              <IconBell />
              {/* Badge */}
              <span style={{ position: "absolute", top: -4, right: -4, minWidth: 16, height: 16, borderRadius: 8, background: "#DC2626", color: "#FFFFFF", fontSize: 9, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 3px", border: "2px solid #FFFFFF" }}>
                3
              </span>
            </button>

            {/* Divider */}
            <div style={{ width: 1, height: 24, background: "#E2E4EA", flexShrink: 0 }} />

            {/* User */}
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#111318", lineHeight: 1.3 }}>Supervisor</div>
                <div style={{ fontSize: 11, color: "#8B90A0" }}>Production Manager</div>
              </div>
              <div style={{ width: 34, height: 34, borderRadius: "50%", background: "#263574", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <IconUser />
              </div>
            </div>

          </div>
        </div>
      </header>
    </>
  );
}

export default DashboardHeader;
