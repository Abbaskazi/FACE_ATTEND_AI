import { supabase } from "./supabase";
import type { Holiday } from "../types/database";

export const MAX_HOLIDAY_REASON_LENGTH = 200;

function throwIfError(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

export function getMonthDateRange(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(year, monthNumber, 0).getDate();
  return {
    from: `${month}-01`,
    to: `${month}-${lastDay.toString().padStart(2, "0")}`,
  };
}

export async function getHolidays(options: { from?: string; to?: string } = {}) {
  let query = supabase
    .from("holidays")
    .select("id, holiday_date, reason, created_by, created_at, updated_at")
    .order("holiday_date", { ascending: true });

  if (options.from) query = query.gte("holiday_date", options.from);
  if (options.to) query = query.lte("holiday_date", options.to);

  const { data, error } = await query;
  throwIfError(error);
  return (data ?? []) as Holiday[];
}

export async function getHolidaysForMonth(month: string) {
  return getHolidays(getMonthDateRange(month));
}

export async function addHoliday(input: { holidayDate: string; reason: string }) {
  const reason = input.reason.trim();
  if (!input.holidayDate) throw new Error("Choose a holiday date.");
  if (!reason || reason.length > MAX_HOLIDAY_REASON_LENGTH) {
    throw new Error(`Holiday reason must be between 1 and ${MAX_HOLIDAY_REASON_LENGTH} characters.`);
  }

  const { data, error } = await supabase.rpc("admin_add_holiday", {
    p_holiday_date: input.holidayDate,
    p_reason: reason,
  });
  if (error) {
    if (error.code === "23505" || error.message.toLowerCase().includes("holiday_date_unique")) {
      throw new Error("A holiday already exists for this date.");
    }
    if (error.message.includes("admin_authorization_required")) {
      throw new Error("Active administrator access is required.");
    }
    throw new Error(error.message);
  }
  if (typeof data !== "string") throw new Error("Holiday could not be added.");
  return data;
}

export async function deleteHoliday(id: string) {
  const { data, error } = await supabase.rpc("admin_delete_holiday", { p_holiday_id: id });
  throwIfError(error);
  if (data !== true) throw new Error("Holiday could not be removed.");
}

export function holidayByDate(holidays: Holiday[]) {
  return new Map(holidays.map((holiday) => [holiday.holiday_date, holiday]));
}
