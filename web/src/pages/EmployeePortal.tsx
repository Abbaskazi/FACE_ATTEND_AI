import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, Clock3, DollarSign, KeyRound, LogOut, ShieldCheck, UserRound } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import EmployeePortalNav from "../components/EmployeePortalNav";
import { EmptyState, ErrorState, formatDate, formatTime, PageLoader, StatusBadge } from "../components/ui";
import { getEmployeeAttendanceHistory, getEmployeeLeaveRequests } from "../lib/data";
import { getHolidaysForMonth } from "../lib/holidays";
import {
  buildAttendanceCalendar,
  getCurrentMonth,
  getDayTooltip,
  getMonthWeekdayOffset,
  getTodayDate,
  type CalendarDay,
} from "../lib/attendanceCalendar";
import { getApprovedLeaveDates } from "../lib/leave";
import { calculateEarnedSalary, formatInr } from "../lib/payroll";
import type { AttendanceRecord, Holiday, LeaveRequest } from "../types/database";

const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function statusLabel(day: CalendarDay) {
  if (day.status === "HOLIDAY" && day.holiday) return "Holiday";
  switch (day.status) {
    case "PRESENT": return "Present";
    case "ABSENT": return "Absent";
    case "HALF_DAY": return "Half day";
    case "LEAVE": return "Paid leave";
    case "HOLIDAY": return "Friday · non-working";
    case "FUTURE": return "Future";
  }
}

function historyStatusTone(status: AttendanceRecord["status"]): "success" | "danger" | "warning" | "muted" | "info" {
  switch (status) {
    case "PRESENT": return "success";
    case "ABSENT": return "danger";
    case "HALF_DAY": return "warning";
    case "LEAVE": return "info";
  }
}

export default function EmployeePortal({ view = "overview" }: { view?: "overview" | "attendance" }) {
  const navigate = useNavigate();
  const { employeeProfile, signOut } = useAuth();
  const attendanceView = view === "attendance";
  const month = getCurrentMonth();
  const today = getTodayDate();
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadAttendance = useCallback(async () => {
    if (!employeeProfile) return;
    setLoading(true);
    setError("");
    try {
      const [attendance, leave, holidayRows] = await Promise.all([
        getEmployeeAttendanceHistory(employeeProfile.id),
        getEmployeeLeaveRequests(),
        getHolidaysForMonth(month),
      ]);
      setRecords(attendance);
      setLeaveRequests(leave);
      setHolidays(holidayRows);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Attendance could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [employeeProfile, month]);

  useEffect(() => {
    // Attendance is loaded from Supabase after the authenticated profile is
    // available.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadAttendance();
  }, [loadAttendance]);

  const approvedLeaveDates = useMemo(() => [...getApprovedLeaveDates(leaveRequests, holidays)], [holidays, leaveRequests]);
  const calendar = useMemo(
    () => buildAttendanceCalendar(month, records, employeeProfile?.joining_date ?? null, today, approvedLeaveDates, holidays),
    [approvedLeaveDates, employeeProfile?.joining_date, holidays, month, records, today],
  );
  const earnedSalary = useMemo(
    () => calculateEarnedSalary(Number(employeeProfile?.salary ?? 0), calendar),
    [calendar, employeeProfile?.salary],
  );
  const leadingCells = getMonthWeekdayOffset(month);
  const trailingCells = (7 - ((leadingCells + calendar.days.length) % 7)) % 7;
  const history = useMemo(
    () => [...records].sort((left, right) => {
      const dateOrder = right.attendance_date.localeCompare(left.attendance_date);
      if (dateOrder !== 0) return dateOrder;
      return (right.check_in ?? "").localeCompare(left.check_in ?? "");
    }),
    [records],
  );
  const handleLogout = async () => {
    await signOut();
    navigate("/employee/login", { replace: true });
  };

  if (!employeeProfile) return <PageLoader label="Loading your portal…" />;

  return (
    <main className="employee-portal-page">
      <header className="employee-portal-header">
        <div className="brand-lockup"><div className="brand-mark">F</div><div><div className="brand-name">FaceAttend <span>AI</span></div><div className="brand-caption">Employee portal</div></div></div>
        <div className="employee-portal-header-actions"><span className="portal-header-name">{employeeProfile.full_name}</span><button className="button button-secondary" type="button" onClick={() => navigate("/employee/change-password")}><KeyRound size={15} /> Change Password</button><button className="button button-secondary" type="button" onClick={() => void handleLogout()}><LogOut size={15} /> Sign out</button></div>
      </header>

      <div className="employee-portal-content">
        <EmployeePortalNav />

        <div className="page-intro">
          <div><div className="eyebrow">Employee portal</div><h1>{attendanceView ? "Attendance" : `Welcome, ${employeeProfile.full_name}`}</h1><p className="portal-subtitle">{attendanceView ? `Review your attendance and salary details for ${calendar.monthLabel}.` : `Your attendance and salary summary for ${calendar.monthLabel}.`}</p></div>
          <div className="page-date"><CalendarDays size={16} /> {new Intl.DateTimeFormat(undefined, { dateStyle: "long" }).format(new Date())}</div>
        </div>

        {!attendanceView && <section className="portal-profile panel">
          <div className="portal-profile-copy"><div className="employee-profile-avatar">{employeeProfile.full_name.split(" ").filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</div><div><div className="eyebrow">Authenticated employee</div><h2>{employeeProfile.full_name}</h2><p>Employee ID {employeeProfile.employee_code}</p></div></div>
          <div className="portal-profile-details"><div><span>Department</span><strong>{employeeProfile.department?.name ?? "Unassigned"}</strong></div><div><span>Designation</span><strong>{employeeProfile.designation ?? "Employee"}</strong></div><div><span>Joining date</span><strong>{formatDate(employeeProfile.joining_date)}</strong></div></div>
          <div className="portal-security"><ShieldCheck size={18} /><span>Private employee session</span></div>
        </section>}

        <section className="metric-grid employee-portal-metrics">
          <article className="metric-card"><div className="metric-icon metric-icon-green"><CalendarDays size={18} /></div><span className="metric-label">Present days</span><div className="metric-value">{calendar.presentDays}</div><div className="metric-detail">Current month to date</div></article>
          <article className="metric-card"><div className="metric-icon metric-icon-purple"><UserRound size={18} /></div><span className="metric-label">Absent days</span><div className="metric-value">{calendar.absentDays}</div><div className="metric-detail">Applicable working days</div></article>
          <article className="metric-card"><div className="metric-icon metric-icon-blue"><Clock3 size={18} /></div><span className="metric-label">Working days</span><div className="metric-value">{calendar.workingDays}</div><div className="metric-detail">Friday excluded · weekends included</div></article>
          <article className="metric-card"><div className="metric-icon metric-icon-amber"><DollarSign size={18} /></div><span className="metric-label">Salary earned</span><div className="metric-value metric-value-currency">{formatInr(earnedSalary.earnedSalary)}</div><div className="metric-detail">{earnedSalary.paidDays} paid days to date</div></article>
        </section>

        {error && <ErrorState message={error} onRetry={() => void loadAttendance()} />}

        <section className="panel calendar-panel">
          <div className="panel-header calendar-panel-header"><div><h2>{calendar.monthLabel} attendance</h2><p>Friday is non-working; Saturday and Sunday are working days.</p></div><div className="calendar-legend" aria-label="Calendar legend"><span><i className="legend-swatch legend-present" />Present</span><span><i className="legend-swatch legend-absent" />Absent</span><span><i className="legend-swatch legend-half-day" />Half day</span><span><i className="legend-swatch legend-leave" />Paid leave</span><span><i className="legend-swatch legend-holiday" />Friday off</span><span><i className="legend-swatch legend-admin-holiday" />Admin holiday</span><span><i className="legend-swatch legend-future" />Future</span></div></div>
          <div className="calendar-content"><div className="calendar-weekdays">{weekdayLabels.map((label) => <span key={label}>{label}</span>)}</div><div className="attendance-calendar">{Array.from({ length: leadingCells }, (_, index) => <div className="calendar-day calendar-day-empty" key={`leading-${index}`} />)}{calendar.days.map((day) => <div className={`calendar-day calendar-day-${day.status.toLowerCase()}${day.holiday ? " calendar-day-admin-holiday" : ""}${day.leaveConflict ? " calendar-day-conflict" : ""}`} key={day.date} title={getDayTooltip(day)} aria-label={getDayTooltip(day)}><span>{day.dayNumber}</span><small>{statusLabel(day)}</small></div>)}{Array.from({ length: trailingCells }, (_, index) => <div className="calendar-day calendar-day-empty" key={`trailing-${index}`} />)}</div></div>
        </section>

        <section className="panel salary-summary-panel"><div className="panel-header"><div><div className="eyebrow">Salary view</div><h2>Salary earned up to today</h2><p>Calculated from the salary stored on your employee record.</p></div><div className="salary-earned"><span>Earned salary</span><strong>{formatInr(earnedSalary.earnedSalary)}</strong><small>{earnedSalary.paidDays} paid days / {earnedSalary.totalWorkingDays} working days in month</small></div></div><div className="salary-breakdown employee-salary-breakdown"><div><span>Monthly salary</span><strong>{formatInr(Number(employeeProfile.salary))}</strong></div><div><span>Present days</span><strong>{earnedSalary.presentDays}</strong></div><div><span>Paid leave</span><strong>{earnedSalary.paidLeaveDays}</strong></div><div><span>Daily salary</span><strong>{formatInr(earnedSalary.dailySalary)}</strong></div></div></section>

        <section className="panel table-panel"><div className="panel-header"><div><h2>Attendance history</h2><p>Your attendance records, sorted newest first.</p></div><div className="table-summary">{history.length} record{history.length === 1 ? "" : "s"}</div></div>{loading ? <PageLoader label="Loading attendance…" /> : history.length === 0 ? <EmptyState title="No attendance records yet" description="Your attendance records will appear here after a successful check-in." /> : <div className="table-scroll"><table><thead><tr><th>Date</th><th>Status</th><th>Check-in</th><th>Check-out</th><th>Working minutes</th></tr></thead><tbody>{history.map((record) => <tr key={record.id}><td>{formatDate(record.attendance_date)}</td><td><StatusBadge tone={historyStatusTone(record.status)}>{record.status.replace("_", " ")}</StatusBadge></td><td>{formatTime(record.check_in)}</td><td>{formatTime(record.check_out)}</td><td>{record.working_minutes === null ? "—" : record.working_minutes}</td></tr>)}</tbody></table></div>}</section>
      </div>
    </main>
  );
}
