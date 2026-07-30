import type { ReactNode } from "react";
import { Activity, ClipboardCheck, Fingerprint, ShieldCheck } from "lucide-react";

const authFeatures = [
  {
    icon: Activity,
    title: "Live operations visibility",
    description:
      "Attendance, line readiness, biometric verification, alerts, and reporting stay connected in one controlled workspace.",
  },
  {
    icon: Fingerprint,
    title: "Biometric attendance reconciliation",
    description:
      "Face events and fingerprint punches are monitored together so teams can review present, absent, late, and mismatch records.",
  },
  {
    icon: ClipboardCheck,
    title: "Auditable role-based access",
    description:
      "Admins, HR, IE, and supervisors receive the right modules and every operational change remains traceable.",
  },
];

const copyrightText = `© ${new Date().getFullYear()} Tradex Innovations. All rights reserved.`;
const clientLogoSrc = "/brand/union-north-logo.png";

export function AuthPageShell({
  eyebrow,
  title,
  description,
  children,
  footer,
  showBrandPanel = true,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
  showBrandPanel?: boolean;
}) {
  return (
    <div className={`ops-auth-page${showBrandPanel ? "" : " ops-auth-page-centered"}`}>
      {showBrandPanel ? (
        <section className="ops-auth-panel ops-auth-panel-brand">
          <div className="ops-auth-brand-top">
            <div className="ops-auth-brand-lockup" aria-label="LineMatrix">
              <div className="ops-auth-logo ops-client-logo-mark" aria-hidden="true">
                <img src={clientLogoSrc} alt="" />
              </div>
              <div>
                <div className="ops-auth-brand-name">LineMatrix</div>
                <div className="ops-auth-brand-subtitle">Operations Centre</div>
              </div>
            </div>

            <div className="ops-auth-brand-copy">
              <div className="ops-auth-eyebrow">
                <ShieldCheck size={16} />
                {eyebrow}
              </div>
              <h1 className="ops-auth-title">{title}</h1>
              {description ? <p className="ops-auth-description">{description}</p> : null}
            </div>
          </div>

          <div className="ops-auth-feature-list">
            {authFeatures.map((feature) => {
              const Icon = feature.icon;
              return (
                <div className="ops-auth-feature" key={feature.title}>
                  <div className="ops-auth-feature-icon">
                    <Icon size={18} />
                  </div>
                  <div>
                    <div className="ops-auth-feature-title">{feature.title}</div>
                    <p>{feature.description}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="ops-auth-panel ops-auth-panel-form">
        {!showBrandPanel ? (
          <div className="ops-auth-centered-copy">
            <div className="ops-auth-brand-lockup" aria-label="LineMatrix">
              <div className="ops-auth-logo ops-client-logo-mark" aria-hidden="true">
                <img src={clientLogoSrc} alt="" />
              </div>
              <div>
                <div className="ops-auth-brand-name">LineMatrix</div>
                <div className="ops-auth-brand-subtitle">Operations Centre</div>
              </div>
            </div>
            <div className="ops-auth-eyebrow">
              <ShieldCheck size={16} />
              {eyebrow}
            </div>
            <h1 className="ops-auth-centered-title">{title}</h1>
            {description ? <p className="ops-auth-centered-description">{description}</p> : null}
          </div>
        ) : null}
        {children}
        {footer ? <div className="ops-auth-footer">{footer}</div> : null}
        <div className="ops-auth-copyright">{copyrightText}</div>
      </section>
    </div>
  );
}
