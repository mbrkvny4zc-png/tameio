import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { PageLoader } from "@/components/ui";
import AppShell from "@/components/AppShell";
import Landing from "@/pages/Landing";
import { Login, Signup } from "@/pages/Auth";

const Dashboard = lazy(() => import("@/pages/app/Dashboard"));
const Invoices = lazy(() => import("@/pages/app/Invoices"));
const Documents = lazy(() => import("@/pages/app/Documents"));
const Clients = lazy(() => import("@/pages/app/Clients"));
const Expenses = lazy(() => import("@/pages/app/Expenses"));
const Scan = lazy(() => import("@/pages/app/Scan"));
const Suppliers = lazy(() => import("@/pages/app/Suppliers"));
const Reports = lazy(() => import("@/pages/app/Reports"));
const MyData = lazy(() => import("@/pages/app/MyData"));
const Settings = lazy(() => import("@/pages/app/Settings"));
const PublicInvoice = lazy(() => import("@/pages/public/PublicInvoice"));
const PublicQuote = lazy(() => import("@/pages/public/PublicQuote"));
const SupplierPortal = lazy(() => import("@/pages/public/SupplierPortal"));

function RequireAuth({ children }) {
  const { user } = useAuth();
  const loc = useLocation();
  if (user === undefined) return <PageLoader />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return children;
}

export default function App() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/i/:token" element={<PublicInvoice />} />
        <Route path="/q/:token" element={<PublicQuote />} />
        <Route path="/s/:token" element={<SupplierPortal />} />
        <Route path="/app" element={<RequireAuth><AppShell /></RequireAuth>}>
          <Route index element={<Dashboard />} />
          <Route path="invoices" element={<Invoices />} />
          <Route path="quotes" element={<Documents key="quote" type="quote" />} />
          <Route path="sales-orders" element={<Documents key="sales_order" type="sales_order" />} />
          <Route path="purchase-orders" element={<Documents key="purchase_order" type="purchase_order" />} />
          <Route path="clients" element={<Clients />} />
          <Route path="expenses" element={<Expenses />} />
          <Route path="scan" element={<Scan />} />
          <Route path="suppliers" element={<Suppliers />} />
          <Route path="reports" element={<Reports />} />
          <Route path="mydata" element={<MyData />} />
          <Route path="settings" element={<Settings />} />
        </Route>
        <Route path="*" element={<div className="min-h-screen flex flex-col items-center justify-center gap-3"><p className="text-6xl font-display font-extrabold text-brand">404</p><p className="text-muted">This page doesn't exist.</p><a className="text-brand font-semibold" href="/">Go home</a></div>} />
      </Routes>
    </Suspense>
  );
}
