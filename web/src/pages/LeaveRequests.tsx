import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronRight, Filter, X } from "lucide-react";
import { useAuth } from "../auth/AuthProvider";
import { ErrorState, formatDate, formatDateTime, PageLoader, StatusBadge } from "../components/ui";
import {
  approveEmployeeLeaveRequest,
  getAdminLeaveRequests,
  rejectEmployeeLeaveRequest,
} from "../lib/data";
import type { LeaveRequest, LeaveRequestEmployee, LeaveRequestStatus } from "../types/database";

type StatusFilter = LeaveRequestStatus | "ALL";

function statusTone(status: LeaveRequestStatus): "success" | "warning" | "muted" | "danger" {
  switch (status) {
    case "APPROVED": return "success";
    case "PENDING": return "warning";
    case "REJECTED": return "danger";
    case "CANCELLED": return "muted";
  }
}

function normalizeRequest(request: LeaveRequest & { employees?: LeaveRequestEmployee | LeaveRequestEmployee[] | null }) {
  const employees = Array.isArray(request.employees) ? request.employees[0] ?? null : request.employees ?? null;
  return { ...request, employees };
}

export default function LeaveRequests() {
  const { user } = useAuth();
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusFilter>("PENDING");
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [department, setDepartment] = useState("ALL");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const loadRequests = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const loaded = await getAdminLeaveRequests();
      setRequests(loaded.map((request) => normalizeRequest(request as LeaveRequest & { employees?: LeaveRequestEmployee | LeaveRequestEmployee[] | null })));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Leave requests could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Admin visibility remains protected by the database policy; this query is
    // only a presentation-level filter over authorized rows.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadRequests();
  }, [loadRequests]);

  const departments = useMemo(() => [...new Set(requests.map((request) => request.employees?.departments?.name).filter((name): name is string => Boolean(name)))].sort(), [requests]);
  const filteredRequests = useMemo(() => {
    const search = employeeSearch.trim().toLowerCase();
    return requests.filter((request) => {
      const employee = request.employees;
      const matchesStatus = status === "ALL" || request.status === status;
      const matchesSearch = !search || employee?.full_name.toLowerCase().includes(search) || employee?.employee_code.toLowerCase().includes(search);
      const matchesDepartment = department === "ALL" || employee?.departments?.name === department;
      const matchesFrom = !fromDate || request.end_date >= fromDate;
      const matchesTo = !toDate || request.start_date <= toDate;
      return matchesStatus && matchesSearch && matchesDepartment && matchesFrom && matchesTo;
    });
  }, [department, employeeSearch, fromDate, requests, status, toDate]);

  const selectedRequest = requests.find((request) => request.id === selectedId) ?? filteredRequests[0] ?? null;

  const runAction = async (requestId: string, action: "approve" | "reject") => {
    setActionId(requestId);
    setError("");
    try {
      if (action === "approve") {
        await approveEmployeeLeaveRequest(requestId);
      } else {
        await rejectEmployeeLeaveRequest(requestId, rejectionReason);
        setRejectionReason("");
      }
      await loadRequests();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Leave request action failed.");
    } finally {
      setActionId(null);
    }
  };

  if (!user) return <PageLoader label="Loading leave requests…" />;

  return (
    <>
      {error && <ErrorState message={error} onRetry={() => void loadRequests()} />}
      <section className="panel leave-admin-filters">
        <div className="filter-heading"><Filter size={17} /><strong>Filter requests</strong></div>
        <label>Status<select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)}><option value="ALL">All statuses</option><option value="PENDING">Pending</option><option value="APPROVED">Approved</option><option value="REJECTED">Rejected</option><option value="CANCELLED">Cancelled</option></select></label>
        <label>Employee<input value={employeeSearch} placeholder="Name or employee code" onChange={(event) => setEmployeeSearch(event.target.value)} /></label>
        <label>Department<select value={department} onChange={(event) => setDepartment(event.target.value)}><option value="ALL">All departments</option>{departments.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
        <label>From<input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label>
        <label>To<input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></label>
      </section>

      <section className="leave-admin-layout">
        <div className="panel table-panel leave-admin-list">
          <div className="panel-header"><div><h2>Leave requests</h2><p>Server-validated paid leave requests.</p></div><div className="table-summary">{filteredRequests.length} shown</div></div>
          {loading ? <PageLoader label="Loading leave requests…" /> : filteredRequests.length === 0 ? <div className="leave-empty">No requests match the selected filters.</div> : <div className="table-scroll"><table><thead><tr><th>Employee</th><th>Department</th><th>Dates</th><th>Paid days</th><th>Status</th><th /></tr></thead><tbody>{filteredRequests.map((request) => <tr className={selectedRequest?.id === request.id ? "table-row-selected" : ""} key={request.id} onClick={() => setSelectedId(request.id)}><td><strong>{request.employees?.full_name ?? "Unknown employee"}</strong><span className="table-secondary">{request.employees?.employee_code ?? request.employee_id}</span></td><td>{request.employees?.departments?.name ?? "Unassigned"}</td><td>{formatDate(request.start_date)} – {formatDate(request.end_date)}</td><td>{request.requested_working_days}</td><td><StatusBadge tone={statusTone(request.status)}>{request.status}</StatusBadge></td><td><ChevronRight size={16} className="table-row-chevron" /></td></tr>)}</tbody></table></div>}
        </div>

        <aside className="panel leave-detail-panel">
          {!selectedRequest ? <div className="leave-empty">Select a request to view details.</div> : <LeaveRequestDetail request={selectedRequest} rejectionReason={rejectionReason} setRejectionReason={setRejectionReason} actionId={actionId} onAction={(action) => void runAction(selectedRequest.id, action)} />}
        </aside>
      </section>
    </>
  );
}

function LeaveRequestDetail({
  request,
  rejectionReason,
  setRejectionReason,
  actionId,
  onAction,
}: {
  request: LeaveRequest;
  rejectionReason: string;
  setRejectionReason: (value: string) => void;
  actionId: string | null;
  onAction: (action: "approve" | "reject") => void;
}) {
  const employee = request.employees;
  return (
    <div className="leave-detail-content">
      <div className="panel-header"><div><div className="eyebrow">Request detail</div><h2>{employee?.full_name ?? "Unknown employee"}</h2><p>{employee?.employee_code ?? request.employee_id}</p></div><StatusBadge tone={statusTone(request.status)}>{request.status}</StatusBadge></div>
      <div className="leave-detail-grid"><div><span>Department</span><strong>{employee?.departments?.name ?? "Unassigned"}</strong></div><div><span>Designation</span><strong>{employee?.designation ?? "Employee"}</strong></div><div><span>Start date</span><strong>{formatDate(request.start_date)}</strong></div><div><span>End date</span><strong>{formatDate(request.end_date)}</strong></div><div><span>Paid leave days</span><strong>{request.requested_working_days}</strong></div><div><span>Created</span><strong>{formatDateTime(request.created_at)}</strong></div></div>
      <div className="leave-detail-reason"><span>Reason</span><p>{request.reason}</p></div>
      {request.rejection_reason && <div className="rejection-note rejection-note-block"><span>Rejection reason</span><p>{request.rejection_reason}</p></div>}
      {request.status === "PENDING" && <div className="leave-review-actions"><button className="button button-primary" type="button" disabled={actionId === request.id} onClick={() => onAction("approve")}><Check size={15} /> {actionId === request.id ? "Checking…" : "Approve"}</button><label>Optional rejection reason<textarea value={rejectionReason} maxLength={2000} rows={3} placeholder="Reason shown to the employee" onChange={(event) => setRejectionReason(event.target.value)} /></label><button className="button button-danger" type="button" disabled={actionId === request.id} onClick={() => onAction("reject")}><X size={15} /> Reject</button></div>}
    </div>
  );
}
