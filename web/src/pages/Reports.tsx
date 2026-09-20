import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, CalendarRange, Download, TrendingUp } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { getAttendance, getToday } from "../lib/data";
import type { AttendanceRecord } from "../types/database";
import { EmptyState, ErrorState, formatDate, PageLoader } from "../components/ui";

const getMonthStart = () => {
  const date = new Date();
  const localStart = new Date(date.getFullYear(), date.getMonth(), 1);
  const offset = localStart.getTimezoneOffset() * 60_000;
  return new Date(localStart.getTime() - offset).toISOString().slice(0, 10);
};

export default function Reports() {
  const [from, setFrom] = useState(getMonthStart());
  const [to, setTo] = useState(getToday());
  const [applied, setApplied] = useState({ from: getMonthStart(), to: getToday() });
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setRecords(await getAttendance({ ...applied, limit: 1000 }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Please try again in a moment.");
    } finally {
      setLoading(false);
    }
  }, [applied]);

  // Supabase data is an external system; load it when the report period changes.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadReport(); }, [loadReport]);

  const dailyData = useMemo(() => {
    const days = new Map<string, { date: string; present: number; other: number }>();
    for (const record of records) {
      const current = days.get(record.attendance_date) ?? { date: record.attendance_date.slice(5), present: 0, other: 0 };
      if (record.status === "PRESENT") current.present += 1;
      else current.other += 1;
      days.set(record.attendance_date, current);
    }
    return [...days.entries()].sort(([first], [second]) => first.localeCompare(second)).map(([, value]) => value);
  }, [records]);

  const departmentData = useMemo(() => {
    const departments = new Map<string, number>();
    for (const record of records) {
      const name = record.employees?.departments?.name ?? "Unassigned";
      departments.set(name, (departments.get(name) ?? 0) + 1);
    }
    return [...departments.entries()].map(([name, attendance]) => ({ name, attendance })).sort((first, second) => second.attendance - first.attendance).slice(0, 8);
  }, [records]);

  const presentCount = records.filter((record) => record.status === "PRESENT").length;
  const otherCount = records.length - presentCount;
  const applyFilters = () => { if (from <= to) setApplied({ from, to }); };

  return (
    <div className="page-stack">
      <section className="report-hero panel"><div><div className="eyebrow">Attendance intelligence</div><h2>Understand your team’s rhythm</h2><p>Use the selected period to review attendance patterns and prepare future exports.</p></div><div className="report-hero-icon"><TrendingUp size={25} /></div></section>
      <section className="filters panel"><div className="filter-heading"><CalendarRange size={17} /><strong>Report period</strong></div><label>From<input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} /></label><label>To<input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} /></label><button className="button button-secondary filter-apply" onClick={applyFilters} disabled={from > to}>Update report</button><button className="button button-ghost" disabled title="Export will be enabled with the reporting workflow"><Download size={16} /> Export</button></section>
      {loading ? <PageLoader label="Preparing report…" /> : error ? <ErrorState message={error} onRetry={() => void loadReport()} /> : <>
        <section className="report-stat-grid"><article className="report-stat panel"><span>Total records</span><strong>{records.length}</strong><small>{formatDate(applied.from)} – {formatDate(applied.to)}</small></article><article className="report-stat panel"><span>Present records</span><strong>{presentCount}</strong><small>{records.length ? Math.round((presentCount / records.length) * 100) : 0}% of recorded attendance</small></article><article className="report-stat panel"><span>Other statuses</span><strong>{otherCount}</strong><small>Leave, half-day, or absent</small></article></section>
        {records.length === 0 ? <section className="panel"><EmptyState title="No attendance data for this period" description="Choose another date range once attendance records are available." /></section> : <section className="report-chart-grid"><article className="panel chart-panel"><div className="panel-header"><div><h2>Daily attendance</h2><p>Present versus other recorded statuses</p></div><BarChart3 size={19} className="panel-icon" /></div><div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><BarChart data={dailyData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e7eaf0" /><XAxis dataKey="date" tickLine={false} axisLine={false} tick={{ fill: "#7b8496", fontSize: 11 }} /><YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: "#7b8496", fontSize: 11 }} /><Tooltip contentStyle={{ border: "1px solid #e2e6ee", borderRadius: 10, boxShadow: "0 8px 24px rgba(27, 39, 66, .1)" }} /><Bar dataKey="present" name="Present" fill="#2f9d70" radius={[4, 4, 0, 0]} /><Bar dataKey="other" name="Other" fill="#d8def1" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div></article><article className="panel chart-panel"><div className="panel-header"><div><h2>By department</h2><p>Attendance records by team</p></div><BarChart3 size={19} className="panel-icon" /></div><div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><BarChart data={departmentData} layout="vertical" margin={{ top: 5, right: 18, left: 10, bottom: 5 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e7eaf0" /><XAxis type="number" allowDecimals={false} hide /><YAxis type="category" dataKey="name" width={90} tickLine={false} axisLine={false} tick={{ fill: "#7b8496", fontSize: 11 }} /><Tooltip contentStyle={{ border: "1px solid #e2e6ee", borderRadius: 10, boxShadow: "0 8px 24px rgba(27, 39, 66, .1)" }} /><Bar dataKey="attendance" name="Records" fill="#6862c9" radius={[0, 4, 4, 0]} barSize={18} /></BarChart></ResponsiveContainer></div></article></section>}
      </>}
    </div>
  );
}
