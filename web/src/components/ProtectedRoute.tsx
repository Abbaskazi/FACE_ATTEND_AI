import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { PageLoader } from "./ui";

export default function ProtectedRoute() {
  const { loading, identityLoading, role, user } = useAuth();
  const location = useLocation();

  if (loading) return <PageLoader label="Checking your session…" />;
  if (!user) return <Navigate to="/admin" replace state={{ from: location }} />;
  if (identityLoading) return <PageLoader label="Checking your access…" />;
  if (role !== "admin") return <Navigate to={role === "employee" ? "/employee" : "/admin"} replace />;
  return <Outlet />;
}
