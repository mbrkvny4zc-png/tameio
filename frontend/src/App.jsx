import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { useOrg } from "@/lib/org";
import { useAuth } from "@/lib/auth";
import { PageLoader } from "@/components/ui";
import AppShell from "@/components/AppShell";
import Landing from "@/pages/Landing";
import { AcceptInvite, Login, Signup } from "@/pages/Auth";
import { translate as tr } from "@/lib/i18n";
import { saveRef } from "@/lib/referral";

/** /r/CODE — an accounting firm's referral link: remember the code, then show the landing page. */
function RefLink() {
  const { code } = useParams();
  saveRef(code);
  return <Navigate to="/" replace />;
}

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
const Practice = lazy(() => import("@/pages/app/Practice"));
const Received = lazy(() => import("@/pages/app/Received"));
const Bank = lazy(() => import("@/pages/app/Bank"));
const Calendar = lazy(() => import("@/pages/app/Calendar"));
const Requests = lazy(() => import("@/pages/app/Requests"));
const Ask = lazy(() => import("@/pages/app/Ask"));
const Products = lazy(() => import("@/pages/app/Products"));
const DeliveryNotes = lazy(() => import("@/pages/app/DeliveryNotes"));
const Partner = lazy(() => import("@/pages/app/Partner"));
const AdminPartners = lazy(() => import("@/pages/app/AdminPartners"));
const Admin = lazy(() => import("@/pages/app/Admin"));
const Feedback = lazy(() => import("@/pages/app/Feedback"));
const CustomReports = lazy(() => import("@/pages/app/CustomReports"));
const Mentions = lazy(() => import("@/pages/app/Mentions"));
const PublicDeliveryNote = lazy(() => import("@/pages/public/PublicDeliveryNote"));
const Privacy = lazy(() => import("@/pages/Privacy"));
const PaidReturn = lazy(() => import("@/pages/public/PaidReturn"));
const PublicInvoice = lazy(() => import("@/pages/public/PublicInvoice"));
const PublicQuote = lazy(() => import("@/pages/public/PublicQuote"));
const SupplierPortal = lazy(() => import("@/pages/public/SupplierPortal"));

function RequireAuth({ children }) {
  const { user } = useAuth();
  const loc = useLocation();
  if (user === undefined) return <PageLoader />; if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return children;
}

function Home() {
  const { current } = useOrg();
  if (!current) return <PageLoader />;
  return current.kind === "practice" ? <Navigate to="/app/practice" replace /> : <Dashboard />;
}

export default function App() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/invite/:token" element={<AcceptInvite />} />
        <Route path="/i/paid" element={<PaidReturn />} />
        <Route path="/i/:token" element={<PublicInvoice />} />
        <Route path="/q/:token" element={<PublicQuote />} />
        <Route path="/s/:token" element={<SupplierPortal />} />
        <Route path="/d/:token" element={<PublicDeliveryNote />} />
        <Route path="/r/:code" element={<RefLink />} />
        <Route path="/app" element={<RequireAuth><AppShell /></RequireAuth>}>
          <Route index element={<Home />} />
          <Route path="practice" element={<Practice />} />
          <Route path="received" element={<Received />} />
          <Route path="bank" element={<Bank />} />
          <Route path="calendar" element={<Calendar />} />
          <Route path="requests" element={<Requests />} />
          <Route path="ask" element={<Ask />} />
          <Route path="partner" element={<Partner />} />
          <Route path="admin/partners" element={<AdminPartners />} />
          <Route path="admin" element={<Admin />} />
          <Route path="feedback" element={<Feedback />} />
          <Route path="reports/custom" element={<CustomReports />} />
          <Route path="mentions" element={<Mentions />} />
          <Route path="products" element={<Products />} />
          <Route path="delivery-notes" element={<DeliveryNotes />} />
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
        <Route path="*" element={<div className="min-h-screen flex flex-col items-center justify-center gap-3"><p className="text-6xl font-display font-extrabold text-brand">404</p><p className="text-muted">{tr("This page doesn't exist.")}</p><a className="text-brand font-semibold" href="/">{tr("Go home")}</a></div>} />
      </Routes>
    </Suspense>
  );
}
