import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Plus, Trash2, X } from "lucide-react";
import { ErrorState, formatDate, PageLoader } from "../components/ui";
import { addHoliday, deleteHoliday, getHolidaysForMonth, holidayByDate, MAX_HOLIDAY_REASON_LENGTH } from "../lib/holidays";
import { getCurrentMonth, getMonthWeekdayOffset, shiftMonth } from "../lib/attendanceCalendar";
import type { Holiday } from "../types/database";

const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function daysInMonth(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(year, monthNumber, 0).getDate();
}

function dateForMonth(month: string, day: number) {
  return `${month}-${day.toString().padStart(2, "0")}`;
}

function monthLabel(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(new Date(year, monthNumber - 1, 1));
}

export default function HolidayManagement() {
  const [month, setMonth] = useState(getCurrentMonth);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"add" | "details" | null>(null);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");

  const loadHolidays = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setHolidays(await getHolidaysForMonth(month));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Holidays could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    // The calendar is backed by the protected holidays table; this reload is
    // scoped to the visible month.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadHolidays();
  }, [loadHolidays]);

  const byDate = useMemo(() => holidayByDate(holidays), [holidays]);
  const leadingCells = getMonthWeekdayOffset(month);
  const totalDays = daysInMonth(month);
  const trailingCells = (7 - ((leadingCells + totalDays) % 7)) % 7;
  const selectedHoliday = selectedDate ? byDate.get(selectedDate) ?? null : null;

  const openDate = (date: string) => {
    setSelectedDate(date);
    setFormError("");
    if (byDate.has(date)) {
      setDialog("details");
    } else {
      setReason("");
      setDialog("add");
    }
  };

  const handleAdd = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedDate) return;
    const trimmedReason = reason.trim();
    if (!trimmedReason || trimmedReason.length > MAX_HOLIDAY_REASON_LENGTH) {
      setFormError(`Enter a reason between 1 and ${MAX_HOLIDAY_REASON_LENGTH} characters.`);
      return;
    }
    setSaving(true);
    setFormError("");
    try {
      await addHoliday({ holidayDate: selectedDate, reason: trimmedReason });
      setDialog(null);
      await loadHolidays();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "Holiday could not be added.");
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    if (!selectedHoliday || !window.confirm(`Remove the holiday on ${formatDate(selectedHoliday.holiday_date)}?`)) return;
    setSaving(true);
    setFormError("");
    try {
      await deleteHoliday(selectedHoliday.id);
      setDialog(null);
      await loadHolidays();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "Holiday could not be removed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-stack">
      {error && <ErrorState message={error} onRetry={() => void loadHolidays()} />}
      <section className="panel calendar-panel holiday-management-panel">
        <div className="panel-header calendar-panel-header">
          <div><div className="eyebrow">Admin calendar</div><h2>Holiday Management</h2><p>Select one date at a time to add or manage a paid holiday.</p></div>
          <div className="calendar-legend"><span><i className="legend-swatch legend-admin-holiday" />Admin holiday</span></div>
        </div>
        <div className="holiday-month-toolbar">
          <button className="icon-button" type="button" onClick={() => { setMonth((value) => shiftMonth(value, -1)); setDialog(null); }} aria-label="Previous month"><ChevronLeft size={17} /></button>
          <strong>{monthLabel(month)}</strong>
          <button className="icon-button" type="button" onClick={() => { setMonth((value) => shiftMonth(value, 1)); setDialog(null); }} aria-label="Next month"><ChevronRight size={17} /></button>
          <button className="button button-secondary button-small" type="button" onClick={() => { setMonth(getCurrentMonth()); setDialog(null); }} disabled={month === getCurrentMonth()}><CalendarDays size={14} /> Current month</button>
        </div>
        {loading ? <PageLoader label="Loading holidays…" /> : <div className="calendar-content holiday-calendar-content"><div className="calendar-weekdays">{weekdayLabels.map((label) => <span key={label}>{label}</span>)}</div><div className="attendance-calendar">{Array.from({ length: leadingCells }, (_, index) => <div className="calendar-day calendar-day-empty" key={`leading-${index}`} />)}{Array.from({ length: totalDays }, (_, index) => { const date = dateForMonth(month, index + 1); const holiday = byDate.get(date); return <button className={`calendar-day calendar-day-admin-empty${holiday ? " calendar-day-admin-holiday" : ""}${selectedDate === date ? " calendar-day-selected" : ""}`} key={date} type="button" title={holiday?.reason ?? "Click to add a holiday"} onClick={() => openDate(date)}><span>{index + 1}</span>{holiday ? <small>{holiday.reason}</small> : <small><Plus size={12} /></small>}</button>; })}{Array.from({ length: trailingCells }, (_, index) => <div className="calendar-day calendar-day-empty" key={`trailing-${index}`} />)}</div></div>}
      </section>

      {dialog && selectedDate && <div className="modal-backdrop" role="presentation"><section className="modal holiday-dialog" role="dialog" aria-modal="true" aria-labelledby="holiday-dialog-title">
        <div className="modal-header"><div><div className="eyebrow">Holiday</div><h2 id="holiday-dialog-title">{dialog === "add" ? "Add Holiday" : "Holiday details"}</h2></div><button className="icon-button" type="button" onClick={() => setDialog(null)} disabled={saving} aria-label="Close holiday dialog"><X size={19} /></button></div>
        {dialog === "add" ? <form className="modal-form" onSubmit={(event) => void handleAdd(event)}><div className="holiday-selected-date"><span>Date</span><strong>{formatDate(selectedDate)}</strong></div><label>Reason *<input value={reason} maxLength={MAX_HOLIDAY_REASON_LENGTH} autoFocus required placeholder="Holiday name or reason" onChange={(event) => setReason(event.target.value)} /></label>{formError && <div className="form-error" role="alert">{formError}</div>}<div className="modal-actions"><button className="button button-secondary" type="button" onClick={() => setDialog(null)} disabled={saving}>Cancel</button><button className="button button-primary" type="submit" disabled={saving}>{saving ? "Adding…" : "Add Holiday"}</button></div></form> : <div className="holiday-detail-body"><div className="holiday-selected-date"><span>Date</span><strong>{formatDate(selectedDate)}</strong></div><div className="holiday-reason-detail"><span>Reason</span><strong>{selectedHoliday?.reason}</strong></div>{formError && <div className="form-error" role="alert">{formError}</div>}<div className="modal-actions"><button className="button button-secondary" type="button" onClick={() => setDialog(null)} disabled={saving}>Close</button><button className="button button-danger" type="button" onClick={() => void handleRemove()} disabled={saving || !selectedHoliday}><Trash2 size={15} />{saving ? "Removing…" : "Remove Holiday"}</button></div></div>}
      </section></div>}
    </div>
  );
}
