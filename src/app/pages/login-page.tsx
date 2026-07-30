import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";
import { Eye, EyeOff, LockKeyhole, Mail, ShieldCheck } from "lucide-react";
import { useAuth } from "../auth";
import { getAuthRedirectPath, getAuthRouteState } from "../auth-routing";
import { AuthPageShell } from "../components/auth-page-shell";
import { AccessDeniedState, Button } from "../components/ops-ui";

export function LoginPage() {
  const { isConfigured, loading, isAuthenticated, signInWithPassword } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const redirectTo = getAuthRedirectPath(location.state);
  const { flash, email: prefilledEmail } = getAuthRouteState(location.state);

  const [email, setEmail] = useState(prefilledEmail || "");
  const [password, setPassword] = useState("");
  const [feedback, setFeedback] = useState<string | null>(flash || null);
  const [feedbackTone, setFeedbackTone] = useState<"success" | "danger" | "info">(
    flash ? "info" : "info"
  );
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  if (!isConfigured) {
    return (
      <AccessDeniedState
        title="Secure workspace unavailable"
        description="LineMatrix is not connected to its authentication service in this environment. Contact the system administrator before signing in."
      />
    );
  }

  if (loading) {
    return (
      <AccessDeniedState
        title="Loading secure session"
        description="LineMatrix is checking your existing session before opening the sign-in form."
      />
    );
  }

  if (isAuthenticated) {
    return <Navigate to={redirectTo} replace />;
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    const result = await signInWithPassword(email, password);
    setFeedback(result.message);
    setFeedbackTone(result.ok ? "success" : "danger");
    setSubmitting(false);

    if (result.ok) {
      navigate(redirectTo, { replace: true });
    }
  };

  return (
    <AuthPageShell
      eyebrow="Secure client access"
      title="Sign in to LineMatrix"
      description=""
      showBrandPanel={false}
    >
      <div className="ops-auth-form-card">
        <div className="ops-auth-form-header">
          <div className="ops-auth-form-icon">
            <ShieldCheck size={20} />
          </div>
          <div>
            <div className="ops-card-title">Welcome back</div>
            <p className="ops-card-subtitle">
              Authorized staff can continue into the operational workspace.
            </p>
          </div>
        </div>

        <form className="ops-auth-form-stack" onSubmit={handleSubmit}>
          <label className="ops-filter-group">
            <span className="ops-filter-label">Email address</span>
            <span className="ops-auth-input-shell">
              <Mail size={18} aria-hidden="true" />
              <input
                className="ops-input"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@company.com"
                autoComplete="email"
                inputMode="email"
                spellCheck={false}
                required
              />
            </span>
          </label>

          <label className="ops-filter-group">
            <span className="ops-filter-label">Password</span>
            <span className="ops-auth-input-shell">
              <LockKeyhole size={18} aria-hidden="true" />
              <input
                className="ops-input"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter your password"
                autoComplete="current-password"
                required
              />
              <button
                className="ops-auth-password-toggle"
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </span>
          </label>

          {feedback ? (
            <div className={`ops-auth-feedback tone-${feedbackTone}`} role="status">
              {feedback}
            </div>
          ) : null}

          <div className="ops-auth-actions">
            <Button tone="primary" type="submit" disabled={submitting}>
              {submitting ? "Verifying..." : "Sign in securely"}
            </Button>
          </div>

          <div className="ops-auth-security-note">
            <ShieldCheck size={16} aria-hidden="true" />
            <span>Authorized access only. Accounts are issued and managed by the system administrator.</span>
          </div>
        </form>
      </div>
    </AuthPageShell>
  );
}
