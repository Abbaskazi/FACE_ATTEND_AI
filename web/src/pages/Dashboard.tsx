import { useCallback, useEffect, useState } from "react";
import { ArrowUpRight, Building2, CheckCircle2, Clock3, Users, UserCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { getDashboardData } from "../lib/data";
import type { DashboardData } from "../types/database";
import { EmptyState, ErrorState, formatDateTime, formatTime, PageLoader, StatusBadge } from "../components/ui";

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await getDashboardData());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Please try again in a moment.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Supabase data is an external system; load it when the page mounts.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadDashboard(); }, [loadDashboard]);

  if (loading) return <PageLoader label="Loading your workspace…" />;
  if (error) return <ErrorState message={error} onRetry={() => void loadDashboard()} />;
  if (!data) return null;

  const metrics = [
    { label: "Total employees", value: data.totalEmployees, detail: `${data.activeEmployees} active`, icon: Users, tone: "purple" },
    { label: "Present today", value: data.presentToday, detail: `${data.attendanceRate}% of active team`, icon: UserCheck, tone: "green" },
    { label: "Active departments", value: data.activeDepartments, detail: "Organizational units", icon: Building2, tone: "blue" },
    { label: "Attendance rate", value: `${data.attendanceRate}%`, detail: "Based on today’s records", icon: CheckCircle2, tone: "amber" },
  ];

  return (
    <div className="dashboard-page page-stack">
      <section className="metric-grid">
        {metrics.map(({ label, value, detail, icon: Icon, tone }) => (
          <article className="metric-card" key={label}>
            <div className={`metric-icon metric-icon-${tone}`}><Icon size={20} /></div>
            <div className="metric-label">{label}</div>
            <div className="metric-value">{value}</div>
            <div className="metric-detail">{detail}</div>
          </article>
        ))}
      </section>

      <section className="dashboard-grid">
        <article className="panel recent-panel">
          <div className="panel-header"><div><h2>Recent attendance</h2><p>Latest check-in activity across your team</p></div><Link className="text-link" to="/attendance">View all <ArrowUpRight size={15} /></Link></div>
          {data.recentAttendance.length === 0 ? (
            <EmptyState title="No attendance yet" description="Attendance records will appear here once employees check in." />
          ) : (
            <div className="activity-list">
              {data.recentAttendance.map((record) => (
                <div className="activity-row" key={record.id}>
                  <div className="activity-avatar">{record.employees?.full_name.slice(0, 1).toUpperCase() ?? "?"}</div>
                  <div className="activity-person"><strong>{record.employees?.full_name ?? "Unknown employee"}</strong><span>{record.employees?.departments?.name ?? "Unassigned"}</span></div>
                  <div className="activity-time"><strong>{formatTime(record.check_in)}</strong><span>{formatDateTime(record.created_at)}</span></div>
                  <StatusBadge tone={record.status === "PRESENT" ? "success" : record.status === "HALF_DAY" ? "warning" : "muted"}>{record.status.replace("_", " ")}</StatusBadge>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="panel quick-panel">
          <div className="panel-header"><div><h2>At a glance</h2><p>Keep your workspace moving</p></div></div>
          <div className="quick-list">
            <Link to="/employees" className="quick-link"><div className="quick-link-icon"><Users size={18} /></div><div><strong>Manage employees</strong><span>Review profiles and enrollment status</span></div><ArrowUpRight size={16} /></Link>
            <Link to="/attendance" className="quick-link"><div className="quick-link-icon"><Clock3 size={18} /></div><div><strong>Review attendance</strong><span>Check daily records and working hours</span></div><ArrowUpRight size={16} /></Link>
            <Link to="/reports" className="quick-link"><div className="quick-link-icon"><Building2 size={18} /></div><div><strong>Open reports</strong><span>Explore team attendance trends</span></div><ArrowUpRight size={16} /></Link>
          </div>
        </article>
      </section>
    </div>
  );
}
