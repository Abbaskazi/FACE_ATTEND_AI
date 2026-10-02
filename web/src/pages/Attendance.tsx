import { useCallback, useEffect, useMemo, useState } from "react";
import { Calendar, Filter, RotateCcw, Trash2 } from "lucide-react";
import { deleteAttendanceSession, getAttendance, getDateDaysAgo, getToday, normalizeAttendanceStatus } from "../lib/data";
import type { AttendanceRecord, AttendanceStatus } from "../types/database";
import { EmptyState, ErrorState, formatDate, formatMinutes, formatTime, Initials, PageLoader, StatusBadge } from "../components/ui";

const statusOptions: Array<"ALL" | AttendanceStatus> = ["ALL", "PRESENT", "HALF_DAY", "LEAVE", "ABSENT"];

export default function Attendance() {
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [from, setFrom] = useState(getDateDaysAgo(29));
  const [to, setTo] = useState(getToday());
  const [status, setStatus] = useState<"ALL" | AttendanceStatus>("ALL");
  const [applied, setApplied] = useState({ from: getDateDaysAgo(29), to: getToday() });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadAttendance = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setRecords(await getAttendance(applied));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Please try again in a moment.");
    } finally {
      setLoading(false);
    }
  }, [applied]);

  const requestDelete = async (record: AttendanceRecord) => {
    const confirmed = window.confirm([
      "Delete this attendance session?",
      "",
      `Employee: ${record.employees?.full_name ?? "Unknown employee"}`,
      `Employee ID: ${record.employees?.employee_code ?? "Unknown ID"}`,
      `Date: ${formatDate(record.attendance_date)}`,
      `Check-in: ${formatTime(record.check_in)}`,
      `Check-out: ${formatTime(record.check_out)}`,
      `Working duration: ${formatMinutes(record.working_minutes)}`,
    ].join("\n"));
    if (!confirmed) return;

    setDeletingId(record.id);
    setError("");
    try {
      await deleteAttendanceSession(record.id);
      await loadAttendance();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Attendance session could not be deleted.");
    } finally {
      setDeletingId(null);
    }
  };

  // Supabase data is an external system; load it when the filters change.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadAttendance(); }, [loadAttendance]);

  const filteredRecords = status === "ALL" ? records : records.filter((record) => normalizeAttendanceStatus(record.status) === status);
  const dailyTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const record of records) {
      const key = `${record.employee_id}:${record.attendance_date}`;
      totals.set(key, (totals.get(key) ?? 0) + (record.working_minutes ?? 0));
    }
    return totals;
  }, [records]);
  const applyFilters = () => { if (from <= to) setApplied({ from, to }); };

  return (
    <div className="page-stack">
      <section className="filters panel"><div className="filter-heading"><Filter size={17} /><strong>Filter records</strong></div><label>From<input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} /></label><label>To<input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} /></label><label>Status<select value={status} onChange={(event) => setStatus(event.target.value as "ALL" | AttendanceStatus)}>{statusOptions.map((option) => <option key={option} value={option}>{option === "ALL" ? "All statuses" : option.replace("_", " ")}</option>)}</select></label><button className="button button-secondary filter-apply" onClick={applyFilters} disabled={from > to}><Calendar size={16} /> Apply</button><button className="icon-button filter-reset" onClick={() => { const nextFrom = getDateDaysAgo(29); const nextTo = getToday(); setFrom(nextFrom); setTo(nextTo); setStatus("ALL"); setApplied({ from: nextFrom, to: nextTo }); }} aria-label="Reset filters" title="Reset filters"><RotateCcw size={16} /></button></section>
      <section className="panel table-panel"><div className="panel-header"><div><h2>Attendance records</h2><p>{applied.from === applied.to ? formatDate(applied.from) : `${formatDate(applied.from)} – ${formatDate(applied.to)}`}</p></div><div className="table-summary">{filteredRecords.length} record{filteredRecords.length === 1 ? "" : "s"}</div></div>{loading ? <PageLoader label="Loading attendance…" /> : error ? <ErrorState message={error} onRetry={() => void loadAttendance()} /> : filteredRecords.length === 0 ? <EmptyState title="No records found" description="Try adjusting the date range or status filter." /> : <div className="table-scroll"><table><thead><tr><th>Employee</th><th>Date</th><th>Check-in</th><th>Check-out</th><th>Status</th><th>Session time</th><th>Day total</th><th>Actions</th></tr></thead><tbody>{filteredRecords.map((record) => <tr key={record.id}><td><div className="person-cell"><Initials name={record.employees?.full_name ?? "Unknown"} /><div><strong>{record.employees?.full_name ?? "Unknown employee"}</strong><span>{record.employees?.employee_code ?? "—"}</span></div></div></td><td>{formatDate(record.attendance_date)}</td><td className="time-cell">{formatTime(record.check_in)}</td><td className="time-cell">{formatTime(record.check_out)}</td><td><StatusBadge tone={record.status === "PRESENT" ? "success" : record.status === "HALF_DAY" ? "warning" : record.status === "LEAVE" ? "info" : "muted"}>{record.status.replace("_", " ")}</StatusBadge></td><td>{formatMinutes(record.working_minutes)}</td><td>{formatMinutes(dailyTotals.get(`${record.employee_id}:${record.attendance_date}`) ?? 0)}</td><td><button className="icon-button" type="button" title="Delete attendance session" aria-label={`Delete attendance session for ${record.employees?.full_name ?? "employee"}`} onClick={() => void requestDelete(record)} disabled={deletingId !== null}><Trash2 size={16} /></button></td></tr>)}</tbody></table></div>}</section>
    </div>
  );
}
