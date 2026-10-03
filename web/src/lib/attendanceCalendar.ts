import type { AttendanceRecord, AttendanceStatus, Holiday } from "../types/database";

export type CalendarDayStatus = AttendanceStatus | "HOLIDAY" | "FUTURE";

export interface CalendarDaySummary {
  sessionCount: number;
  openSessionCount: number;
  workingMinutes: number;
  status: AttendanceStatus;
}

export interface CalendarDay {
  date: string;
  dayNumber: number;
  weekday: number;
  status: CalendarDayStatus;
  summary: CalendarDaySummary | null;
  approvedLeave: boolean;
  leaveConflict: boolean;
  holiday: Holiday | null;
}

export interface AttendanceCalendarSummary {
  month: string;
  monthLabel: string;
  days: CalendarDay[];
  presentDays: number;
  absentDays: number;
  halfDayDays: number;
  paidLeaveDays: number;
  holidayDays: number;
  paidDays: number;
  workingDays: number;
}

interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

function parseDate(value: string): CalendarDate {
  const [year, month, day] = value.split("-").map(Number);
  return { year, month, day };
}

function dateValue(value: CalendarDate) {
  return value.year * 10_000 + value.month * 100 + value.day;
}

function formatDate(value: CalendarDate) {
  return `${value.year.toString().padStart(4, "0")}-${value.month.toString().padStart(2, "0")}-${value.day.toString().padStart(2, "0")}`;
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

function toLocalDate(value: CalendarDate) {
  return new Date(value.year, value.month - 1, value.day);
}

function statusPriority(status: AttendanceStatus) {
  switch (status) {
    case "PRESENT": return 4;
    case "LEAVE": return 3;
    case "HALF_DAY": return 2;
    case "ABSENT": return 1;
  }
}

function displayStatus(day: CalendarDay) {
  switch (day.status) {
    case "PRESENT": return "Present";
    case "ABSENT": return "Absent";
    case "HALF_DAY": return "Half day";
    case "LEAVE": return "Paid leave";
    case "HOLIDAY": return day.holiday ? `Holiday: ${day.holiday.reason}` : "Friday - non-working";
    case "FUTURE": return "Future";
  }
}

export function getCurrentMonth(today = new Date()) {
  return `${today.getFullYear()}-${(today.getMonth() + 1).toString().padStart(2, "0")}`;
}

export function getTodayDate(today = new Date()) {
  return formatDate({ year: today.getFullYear(), month: today.getMonth() + 1, day: today.getDate() });
}

export function shiftMonth(month: string, offset: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  const shifted = new Date(year, monthNumber - 1 + offset, 1);
  return getCurrentMonth(shifted);
}

export function getMonthWeekdayOffset(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(year, monthNumber - 1, 1).getDay();
}

export function getDayTooltip(day: CalendarDay) {
  const conflict = day.leaveConflict ? " - Conflict: attendance already recorded" : "";
  const holiday = day.holiday ? ` - Holiday: ${day.holiday.reason}` : "";
  if (!day.summary) return `${day.date} - ${displayStatus(day)}${conflict}`;
  const sessions = `${day.summary.sessionCount} session${day.summary.sessionCount === 1 ? "" : "s"}`;
  const open = day.summary.openSessionCount ? `, ${day.summary.openSessionCount} open` : "";
  return `${day.date} - ${displayStatus(day)}${holiday} - ${sessions}${open} - Total working time ${formatMinutes(day.summary.workingMinutes)}${conflict}`;
}

export function formatMinutes(value: number) {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
}

export function buildAttendanceCalendar(
  month: string,
  attendance: AttendanceRecord[],
  joiningDate: string | null,
  today = getTodayDate(),
  approvedLeaveDates: string[] = [],
  holidays: Holiday[] = [],
): AttendanceCalendarSummary {
  const [year, monthNumber] = month.split("-").map(Number);
  const todayValue = dateValue(parseDate(today));
  const joiningValue = joiningDate ? dateValue(parseDate(joiningDate)) : null;
  const approvedLeaveDateSet = new Set(approvedLeaveDates);
  const holidayDateMap = new Map(holidays.map((holiday) => [holiday.holiday_date, holiday]));
  const attendanceByDate = new Map<string, CalendarDaySummary>();

  for (const record of attendance) {
    const current = attendanceByDate.get(record.attendance_date);
    const status = current && statusPriority(current.status) > statusPriority(record.status)
      ? current.status
      : record.status;
    attendanceByDate.set(record.attendance_date, {
      sessionCount: (current?.sessionCount ?? 0) + 1,
      openSessionCount: (current?.openSessionCount ?? 0) + (record.check_out ? 0 : 1),
      workingMinutes: (current?.workingMinutes ?? 0) + Math.max(0, record.working_minutes ?? 0),
      status,
    });
  }

  const days: CalendarDay[] = [];
  let presentDays = 0;
  let absentDays = 0;
  let halfDayDays = 0;
  let paidLeaveDays = 0;
  let holidayDays = 0;
  let paidDays = 0;
  let workingDays = 0;

  for (let dayNumber = 1; dayNumber <= daysInMonth(year, monthNumber); dayNumber += 1) {
    const date = { year, month: monthNumber, day: dayNumber };
    const dateString = formatDate(date);
    const weekday = toLocalDate(date).getDay();
    const isFriday = weekday === 5;
    const isBeforeJoining = joiningValue !== null && dateValue(date) < joiningValue;
    const isFuture = isBeforeJoining || dateValue(date) > todayValue;
    const summary = attendanceByDate.get(dateString) ?? null;
    const approvedLeave = approvedLeaveDateSet.has(dateString);
    const leaveConflict = approvedLeave && summary !== null;
    const holiday = holidayDateMap.get(dateString) ?? null;
    const attendanceStatus = summary?.status === "LEAVE" && !approvedLeave
      ? (isFriday ? "HOLIDAY" : "ABSENT")
      : summary?.status;
    const status: CalendarDayStatus = holiday
      ? "HOLIDAY"
      : isFuture
        ? attendanceStatus ?? (approvedLeave ? "LEAVE" : "FUTURE")
        : attendanceStatus ?? (approvedLeave ? "LEAVE" : (isFriday ? "HOLIDAY" : "ABSENT"));
    const applicableWorkingDay = !isFuture && !isFriday && !holiday;

    if (applicableWorkingDay) {
      workingDays += 1;
      const isPresent = summary?.status === "PRESENT";
      const isPaidLeave = approvedLeave;
      if (isPresent) presentDays += 1;
      if (isPaidLeave) paidLeaveDays += 1;
      if (isPresent || isPaidLeave) paidDays += 1;
      if (status === "ABSENT") absentDays += 1;
      else if (status === "HALF_DAY") halfDayDays += 1;
    }

    if (!isFuture && holiday && !isFriday) {
      holidayDays += 1;
      paidDays += 1;
    }

    days.push({ date: dateString, dayNumber, weekday, status, summary, approvedLeave, leaveConflict, holiday });
  }

  return {
    month,
    monthLabel: new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(new Date(year, monthNumber - 1, 1)),
    days,
    presentDays,
    absentDays,
    halfDayDays,
    paidLeaveDays,
    holidayDays,
    paidDays,
    workingDays,
  };
}
