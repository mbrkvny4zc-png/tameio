import { useId } from "react";

export const APP_NAME = "Tameio";

export function LogoMark({ className = "h-8 w-8" }) {
  // Unique per instance: a duplicate id inside a hidden element would make the gradient disappear.
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={`lg${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2F6BFF" /><stop offset="1" stopColor="#1A3FB8" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill={`url(#lg${id})`} />
      <path d="M9 10h14M16 10v13" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" />
      <circle cx="23" cy="22" r="2.6" fill="#5EEAD4" />
    </svg>
  );
}

export function Logo({ className = "", light }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <LogoMark />
      <span className={`font-display font-extrabold text-[19px] tracking-tight ${light ? "text-white" : "text-ink"}`}>{APP_NAME}</span>
    </span>
  );
}
