import type { AttendanceRecord } from "../types/database";

export type CalendarDayStatus = "PRESENT" | "ABSENT" | "HOLIDAY" | "FUTURE";

export interface CalendarDaySummary {
  sessionCount: number;
  openSessionCount: number;
  workingMinutes: number;
}

export interface CalendarDay {
  date: string;
  dayNumber: number;
  weekday: number;
  status: CalendarDayStatus;
  summary: CalendarDaySummary | null;
}

export interface AttendanceCalendarSummary {
  month: string;
  monthLabel: string;
  days: CalendarDay[];
  presentDays: number;
  absentDays: number;
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
  if (day.status === "PRESENT") {
    const sessions = `${day.summary?.sessionCount ?? 0} session${day.summary?.sessionCount === 1 ? "" : "s"}`;
    const open = day.summary?.openSessionCount ? `, ${day.summary.openSessionCount} open` : "";
    return `${day.date} · Present · ${sessions}${open} · Total working time ${formatMinutes(day.summary?.workingMinutes ?? 0)}`;
  }
  if (day.status === "ABSENT") return `${day.date} · Absent`;
  if (day.status === "HOLIDAY") return `${day.date} · Weekly Holiday`;
  return `${day.date} · Not yet applicable`;
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
): AttendanceCalendarSummary {
  const [year, monthNumber] = month.split("-").map(Number);
  const todayValue = dateValue(parseDate(today));
  const joiningValue = joiningDate ? dateValue(parseDate(joiningDate)) : null;
  const attendanceByDate = new Map<string, CalendarDaySummary>();

  for (const record of attendance) {
    if (!record.check_in) continue;
    const current = attendanceByDate.get(record.attendance_date) ?? {
      sessionCount: 0,
      openSessionCount: 0,
      workingMinutes: 0,
    };
    current.sessionCount += 1;
    if (!record.check_out) current.openSessionCount += 1;
    current.workingMinutes += Math.max(0, record.working_minutes ?? 0);
    attendanceByDate.set(record.attendance_date, current);
  }

  const days: CalendarDay[] = [];
  let presentDays = 0;
  let absentDays = 0;
  let workingDays = 0;

  for (let dayNumber = 1; dayNumber <= daysInMonth(year, monthNumber); dayNumber += 1) {
    const date = { year, month: monthNumber, day: dayNumber };
    const dateString = formatDate(date);
    const weekday = toLocalDate(date).getDay();
    const isFriday = weekday === 5;
    const isBeforeJoining = joiningValue !== null && dateValue(date) < joiningValue;
    const isFuture = isBeforeJoining || dateValue(date) > todayValue;
    const summary = attendanceByDate.get(dateString) ?? null;
    const status: CalendarDayStatus = isFuture
      ? "FUTURE"
      : summary
        ? "PRESENT"
        : isFriday
          ? "HOLIDAY"
          : "ABSENT";

    if (!isFuture && !isFriday) {
      workingDays += 1;
      if (summary) presentDays += 1;
      else absentDays += 1;
    }

    days.push({ date: dateString, dayNumber, weekday, status, summary });
  }

  return {
    month,
    monthLabel: new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(new Date(year, monthNumber - 1, 1)),
    days,
    presentDays,
    absentDays,
    workingDays,
  };
}

