import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  BarChart3,
  Building2,
  CalendarDays,
  ChevronDown,
  ClipboardCheck,
  LayoutDashboard,
  LogOut,
  Menu,
  Users,
  X,
} from "lucide-react";
import { useAuth } from "../auth/AuthProvider";
import { getAdminProfile } from "../lib/data";
import type { AdminProfile } from "../types/database";
import { Initials, PageLoader } from "./ui";

const navigation = [
  { to: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { to: "/employees", label: "Employees", icon: Users },
  { to: "/departments", label: "Departments", icon: Building2 },
  { to: "/attendance", label: "Attendance", icon: ClipboardCheck },
  { to: "/reports", label: "Reports", icon: BarChart3 },
];

const pageTitles: Record<string, { title: string; eyebrow: string }> = {
  "/dashboard": { title: "Overview", eyebrow: "Workspace" },
  "/employees": { title: "Employees", eyebrow: "People directory" },
  "/departments": { title: "Departments", eyebrow: "Organization" },
  "/attendance": { title: "Attendance", eyebrow: "Daily records" },
  "/reports": { title: "Reports", eyebrow: "Insights" },
};

export default function AppShell() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [profile, setProfile] = useState<AdminProfile | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const page = pageTitles[location.pathname] ?? pageTitles["/dashboard"];

  useEffect(() => {
    if (!user) return;
    void getAdminProfile(user.id)
      .then(setProfile)
      .catch(() => setProfile(null));
  }, [user]);

  useEffect(() => {
    // Navigation state is intentionally reset when the route changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSidebarOpen(false);
    setProfileOpen(false);
  }, [location.pathname]);

  const displayName = profile?.full_name || user?.email || "Admin";
  const displayEmail = user?.email ?? "Authenticated administrator";

  const handleLogout = async () => {
    await signOut();
    navigate("/login", { replace: true });
  };

  if (!user) return <PageLoader label="Loading workspace…" />;

  return (
    <div className="app-shell">
      {sidebarOpen && <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}
      <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <div className="brand-lockup">
          <div className="brand-mark">F</div>
          <div>
            <div className="brand-name">FaceAttend <span>AI</span></div>
            <div className="brand-caption">Admin workspace</div>
          </div>
          <button className="icon-button sidebar-close" onClick={() => setSidebarOpen(false)} aria-label="Close navigation">
            <X size={19} />
          </button>
        </div>

        <div className="sidebar-section-label">Manage</div>
        <nav className="sidebar-nav" aria-label="Primary navigation">
          {navigation.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} className={({ isActive }) => `nav-link ${isActive ? "nav-link-active" : ""}`}>
              <Icon size={18} strokeWidth={1.8} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="security-note">
            <div className="security-dot" />
            <div><strong>Secure workspace</strong><span>Protected by Supabase Auth</span></div>
          </div>
          <button className="sidebar-logout" onClick={() => void handleLogout()}>
            <LogOut size={17} />
            Sign out
          </button>
        </div>
      </aside>

      <main className="main-shell">
        <header className="topbar">
          <button className="icon-button menu-button" onClick={() => setSidebarOpen(true)} aria-label="Open navigation">
            <Menu size={21} />
          </button>
          <div className="breadcrumb"><span>FaceAttend AI</span><span className="breadcrumb-separator">/</span><strong>{page.title}</strong></div>
          <div className="topbar-actions">
            <div className="admin-menu-wrap">
              <button className="admin-menu-trigger" onClick={() => setProfileOpen((open) => !open)} aria-expanded={profileOpen}>
                <Initials name={displayName} />
                <span className="admin-menu-copy"><strong>{displayName}</strong><small>Administrator</small></span>
                <ChevronDown size={16} />
              </button>
              {profileOpen && (
                <div className="admin-menu">
                  <div className="admin-menu-details"><strong>{displayName}</strong><span>{displayEmail}</span></div>
                  <button onClick={() => void handleLogout()}><LogOut size={16} /> Sign out</button>
                </div>
              )}
            </div>
          </div>
        </header>

        <div className="content-shell">
          <div className="page-intro">
            <div><div className="eyebrow">{page.eyebrow}</div><h1>{page.title}</h1></div>
            <div className="page-date"><CalendarDays size={16} /> {new Intl.DateTimeFormat(undefined, { dateStyle: "long" }).format(new Date())}</div>
          </div>
          <Outlet />
        </div>
      </main>
    </div>
  );
}
