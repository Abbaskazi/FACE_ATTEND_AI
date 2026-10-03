import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, RotateCcw, Search, X } from "lucide-react";
import { approvePasswordChangeRequest, getAdminPasswordChangeRequests, rejectPasswordChangeRequest } from "../lib/data";
import type { PasswordChangeRequest, PasswordChangeRequestStatus } from "../types/database";
import { EmptyState, ErrorState, formatDateTime, PageLoader, StatusBadge } from "../components/ui";

function statusTone(status: PasswordChangeRequestStatus): "success" | "warning" | "danger" | "muted" {
  if (status === "APPROVED" || status === "COMPLETED") return "success";
  if (status === "PENDING") return "warning";
  if (status === "REJECTED") return "danger";
  return "muted";
}

export default function PasswordChangeRequests() {
  const [requests, setRequests] = useState<PasswordChangeRequest[]>([]);
  const [status, setStatus] = useState<"ALL" | PasswordChangeRequestStatus>("PENDING");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<PasswordChangeRequest | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");

  const loadRequests = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setRequests(await getAdminPasswordChangeRequests());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Password change requests could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Supabase is an external request source; load it after the page mounts.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadRequests(); }, [loadRequests]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return requests.filter((request) => {
      const employee = request.employees;
      const matchesStatus = status === "ALL" || request.status === status;
      const matchesSearch = !needle || [employee?.full_name ?? "", employee?.employee_code ?? "", employee?.departments?.name ?? ""].some((value) => value.toLowerCase().includes(needle));
      return matchesStatus && matchesSearch;
    });
  }, [requests, search, status]);

  const approve = async (request: PasswordChangeRequest) => {
    setProcessingId(request.id);
    setActionError("");
    try {
      await approvePasswordChangeRequest(request.id);
      await loadRequests();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Password reset could not be completed.");
    } finally {
      setProcessingId(null);
    }
  };

  const reject = async () => {
    if (!rejecting) return;
    setProcessingId(rejecting.id);
    setActionError("");
    try {
      await rejectPasswordChangeRequest(rejecting.id, rejectionReason);
      setRejecting(null);
      setRejectionReason("");
      await loadRequests();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Password request could not be rejected.");
    } finally {
      setProcessingId(null);
    }
  };

  if (loading) return <PageLoader label="Loading password change requests…" />;
  if (error) return <ErrorState message={error} onRetry={() => void loadRequests()} />;

  return <div className="page-stack">
    <section className="toolbar panel"><div className="search-field"><Search size={17} /><input aria-label="Search password requests" placeholder="Search by employee, code, or department" value={search} onChange={(event) => setSearch(event.target.value)} /></div><select value={status} onChange={(event) => setStatus(event.target.value as "ALL" | PasswordChangeRequestStatus)} aria-label="Filter password requests"><option value="PENDING">Pending</option><option value="ALL">All statuses</option><option value="APPROVED">Approved</option><option value="COMPLETED">Completed</option><option value="REJECTED">Rejected</option></select><button className="button button-secondary" type="button" onClick={() => void loadRequests()}><RotateCcw size={15} /> Refresh</button></section>
    {actionError && <div className="form-error" role="alert">{actionError}</div>}
    <section className="panel table-panel"><div className="panel-header"><div><h2>Password Change Requests</h2><p>Administrator review and secure temporary-password resets.</p></div><div className="table-summary">{filtered.length} shown</div></div>{filtered.length === 0 ? <EmptyState title="No password change requests" description="Requests submitted by employees will appear here." /> : <div className="table-scroll"><table><thead><tr><th>Employee</th><th>Department</th><th>Requested at</th><th>Status</th><th>Reason</th><th>Actions</th></tr></thead><tbody>{filtered.map((request) => <tr key={request.id}><td><strong className="table-primary">{request.employees?.full_name ?? "Unknown employee"}</strong><span className="table-secondary">{request.employees?.employee_code ?? "—"}</span></td><td>{request.employees?.departments?.name ?? "Unassigned"}</td><td>{formatDateTime(request.created_at)}</td><td><StatusBadge tone={statusTone(request.status)}>{request.status}</StatusBadge>{request.status === "APPROVED" && <span className="table-secondary">Must change password</span>}</td><td>{request.reason || request.rejection_reason || <span className="muted">No reason provided</span>}</td><td>{request.status === "PENDING" ? <div className="table-actions"><button className="button button-primary button-small" type="button" disabled={processingId === request.id} onClick={() => void approve(request)}><Check size={14} /> Approve</button><button className="button button-secondary button-small" type="button" disabled={processingId === request.id} onClick={() => { setRejecting(request); setRejectionReason(""); }}><X size={14} /> Reject</button></div> : <span className="muted">{request.completed_at ? `Completed ${formatDateTime(request.completed_at)}` : request.rejected_at ? `Rejected ${formatDateTime(request.rejected_at)}` : "—"}</span>}</td></tr>)}</tbody></table></div>}</section>
    {rejecting && <div className="modal-backdrop" role="presentation"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="reject-password-request-title"><div className="modal-header"><div><div className="eyebrow">Administrator action</div><h2 id="reject-password-request-title">Reject password request</h2></div><button className="icon-button" type="button" onClick={() => setRejecting(null)} aria-label="Close"><X size={19} /></button></div><p>Reject the request from <strong>{rejecting.employees?.full_name ?? "this employee"}</strong>?</p><label htmlFor="password-rejection-reason">Reason (optional)<textarea id="password-rejection-reason" rows={4} value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value)} /></label><div className="modal-actions"><button className="button button-secondary" type="button" onClick={() => setRejecting(null)} disabled={processingId === rejecting.id}>Cancel</button><button className="button button-danger" type="button" onClick={() => void reject()} disabled={processingId === rejecting.id}>{processingId === rejecting.id ? "Rejecting…" : "Reject request"}</button></div></section></div>}
  </div>;
}
