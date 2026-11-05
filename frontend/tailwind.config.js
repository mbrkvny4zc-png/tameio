/** @type {import('tailwindcss').Config} */
const c = (v) => `hsl(var(--${v}) / <alpha-value>)`;
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        bg: c("bg"), surface: c("surface"), "surface-2": c("surface-2"), line: c("line"),
        ink: c("ink"), muted: c("muted"), brand: c("brand"), "brand-soft": c("brand-soft"),
        success: c("success"), warn: c("warn"), danger: c("danger"), violet: c("violet"),
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["'Plus Jakarta Sans'", "Inter", "sans-serif"],
        serif: ["Literata", "Georgia", "'Times New Roman'", "serif"],
      },
      borderRadius: { xl: "14px", "2xl": "18px", "3xl": "24px" },
      boxShadow: {
        card: "0 1px 2px rgb(16 24 40 / 0.04), 0 1px 3px rgb(16 24 40 / 0.06)",
        lift: "0 12px 32px -12px rgb(16 24 40 / 0.18), 0 2px 6px rgb(16 24 40 / 0.06)",
        glow: "0 0 0 4px hsl(var(--brand) / 0.12)",
      },
      keyframes: { in: { from: { opacity: 0, transform: "translateY(4px)" }, to: { opacity: 1, transform: "none" } } },
      animation: { in: "in .18s ease-out" },
    },
  },
  plugins: [],
};
