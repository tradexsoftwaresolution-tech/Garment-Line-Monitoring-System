import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router";
import { useAuth } from "../auth";
import { getAuthRedirectPath } from "../auth-routing";
import { AuthPageShell } from "../components/auth-page-shell";
import { AccessDeniedState, Button } from "../components/ops-ui";

export function SignUpPage() {
  const { isConfigured, loading, isAuthenticated, signUp } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const redirectTo = getAuthRedirectPath(location.state);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [feedbackTone, setFeedbackTone] = useState<"success" | "danger" | "info">("info");
  const [submitting, setSubmitting] = useState(false);

  if (!isConfigured) {
    return (
      <AccessDeniedState
        title="Supabase configuration required"
        description="Create the project .env file, restart Vite, and make sure the local Supabase stack is running before signing up."
      />
    );
  }

  if (loading) {
    return (
      <AccessDeniedState
        title="Loading secure session"
        description="The application is checking whether you already have an active session before showing sign-up."
      />
    );
  }

  if (isAuthenticated) {
    return <Navigate to={redirectTo} replace />;
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (password.length < 8) {
      setFeedback("Use at least 8 characters for the password.");
      setFeedbackTone("danger");
      return;
    }

    if (password !== confirmPassword) {
      setFeedback("Passwords do not match.");
      setFeedbackTone("danger");
      return;
    }

    setSubmitting(true);
    const result = await signUp(fullName, email, password);
    setFeedback(result.message);
    setFeedbackTone(result.ok ? "success" : "danger");
    setSubmitting(false);

    if (!result.ok) {
      return;
    }

    if (result.requiresEmailConfirmation) {
      navigate("/login", {
        replace: true,
        state: {
          from: redirectTo,
          flash: result.message,
          email,
        },
      });
      return;
    }

    navigate(redirectTo, { replace: true });
  };

  return (
    <AuthPageShell
      eyebrow="Create account"
      title="Sign up for workspace access"
      description="Create a Supabase-backed account for LineMatrix. New self-registered users start as Viewer until an administrator promotes their role."
      footer={
        <p className="ops-auth-footer-copy">
          Already have credentials? <Link to="/login" state={{ from: redirectTo }}>Go to sign in</Link>.
        </p>
      }
    >
      <div className="ops-auth-form-stack">
        <div>
          <div className="ops-card-title">Create your account</div>
          <p className="ops-card-subtitle">This signs you up in Supabase and creates a linked profile row automatically.</p>
        </div>

        <form className="ops-auth-form-stack" onSubmit={handleSubmit}>
          <label className="ops-filter-group">
            <span className="ops-filter-label">Full name</span>
            <input
              className="ops-input"
              type="text"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              placeholder="Your full name"
              autoComplete="name"
              required
            />
          </label>

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

          <div className="ops-auth-form-grid">
            <label className="ops-filter-group">
              <span className="ops-filter-label">Password</span>
              <input
                className="ops-input"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Minimum 8 characters"
                autoComplete="new-password"
                required
              />
            </label>

            <label className="ops-filter-group">
              <span className="ops-filter-label">Confirm password</span>
              <input
                className="ops-input"
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="Repeat password"
                autoComplete="new-password"
                required
              />
            </label>
          </div>

          {feedback ? <div className={`ops-badge tone-${feedbackTone}`}>{feedback}</div> : null}

          <div className="ops-auth-note">
            For import processing and validation management, use an `admin` or `hr` account. New sign-ups default to the `viewer` role until updated in Supabase.
          </div>

          <div className="ops-auth-actions">
            <Button tone="primary" type="submit" disabled={submitting}>
              {submitting ? "Creating account..." : "Create account"}
            </Button>
            <Link to="/login" state={{ from: redirectTo }} className="ops-button ops-button-secondary">
              Back to sign in
            </Link>
          </div>
        </form>
      </div>
    </AuthPageShell>
  );
}
