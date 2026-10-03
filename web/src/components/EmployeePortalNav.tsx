import { NavLink } from "react-router-dom";

const links = [
  { to: "/employee", label: "Overview", end: true },
  { to: "/employee/attendance", label: "Attendance", end: false },
  { to: "/employee/leave", label: "Leave", end: false },
];

export default function EmployeePortalNav() {
  return (
    <nav className="employee-portal-nav" aria-label="Employee portal navigation">
      {links.map((link) => (
        <NavLink
          key={link.to}
          end={link.end}
          to={link.to}
          className={({ isActive }) => `employee-portal-nav-link${isActive ? " employee-portal-nav-active" : ""}`}
        >
          {link.label}
        </NavLink>
      ))}
    </nav>
  );
}
