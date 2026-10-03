import type { AttendanceCalendarSummary } from "./attendanceCalendar";

export const MAX_MONTHLY_SALARY = 9_999_999_999.99;

export interface EarnedSalary {
  presentDays: number;
  paidLeaveDays: number;
  paidDays: number;
  totalWorkingDays: number;
  dailySalary: number;
  earnedSalary: number;
}

/**
 * Counts company working days for the entire selected month. Friday (weekday
 * 5) is the only weekly holiday; future dates are still included here because
 * the monthly salary denominator is independent of attendance to date.
 */
export function getTotalWorkingDays(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const totalCalendarDays = new Date(year, monthNumber, 0).getDate();
  let totalWorkingDays = 0;

  for (let dayNumber = 1; dayNumber <= totalCalendarDays; dayNumber += 1) {
    if (new Date(year, monthNumber - 1, dayNumber).getDay() !== 5) totalWorkingDays += 1;
  }

  return totalWorkingDays;
}

/**
 * Uses the employee calendar's server-provided attendance statuses. The
 * salary denominator is every date in the selected month except Friday;
 * paid days are only applicable PRESENT and LEAVE dates through today.
 */
export function calculateEarnedSalary(
  monthlySalary: number,
  calendar: AttendanceCalendarSummary,
): EarnedSalary {
  const safeMonthlySalary = Number.isFinite(monthlySalary) && monthlySalary >= 0 ? monthlySalary : 0;
  const presentDays = calendar.presentDays;
  const paidLeaveDays = calendar.paidLeaveDays;
  const paidDays = calendar.paidDays;
  const totalWorkingDays = getTotalWorkingDays(calendar.month);
  const dailySalary = totalWorkingDays > 0 ? safeMonthlySalary / totalWorkingDays : 0;
  const earnedSalary = totalWorkingDays > 0
    ? roundCurrency(dailySalary * paidDays)
    : 0;

  return { presentDays, paidLeaveDays, paidDays, totalWorkingDays, dailySalary, earnedSalary };
}

export function parseMonthlySalary(value: string): number | null {
  const normalized = value.trim();
  if (!/^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(normalized)) return null;

  const salary = Number(normalized);
  if (!Number.isFinite(salary) || salary < 0 || salary > MAX_MONTHLY_SALARY) return null;
  return salary;
}

export function formatInr(value: number | string | null | undefined) {
  const amount = typeof value === "number" ? value : Number(value ?? 0);
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(amount) && amount >= 0 ? amount : 0);
}

export function formatSalaryInput(value: number | string | null | undefined) {
  const amount = typeof value === "number" ? value : Number(value ?? 0);
  return (Number.isFinite(amount) && amount >= 0 ? amount : 0).toFixed(2);
}

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
