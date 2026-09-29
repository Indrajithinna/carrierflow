import {
  useEffect,
  useRef,
  useId,
  type ReactNode,
  type ButtonHTMLAttributes,
} from "react";
import { X, ArrowRight, Files, type LucideIcon } from "lucide-react";
import { statusLabels, type Status, type Job } from "./types";
export function Button({
  children,
  variant = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) {
  return (
    <button
      type="button"
      {...props}
      className={"button " + variant + " " + (props.className || "")}
    >
      {children}
    </button>
  );
}
export function IconButton({
  label,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      {...props}
      className="icon-button"
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Modal({
  title,
  children,
  onClose,
  sheet = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  sheet?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    id = useId();
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement;
    dialog?.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      dialog?.close();
      document.body.style.overflow = overflow;
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={id}
      className={"modal " + (sheet ? "sheet" : "")}
      onCancel={onClose}
    >
      <div className="modal-header">
        <h2 id={id}>{title}</h2>
        <IconButton label="Close dialog" onClick={onClose}>
          <X size={20} />
        </IconButton>
      </div>
      {children}
    </dialog>
  );
}
export function Heading({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {children}
    </div>
  );
}
export function Empty({
  title,
  children,
  icon: Icon = Files,
}: {
  title: string;
  children: ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon size={26} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export function Badge({ status }: { status: string }) {
  return (
    <span className={"badge " + status}>
      <span />
      {statusLabels[status as Status] || status.replaceAll("_", " ")}
    </span>
  );
}
export function Logo({ job, small = false }: { job: Job; small?: boolean }) {
  return (
    <span
      className={"company-logo " + (small ? "small" : "")}
      style={{ background: job.color || "#426455" }}
    >
      {job.company.slice(0, 1)}
    </span>
  );
}
export const date = (v: string | number | null | undefined) =>
  v && Number.isFinite(new Date(v).getTime())
    ? new Date(v).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
      })
    : "Not scheduled";
export const dateTime = (v: string) =>
  new Date(v).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
export const localInput = (value: string | null | undefined) => {
  if (!value) return "";
  const d = new Date(value);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};
export const initials = (name: string) =>
  name
    .split(" ")
    .slice(0, 2)
    .map((s) => s[0])
    .join("")
    .toUpperCase() || "Y";
export function TextList({ items }: { items: string[] }) {
  return (
    <ul className="plain-list">
      {items.map((s, i) => (
        <li key={i}>{s}</li>
      ))}
    </ul>
  );
}
export function Brand() {
  return (
    <span className="brand">
      <span className="brand-icon">
        <ArrowRight size={23} />
      </span>
      careerflow<span className="brand-period">.</span>
    </span>
  );
}
