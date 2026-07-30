import { LucideIcon } from "lucide-react";
import { ReactNode } from "react";

interface StatsCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  trend?: {
    value: string;
    positive?: boolean;
  };
  iconBgColor?: string;
  iconColor?: string;
  accentColor?: string;
  subtitle?: ReactNode;
}

export function StatsCard({
  title,
  value,
  icon: Icon,
  trend,
  iconBgColor = "#DBEAFE",
  iconColor = "#263574",
  accentColor = "#263574",
  subtitle,
}: StatsCardProps) {
  return (
    <div
      style={{
        background: "#FFFFFF",
        border: "1px solid #E2E4EA",
        borderRadius: 14,
        padding: "16px 18px",
        position: "relative",
        overflow: "hidden",
        fontFamily: "'DM Sans', system-ui, sans-serif",
      }}
    >
      {/* ── Left accent stripe ── */}
      <div
        style={{
          position: "absolute",
          top: 0, left: 0,
          width: 3,
          height: "100%",
          background: accentColor,
          borderRadius: "3px 0 0 3px",
        }}
      />

      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        {/* ── Text side ── */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 500,
              color: "#8B90A0",
              textTransform: "uppercase",
              letterSpacing: "0.6px",
              marginBottom: 5,
            }}
          >
            {title}
          </div>

          <div
            style={{
              fontSize: 26,
              fontWeight: 600,
              color: "#111318",
              letterSpacing: "-1px",
              lineHeight: 1.1,
              marginBottom: 4,
            }}
          >
            {value}
          </div>

          {subtitle && (
            <div style={{ fontSize: 12, color: "#4B5063", marginTop: 2 }}>
              {subtitle}
            </div>
          )}

          {trend && (
            <div
              style={{
                fontSize: 12,
                fontWeight: 500,
                marginTop: 5,
                color: trend.positive ? "#16A34A" : "#DC2626",
              }}
            >
              {trend.value}
            </div>
          )}
        </div>

        {/* ── Icon bubble ── */}
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: 8,
            background: iconBgColor,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            marginLeft: 12,
          }}
        >
          <Icon style={{ width: 16, height: 16, color: iconColor }} />
        </div>
      </div>
    </div>
  );
}

export default StatsCard;