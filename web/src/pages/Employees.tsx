import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Copy, Plus, Search, UserRoundPlus, X } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { createEmployee, createEnrollmentSession, getDepartments, getEmployees, getEnrollmentLabel, getEnrollmentSessions, latestEnrollmentByEmployee } from "../lib/data";
import type { Department, Employee, EnrollmentSession } from "../types/database";
import { EmptyState, ErrorState, Initials, PageLoader, StatusBadge } from "../components/ui";

export default function Employees() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [enrollments, setEnrollments] = useState<Map<string, EnrollmentSession>>(new Map());
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [sessionCreatingFor, setSessionCreatingFor] = useState<string | null>(null);
  const [sessionResult, setSessionResult] = useState<{ employeeName: string; token: string; expiresAt: string } | null>(null);
  const [form, setForm] = useState({ employee_code: "", full_name: "", email: "", phone: "", department_id: "", designation: "", joining_date: "" });

  const loadEmployees = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [employeeRows, departmentRows, enrollmentRows] = await Promise.all([getEmployees(), getDepartments(), getEnrollmentSessions()]);
      setEmployees(employeeRows);
      setDepartments(departmentRows);
      setEnrollments(latestEnrollmentByEmployee(enrollmentRows));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Please try again in a moment.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Supabase data is an external system; load it when the page mounts.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadEmployees(); }, [loadEmployees]);

  const filteredEmployees = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return employees;
    return employees.filter((employee) => [employee.full_name, employee.employee_code, employee.email ?? "", employee.departments?.name ?? ""].some((value) => value.toLowerCase().includes(needle)));
  }, [employees, search]);

  const resetForm = () => {
    setForm({ employee_code: "", full_name: "", email: "", phone: "", department_id: "", designation: "", joining_date: "" });
    setFormError("");
  };

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user) return;
    setSaving(true);
    setFormError("");
    try {
      await createEmployee({ ...form, email: form.email || null, phone: form.phone || null, department_id: form.department_id || null, designation: form.designation || null, joining_date: form.joining_date || null, created_by: user.id });
      setDialogOpen(false);
      resetForm();
      await loadEmployees();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "Employee could not be created.");
    } finally {
      setSaving(false);
    }
  };

  const handleCreateSession = async (employee: Employee) => {
    setSessionCreatingFor(employee.id);
    setError("");
    try {
      const result = await createEnrollmentSession(employee.id);
      setSessionResult({ employeeName: employee.full_name, token: result.enrollment_token, expiresAt: result.expires_at });
      await loadEmployees();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Enrollment session could not be created.");
    } finally {
      setSessionCreatingFor(null);
    }
  };

  if (loading) return <PageLoader label="Loading employees…" />;
  if (error) return <ErrorState message={error} onRetry={() => void loadEmployees()} />;

  const deletionNotice = (location.state as { employeeDeleted?: boolean } | null)?.employeeDeleted
    ? "Employee deleted successfully."
    : "";

  return (
    <div className="page-stack">
      {deletionNotice && <div className="form-success" role="status">{deletionNotice}<button className="notice-dismiss" type="button" onClick={() => navigate(location.pathname, { replace: true, state: null })}>Dismiss</button></div>}
      <section className="toolbar panel">
        <div className="search-field"><Search size={17} /><input aria-label="Search employees" placeholder="Search by name, code, or department" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
        <button className="button button-primary" onClick={() => setDialogOpen(true)}><Plus size={17} /> Add employee</button>
      </section>

      {sessionResult && <div className="modal-backdrop" role="presentation"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="enrollment-session-title"><div className="modal-header"><div><div className="eyebrow">One-time capability</div><h2 id="enrollment-session-title">Enrollment session created</h2></div><button className="icon-button" onClick={() => setSessionResult(null)} aria-label="Close dialog"><X size={19} /></button></div><p>Transfer this token to the enrollment device for <strong>{sessionResult.employeeName}</strong>. It is shown only now and expires {new Date(sessionResult.expiresAt).toLocaleString()}.</p><div className="form-field"><label htmlFor="enrollment-token">Enrollment token</label><input id="enrollment-token" readOnly value={sessionResult.token} /></div><div className="modal-actions"><button className="button button-secondary" onClick={() => void navigator.clipboard?.writeText(sessionResult.token)}><Copy size={15} /> Copy token</button><button className="button button-primary" onClick={() => setSessionResult(null)}>Done</button></div></section></div>}

      <section className="panel table-panel">
        <div className="panel-header"><div><h2>Employee directory</h2><p>{employees.length} employee{employees.length === 1 ? "" : "s"} in your workspace</p></div><div className="table-summary">{filteredEmployees.length} shown</div></div>
        {filteredEmployees.length === 0 ? <EmptyState title={employees.length ? "No matches found" : "No employees yet"} description={employees.length ? "Try a different search term." : "Add your first employee to begin building the directory."} action={!employees.length ? <button className="button button-secondary button-small" onClick={() => setDialogOpen(true)}><UserRoundPlus size={15} /> Add employee</button> : undefined} /> : (
          <div className="table-scroll"><table><thead><tr><th>Employee</th><th>Department</th><th>Status</th><th>Enrollment</th><th>Contact</th></tr></thead><tbody>
            {filteredEmployees.map((employee) => {
              const enrollment = getEnrollmentLabel(enrollments.get(employee.id));
              return <tr key={employee.id}><td><div className="person-cell"><Initials name={employee.full_name} /><div><strong><Link className="employee-name-link" to={`/employees/${employee.id}/attendance`}>{employee.full_name}</Link></strong><span>{employee.employee_code}{employee.designation ? ` · ${employee.designation}` : ""}</span></div></div></td><td>{employee.departments ? <div><strong className="table-primary">{employee.departments.name}</strong><span className="table-secondary">{employee.departments.code}</span></div> : <span className="muted">Unassigned</span>}</td><td><StatusBadge tone={employee.status === "ACTIVE" ? "success" : employee.status === "SUSPENDED" ? "danger" : "muted"}>{employee.status}</StatusBadge></td><td><div><StatusBadge tone={enrollment.tone}>{enrollment.label}</StatusBadge>{employee.status === "ACTIVE" && enrollment.label !== "Enrolled" && <button className="button button-secondary button-small" disabled={sessionCreatingFor === employee.id} onClick={() => void handleCreateSession(employee)}>{sessionCreatingFor === employee.id ? "Creating…" : "Create session"}</button>}</div></td><td><span className="table-secondary">{employee.email ?? employee.phone ?? "No contact details"}</span></td></tr>;
            })}
          </tbody></table></div>
        )}
      </section>

      {dialogOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialogOpen(false); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="add-employee-title"><div className="modal-header"><div><div className="eyebrow">Employee directory</div><h2 id="add-employee-title">Add employee</h2></div><button className="icon-button" onClick={() => setDialogOpen(false)} aria-label="Close dialog"><X size={19} /></button></div><form className="modal-form" onSubmit={handleCreate}><div className="form-grid"><label>Employee code<input value={form.employee_code} onChange={(event) => setForm({ ...form, employee_code: event.target.value.toUpperCase() })} placeholder="EMP-001" required /></label><label>Full name<input value={form.full_name} onChange={(event) => setForm({ ...form, full_name: event.target.value })} placeholder="Alex Morgan" required /></label><label>Email<input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="alex@company.com" /></label><label>Phone<input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="Optional" /></label><label>Department<select value={form.department_id} onChange={(event) => setForm({ ...form, department_id: event.target.value })}><option value="">Unassigned</option>{departments.filter((department) => department.is_active).map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label><label>Designation<input value={form.designation} onChange={(event) => setForm({ ...form, designation: event.target.value })} placeholder="Optional" /></label><label>Joining date<input type="date" value={form.joining_date} onChange={(event) => setForm({ ...form, joining_date: event.target.value })} /></label></div>{formError && <div className="form-error" role="alert">{formError}</div>}<div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setDialogOpen(false)}>Cancel</button><button className="button button-primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Create employee"}</button></div></form></section></div>}
    </div>
  );
}
