/* Shared presentational primitives and pure formatting helpers live together. */
/* eslint-disable react-refresh/only-export-components */
import type { ReactNode } from "react";
import { AlertCircle, LoaderCircle } from "lucide-react";

export function PageLoader({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="page-loader" role="status">
      <LoaderCircle className="spin" size={22} />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="state-card error-state">
      <AlertCircle size={22} />
      <div>
        <strong>Couldn’t load this data</strong>
        <p>{message}</p>
        {onRetry && (
          <button className="button button-secondary button-small" onClick={onRetry} type="button">
            Try again
          </button>
        )}
      </div>
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="state-card empty-state">
      <div className="empty-state-mark">—</div>
      <strong>{title}</strong>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function StatusBadge({ tone, children }: { tone: "success" | "warning" | "muted" | "danger" | "info"; children: ReactNode }) {
  return <span className={`status-badge status-${tone}`}>{children}</span>;
}

export function Initials({ name }: { name: string }) {
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  return <span className="avatar">{initials || "A"}</span>;
}

export function formatDate(value: string | null) {
  if (!value) return "—";
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(year, month - 1, day));
}

export function formatDateTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function formatTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(new Date(value));
}

export function formatMinutes(value: number | null) {
  if (value === null || value === undefined) return "—";
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
}
