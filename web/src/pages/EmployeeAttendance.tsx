import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { ArrowLeft, CalendarDays, ChevronLeft, ChevronRight, Clock3, Edit3, RotateCcw, Save, Trash2, X } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { deleteEmployee, getAdminEmployeeLeaveRequests, getAdminProfile, getDepartments, getEmployee, getEmployeeAttendance, updateEmployeeContact, updateEmployeeProfile, updateEmployeeSalary } from "../lib/data";
import {
  buildAttendanceCalendar,
  getCurrentMonth,
  getDayTooltip,
  getMonthWeekdayOffset,
  shiftMonth,
  type CalendarDay,
} from "../lib/attendanceCalendar";
import { EmptyState, ErrorState, formatDate, formatDateTime, PageLoader, StatusBadge } from "../components/ui";
import type { AttendanceRecord, Department, Employee, EmployeeStatus, LeaveRequest, LeaveRequestStatus } from "../types/database";
import { getApprovedLeaveDates } from "../lib/leave";
import { getHolidaysForMonth } from "../lib/holidays";
import { calculateEarnedSalary, formatInr, formatSalaryInput, parseMonthlySalary } from "../lib/payroll";
import type { Holiday } from "../types/database";

const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type EmployeeEditForm = {
  employee_code: string;
  full_name: string;
  email: string;
  phone: string;
  department_id: string;
  designation: string;
  joining_date: string;
  salary: string;
  status: EmployeeStatus;
};

function editFormFor(employee: Employee): EmployeeEditForm {
  return {
    employee_code: employee.employee_code,
    full_name: employee.full_name,
    email: employee.email ?? "",
    phone: employee.phone ?? "",
    department_id: employee.department_id ?? "",
    designation: employee.designation ?? "",
    joining_date: employee.joining_date ?? "",
    salary: formatSalaryInput(employee.salary),
    status: employee.status,
  };
}

function statusLabel(day: CalendarDay) {
  if (day.status === "HOLIDAY" && day.holiday) return "Holiday";
  switch (day.status) {
    case "PRESENT":
      return "Present";
    case "ABSENT":
      return "Absent";
    case "HALF_DAY":
      return "Half day";
    case "LEAVE":
      return "Paid leave";
    case "HOLIDAY":
      return "Weekly Holiday";
    case "FUTURE":
      return "Not yet applicable";
  }
}

function statusTone(day: CalendarDay): "success" | "danger" | "muted" | "info" | "warning" {
  switch (day.status) {
    case "PRESENT":
      return "success";
    case "ABSENT":
      return "danger";
    case "HALF_DAY":
      return "warning";
    case "LEAVE":
      return "info";
    case "HOLIDAY":
      return "info";
    case "FUTURE":
      return "muted";
  }
}

function leaveStatusTone(status: LeaveRequestStatus): "success" | "warning" | "muted" | "danger" {
  switch (status) {
    case "APPROVED": return "success";
    case "PENDING": return "warning";
    case "REJECTED": return "danger";
    case "CANCELLED": return "muted";
  }
}

function leaveDecisionDate(status: LeaveRequestStatus, request: { approved_at: string | null; rejected_at: string | null; cancelled_at: string | null }) {
  if (status === "APPROVED") return request.approved_at;
  if (status === "REJECTED") return request.rejected_at;
  if (status === "CANCELLED") return request.cancelled_at;
  return null;
}

export default function EmployeeAttendance() {
  const { employeeId } = useParams<{ employeeId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
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
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactSaving, setContactSaving] = useState(false);
  const [contactFeedback, setContactFeedback] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editFeedback, setEditFeedback] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const [profileFeedback, setProfileFeedback] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const [editForm, setEditForm] = useState<EmployeeEditForm>({ employee_code: "", full_name: "", email: "", phone: "", department_id: "", designation: "", joining_date: "", salary: "0", status: "ACTIVE" });
  const salaryEmployeeRef = useRef<string | null>(null);
  const contactEmployeeRef = useRef<string | null>(null);

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
      const [employeeRow, attendanceRows, leaveRows, departmentRows, holidayRows] = await Promise.all([
        getEmployee(employeeId),
        getEmployeeAttendance(employeeId, { from, to }),
        getAdminEmployeeLeaveRequests(employeeId),
        getDepartments(),
        getHolidaysForMonth(selectedMonth),
      ]);
      if (!employeeRow) throw new Error("Employee could not be found or is not available to this administrator.");
      if (salaryEmployeeRef.current !== employeeRow.id) {
        salaryEmployeeRef.current = employeeRow.id;
        setSalaryInput(formatSalaryInput(employeeRow.salary));
        setSalaryFeedback(null);
      }
      if (contactEmployeeRef.current !== employeeRow.id) {
        contactEmployeeRef.current = employeeRow.id;
        setContactEmail(employeeRow.email ?? "");
        setContactPhone(employeeRow.phone ?? "");
        setContactFeedback(null);
      }
      setEditForm(editFormFor(employeeRow));
      setEmployee(employeeRow);
      setRecords(attendanceRows);
      setLeaveRequests(leaveRows);
      setDepartments(departmentRows);
      setHolidays(holidayRows);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Please try again in a moment.");
    } finally {
      setLoading(false);
    }
  }, [employeeId, selectedMonth, user]);

  // Supabase data is an external system; reload when the selected month changes.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadDetails(); }, [loadDetails]);

  const approvedLeaveDates = useMemo(() => [...getApprovedLeaveDates(leaveRequests, holidays)], [holidays, leaveRequests]);
  const calendar = useMemo(
    () => buildAttendanceCalendar(selectedMonth, records, employee?.joining_date ?? null, undefined, approvedLeaveDates, holidays),
    [approvedLeaveDates, employee?.joining_date, holidays, records, selectedMonth],
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

  const handleSaveContact = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!employee) return;
    setContactSaving(true);
    setContactFeedback(null);
    try {
      const updatedEmployee = await updateEmployeeContact(employee.id, {
        email: contactEmail.trim() || null,
        phone: contactPhone.trim() || null,
      });
      setEmployee(updatedEmployee);
      setContactEmail(updatedEmployee.email ?? "");
      setContactPhone(updatedEmployee.phone ?? "");
      setContactFeedback({ tone: "success", message: "Contact information saved." });
    } catch (cause) {
      setContactFeedback({ tone: "error", message: cause instanceof Error ? cause.message : "Contact information could not be saved." });
    } finally {
      setContactSaving(false);
    }
  };

  const handleEditEmployee = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!employee || editSaving) return;
    setEditFeedback(null);
    const salary = parseMonthlySalary(editForm.salary);
    if (!editForm.employee_code.trim()) {
      setEditFeedback({ tone: "error", message: "Employee code is required." });
      return;
    }
    if (!editForm.full_name.trim()) {
      setEditFeedback({ tone: "error", message: "Full name is required." });
      return;
    }
    if (!editForm.email.trim()) {
      setEditFeedback({ tone: "error", message: "Email is required." });
      return;
    }
    if (!editForm.phone.trim()) {
      setEditFeedback({ tone: "error", message: "Phone number is required." });
      return;
    }
    if (salary === null) {
      setEditFeedback({ tone: "error", message: "Salary cannot be negative and must use up to two decimal places." });
      return;
    }

    setEditSaving(true);
    try {
      const updatedEmployee = await updateEmployeeProfile({
        id: employee.id,
        employee_code: editForm.employee_code.trim().toUpperCase(),
        full_name: editForm.full_name.trim(),
        email: editForm.email.trim(),
        phone: editForm.phone.trim(),
        department_id: editForm.department_id || null,
        designation: editForm.designation.trim() || null,
        joining_date: editForm.joining_date || null,
        salary,
        status: editForm.status,
      });
      setEmployee(updatedEmployee);
      setSalaryInput(formatSalaryInput(updatedEmployee.salary));
      setContactEmail(updatedEmployee.email ?? "");
      setContactPhone(updatedEmployee.phone ?? "");
      setEditForm(editFormFor(updatedEmployee));
      setEditDialogOpen(false);
      setEditFeedback(null);
      setContactFeedback(null);
      setSalaryFeedback(null);
      setProfileFeedback({ tone: "success", message: "Employee details updated successfully." });
    } catch (cause) {
      setEditFeedback({ tone: "error", message: cause instanceof Error ? cause.message : "Employee details could not be updated." });
    } finally {
      setEditSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!employee || deleting) return;

    setDeleting(true);
    setDeleteError("");
    try {
      await deleteEmployee(employee.id);
      navigate("/admin/employees", { replace: true, state: { employeeDeleted: true } });
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
  if (!employee) return <EmptyState title="Employee unavailable" description="This employee could not be loaded." action={<Link className="button button-secondary button-small" to="/admin/employees">Back to employees</Link>} />;

  return (
    <div className="page-stack">
      <Link className="text-link" to="/admin/employees"><ArrowLeft size={15} /> Back to employees</Link>
      {profileFeedback && <div className={profileFeedback.tone === "error" ? "form-error" : "form-success"} role={profileFeedback.tone === "error" ? "alert" : "status"}>{profileFeedback.message}</div>}

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
          <button className="button button-secondary" type="button" onClick={() => { setEditForm(editFormFor(employee)); setEditFeedback(null); setEditDialogOpen(true); }}>
            <Edit3 size={15} /> Edit Employee
          </button>
          <button className="button button-danger" type="button" onClick={() => { setDeleteError(""); setDeleteDialogOpen(true); }}>
            <Trash2 size={15} /> Delete Employee
          </button>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header"><div><div className="eyebrow">Employee contact</div><h2>Contact information</h2><p>Existing NULL values remain allowed. Email and phone are used as contact details, not phone OTP.</p></div></div>
        <form className="salary-form" onSubmit={(event) => void handleSaveContact(event)}><div className="form-grid"><label htmlFor="employee-email">Email<input id="employee-email" type="email" value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} placeholder="employee@company.com" /></label><label htmlFor="employee-phone">Phone<input id="employee-phone" value={contactPhone} onChange={(event) => setContactPhone(event.target.value)} placeholder="+919876543210" /></label></div>{contactFeedback && <div className={contactFeedback.tone === "error" ? "form-error" : "form-success"} role={contactFeedback.tone === "error" ? "alert" : "status"}>{contactFeedback.message}</div>}<button className="button button-primary" type="submit" disabled={contactSaving}>{contactSaving ? "Saving…" : "Save contact information"}</button></form>
      </section>

      <section className="salary-panel panel">
        <div className="panel-header">
          <div><div className="eyebrow">Salary</div><h2>Monthly payroll</h2><p>Earned salary for {calendar.monthLabel} follows the attendance calendar below.</p></div>
          <div className="salary-earned"><span>Current / earned salary</span><strong>{formatInr(earnedSalary.earnedSalary)}</strong><small>Paid days: {earnedSalary.paidDays} / {earnedSalary.totalWorkingDays} working days</small></div>
        </div>
        <div className="salary-breakdown">
          <div><span>Monthly salary</span><strong>{formatInr(Number(employee.salary))}</strong></div>
          <div><span>Total working days</span><strong>{earnedSalary.totalWorkingDays}</strong></div>
          <div><span>Present days</span><strong>{earnedSalary.presentDays}</strong></div>
          <div><span>Paid leave</span><strong>{earnedSalary.paidLeaveDays}</strong></div>
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
            <span><i className="legend-swatch legend-half-day" />Half day</span>
            <span><i className="legend-swatch legend-leave" />Paid leave</span>
            <span><i className="legend-swatch legend-holiday" />Friday off</span>
            <span><i className="legend-swatch legend-admin-holiday" />Admin holiday</span>
            <span><i className="legend-swatch legend-future" />Future / not applicable</span>
          </div>
        </div>
        <div className="calendar-content">
          <div className="calendar-weekdays">{weekdayLabels.map((label) => <span key={label}>{label}</span>)}</div>
          <div className="attendance-calendar">
            {Array.from({ length: leadingCells }, (_, index) => <div className="calendar-day calendar-day-empty" key={`leading-${index}`} />)}
            {calendar.days.map((day) => (
              <button
                className={`calendar-day calendar-day-${day.status.toLowerCase()}${day.holiday ? " calendar-day-admin-holiday" : ""}${day.leaveConflict ? " calendar-day-conflict" : ""} ${selectedDate === day.date ? "calendar-day-selected" : ""}`}
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

      <section className="panel table-panel">
        <div className="panel-header">
          <div><h2>Paid Leave History</h2><p>Approved paid leave is included in the calendar and earned salary.</p></div>
          <div className="table-summary">{leaveRequests.length} request{leaveRequests.length === 1 ? "" : "s"}</div>
        </div>
        {leaveRequests.length === 0 ? <EmptyState title="No paid leave requests yet" description="Leave requests for this employee will appear here after submission." /> : <div className="table-scroll"><table><thead><tr><th>Dates</th><th>Paid working days</th><th>Status</th><th>Reason</th><th>Requested</th><th>Decision</th></tr></thead><tbody>{leaveRequests.map((request) => { const decisionDate = leaveDecisionDate(request.status, request); return <tr key={request.id}><td>{formatDate(request.start_date)} – {formatDate(request.end_date)}</td><td>{request.requested_working_days}</td><td><StatusBadge tone={leaveStatusTone(request.status)}>{request.status === "APPROVED" ? "APPROVED · PAID" : request.status}</StatusBadge></td><td className="leave-reason-cell"><div>{request.reason}</div>{request.status === "REJECTED" && request.rejection_reason && <span className="rejection-note">Rejection: {request.rejection_reason}</span>}</td><td>{formatDateTime(request.created_at)}</td><td>{decisionDate ? formatDateTime(decisionDate) : <span className="muted">—</span>}</td></tr>; })}</tbody></table></div>}
      </section>

      {editDialogOpen && <div className="modal-backdrop" role="presentation"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="edit-employee-title"><div className="modal-header"><div><div className="eyebrow">Employee directory</div><h2 id="edit-employee-title">Edit Employee</h2></div><button className="icon-button" type="button" onClick={() => setEditDialogOpen(false)} disabled={editSaving} aria-label="Close edit employee dialog"><X size={19} /></button></div><form className="modal-form" onSubmit={(event) => void handleEditEmployee(event)}><div className="form-grid"><label>Full Name *<input value={editForm.full_name} onChange={(event) => setEditForm({ ...editForm, full_name: event.target.value })} required /></label><label>Employee Code *<input value={editForm.employee_code} onChange={(event) => setEditForm({ ...editForm, employee_code: event.target.value.toUpperCase() })} required /></label><label>Email *<input type="email" value={editForm.email} onChange={(event) => setEditForm({ ...editForm, email: event.target.value })} required /></label><label>Phone Number *<input value={editForm.phone} onChange={(event) => setEditForm({ ...editForm, phone: event.target.value })} placeholder="+919876543210" required /></label><label>Department<select value={editForm.department_id} onChange={(event) => setEditForm({ ...editForm, department_id: event.target.value })}><option value="">Unassigned</option>{departments.map((department) => <option key={department.id} value={department.id}>{department.name}{department.is_active ? "" : " (inactive)"}</option>)}</select></label><label>Designation<input value={editForm.designation} onChange={(event) => setEditForm({ ...editForm, designation: event.target.value })} /></label><label>Joining Date<input type="date" value={editForm.joining_date} onChange={(event) => setEditForm({ ...editForm, joining_date: event.target.value })} /></label><label>Salary (INR)<input type="number" min="0" max="9999999999.99" step="0.01" value={editForm.salary} onChange={(event) => setEditForm({ ...editForm, salary: event.target.value })} required /></label><label>Employee Status<select value={editForm.status} onChange={(event) => setEditForm({ ...editForm, status: event.target.value as EmployeeStatus })}><option value="ACTIVE">ACTIVE</option><option value="INACTIVE">INACTIVE</option><option value="SUSPENDED">SUSPENDED</option></select></label></div>{editFeedback && <div className="form-error" role="alert">{editFeedback.message}</div>}<div className="modal-actions"><button className="button button-secondary" type="button" onClick={() => setEditDialogOpen(false)} disabled={editSaving}>Cancel</button><button className="button button-primary" type="submit" disabled={editSaving}>{editSaving ? "Saving…" : "Save Changes"}</button></div></form></section></div>}

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
