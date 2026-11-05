// Fonts are served from our own site (no requests to Google — nothing about visitors leaves the EU for typography).
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/plus-jakarta-sans/600.css";
import "@fontsource/plus-jakarta-sans/700.css";
import "@fontsource/plus-jakarta-sans/800.css";
import "@fontsource-variable/literata/opsz.css";
import "@fontsource-variable/literata/opsz-italic.css";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "sonner";
import App from "@/App";
import CookieBanner from "@/components/CookieBanner";
import { AuthProvider } from "@/lib/auth";
import { LanguageProvider } from "@/lib/i18n";
import { OrgProvider } from "@/lib/org";
import "@/index.css";
import { installCrashReporter } from "@/lib/crash";

installCrashReporter();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <LanguageProvider>
      <AuthProvider>
      <OrgProvider>
        <App />
        <CookieBanner />
        <Toaster position="top-center" richColors closeButton toastOptions={{ style: { borderRadius: 14, fontFamily: "Inter, sans-serif" } }} />
      </OrgProvider>
      </AuthProvider>
      </LanguageProvider>
    </BrowserRouter>
  </React.StrictMode>,
);

// Installable app (PWA). Only in production builds so development always loads fresh code.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
// Keep the browser's install offer so we can show our own "Install app" button.
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); window.__tameioInstall = e; window.dispatchEvent(new Event("tameio:installable")); });
