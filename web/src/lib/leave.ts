import { getTodayDate } from "./attendanceCalendar";
import type { LeaveRequest } from "../types/database";
import type { Holiday } from "../types/database";

export const PAID_LEAVE_ALLOWANCE = 2;

export interface LeaveMonthBreakdown {
  month: string;
  workingDays: number;
}

export interface LeavePreview {
  calendarDays: number;
  workingDays: number;
  months: LeaveMonthBreakdown[];
}

function parseDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDate(value: Date) {
  return `${value.getUTCFullYear().toString().padStart(4, "0")}-${(value.getUTCMonth() + 1).toString().padStart(2, "0")}-${value.getUTCDate().toString().padStart(2, "0")}`;
}

function isValidDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = parseDate(value);
  return formatDate(date) === value;
}

function dateDifference(startDate: string, endDate: string) {
  return Math.floor((parseDate(endDate).getTime() - parseDate(startDate).getTime()) / 86_400_000);
}

function monthKey(date: Date) {
  return `${date.getUTCFullYear().toString().padStart(4, "0")}-${(date.getUTCMonth() + 1).toString().padStart(2, "0")}`;
}

export function countWorkingLeaveDays(startDate: string, endDate: string, holidays: Holiday[] = []) {
  if (!isValidDate(startDate) || !isValidDate(endDate) || startDate > endDate) return 0;

  let workingDays = 0;
  const holidayDates = new Set(holidays.map((holiday) => holiday.holiday_date));
  const current = parseDate(startDate);
  const end = parseDate(endDate);
  while (current <= end) {
    if (current.getUTCDay() !== 5 && !holidayDates.has(formatDate(current))) workingDays += 1;
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return workingDays;
}

export function getLeaveMonthBreakdown(startDate: string, endDate: string, holidays: Holiday[] = []): LeaveMonthBreakdown[] {
  if (!isValidDate(startDate) || !isValidDate(endDate) || startDate > endDate) return [];

  const byMonth = new Map<string, number>();
  const holidayDates = new Set(holidays.map((holiday) => holiday.holiday_date));
  const current = parseDate(startDate);
  const end = parseDate(endDate);
  while (current <= end) {
    if (current.getUTCDay() !== 5 && !holidayDates.has(formatDate(current))) {
      const month = monthKey(current);
      byMonth.set(month, (byMonth.get(month) ?? 0) + 1);
    }
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return [...byMonth.entries()].map(([month, workingDays]) => ({ month, workingDays }));
}

export function calculateLeavePreview(startDate: string, endDate: string, holidays: Holiday[] = []): LeavePreview {
  const validRange = isValidDate(startDate) && isValidDate(endDate) && startDate <= endDate;
  const calendarDays = validRange ? dateDifference(startDate, endDate) + 1 : 0;
  const months = validRange ? getLeaveMonthBreakdown(startDate, endDate, holidays) : [];
  return {
    calendarDays,
    workingDays: months.reduce((total, month) => total + month.workingDays, 0),
    months,
  };
}

export function getApprovedLeaveUsageByMonth(requests: LeaveRequest[], holidays: Holiday[] = []) {
  const usage = new Map<string, number>();
  for (const request of requests) {
    if (request.status !== "APPROVED") continue;
    for (const month of getLeaveMonthBreakdown(request.start_date, request.end_date, holidays)) {
      usage.set(month.month, (usage.get(month.month) ?? 0) + month.workingDays);
    }
  }
  return usage;
}

export function getApprovedLeaveDates(requests: LeaveRequest[], holidays: Holiday[] = []) {
  const dates = new Set<string>();
  const holidayDates = new Set(holidays.map((holiday) => holiday.holiday_date));
  for (const request of requests) {
    if (request.status !== "APPROVED") continue;
    const current = parseDate(request.start_date);
    const end = parseDate(request.end_date);
    while (current <= end) {
      if (current.getUTCDay() !== 5 && !holidayDates.has(formatDate(current))) dates.add(formatDate(current));
      current.setUTCDate(current.getUTCDate() + 1);
    }
  }
  return dates;
}

export function formatLeaveMonth(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(
    new Date(Date.UTC(year, monthNumber - 1, 1)),
  );
}

export function getLeaveToday() {
  return getTodayDate();
}
