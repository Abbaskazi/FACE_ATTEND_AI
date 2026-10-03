import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ArrowRight, Fingerprint, LockKeyhole, ShieldCheck } from "lucide-react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { PageLoader } from "../components/ui";
import { supabase } from "../lib/supabase";

type EmployeeLoginResponse = {
  ok: boolean;
  error_code?: string;
  session?: { access_token: string; refresh_token: string };
};

type RecoveryStep = "code" | "otp" | "password" | "success";
type RecoveryResponse = { ok: boolean; message?: string; challenge_id?: string; maskedEmail?: string; error_code?: string };

const loginErrors: Record<string, string> = {
  INVALID_CREDENTIALS: "Employee ID or password is incorrect.",
  EMPLOYEE_INACTIVE: "This employee account is inactive. Contact an administrator.",
  EMPLOYEE_SUSPENDED: "This employee account is suspended. Contact an administrator.",
  ACCOUNT_NOT_PROVISIONED: "This employee account has not been provisioned yet. Contact an administrator.",
  AUTHENTICATION_UNAVAILABLE: "Employee authentication is temporarily unavailable. Please try again.",
};

export default function EmployeeLogin() {
  const navigate = useNavigate();
  const location = useLocation();
  const { loading: authLoading, identityLoading, role, user, employeeProfile } = useAuth();
  const [employeeCode, setEmployeeCode] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [forgotPassword, setForgotPassword] = useState(false);
  const [recoveryStep, setRecoveryStep] = useState<RecoveryStep>("code");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [recoveryOtp, setRecoveryOtp] = useState("");
  const [recoveryChallengeId, setRecoveryChallengeId] = useState("");
  const [recoveryNewPassword, setRecoveryNewPassword] = useState("");
  const [recoveryConfirmPassword, setRecoveryConfirmPassword] = useState("");
  const [recoveryReason, setRecoveryReason] = useState("");
  const [recoveryMessage, setRecoveryMessage] = useState("");
  const [recoveryMaskedEmail, setRecoveryMaskedEmail] = useState("");
  const [recoveryError, setRecoveryError] = useState("");
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendCooldownSeconds, setResendCooldownSeconds] = useState(0);

  useEffect(() => {
    if (!forgotPassword || recoveryStep !== "otp" || resendCooldownSeconds <= 0) return;
    const timer = window.setTimeout(() => setResendCooldownSeconds((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [forgotPassword, recoveryStep, resendCooldownSeconds]);

  if (authLoading || (user && identityLoading)) return <PageLoader label="Loading employee access…" />;
  if (user && role === "admin") return <Navigate to="/admin/dashboard" replace />;
  if (user && role === "employee") {
    return <Navigate to={employeeProfile?.must_change_password ? "/employee/change-password" : "/employee"} replace state={{ from: location }} />;
  }

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError("");

    const { data, error: invokeError } = await supabase.functions.invoke<EmployeeLoginResponse>("employee-login", {
      body: { employee_code: employeeCode, password },
    });

    if (invokeError || !data?.ok || !data.session?.access_token || !data.session.refresh_token) {
      setLoading(false);
      setError(data?.error_code ? (loginErrors[data.error_code] ?? "Employee login failed. Please try again.") : "Employee login failed. Please try again.");
      return;
    }

    const { error: sessionError } = await supabase.auth.setSession({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    });
    setLoading(false);
    if (sessionError) {
      setError("Your session could not be started. Please try again.");
      return;
    }
    navigate("/employee", { replace: true });
  };

  const handleRecoveryRequest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setRecoveryLoading(true);
    setRecoveryError("");
    const { data, error: invokeError } = await supabase.functions.invoke<RecoveryResponse>("employee-password-recovery", {
      body: { action: "request-otp", employee_code: recoveryCode },
    });
    setRecoveryLoading(false);
    if (invokeError || !data?.ok || !data.challenge_id || !data.maskedEmail) {
      setRecoveryError("Recovery is temporarily unavailable. Please try again.");
      return;
    }
    setRecoveryChallengeId(data.challenge_id);
    setRecoveryMaskedEmail(data.maskedEmail);
    setRecoveryMessage("");
    setResendCooldownSeconds(60);
    setRecoveryStep("otp");
  };

  const handleResendOtp = async () => {
    if (resendCooldownSeconds > 0 || resendLoading || !recoveryChallengeId) return;
    setRecoveryLoading(true);
    setResendLoading(true);
    setRecoveryError("");
    const { data, error: invokeError } = await supabase.functions.invoke<RecoveryResponse>("employee-password-recovery", {
      body: { action: "resend-otp", employee_code: recoveryCode, challenge_id: recoveryChallengeId },
    });
    setRecoveryLoading(false);
    setResendLoading(false);
    if (data?.error_code === "OTP_COOLDOWN" || data?.error_code === "OTP_RATE_LIMITED") {
      setRecoveryError("Please wait before requesting another OTP.");
      return;
    }
    if (invokeError || !data?.ok || !data.challenge_id || !data.maskedEmail) {
      setRecoveryError("Recovery is temporarily unavailable. Please try again.");
      return;
    }
    setRecoveryChallengeId(data.challenge_id);
    setRecoveryMaskedEmail(data.maskedEmail);
    setRecoveryOtp("");
    setRecoveryMessage(`New OTP sent to ${data.maskedEmail}.`);
    setResendCooldownSeconds(60);
  };

  const handleVerifyOtp = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setRecoveryLoading(true);
    setRecoveryError("");
    const { data, error: invokeError } = await supabase.functions.invoke<RecoveryResponse>("employee-password-recovery", {
      body: { action: "verify-otp", employee_code: recoveryCode, challenge_id: recoveryChallengeId, otp: recoveryOtp },
    });
    setRecoveryLoading(false);
    if (invokeError || !data?.ok) {
      if (data?.error_code === "OTP_EXPIRED") setRecoveryError("Your OTP has expired. Please request a new OTP.");
      else if (data?.error_code === "OTP_ATTEMPTS_EXCEEDED") setRecoveryError("Too many incorrect attempts. Please request a new OTP.");
      else setRecoveryError("Invalid OTP. Please try again.");
      return;
    }
    setRecoveryMessage("");
    setRecoveryStep("password");
  };

  const handleRecoveryReset = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (recoveryNewPassword !== recoveryConfirmPassword) {
      setRecoveryError("The new password and confirmation do not match.");
      return;
    }
    if (recoveryNewPassword.length < 8 || recoveryNewPassword.trim().toLowerCase() === "rajmotor") {
      setRecoveryError("Choose a password with at least 8 characters that is not RajMotor.");
      return;
    }
    setRecoveryLoading(true);
    setRecoveryError("");
    const { data, error: invokeError } = await supabase.functions.invoke<RecoveryResponse>("employee-password-recovery", {
      body: { action: "reset-password", employee_code: recoveryCode, challenge_id: recoveryChallengeId, new_password: recoveryNewPassword, confirm_password: recoveryConfirmPassword },
    });
    setRecoveryLoading(false);
    if (invokeError || !data?.ok) {
      setRecoveryError("The password could not be reset. The recovery session may have expired.");
      return;
    }
    setRecoveryNewPassword("");
    setRecoveryConfirmPassword("");
    setRecoveryStep("success");
  };

  const handleAdminResetRequest = async () => {
    setRecoveryLoading(true);
    setRecoveryError("");
    const { data, error: invokeError } = await supabase.functions.invoke<RecoveryResponse>("employee-password-recovery", {
      body: { action: "request-admin-reset", employee_code: recoveryCode, reason: recoveryReason },
    });
    setRecoveryLoading(false);
    if (invokeError || !data?.ok) {
      setRecoveryError("The request could not be submitted. Please try again.");
      return;
    }
    setRecoveryMessage("Your request has been submitted for administrator review.");
  };

  const openRecovery = () => {
    setForgotPassword(true);
    setRecoveryStep("code");
    setRecoveryChallengeId("");
    setRecoveryMaskedEmail("");
    setRecoveryOtp("");
    setResendCooldownSeconds(0);
    setResendLoading(false);
    setRecoveryError("");
    setRecoveryMessage("");
  };

  const closeRecovery = () => {
    setForgotPassword(false);
    setRecoveryStep("code");
    setRecoveryChallengeId("");
    setRecoveryMaskedEmail("");
    setRecoveryOtp("");
    setResendCooldownSeconds(0);
    setResendLoading(false);
    setRecoveryError("");
    setRecoveryMessage("");
  };

  return (
    <main className="login-page">
      <section className="login-visual">
        <div className="login-visual-inner">
          <div className="brand-lockup login-brand"><div className="brand-mark">F</div><div><div className="brand-name">FaceAttend <span>AI</span></div><div className="brand-caption">Employee portal</div></div></div>
          <div className="login-hero-copy"><div className="eyebrow eyebrow-light">Your attendance, in one place</div><h1>Welcome to your <em>workday.</em></h1><p>Sign in securely to access your employee portal and your own attendance information.</p></div>
          <div className="login-feature-list"><div><ShieldCheck size={18} /><span>Protected by Supabase Auth and row-level security</span></div><div><Fingerprint size={18} /><span>Your employee data stays private to your account</span></div></div>
        </div>
        <div className="visual-orb visual-orb-one" /><div className="visual-orb visual-orb-two" />
      </section>

      <section className="login-form-panel">
        <div className="login-form-wrap">
          <div className="mobile-login-brand brand-lockup"><div className="brand-mark">F</div><div><div className="brand-name">FaceAttend <span>AI</span></div><div className="brand-caption">Employee portal</div></div></div>
          <div className="login-heading"><div className="eyebrow">Employee access</div><h2>{forgotPassword ? "Forgot Password" : "Employee Login"}</h2><p>{forgotPassword ? "Recover access with the email registered to your employee account." : "Use your employee ID and password to continue."}</p></div>
          {!forgotPassword && <form className="auth-form" onSubmit={handleLogin}>
            <label htmlFor="employee-code">Employee ID<input id="employee-code" autoComplete="username" placeholder="EMP001" value={employeeCode} onChange={(event) => setEmployeeCode(event.target.value.toUpperCase())} required /></label>
            <label htmlFor="employee-password">Password<input id="employee-password" type="password" autoComplete="current-password" placeholder="Enter your password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
            {error && <div className="form-error" role="alert"><LockKeyhole size={16} />{error}</div>}
            <button className="button button-primary login-submit" type="submit" disabled={loading}>{loading ? "Signing in…" : "Login"}{!loading && <ArrowRight size={17} />}</button>
          </form>}
          {!forgotPassword && <button className="text-link login-forgot-link" type="button" onClick={openRecovery}>Forgot Password?</button>}
          {forgotPassword && recoveryStep === "code" && <form className="auth-form" onSubmit={handleRecoveryRequest}><label htmlFor="recovery-code">Employee Code<input id="recovery-code" autoComplete="username" value={recoveryCode} onChange={(event) => setRecoveryCode(event.target.value.toUpperCase())} required /></label>{recoveryError && <div className="form-error" role="alert">{recoveryError}</div>}<button className="button button-primary login-submit" type="submit" disabled={recoveryLoading}>{recoveryLoading ? "Checking…" : "Send Email OTP"}<ArrowRight size={17} /></button></form>}
          {forgotPassword && recoveryStep === "otp" && <form className="auth-form" onSubmit={handleVerifyOtp}>
            <div className="login-note recovery-email-note" role="status">
              <strong>Check your email</strong>
              <span>OTP sent to {recoveryMaskedEmail}</span>
              <span>Enter the 6-digit OTP sent to your registered email.</span>
              {recoveryMessage && <span>{recoveryMessage}</span>}
            </div>
            <label htmlFor="recovery-otp">Email OTP<input id="recovery-otp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={recoveryOtp} onChange={(event) => setRecoveryOtp(event.target.value.replace(/\D/g, ""))} required /></label>
            {recoveryError && <div className="form-error" role="alert">{recoveryError}</div>}
            <button className="button button-primary login-submit" type="submit" disabled={recoveryLoading}>{recoveryLoading ? "Verifying…" : "Verify OTP"}<ArrowRight size={17} /></button>
            <div className="recovery-resend">
              <span>Didn't receive the OTP?</span>
              <button className="text-link" type="button" onClick={() => void handleResendOtp()} disabled={recoveryLoading || resendCooldownSeconds > 0}>
                {resendLoading ? "Sending…" : resendCooldownSeconds > 0 ? `Resend OTP in ${resendCooldownSeconds}s` : "Resend OTP"}
              </button>
            </div>
            <label htmlFor="recovery-reason">Need administrator help? <span className="muted">Optional reason</span><textarea id="recovery-reason" rows={3} value={recoveryReason} onChange={(event) => setRecoveryReason(event.target.value)} /></label>
            <button className="button button-secondary" type="button" onClick={() => void handleAdminResetRequest()} disabled={recoveryLoading}>Request Admin Password Reset</button>
          </form>}
          {forgotPassword && recoveryStep === "password" && <form className="auth-form" onSubmit={handleRecoveryReset}><label htmlFor="recovery-new-password">New Password<input id="recovery-new-password" type="password" autoComplete="new-password" value={recoveryNewPassword} onChange={(event) => setRecoveryNewPassword(event.target.value)} required /></label><label htmlFor="recovery-confirm-password">Confirm New Password<input id="recovery-confirm-password" type="password" autoComplete="new-password" value={recoveryConfirmPassword} onChange={(event) => setRecoveryConfirmPassword(event.target.value)} required /></label>{recoveryError && <div className="form-error" role="alert">{recoveryError}</div>}<button className="button button-primary login-submit" type="submit" disabled={recoveryLoading}>{recoveryLoading ? "Saving…" : "Create New Password"}<ArrowRight size={17} /></button></form>}
          {forgotPassword && recoveryStep === "success" && <div className="login-note" role="status">Your password has been reset. You can now sign in with your employee code and new password.<button className="button button-primary login-submit" type="button" onClick={closeRecovery}>Return to Login</button></div>}
          {forgotPassword && recoveryStep !== "success" && <button className="button button-ghost" type="button" onClick={closeRecovery}>Back to Login</button>}
        </div>
        <div className="login-footer">© {new Date().getFullYear()} FaceAttend AI <span>•</span> Secure employee access</div>
      </section>
    </main>
  );
}
