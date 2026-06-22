import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router";
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

  if (!isConfigured) {
    return (
      <AccessDeniedState
        title="Supabase configuration required"
        description="Create the project .env file, restart Vite, and make sure the local Supabase stack is running before signing in."
      />
    );
  }

  if (loading) {
    return (
      <AccessDeniedState
        title="Loading secure session"
        description="The application is checking your existing Supabase session before showing the sign-in form."
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
      eyebrow="Secure access"
      title="Sign in to LineMatrix"
      description="Use your Supabase credentials to open the live operations workspace and continue with the same protected data across every screen."
      footer={
        <p className="ops-auth-footer-copy">
          Need a new workspace account? <Link to="/sign-up" state={{ from: redirectTo }}>Create one here</Link>.
        </p>
      }
    >
      <div className="ops-auth-form-stack">
        <div>
          <div className="ops-card-title">Welcome back</div>
          <p className="ops-card-subtitle">Sign in with an existing account to continue into the operational workspace.</p>
        </div>

        <form className="ops-auth-form-stack" onSubmit={handleSubmit}>
          <label className="ops-filter-group">
            <span className="ops-filter-label">Email address</span>
            <input
              className="ops-input"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </label>

          <label className="ops-filter-group">
            <span className="ops-filter-label">Password</span>
            <input
              className="ops-input"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter your password"
              autoComplete="current-password"
              required
            />
          </label>

          {feedback ? <div className={`ops-badge tone-${feedbackTone}`}>{feedback}</div> : null}

          <div className="ops-auth-actions">
            <Button tone="primary" type="submit" disabled={submitting}>
              {submitting ? "Signing in..." : "Sign in"}
            </Button>
            <Link to="/sign-up" state={{ from: redirectTo }} className="ops-button ops-button-secondary">
              Sign up
            </Link>
          </div>
        </form>
      </div>
    </AuthPageShell>
  );
}
