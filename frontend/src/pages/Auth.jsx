import { useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { ShieldCheck, ScanLine, Truck } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Logo } from "@/components/Logo";
import { Button, Field, Input } from "@/components/ui";

function Frame({ title, subtitle, children, footer }) {
  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-bg">
      <div className="flex flex-col px-5 sm:px-10 py-8">
        <Link to="/"><Logo /></Link>
        <div className="flex-1 flex items-center">
          <div className="w-full max-w-sm mx-auto py-10">
            <h1 className="text-3xl font-extrabold">{title}</h1>
            <p className="text-muted mt-2 text-sm">{subtitle}</p>
            <div className="mt-8">{children}</div>
            <p className="text-sm text-muted mt-6 text-center">{footer}</p>
          </div>
        </div>
      </div>
      <div className="hidden lg:flex relative overflow-hidden bg-gradient-to-br from-[#2F6BFF] to-[#1A3FB8] text-white p-12 items-end">
        <div className="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-white/10 blur-3xl" aria-hidden />
        <div className="relative max-w-md space-y-6">
          {[[ShieldCheck, "myDATA-ready invoices", "Validated before they're sent, ΜΑΡΚ and QR on every invoice."],
            [ScanLine, "AI receipt scanning", "Photograph a receipt; the expense fills itself in."],
            [Truck, "Supplier compliance", "Clearances and contracts collected and tracked for you."]].map(([Icon, t, d]) => (
            <div key={t} className="flex gap-4">
              <div className="h-11 w-11 shrink-0 rounded-2xl bg-white/15 flex items-center justify-center"><Icon className="h-5 w-5" /></div>
              <div><p className="font-semibold">{t}</p><p className="text-sm text-white/75">{d}</p></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function Login() {
  const { user, login } = useAuth();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [f, setF] = useState({ email: "", password: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const next = params.get("next")?.startsWith("/app") ? params.get("next") : "/app";
  if (user) return <Navigate to={next} replace />;
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr("");
    try { await login(f.email, f.password); nav(next, { replace: true }); } catch (e2) { setErr(e2.message); }
    setBusy(false);
  };
  return (
    <Frame title="Welcome back" subtitle="Sign in to your books." footer={<>New here? <Link to="/signup" className="text-brand font-semibold">Create an account</Link></>}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email"><Input type="email" autoComplete="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} data-testid="login-email" /></Field>
        <Field label="Password"><Input type="password" autoComplete="current-password" required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} data-testid="login-password" /></Field>
        {err && <p className="text-sm text-danger" role="alert">{err}</p>}
        <Button className="w-full" size="lg" loading={busy} data-testid="login-submit">Sign in</Button>
      </form>
    </Frame>
  );
}

export function Signup() {
  const { user, signup } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useState({ name: "", business_name: "", email: "", password: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/app" replace />;
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr("");
    try { await signup(f); nav("/app?welcome=1", { replace: true }); } catch (e2) { setErr(e2.message); }
    setBusy(false);
  };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Frame title="Create your account" subtitle="Free to start. No card needed." footer={<>Already have an account? <Link to="/login" className="text-brand font-semibold">Sign in</Link></>}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Your name"><Input required autoComplete="name" value={f.name} onChange={set("name")} data-testid="signup-name" /></Field>
          <Field label="Business name"><Input value={f.business_name} onChange={set("business_name")} data-testid="signup-business" /></Field>
        </div>
        <Field label="Email"><Input type="email" required autoComplete="email" value={f.email} onChange={set("email")} data-testid="signup-email" /></Field>
        <Field label="Password" hint="At least 8 characters"><Input type="password" required minLength={8} autoComplete="new-password" value={f.password} onChange={set("password")} data-testid="signup-password" /></Field>
        {err && <p className="text-sm text-danger" role="alert">{err}</p>}
        <Button className="w-full" size="lg" loading={busy} data-testid="signup-submit">Create account</Button>
      </form>
    </Frame>
  );
}
