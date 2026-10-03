import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { PageLoader } from "./ui";

export default function EmployeeRoute() {
  const { loading, identityLoading, role, user, employeeProfile } = useAuth();
  const location = useLocation();

  if (loading || identityLoading) return <PageLoader label="Checking your employee session…" />;
  if (!user) return <Navigate to="/employee/login" replace state={{ from: location }} />;
  if (role === "admin") return <Navigate to="/admin/dashboard" replace />;
  if (role !== "employee" || !employeeProfile) return <Navigate to="/employee/login" replace />;

  const mustChange = employeeProfile.must_change_password;
  if (mustChange && location.pathname !== "/employee/change-password") {
    return <Navigate to="/employee/change-password" replace />;
  }
  return <Outlet />;
}
