/* This module intentionally co-locates the provider and its hook. */
/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import type { AdminProfile, EmployeeDepartment, EmployeePortalProfile } from "../types/database";

export type AuthRole = "admin" | "employee";

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  loading: boolean;
  identityLoading: boolean;
  role: AuthRole | null;
  adminProfile: AdminProfile | null;
  employeeProfile: EmployeePortalProfile | null;
  refreshIdentity: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [identityLoading, setIdentityLoading] = useState(true);
  const [role, setRole] = useState<AuthRole | null>(null);
  const [adminProfile, setAdminProfile] = useState<AdminProfile | null>(null);
  const [employeeProfile, setEmployeeProfile] = useState<EmployeePortalProfile | null>(null);

  useEffect(() => {
    let mounted = true;

    void supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return;
      setSession(nextSession);
      setLoading(false);
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const refreshIdentity = useCallback(async () => {
    if (!session?.user) {
      setRole(null);
      setAdminProfile(null);
      setEmployeeProfile(null);
      setIdentityLoading(false);
      return;
    }

    setIdentityLoading(true);
    const [adminResult, employeeResult] = await Promise.all([
      supabase
        .from("admin_profiles")
        .select("id, full_name, is_active")
        .eq("id", session.user.id)
        .eq("is_active", true)
        .maybeSingle(),
      supabase
        .from("employees")
        .select("id, employee_code, full_name, department_id, designation, joining_date, salary, status, must_change_password, department:departments(id, name, code)")
        .eq("auth_user_id", session.user.id)
        .eq("status", "ACTIVE")
        .maybeSingle(),
    ]);

    if (adminResult.error || employeeResult.error) {
      setRole(null);
      setAdminProfile(null);
      setEmployeeProfile(null);
    } else if (adminResult.data) {
      setRole("admin");
      setAdminProfile(adminResult.data as AdminProfile);
      setEmployeeProfile(null);
    } else if (employeeResult.data) {
      const rawEmployee = employeeResult.data as unknown as EmployeePortalProfile & {
        department: EmployeeDepartment[] | EmployeeDepartment | null;
      };
      const department = Array.isArray(rawEmployee.department) ? rawEmployee.department[0] ?? null : rawEmployee.department;
      setRole("employee");
      setEmployeeProfile({ ...rawEmployee, department });
      setAdminProfile(null);
    } else {
      setRole(null);
      setAdminProfile(null);
      setEmployeeProfile(null);
    }
    setIdentityLoading(false);
  }, [session]);

  useEffect(() => {
    // Supabase is an external session/identity system; synchronize its state
    // after the session changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshIdentity();
  }, [refreshIdentity]);

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refreshIdentity();
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => document.removeEventListener("visibilitychange", refreshWhenVisible);
  }, [refreshIdentity]);

  const value = useMemo(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      identityLoading,
      role,
      adminProfile,
      employeeProfile,
      refreshIdentity,
      signOut: async () => {
        await supabase.auth.signOut();
      },
    }),
    [employeeProfile, identityLoading, loading, adminProfile, refreshIdentity, role, session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
