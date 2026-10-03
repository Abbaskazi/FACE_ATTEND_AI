import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { CalendarDays, CheckCircle2, Clock3, FileText, LogOut, XCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import EmployeePortalNav from "../components/EmployeePortalNav";
import { EmptyState, ErrorState, formatDate, formatDateTime, PageLoader, StatusBadge } from "../components/ui";
import {
  cancelEmployeeLeaveRequest,
  getEmployeeLeaveRequests,
  requestEmployeePaidLeave,
} from "../lib/data";
import {
  calculateLeavePreview,
  formatLeaveMonth,
  getApprovedLeaveUsageByMonth,
  getLeaveToday,
  PAID_LEAVE_ALLOWANCE,
} from "../lib/leave";
import { getHolidays } from "../lib/holidays";
import type { Holiday, LeaveRequest, LeaveRequestStatus } from "../types/database";

function statusTone(status: LeaveRequestStatus): "success" | "warning" | "muted" | "danger" {
  switch (status) {
    case "APPROVED": return "success";
    case "PENDING": return "warning";
    case "REJECTED": return "danger";
    case "CANCELLED": return "muted";
  }
}

export default function EmployeeLeave() {
  const navigate = useNavigate();
  const { employeeProfile, signOut } = useAuth();
  const today = getLeaveToday();
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");

  const loadRequests = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setRequests(await getEmployeeLeaveRequests());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Leave requests could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Leave data is loaded only after the employee route has authenticated the
    // session; RLS remains the authoritative owner check.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadRequests();
  }, [loadRequests]);

  useEffect(() => {
    const requestDates = requests.flatMap((request) => [request.start_date, request.end_date]);
    const from = [today.slice(0, 7) + "-01", startDate, ...requestDates].sort()[0];
    const currentMonthEnd = `${today.slice(0, 7)}-${new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0).getDate().toString().padStart(2, "0")}`;
    const to = [currentMonthEnd, endDate, ...requestDates].sort().at(-1) ?? currentMonthEnd;
    // Holiday data is limited to dates used by the leave form and history.
    void getHolidays({ from, to }).then(setHolidays).catch(() => undefined);
  }, [endDate, requests, startDate, today]);

  const preview = useMemo(() => calculateLeavePreview(startDate, endDate, holidays), [endDate, holidays, startDate]);
  const approvedUsage = useMemo(() => getApprovedLeaveUsageByMonth(requests, holidays), [holidays, requests]);
  const currentMonth = today.slice(0, 7);
  const currentMonthUsed = approvedUsage.get(currentMonth) ?? 0;
  const currentMonthRemaining = Math.max(0, PAID_LEAVE_ALLOWANCE - currentMonthUsed);
  const pendingRequests = requests.filter((request) => request.status === "PENDING");
  const previousRequests = requests.filter((request) => request.status !== "PENDING");

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError("");
    if (!startDate || !endDate || startDate > endDate) {
      setFormError("Choose a valid start and end date.");
      return;
    }
    if (!preview.workingDays) {
      setFormError("Select at least one working day. Friday is not a paid-leave day.");
      return;
    }
    if (!reason.trim()) {
      setFormError("Enter a reason for the leave request.");
      return;
    }
    const allowanceExceeded = preview.months.some((month) =>
      (approvedUsage.get(month.month) ?? 0) + month.workingDays > PAID_LEAVE_ALLOWANCE,
    );
    if (allowanceExceeded) {
      setFormError("This request exceeds the approved paid-leave allowance in at least one month.");
      return;
    }

    setSubmitting(true);
    try {
      await requestEmployeePaidLeave({ startDate, endDate, reason });
      setReason("");
      setStartDate(today);
      setEndDate(today);
      await loadRequests();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "Leave request could not be submitted.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async (requestId: string) => {
    setActionId(requestId);
    setError("");
    try {
      await cancelEmployeeLeaveRequest(requestId);
      await loadRequests();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Leave request could not be cancelled.");
    } finally {
      setActionId(null);
    }
  };

  const handleLogout = async () => {
    await signOut();
    navigate("/employee/login", { replace: true });
  };

  if (!employeeProfile) return <PageLoader label="Loading your leave portal…" />;

  return (
    <main className="employee-portal-page">
      <header className="employee-portal-header">
        <div className="brand-lockup"><div className="brand-mark">F</div><div><div className="brand-name">FaceAttend <span>AI</span></div><div className="brand-caption">Employee portal</div></div></div>
        <div className="employee-portal-header-actions"><span className="portal-header-name">{employeeProfile.full_name}</span><button className="button button-secondary" type="button" onClick={() => void handleLogout()}><LogOut size={15} /> Sign out</button></div>
      </header>

      <div className="employee-portal-content">
        <EmployeePortalNav />

        <div className="page-intro">
          <div><div className="eyebrow">Employee portal</div><h1>Paid leave</h1><p className="portal-subtitle">Request and track your monthly paid leave allowance.</p></div>
          <div className="page-date"><CalendarDays size={16} /> {formatDate(today)}</div>
        </div>

        {error && <ErrorState message={error} onRetry={() => void loadRequests()} />}

        <section className="leave-summary-grid">
          <article className="metric-card"><div className="metric-icon metric-icon-blue"><CalendarDays size={18} /></div><span className="metric-label">Paid leave allowance</span><div className="metric-value">{PAID_LEAVE_ALLOWANCE}</div><div className="metric-detail">{formatLeaveMonth(currentMonth)}</div></article>
          <article className="metric-card"><div className="metric-icon metric-icon-purple"><CheckCircle2 size={18} /></div><span className="metric-label">Approved used</span><div className="metric-value">{currentMonthUsed}</div><div className="metric-detail">Working days only</div></article>
          <article className="metric-card"><div className="metric-icon metric-icon-green"><Clock3 size={18} /></div><span className="metric-label">Remaining</span><div className="metric-value">{currentMonthRemaining}</div><div className="metric-detail">Does not carry forward</div></article>
        </section>

        <section className="panel leave-request-panel">
          <div className="panel-header"><div><div className="eyebrow">New request</div><h2>Request paid leave</h2><p>Fridays are excluded; Saturday and Sunday are working days.</p></div><FileText size={20} className="panel-icon" /></div>
          <form className="leave-request-form" onSubmit={(event) => void handleSubmit(event)}>
            <div className="leave-form-grid">
              <label>Start date<input type="date" value={startDate} min={today} onChange={(event) => setStartDate(event.target.value)} /></label>
              <label>End date<input type="date" value={endDate} min={startDate || today} onChange={(event) => setEndDate(event.target.value)} /></label>
            </div>
            <label>Reason<textarea value={reason} maxLength={2000} rows={3} placeholder="Briefly explain the reason for your leave" onChange={(event) => setReason(event.target.value)} /></label>
            <div className="leave-preview">
              <div><span>Calendar days</span><strong>{preview.calendarDays}</strong></div>
              <div><span>Paid leave days</span><strong>{preview.workingDays}</strong></div>
              <div><span>Monthly allocation</span><strong>{preview.months.length ? preview.months.map((month) => `${formatLeaveMonth(month.month)}: ${month.workingDays}`).join(" · ") : "—"}</strong></div>
            </div>
            {formError && <div className="form-error" role="alert">{formError}</div>}
            <div className="leave-form-actions"><span className="form-help">The server recalculates dates, Fridays, conflicts, and allowance before creating the request.</span><button className="button button-primary" type="submit" disabled={submitting}>{submitting ? "Submitting…" : "Submit request"}</button></div>
          </form>
        </section>

        <section className="panel table-panel">
          <div className="panel-header"><div><h2>Pending requests</h2><p>Pending requests reserve their dates but do not consume paid leave.</p></div><div className="table-summary">{pendingRequests.length} request{pendingRequests.length === 1 ? "" : "s"}</div></div>
          {loading ? <PageLoader label="Loading leave requests…" /> : pendingRequests.length === 0 ? <EmptyState title="No pending requests" description="New requests will appear here until an administrator reviews them." /> : <LeaveRequestTable requests={pendingRequests} actionId={actionId} onCancel={handleCancel} />}
        </section>

        <section className="panel table-panel">
          <div className="panel-header"><div><h2>Request history</h2><p>Approved leave is reflected in your attendance calendar and salary.</p></div><div className="table-summary">{previousRequests.length} request{previousRequests.length === 1 ? "" : "s"}</div></div>
          {loading ? <PageLoader label="Loading history…" /> : previousRequests.length === 0 ? <EmptyState title="No previous requests" description="Completed requests will appear here." /> : <LeaveRequestTable requests={previousRequests} />}
        </section>
      </div>
    </main>
  );
}

function LeaveRequestTable({
  requests,
  actionId,
  onCancel,
}: {
  requests: LeaveRequest[];
  actionId?: string | null;
  onCancel?: (requestId: string) => void;
}) {
  return (
    <div className="table-scroll"><table><thead><tr><th>Dates</th><th>Paid days</th><th>Reason</th><th>Status</th><th>Submitted</th><th>Details</th></tr></thead><tbody>{requests.map((request) => <tr key={request.id}><td>{formatDate(request.start_date)} – {formatDate(request.end_date)}</td><td>{request.requested_working_days}</td><td className="leave-reason-cell">{request.reason}</td><td><StatusBadge tone={statusTone(request.status)}>{request.status}</StatusBadge></td><td>{formatDateTime(request.created_at)}</td><td>{request.status === "REJECTED" && request.rejection_reason ? <span className="rejection-note">{request.rejection_reason}</span> : request.status === "PENDING" && onCancel ? <button className="button button-secondary button-small" type="button" disabled={actionId === request.id} onClick={() => onCancel(request.id)}><XCircle size={14} /> {actionId === request.id ? "Cancelling…" : "Cancel"}</button> : <span className="muted">—</span>}</td></tr>)}</tbody></table></div>
  );
}
