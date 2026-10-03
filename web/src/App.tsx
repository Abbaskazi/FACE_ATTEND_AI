import { BrowserRouter, Navigate, Route, Routes, useParams } from "react-router-dom";
import { AuthProvider } from "./auth/AuthProvider";
import AppShell from "./components/AppShell";
import EmployeeRoute from "./components/EmployeeRoute";
import ProtectedRoute from "./components/ProtectedRoute";
import Attendance from "./pages/Attendance";
import Dashboard from "./pages/Dashboard";
import Departments from "./pages/Departments";
import Employees from "./pages/Employees";
import EmployeeAttendance from "./pages/EmployeeAttendance";
import Login from "./pages/Login";
import EmployeeChangePassword from "./pages/EmployeeChangePassword";
import EmployeeLogin from "./pages/EmployeeLogin";
import EmployeePortal from "./pages/EmployeePortal";
import EmployeeLeave from "./pages/EmployeeLeave";
import LeaveRequests from "./pages/LeaveRequests";
import PasswordChangeRequests from "./pages/PasswordChangeRequests";
import Reports from "./pages/Reports";
import HolidayManagement from "./pages/HolidayManagement";

function LegacyEmployeeAttendanceRedirect() {
  const { employeeId } = useParams();
  return <Navigate to={`/admin/employees/${employeeId ?? ""}/attendance`} replace />;
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<EmployeeLogin />} />
          <Route path="/employee/login" element={<EmployeeLogin />} />
          <Route element={<EmployeeRoute />}>
            <Route path="/employee/change-password" element={<EmployeeChangePassword />} />
            <Route path="/employee" element={<EmployeePortal />} />
            <Route path="/employee/attendance" element={<EmployeePortal view="attendance" />} />
            <Route path="/employee/leave" element={<EmployeeLeave />} />
            <Route path="/employee/*" element={<Navigate to="/employee" replace />} />
          </Route>
          <Route path="/admin">
            <Route index element={<Login />} />
            <Route element={<ProtectedRoute />}>
              <Route element={<AppShell />}>
                <Route path="dashboard" element={<Dashboard />} />
                <Route path="employees" element={<Employees />} />
                <Route path="employees/:employeeId/attendance" element={<EmployeeAttendance />} />
                <Route path="departments" element={<Departments />} />
                <Route path="attendance" element={<Attendance />} />
                <Route path="leave-requests" element={<LeaveRequests />} />
                <Route path="holidays" element={<HolidayManagement />} />
                <Route path="password-change-requests" element={<PasswordChangeRequests />} />
                <Route path="reports" element={<Reports />} />
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </Route>
          <Route path="/login" element={<Navigate to="/admin" replace />} />
          <Route path="/dashboard" element={<Navigate to="/admin/dashboard" replace />} />
          <Route path="/employees" element={<Navigate to="/admin/employees" replace />} />
          <Route path="/employees/:employeeId/attendance" element={<LegacyEmployeeAttendanceRedirect />} />
          <Route path="/departments" element={<Navigate to="/admin/departments" replace />} />
          <Route path="/attendance" element={<Navigate to="/admin/attendance" replace />} />
          <Route path="/leave-requests" element={<Navigate to="/admin/leave-requests" replace />} />
          <Route path="/holidays" element={<Navigate to="/admin/holidays" replace />} />
          <Route path="/password-change-requests" element={<Navigate to="/admin/password-change-requests" replace />} />
          <Route path="/reports" element={<Navigate to="/admin/reports" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
