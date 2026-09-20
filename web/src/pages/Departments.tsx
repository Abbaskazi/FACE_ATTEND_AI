import { useCallback, useEffect, useState } from "react";
import { Building2, Plus, Users } from "lucide-react";
import { getDepartmentSummaries } from "../lib/data";
import type { DepartmentSummary } from "../types/database";
import { EmptyState, ErrorState, PageLoader, StatusBadge } from "../components/ui";

export default function Departments() {
  const [departments, setDepartments] = useState<DepartmentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showNotice, setShowNotice] = useState(false);

  const loadDepartments = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setDepartments(await getDepartmentSummaries());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Please try again in a moment.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Supabase data is an external system; load it when the page mounts.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadDepartments(); }, [loadDepartments]);

  if (loading) return <PageLoader label="Loading departments…" />;
  if (error) return <ErrorState message={error} onRetry={() => void loadDepartments()} />;

  return (
    <div className="page-stack">
      <section className="toolbar panel"><div><h2>Departments</h2><p>Organize employees across your business</p></div><button className="button button-primary" onClick={() => setShowNotice(true)}><Plus size={17} /> Add department</button></section>
      {showNotice && <div className="inline-notice"><Building2 size={18} /><div><strong>Department creation is coming next</strong><span>The directory is connected and employee counts are live. The full department workflow will be added without changing your existing security model.</span></div><button className="notice-dismiss" onClick={() => setShowNotice(false)}>Dismiss</button></div>}
      {departments.length === 0 ? <section className="panel"><EmptyState title="No departments yet" description="Add departments in the next workspace management update." action={<button className="button button-secondary button-small" onClick={() => setShowNotice(true)}><Plus size={15} /> Add department</button>} /></section> : <section className="department-grid">{departments.map((department) => <article className="department-card panel" key={department.id}><div className="department-card-top"><div className="department-icon"><Building2 size={20} /></div><StatusBadge tone={department.is_active ? "success" : "muted"}>{department.is_active ? "Active" : "Inactive"}</StatusBadge></div><h2>{department.name}</h2><div className="department-code">{department.code}</div><p>{department.description || "No description provided."}</p><div className="department-card-footer"><span><Users size={16} /> {department.employee_count} employee{department.employee_count === 1 ? "" : "s"}</span><span>{new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(department.created_at))}</span></div></article>)}</section>}
    </div>
  );
}
