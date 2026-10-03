import { useState } from "react";
import type { FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { ArrowRight, Fingerprint, LockKeyhole, ShieldCheck } from "lucide-react";
import { useAuth } from "../auth/AuthProvider";
import { supabase } from "../lib/supabase";
import { PageLoader } from "../components/ui";

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { loading: authLoading, identityLoading, role, user } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  if (authLoading) return <PageLoader label="Loading FaceAttend AI…" />;
  if (user && identityLoading) return <PageLoader label="Checking your access…" />;
  if (user && role === "employee") {
    return <Navigate to="/employee" replace />;
  }
  if (user && role === "admin") {
    const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname;
    return <Navigate to={from && from !== "/login" && from !== "/admin" ? from : "/admin/dashboard"} replace />;
  }

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError("");

    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);

    if (signInError) {
      setError(signInError.message);
      return;
    }

    navigate("/admin/dashboard", { replace: true });
  };

  return (
    <main className="login-page">
      <section className="login-visual">
        <div className="login-visual-inner">
          <div className="brand-lockup login-brand"><div className="brand-mark">F</div><div><div className="brand-name">FaceAttend <span>AI</span></div><div className="brand-caption">Admin workspace</div></div></div>
          <div className="login-hero-copy"><div className="eyebrow eyebrow-light">Attendance, made intelligent</div><h1>A clearer view of your <em>workforce.</em></h1><p>Securely manage people, attendance, and the insights that help your team show up at its best.</p></div>
          <div className="login-feature-list"><div><ShieldCheck size={18} /><span>Protected by Supabase Auth and row-level security</span></div><div><Fingerprint size={18} /><span>Biometric data stays outside the admin workspace</span></div></div>
        </div>
        <div className="visual-orb visual-orb-one" /><div className="visual-orb visual-orb-two" />
      </section>

      <section className="login-form-panel">
        <div className="login-form-wrap">
          <div className="mobile-login-brand brand-lockup"><div className="brand-mark">F</div><div><div className="brand-name">FaceAttend <span>AI</span></div><div className="brand-caption">Admin workspace</div></div></div>
          <div className="login-heading"><div className="eyebrow">Welcome back</div><h2>Sign in to your workspace</h2><p>Use your administrator credentials to continue.</p></div>
          <form className="auth-form" onSubmit={handleLogin}>
            <label htmlFor="email">Email address<input id="email" type="email" autoComplete="email" placeholder="you@company.com" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
            <label htmlFor="password">Password<input id="password" type="password" autoComplete="current-password" placeholder="Enter your password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
            {error && <div className="form-error" role="alert"><LockKeyhole size={16} />{error}</div>}
            <button className="button button-primary login-submit" type="submit" disabled={loading}>{loading ? "Signing in…" : "Sign in"}{!loading && <ArrowRight size={17} />}</button>
          </form>
          <div className="login-note"><LockKeyhole size={15} /> Admin access only. Contact your workspace owner if you need access.</div>
        </div>
        <div className="login-footer">© {new Date().getFullYear()} FaceAttend AI <span>•</span> Secure attendance management</div>
      </section>
    </main>
  );
}
