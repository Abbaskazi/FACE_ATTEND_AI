import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { ArrowLeft, CalendarDays, ChevronLeft, ChevronRight, Clock3, RotateCcw, Save, Trash2, X } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { deleteEmployee, getAdminProfile, getEmployee, getEmployeeAttendance, updateEmployeeSalary } from "../lib/data";
import {
  buildAttendanceCalendar,
  getCurrentMonth,
  getDayTooltip,
  getMonthWeekdayOffset,
  shiftMonth,
  type CalendarDay,
} from "../lib/attendanceCalendar";
import { EmptyState, ErrorState, formatDate, PageLoader, StatusBadge } from "../components/ui";
import type { AttendanceRecord, Employee } from "../types/database";
import { calculateEarnedSalary, formatInr, formatSalaryInput, parseMonthlySalary } from "../lib/payroll";

const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function statusLabel(day: CalendarDay) {
  switch (day.status) {
    case "PRESENT":
      return "Present";
    case "ABSENT":
      return "Absent";
    case "HOLIDAY":
      return "Weekly Holiday";
    case "FUTURE":
      return "Not yet applicable";
  }
}

function statusTone(day: CalendarDay): "success" | "danger" | "muted" | "info" {
  switch (day.status) {
    case "PRESENT":
      return "success";
    case "ABSENT":
      return "danger";
    case "HOLIDAY":
      return "info";
    case "FUTURE":
      return "muted";
  }
}

export default function EmployeeAttendance() {
  const { employeeId } = useParams<{ employeeId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [selectedMonth, setSelectedMonth] = useState(getCurrentMonth);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [salaryInput, setSalaryInput] = useState("");
  const [salarySaving, setSalarySaving] = useState(false);
  const [salaryFeedback, setSalaryFeedback] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const salaryEmployeeRef = useRef<string | null>(null);

  const loadDetails = useCallback(async () => {
    if (!user) {
      setError("Administrator authentication is required.");
      setLoading(false);
      return;
    }
    if (!employeeId) {
      setError("Employee was not specified.");
      setLoading(false);
      return;
    }

    const [year, month] = selectedMonth.split("-").map(Number);
    const from = `${selectedMonth}-01`;
    const to = `${selectedMonth}-${new Date(year, month, 0).getDate().toString().padStart(2, "0")}`;
    setLoading(true);
    setError("");
    try {
      const adminProfile = await getAdminProfile(user.id);
      if (!adminProfile?.is_active) throw new Error("Active administrator access is required.");
      const [employeeRow, attendanceRows] = await Promise.all([
        getEmployee(employeeId),
        getEmployeeAttendance(employeeId, { from, to }),
      ]);
      if (!employeeRow) throw new Error("Employee could not be found or is not available to this administrator.");
      if (salaryEmployeeRef.current !== employeeRow.id) {
        salaryEmployeeRef.current = employeeRow.id;
        setSalaryInput(formatSalaryInput(employeeRow.salary));
        setSalaryFeedback(null);
      }
      setEmployee(employeeRow);
      setRecords(attendanceRows);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Please try again in a moment.");
    } finally {
      setLoading(false);
    }
  }, [employeeId, selectedMonth, user]);

  // Supabase data is an external system; reload when the selected month changes.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadDetails(); }, [loadDetails]);

  const calendar = useMemo(
    () => buildAttendanceCalendar(selectedMonth, records, employee?.joining_date ?? null),
    [employee?.joining_date, records, selectedMonth],
  );
  const leadingCells = getMonthWeekdayOffset(selectedMonth);
  const trailingCells = (7 - ((leadingCells + calendar.days.length) % 7)) % 7;
  const selectedDay = selectedDate ? calendar.days.find((day) => day.date === selectedDate) ?? null : null;
  const isCurrentMonth = selectedMonth === getCurrentMonth();
  const earnedSalary = useMemo(
    () => calculateEarnedSalary(Number(employee?.salary ?? 0), calendar),
    [calendar, employee?.salary],
  );

  const handleSaveSalary = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!employee) return;

    const salary = parseMonthlySalary(salaryInput);
    if (salary === null) {
      setSalaryFeedback({ tone: "error", message: "Enter a non-negative salary with up to two decimal places." });
      return;
    }

    setSalarySaving(true);
    setSalaryFeedback(null);
    try {
      const updatedEmployee = await updateEmployeeSalary(employee.id, salary);
      setEmployee(updatedEmployee);
      setSalaryInput(formatSalaryInput(updatedEmployee.salary));
      setSalaryFeedback({ tone: "success", message: "Salary saved successfully." });
    } catch (cause) {
      setSalaryFeedback({ tone: "error", message: cause instanceof Error ? cause.message : "Salary could not be saved." });
    } finally {
      setSalarySaving(false);
    }
  };

  const handleDelete = async () => {
    if (!employee || deleting) return;

    setDeleting(true);
    setDeleteError("");
    try {
      await deleteEmployee(employee.id);
      navigate("/employees", { replace: true, state: { employeeDeleted: true } });
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : "Employee could not be deleted. No changes were made.");
      setDeleting(false);
    }
  };

  const changeMonth = (offset: number) => {
    setSelectedMonth((month) => shiftMonth(month, offset));
    setSelectedDate(null);
  };

  if (loading && !employee) return <PageLoader label="Loading employee attendance…" />;
  if (error && !employee) return <ErrorState message={error} onRetry={() => void loadDetails()} />;
  if (!employee) return <EmptyState title="Employee unavailable" description="This employee could not be loaded." action={<Link className="button button-secondary button-small" to="/employees">Back to employees</Link>} />;

  return (
    <div className="page-stack">
      <Link className="text-link" to="/employees"><ArrowLeft size={15} /> Back to employees</Link>

      <section className="employee-profile panel">
        <div className="employee-profile-main">
          <div className="employee-profile-avatar">{employee.full_name.split(" ").filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</div>
          <div>
            <div className="eyebrow">Employee attendance</div>
            <h2>{employee.full_name}</h2>
            <p>{employee.designation ?? "Employee"} · {employee.status}</p>
          </div>
        </div>
        <div className="employee-profile-details">
          <div><span>Employee ID</span><strong>{employee.employee_code}</strong></div>
          <div><span>Department</span><strong>{employee.departments?.name ?? "Unassigned"}</strong></div>
          <div><span>Joining date</span><strong>{formatDate(employee.joining_date)}</strong></div>
        </div>
        <div className="employee-profile-actions">
          <button className="button button-danger" type="button" onClick={() => { setDeleteError(""); setDeleteDialogOpen(true); }}>
            <Trash2 size={15} /> Delete Employee
          </button>
        </div>
      </section>

      <section className="salary-panel panel">
        <div className="panel-header">
          <div><div className="eyebrow">Salary</div><h2>Monthly payroll</h2><p>Earned salary for {calendar.monthLabel} follows the attendance calendar below.</p></div>
          <div className="salary-earned"><span>Current / earned salary</span><strong>{formatInr(earnedSalary.earnedSalary)}</strong><small>Present: {earnedSalary.presentDays} / {earnedSalary.totalWorkingDays} working days</small></div>
        </div>
        <div className="salary-breakdown">
          <div><span>Monthly salary</span><strong>{formatInr(Number(employee.salary))}</strong></div>
          <div><span>Total working days</span><strong>{earnedSalary.totalWorkingDays}</strong></div>
          <div><span>Present days</span><strong>{earnedSalary.presentDays}</strong></div>
          <div><span>Daily salary</span><strong>{formatInr(earnedSalary.dailySalary)}</strong></div>
        </div>
        <form className="salary-form" onSubmit={(event) => void handleSaveSalary(event)}>
          <label htmlFor="monthly-salary">Monthly salary (INR)</label>
          <div className="salary-form-controls">
            <div className="salary-input-wrap"><span aria-hidden="true">₹</span><input id="monthly-salary" type="number" min="0" max="9999999999.99" step="0.01" value={salaryInput} onChange={(event) => { setSalaryInput(event.target.value); setSalaryFeedback(null); }} placeholder="25000.00" inputMode="decimal" /></div>
            <button className="button button-primary" type="submit" disabled={salarySaving}><Save size={15} />{salarySaving ? "Saving…" : "Save salary"}</button>
          </div>
          {salaryFeedback && <div className={salaryFeedback.tone === "error" ? "form-error" : "form-success"} role={salaryFeedback.tone === "error" ? "alert" : "status"}>{salaryFeedback.message}</div>}
        </form>
      </section>

      <section className="employee-month-toolbar panel">
        <div><div className="eyebrow">Monthly view</div><h2>{calendar.monthLabel}</h2></div>
        <div className="month-controls">
          <button className="icon-button" type="button" onClick={() => changeMonth(-1)} aria-label="Previous month"><ChevronLeft size={17} /></button>
          <button className="button button-secondary button-small" type="button" onClick={() => { setSelectedMonth(getCurrentMonth()); setSelectedDate(null); }} disabled={isCurrentMonth}><RotateCcw size={14} /> Current month</button>
          <button className="icon-button" type="button" onClick={() => changeMonth(1)} aria-label="Next month"><ChevronRight size={17} /></button>
        </div>
      </section>

      <section className="metric-grid employee-attendance-metrics">
        <article className="metric-card"><div className="metric-icon metric-icon-green"><CalendarDays size={18} /></div><span className="metric-label">Present days</span><div className="metric-value">{calendar.presentDays}</div><div className="metric-detail">Unique working dates with attendance</div></article>
        <article className="metric-card"><div className="metric-icon metric-icon-purple"><CalendarDays size={18} /></div><span className="metric-label">Absent days</span><div className="metric-value">{calendar.absentDays}</div><div className="metric-detail">Past applicable working dates</div></article>
        <article className="metric-card"><div className="metric-icon metric-icon-blue"><Clock3 size={18} /></div><span className="metric-label">Working days</span><div className="metric-value">{calendar.workingDays}</div><div className="metric-detail">Saturday and Sunday included</div></article>
      </section>

      {error && <div className="form-error" role="alert">{error}</div>}

      <section className="panel calendar-panel">
        <div className="panel-header calendar-panel-header">
          <div><h2>Attendance calendar</h2><p>Presence is counted once per date, regardless of session count.</p></div>
          <div className="calendar-legend" aria-label="Calendar legend">
            <span><i className="legend-swatch legend-present" />Present</span>
            <span><i className="legend-swatch legend-absent" />Absent</span>
            <span><i className="legend-swatch legend-holiday" />Holiday</span>
            <span><i className="legend-swatch legend-future" />Future / not applicable</span>
          </div>
        </div>
        <div className="calendar-content">
          <div className="calendar-weekdays">{weekdayLabels.map((label) => <span key={label}>{label}</span>)}</div>
          <div className="attendance-calendar">
            {Array.from({ length: leadingCells }, (_, index) => <div className="calendar-day calendar-day-empty" key={`leading-${index}`} />)}
            {calendar.days.map((day) => (
              <button
                className={`calendar-day calendar-day-${day.status.toLowerCase()} ${selectedDate === day.date ? "calendar-day-selected" : ""}`}
                key={day.date}
                type="button"
                title={getDayTooltip(day)}
                aria-label={getDayTooltip(day)}
                onClick={() => setSelectedDate(day.date)}
              >
                <span>{day.dayNumber}</span>
                {day.summary && <small>{day.summary.sessionCount} {day.summary.sessionCount === 1 ? "session" : "sessions"}</small>}
              </button>
            ))}
            {Array.from({ length: trailingCells }, (_, index) => <div className="calendar-day calendar-day-empty" key={`trailing-${index}`} />)}
          </div>
          {selectedDay && <div className="calendar-day-detail"><div><strong>{formatDate(selectedDay.date)}</strong><StatusBadge tone={statusTone(selectedDay)}>{statusLabel(selectedDay)}</StatusBadge></div><p>{getDayTooltip(selectedDay)}</p></div>}
        </div>
      </section>

      <div className="inline-notice"><CalendarDays size={17} /><div><strong>Paid leave tracking is not configured</strong><span>Leave counts are intentionally omitted until an approved leave system is available.</span></div></div>

      {deleteDialogOpen && <div className="modal-backdrop" role="presentation"><section className="modal delete-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-employee-title" aria-describedby="delete-employee-warning">
        <div className="modal-header">
          <div><div className="eyebrow eyebrow-danger">Permanent action</div><h2 id="delete-employee-title">Delete employee?</h2></div>
          <button className="icon-button" type="button" onClick={() => setDeleteDialogOpen(false)} disabled={deleting} aria-label="Close dialog"><X size={19} /></button>
        </div>
        <div className="delete-modal-body">
          <div className="delete-employee-summary">
            <strong>{employee.full_name}</strong>
            <span>Employee code: {employee.employee_code}</span>
            <span>Department: {employee.departments?.name ?? "Unassigned"}</span>
          </div>
          <p id="delete-employee-warning" className="delete-warning">This permanently deletes the employee and all associated biometric templates, enrollment data, attendance records, events, and attempts. This action cannot be undone.</p>
          {deleteError && <div className="form-error" role="alert">{deleteError}</div>}
          <div className="modal-actions">
            <button className="button button-secondary" type="button" onClick={() => setDeleteDialogOpen(false)} disabled={deleting}>Cancel</button>
            <button className="button button-danger" type="button" onClick={() => void handleDelete()} disabled={deleting}><Trash2 size={15} />{deleting ? "Deleting..." : "Delete Employee"}</button>
          </div>
        </div>
      </section></div>}
    </div>
  );
}
