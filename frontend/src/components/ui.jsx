import { forwardRef } from "react";
import * as D from "@radix-ui/react-dialog";
import { clsx } from "clsx";
import { Loader2, X } from "lucide-react";
import { translate as tr } from "@/lib/i18n";

export const cx = clsx;

const BTN = {
  primary: "bg-brand text-white hover:brightness-110 shadow-[0_1px_0_rgb(255_255_255/0.2)_inset,0_1px_2px_rgb(16_24_40/0.2)]",
  secondary: "bg-surface text-ink border border-line hover:bg-surface-2",
  ghost: "text-muted hover:text-ink hover:bg-surface-2",
  danger: "bg-danger text-white hover:brightness-110",
  soft: "bg-brand-soft text-brand hover:brightness-95",
};
const SIZE = { sm: "h-8 px-3 text-xs gap-1.5", md: "h-10 px-4 text-sm gap-2", lg: "h-12 px-6 text-[15px] gap-2", icon: "h-9 w-9" };

export const Button = forwardRef(function Button({ variant = "primary", size = "md", loading, className, children, disabled, ...p }, ref) {
  return (
    <button ref={ref} disabled={disabled || loading}
      className={cx("inline-flex items-center justify-center rounded-xl font-semibold transition-all active:scale-[.98] disabled:opacity-50 disabled:pointer-events-none select-none",
        BTN[variant], SIZE[size], className)} {...p}>
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
});

export const Input = forwardRef(function Input({ className, ...p }, ref) {
  return <input ref={ref} className={cx("input", className)} {...p} />;
});

export const Textarea = forwardRef(function Textarea({ className, ...p }, ref) {
  return <textarea ref={ref} className={cx("input h-auto py-2.5 min-h-[80px] resize-y", className)} {...p} />;
});

export function Select({ className, children, ...p }) {
  return (
    <select className={cx("input appearance-none pr-9 bg-no-repeat bg-[right_0.75rem_center] bg-[length:12px]", className)}
      style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M3 4.5l3 3 3-3' stroke='%2364748B' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E\")" }}
      {...p}>{children}</select>
  );
}

export function Field({ label, hint, error, children, className }) {
  return (
    <div className={className}>
      {label && <label className="label">{label}</label>}
      {children}
      {error ? <p className="text-[11px] text-danger mt-1">{error}</p> : hint && <p className="text-[11px] text-muted mt-1">{hint}</p>}
    </div>
  );
}

export function Card({ className, children, ...p }) {
  return <div className={cx("card", className)} {...p}>{children}</div>;
}

const TONES = {
  neutral: "bg-surface-2 text-muted", brand: "bg-brand-soft text-brand", success: "bg-success/10 text-success",
  warn: "bg-warn/10 text-warn", danger: "bg-danger/10 text-danger", violet: "bg-violet/10 text-violet",
};
export function Badge({ tone = "neutral", className, children, ...p }) {
  return <span className={cx("chip", TONES[tone], className)} {...p}>{children}</span>;
}

export function Spinner({ className }) {
  return <Loader2 className={cx("h-5 w-5 animate-spin text-muted", className)} />;
}

export function PageLoader() {
  return <div className="flex justify-center py-24"><Spinner className="h-6 w-6" /></div>;
}

export function Empty({ icon: Icon, title, text, action }) {
  return (
    <div className="card border-dashed shadow-none text-center px-6 py-14">
      {Icon && <div className="mx-auto mb-4 h-12 w-12 rounded-2xl bg-brand-soft text-brand flex items-center justify-center"><Icon className="h-6 w-6" /></div>}
      <p className="font-semibold">{title}</p>
      {text && <p className="text-sm text-muted mt-1 max-w-md mx-auto">{text}</p>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
      <div>
        <h1 className="text-2xl sm:text-[28px] font-bold leading-tight">{title}</h1>
        {subtitle && <p className="text-sm text-muted mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Stat({ label, value, sub, tone, icon: Icon }) {
  const toneCls = { success: "text-success", danger: "text-danger", warn: "text-warn", brand: "text-brand" }[tone] || "text-ink";
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted">{label}</p>
        {Icon && <Icon className="h-4 w-4 text-muted" />}
      </div>
      <p className={cx("num text-xl sm:text-2xl font-bold mt-2 tracking-tight", toneCls)}>{value}</p>
      {sub && <p className="text-[11px] text-muted mt-1">{sub}</p>}
    </Card>
  );
}

/** Centered modal. */
export function Modal({ open, onClose, title, description, children, wide, footer }) {
  return (
    <D.Root open={open} onOpenChange={(v) => !v && onClose?.()}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-[rgb(10_15_30/0.45)] backdrop-blur-[2px] animate-in" />
        <D.Content className={cx("fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100vw-24px)] max-h-[90vh] overflow-y-auto card shadow-lift p-5 sm:p-6 animate-in",
          wide ? "max-w-3xl" : "max-w-lg")}>
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <D.Title className="text-lg font-bold font-display">{title}</D.Title>
              {description ? <D.Description className="text-sm text-muted mt-1">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
            </div>
            <D.Close className="p-1.5 -m-1 rounded-lg text-muted hover:text-ink hover:bg-surface-2" aria-label={tr("Close")}><X className="h-4 w-4" /></D.Close>
          </div>
          {children}
          {footer && <div className="flex justify-end gap-2 mt-6">{footer}</div>}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

/** Right-hand panel for editors; full screen on phones. */
export function Sheet({ open, onClose, title, description, children, footer, width = "max-w-2xl" }) {
  return (
    <D.Root open={open} onOpenChange={(v) => !v && onClose?.()}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-[rgb(10_15_30/0.35)] animate-in" />
        <D.Content className={cx("fixed z-50 right-0 top-0 h-full w-full bg-surface border-l border-line shadow-lift flex flex-col animate-in", width)}>
          <div className="flex items-start justify-between gap-4 px-5 sm:px-6 py-4 border-b border-line">
            <div className="min-w-0">
              <D.Title className="text-lg font-bold font-display truncate">{title}</D.Title>
              {description ? <D.Description className="text-sm text-muted mt-0.5">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
            </div>
            <D.Close className="p-1.5 rounded-lg text-muted hover:text-ink hover:bg-surface-2" aria-label={tr("Close")}><X className="h-5 w-5" /></D.Close>
          </div>
          <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-5">{children}</div>
          {footer && <div className="px-5 sm:px-6 py-4 border-t border-line flex flex-wrap justify-end gap-2 bg-surface">{footer}</div>}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

export function Segmented({ value, onChange, options, className }) {
  return (
    <div className={cx("inline-flex p-1 rounded-xl bg-surface-2 border border-line", className)} role="tablist">
      {options.map(([k, label]) => (
        <button key={k} role="tab" aria-selected={value === k} onClick={() => onChange(k)}
          className={cx("px-3 h-8 rounded-lg text-xs font-semibold transition-colors", value === k ? "bg-surface text-ink shadow-card" : "text-muted hover:text-ink")}>
          {tr(label)}
        </button>
      ))}
    </div>
  );
}

export function Table({ head, children, className }) {
  return (
    <div className={cx("card overflow-hidden", className)}>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-surface-2/60 border-b border-line"><tr>{head.map((h, i) => <th key={i} className={cx("table-head", h?.className)}>{tr(h?.label ?? h)}</th>)}</tr></thead>
          <tbody className="divide-y divide-line">{children}</tbody>
        </table>
      </div>
    </div>
  );
}

export function IconBtn({ icon: Icon, label, className, tone, ...p }) {
  return (
    <button title={label} aria-label={label}
      className={cx("p-2 rounded-lg text-muted transition-colors", tone === "danger" ? "hover:text-danger hover:bg-danger/10" : "hover:text-ink hover:bg-surface-2", className)} {...p}>
      <Icon className="h-4 w-4" />
    </button>
  );
}
