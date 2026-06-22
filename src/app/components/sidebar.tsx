import { Users, LayoutDashboard, ClipboardList, Settings, BarChart3, LogOut } from "lucide-react";
import { Link, useLocation } from "react-router";
import { useState } from "react";

export function Sidebar() {
  const location = useLocation();
  const [signOutHover, setSignOutHover] = useState(false);
  const [signOutActive, setSignOutActive] = useState(false);

  const navItems = [
    { path: "/",         icon: LayoutDashboard, label: "Dashboard" },
    { path: "/workers",  icon: Users,            label: "Workers" },
    { path: "/lines",    icon: ClipboardList,    label: "Production Lines" },
    { path: "/reports",  icon: BarChart3,        label: "Reports" },
    { path: "/settings", icon: Settings,         label: "Settings" },
  ];

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&display=swap');
      `}</style>

      <aside
        style={{
          width: 232,
          background: "#FFFFFF",
          borderRight: "1px solid #E2E4EA",
          display: "flex",
          flexDirection: "column",
          height: "100vh",
          flexShrink: 0,
          fontFamily: "'DM Sans', system-ui, sans-serif",
        }}
      >
        {/* ── Logo ── */}
        <div style={{ padding: "20px 18px", borderBottom: "1px solid #E2E4EA" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 34,
                height: 34,
                background: "#2563EB",
                borderRadius: 10,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <LayoutDashboard style={{ width: 18, height: 18, color: "#FFFFFF" }} />
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#111318", letterSpacing: "-0.2px" }}>
                Line<span style={{ color: "#2563EB" }}>Matrix</span>
              </div>
              <div style={{ fontSize: 11, color: "#8B90A0", marginTop: 1 }}>Factory Monitor</div>
            </div>
          </div>
        </div>

        {/* ── Nav ── */}
        <nav style={{ flex: 1, padding: "12px 10px", overflowY: "auto" }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 500,
              color: "#8B90A0",
              textTransform: "uppercase",
              letterSpacing: "0.7px",
              padding: "0 8px",
              marginBottom: 8,
            }}
          >
            Main Menu
          </div>

          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;

            return (
              <Link
                key={item.path}
                to={item.path}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "9px 12px",
                  borderRadius: 10,
                  fontSize: 13,
                  fontWeight: 500,
                  marginBottom: 2,
                  textDecoration: "none",
                  transition: "background 0.15s",
                  background: isActive ? "#2563EB" : "transparent",
                  color: isActive ? "#FFFFFF" : "#4B5063",
                }}
                onMouseEnter={(e) => {
                  if (!isActive) (e.currentTarget as HTMLElement).style.background = "#F5F6F8";
                }}
                onMouseLeave={(e) => {
                  if (!isActive) (e.currentTarget as HTMLElement).style.background = "transparent";
                }}
              >
                <Icon style={{ width: 18, height: 18, flexShrink: 0 }} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* ── Sign Out ── */}
        <div style={{ padding: "12px 10px", borderTop: "1px solid #E2E4EA" }}>
          <button
            onMouseEnter={() => setSignOutHover(true)}
            onMouseLeave={() => { setSignOutHover(false); setSignOutActive(false); }}
            onMouseDown={() => setSignOutActive(true)}
            onMouseUp={() => setSignOutActive(false)}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "9px 12px",
              borderRadius: 10,
              fontSize: 13,
              fontWeight: 500,
              border: "none",
              cursor: "pointer",
              fontFamily: "'DM Sans', system-ui, sans-serif",
              transition: "background 0.15s, color 0.15s",
              background: signOutActive ? "#FEE2E2" : signOutHover ? "#F5F6F8" : "transparent",
              color:      signOutActive ? "#DC2626" : "#4B5063",
            }}
          >
            <LogOut style={{ width: 18, height: 18, flexShrink: 0 }} />
            Sign Out
          </button>
        </div>
      </aside>
    </>
  );
}

export default Sidebar;
