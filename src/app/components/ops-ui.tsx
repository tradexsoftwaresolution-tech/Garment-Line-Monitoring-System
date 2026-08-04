import { useEffect, useId, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router";
import { AlertTriangle, ChevronRight, Download, Image, Search, X, type LucideIcon } from "lucide-react";
import type { AlertPriority, AttendanceStatus, ProductionLineRecord, RiskLevel, ValidationStatus, WorkerProfile } from "../types";

export function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function formatDateTime(value?: string) {
  if (!value) return "Not captured";
  return new Date(value).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatTime(value?: string) {
  if (!value) return "Not captured";
  return new Date(value).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-LK", {
    style: "currency",
    currency: "LKR",
    maximumFractionDigits: 0,
  }).format(value);
}

export function getInitials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function validationTone(status: ValidationStatus) {
  if (status === "Fully Validated") return "success";
  if (status === "Pending Validation" || status === "Time Mismatch") return "warning";
  if (status === "Face Only" || status === "Fingerprint Only") return "info";
  return "danger";
}

export function attendanceTone(status: AttendanceStatus) {
  if (status === "Present") return "success";
  if (status === "Late") return "warning";
  if (status === "On Leave") return "info";
  return "danger";
}

export function priorityTone(priority: AlertPriority) {
  if (priority === "critical") return "danger";
  if (priority === "high") return "warning";
  if (priority === "medium") return "info";
  return "neutral";
}

export function riskTone(risk: RiskLevel) {
  if (risk === "Stable") return "success";
  if (risk === "Watch") return "warning";
  return "danger";
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle: string; actions?: ReactNode }) {
  return (
    <div className="ops-page-header">
      <div>
        <h1 className="ops-page-title">{title}</h1>
        <p className="ops-page-subtitle">{subtitle}</p>
      </div>
      {actions ? <div className="ops-page-actions">{actions}</div> : null}
    </div>
  );
}

export function Button({
  children,
  tone = "secondary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: "primary" | "secondary" | "ghost" | "danger";
}) {
  return (
    <button className={cx("ops-button", `ops-button-${tone}`, className)} {...props}>
      {children}
    </button>
  );
}

export function SearchField({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <div className="ops-input-wrap" style={{ minWidth: 220, flex: "1 1 280px" }}>
      <Search />
      <input className="ops-input" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
    </div>
  );
}

export function Card({
  title,
  subtitle,
  actions,
  children,
  padded = true,
}: {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  padded?: boolean;
}) {
  return (
    <section className="ops-card">
      {title || subtitle || actions ? (
        <div className="ops-card-header">
          <div>
            {title ? <h2 className="ops-card-title">{title}</h2> : null}
            {subtitle ? <div className="ops-card-subtitle">{subtitle}</div> : null}
          </div>
          {actions ? <div className="ops-card-actions">{actions}</div> : null}
        </div>
      ) : null}
      <div className={padded ? "ops-card-body" : undefined}>{children}</div>
    </section>
  );
}

export function StatusBadge({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: "success" | "warning" | "danger" | "info" | "neutral" | "violet";
}) {
  return <span className={cx("ops-badge", `tone-${tone}`)}>{label}</span>;
}

export function KpiCard({
  label,
  value,
  meta,
  icon: Icon,
  accent,
  soft,
  onClick,
  ariaLabel,
}: {
  label: string;
  value: string;
  meta: string;
  icon: LucideIcon;
  accent: string;
  soft: string;
  onClick?: () => void;
  ariaLabel?: string;
}) {
  const content = (
    <>
      <div className="ops-kpi-label">{label}</div>
      <div className="ops-kpi-value-row">
        <div className="ops-kpi-value">{value}</div>
        <div className="ops-kpi-icon">
          <Icon size={18} />
        </div>
      </div>
      <div className="ops-kpi-meta">{meta}</div>
    </>
  );

  const style = { "--kpi-accent": accent, "--kpi-soft": soft } as CSSProperties;

  if (onClick) {
    return (
      <button
        type="button"
        className="ops-kpi-card ops-kpi-card-action"
        style={style}
        onClick={onClick}
        aria-label={ariaLabel || `View ${label} worker details`}
      >
        {content}
      </button>
    );
  }

  return (
    <div className="ops-kpi-card" style={style}>
      {content}
    </div>
  );
}

export function WorkerChip({ worker, meta }: { worker: WorkerProfile; meta?: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      {worker.photoUrl ? (
        <img
          src={worker.photoUrl}
          alt={worker.fullName}
          className="ops-avatar"
          style={{ objectFit: "cover" }}
        />
      ) : (
        <span className="ops-avatar ops-avatar-placeholder" aria-label={`${worker.fullName} photo placeholder`}>
          <Image size={15} />
          <span>{getInitials(worker.fullName)}</span>
        </span>
      )}
      <div style={{ minWidth: 0 }}>
        <div className="ops-row-title">{worker.fullName}</div>
        <div className="ops-row-subtitle">{worker.employeeId} · {worker.roleTitle}</div>
        {meta}
      </div>
    </div>
  );
}

export function WorkerCard({ worker, lineName, actions }: { worker: WorkerProfile; lineName: string; actions?: ReactNode }) {
  return (
    <article className="ops-worker-card">
      <div className="ops-item-header">
        <WorkerChip worker={worker} />
        <StatusBadge label={worker.finalValidationStatus} tone={validationTone(worker.finalValidationStatus)} />
      </div>
      <div className="ops-item-meta">
        <span>{worker.department}</span>
        <span>{lineName}</span>
        <span>{worker.shift}</span>
        <span>{worker.currentStatus}</span>
      </div>
      <div className="ops-item-description">{worker.skills.join(" · ")}</div>
      {actions ? <div className="ops-item-actions">{actions}</div> : null}
    </article>
  );
}

export function LineCard({ line, children, actions }: { line: ProductionLineRecord; children?: ReactNode; actions?: ReactNode }) {
  const capacityPercent =
    line.assignedWorkers === 0
      ? 0
      : Math.min(
          100,
          Math.round(((line.presentWorkers + line.lateWorkers) / line.assignedWorkers) * 100)
        );
  return (
    <article className="ops-line-card">
      <div className="ops-item-header">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className={cx("ops-line-health", `tone-${riskTone(line.risk)}`)} />
            <div className="ops-item-title">{line.name}</div>
          </div>
          <div className="ops-row-subtitle">
            {line.code} · Style {line.allocatedStyle || "Unassigned"} · {line.department} · {line.shift} · {line.supervisor}
          </div>
        </div>
        <div className={cx("ops-risk-badge", `risk-${line.risk.toLowerCase()}`)}>{line.risk}</div>
      </div>

      <div className="ops-meta-grid" style={{ marginTop: 14 }}>
        <div className="ops-key-value"><div className="ops-key-value-label">Assigned</div><div className="ops-key-value-value">{line.assignedWorkers}</div></div>
        <div className="ops-key-value"><div className="ops-key-value-label">Came Today</div><div className="ops-key-value-value">{line.presentWorkers + line.lateWorkers}</div></div>
        <div className="ops-key-value"><div className="ops-key-value-label">Attendance</div><div className="ops-key-value-value">{line.attendanceRate}%</div></div>
      </div>

      <div style={{ marginTop: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: "0.78rem", color: "var(--ops-text-soft)" }}>
          <span>Present vs assigned</span>
          <span>{line.presentWorkers + line.lateWorkers} / {line.assignedWorkers}</span>
        </div>
        <div className="ops-capacity-bar">
          <div className="ops-capacity-fill" style={{ width: `${capacityPercent}%` }} />
        </div>
      </div>

      {line.issue ? <div className="ops-item-description">{line.issue}</div> : null}
      {actions ? <div className="ops-item-actions">{actions}</div> : null}
      {children}
    </article>
  );
}

export function AlertItem({
  priority,
  title,
  description,
  meta,
  actions,
}: {
  priority: AlertPriority;
  title: string;
  description: string;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className={cx("ops-alert-item", `priority-${priority}`)}>
      <div className="ops-item-header">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <AlertTriangle size={18} />
          <div className="ops-item-title">{title}</div>
        </div>
        <StatusBadge label={priority.toUpperCase()} tone={priorityTone(priority)} />
      </div>
      <div className="ops-item-description">{description}</div>
      {meta ? <div className="ops-item-meta">{meta}</div> : null}
      {actions ? <div className="ops-item-actions">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="ops-empty-state">
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}

export function DetailDrawer({
  open,
  title,
  subtitle,
  onClose,
  footer,
  children,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="ops-drawer-backdrop" onClick={onClose}>
      <aside className="ops-drawer" onClick={(event) => event.stopPropagation()}>
        <div className="ops-drawer-header">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <div>
              <h2 className="ops-card-title">{title}</h2>
              {subtitle ? <div className="ops-card-subtitle">{subtitle}</div> : null}
            </div>
            <button className="ops-modal-close" onClick={onClose} aria-label="Close details">
              <X size={16} />
            </button>
          </div>
        </div>
        <div className="ops-drawer-body">{children}</div>
        {footer ? <div className="ops-drawer-footer">{footer}</div> : null}
      </aside>
    </div>
  );
}

export function DetailModal({
  open,
  title,
  subtitle,
  onClose,
  footer,
  children,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return undefined;

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div
      className="ops-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="ops-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="ops-modal-header">
          <div>
            <h2 id={titleId} className="ops-card-title">{title}</h2>
            {subtitle ? <div className="ops-card-subtitle">{subtitle}</div> : null}
          </div>
          <button className="ops-modal-close" onClick={onClose} aria-label="Close details" autoFocus>
            <X size={16} />
          </button>
        </div>
        <div className="ops-modal-body">{children}</div>
        {footer ? <div className="ops-modal-footer">{footer}</div> : null}
      </section>
    </div>
  );
}

export function ExportActions({ onExportCsv, onPrint }: { onExportCsv: () => void; onPrint?: () => void }) {
  return (
    <>
      <Button tone="secondary" onClick={onExportCsv}>
        <Download size={15} />
        Export CSV
      </Button>
      {onPrint ? <Button tone="ghost" onClick={onPrint}>Printable View</Button> : null}
    </>
  );
}

export function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows
    .map((row) =>
      row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")
    )
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export function MetricTile({ label, value, meta }: { label: string; value: string; meta?: string }) {
  return (
    <div className="ops-stat-tile">
      <div className="ops-stat-label">{label}</div>
      <div className="ops-stat-value">{value}</div>
      {meta ? <div className="ops-item-description" style={{ marginTop: 8 }}>{meta}</div> : null}
    </div>
  );
}

export function AccessDeniedState({ title, description }: { title: string; description: string }) {
  return (
    <div className="ops-access-state">
      <h2>{title}</h2>
      <p>{description}</p>
      <div style={{ marginTop: 18 }}>
        <Link to="/" className="ops-button ops-button-primary">
          Return to Dashboard
          <ChevronRight size={15} />
        </Link>
      </div>
    </div>
  );
}
