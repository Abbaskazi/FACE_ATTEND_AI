import { useState } from "react";
import type { FormEvent } from "react";
import { ArrowRight, CheckCircle2, LockKeyhole, LogOut } from "lucide-react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { PageLoader } from "../components/ui";
import { supabase } from "../lib/supabase";

const requirements = ["At least 8 characters", "Not blank or whitespace-only", "Must not be RajMotor", "Both fields must match"];

function errorMessage(code: string | undefined) {
  switch (code) {
    case "PASSWORD_UPDATE_FAILED": return "The password could not be saved completely. Please submit the same new password again to finish securely.";
    case "CURRENT_PASSWORD_INVALID": return "The current password is incorrect.";
    case "EMPLOYEE_INACTIVE": return "This employee account is no longer active.";
    default: return "The password could not be changed. Please try again.";
  }
}

export default function EmployeeChangePassword() {
  const navigate = useNavigate();
  const { loading, identityLoading, role, user, employeeProfile, refreshIdentity, signOut } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loadingChange, setLoadingChange] = useState(false);
  const [error, setError] = useState("");

  if (loading || identityLoading) return <PageLoader label="Checking your employee session…" />;
  if (!user) return <Navigate to="/employee/login" replace />;
  if (role === "admin") return <Navigate to="/admin/dashboard" replace />;
  if (role !== "employee" || !employeeProfile) return <Navigate to="/employee/login" replace />;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    if (!currentPassword.trim()) {
      setError("Enter your current password.");
      return;
    }
    if (newPassword.length < 8) {
      setError("Your new password must be at least 8 characters.");
      return;
    }
    if (!newPassword.trim()) {
      setError("Your new password cannot be blank.");
      return;
    }
    if (newPassword.trim().toLowerCase() === "rajmotor") {
      setError("You cannot keep the temporary password RajMotor.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("The new password and confirmation do not match.");
      return;
    }

    setLoadingChange(true);
    const { data, error: invokeError } = await supabase.functions.invoke<{ ok: boolean; error_code?: string }>("employee-password-change", {
      body: { current_password: currentPassword, new_password: newPassword, confirm_password: confirmPassword },
    });
    if (invokeError || !data?.ok) {
      setLoadingChange(false);
      setError(errorMessage(data?.error_code));
      return;
    }

    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    await supabase.auth.getSession();
    await refreshIdentity();
    setLoadingChange(false);
    navigate("/employee", { replace: true });
  };

  return (
    <main className="login-page">
      <section className="login-visual">
        <div className="login-visual-inner">
          <div className="brand-lockup login-brand"><div className="brand-mark">F</div><div><div className="brand-name">FaceAttend <span>AI</span></div><div className="brand-caption">Employee portal</div></div></div>
          <div className="login-hero-copy"><div className="eyebrow eyebrow-light">One quick security step</div><h1>Make your account <em>your own.</em></h1><p>A new password protects your private employee portal. This step is required only once.</p></div>
          <div className="login-feature-list"><div><CheckCircle2 size={18} /><span>Your temporary password cannot remain active</span></div><div><LockKeyhole size={18} /><span>Your password is managed securely by Supabase Auth</span></div></div>
        </div>
        <div className="visual-orb visual-orb-one" /><div className="visual-orb visual-orb-two" />
      </section>
      <section className="login-form-panel">
        <div className="login-form-wrap">
          <div className="mobile-login-brand brand-lockup"><div className="brand-mark">F</div><div><div className="brand-name">FaceAttend <span>AI</span></div><div className="brand-caption">Employee portal</div></div></div>
          <div className="login-heading"><div className="eyebrow">Required on first login</div><h2>Change your password</h2><p>Create a private password before entering your employee portal.</p></div>
          <form className="auth-form" onSubmit={handleSubmit}>
            <label htmlFor="current-password">Current Password<input id="current-password" type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></label>
            <label htmlFor="new-password">New Password<input id="new-password" type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /></label>
            <label htmlFor="confirm-password">Confirm New Password<input id="confirm-password" type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required /></label>
            <div className="password-requirements"><strong>Password requirements</strong>{requirements.map((requirement) => <span key={requirement}>• {requirement}</span>)}</div>
            {error && <div className="form-error" role="alert"><LockKeyhole size={16} />{error}</div>}
            <button className="button button-primary login-submit" type="submit" disabled={loadingChange}>{loadingChange ? "Changing password…" : "Change Password"}{!loadingChange && <ArrowRight size={17} />}</button>
          </form>
          <button className="button button-ghost" type="button" onClick={() => void signOut()}><LogOut size={15} /> Sign out</button>
        </div>
        <div className="login-footer">© {new Date().getFullYear()} FaceAttend AI <span>•</span> Secure employee access</div>
      </section>
    </main>
  );
}
