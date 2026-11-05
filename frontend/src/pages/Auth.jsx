import { useEffect, useState } from "react";
import { getRef, clearRef } from "@/lib/referral";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Briefcase, Calculator, ScanLine, ShieldCheck, Truck, UserPlus } from "lucide-react";
import { api, setOrg } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { LangToggle, useT } from "@/lib/i18n";
import { Logo } from "@/components/Logo";
import { Button, Field, Input, PageLoader } from "@/components/ui";

function Frame({ title, subtitle, children, footer }) {
  const { t } = useT();
  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-bg">
      <div className="flex flex-col px-5 sm:px-10 py-8">
        <div className="flex items-center justify-between"><Link to="/"><Logo /></Link><LangToggle /></div>
        <div className="flex-1 flex items-center">
          <div className="w-full max-w-sm mx-auto py-10">
            <h1 className="text-3xl font-extrabold">{title}</h1>
            <p className="text-muted mt-2 text-sm">{subtitle}</p>
            <div className="mt-8">{children}</div>
            {footer && <p className="text-sm text-muted mt-6 text-center">{footer}</p>}
          </div>
        </div>
      </div>
      <div className="hidden lg:flex relative overflow-hidden bg-gradient-to-br from-[#2F6BFF] to-[#1A3FB8] text-white p-12 items-end">
        <div className="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-white/10 blur-3xl" aria-hidden />
        <div className="relative max-w-md space-y-6">
          {[[ShieldCheck, t("myDATA-ready invoices"), t("Validated before they're sent, ΜΑΡΚ and QR on every invoice.")],
            [ScanLine, t("AI receipt scanning"), t("Photograph a receipt; the expense fills itself in.")],
            [Truck, t("Supplier compliance"), t("Clearances and contracts collected and tracked for you.")],
            [Calculator, t("Built for accountants too"), t("All your clients on one screen, with a monthly checklist.")]].map(([Icon, a, b]) => (
            <div key={a} className="flex gap-4">
              <div className="h-11 w-11 shrink-0 rounded-2xl bg-white/15 flex items-center justify-center"><Icon className="h-5 w-5" /></div>
              <div><p className="font-semibold">{a}</p><p className="text-sm text-white/75">{b}</p></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const safeNext = (n) => (n && n.startsWith("/") && !n.startsWith("//") ? n : "/app");

export function Login() {
  const { user, login } = useAuth();
  const { t } = useT();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [f, setF] = useState({ email: "", password: "", code: "" });
  const [needCode, setNeedCode] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const next = safeNext(params.get("next"));
  if (user) return <Navigate to={next} replace />;
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr("");
    try { await login(f.email, f.password, needCode ? f.code : undefined); nav(next, { replace: true }); }
    catch (e2) { if (e2.data?.two_factor_required) setNeedCode(true); setErr(needCode || !e2.data?.two_factor_required ? e2.message : ""); }
    setBusy(false);
  };
  return (
    <Frame title={needCode ? t("Two-step sign-in") : t("Welcome back")} subtitle={needCode ? t("Enter the 6-digit code from your authenticator app.") : t("Sign in to your books.")}
      footer={!needCode && <>{t("New here?")} <Link to={`/signup${params.get("next") ? `?next=${encodeURIComponent(params.get("next"))}` : ""}`} className="text-brand font-semibold">{t("Create an account")}</Link></>}>
      <form onSubmit={submit} className="space-y-4">
        {!needCode ? <>
          <Field label={t("Email")}><Input type="email" autoComplete="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} data-testid="login-email" /></Field>
          <Field label={t("Password")}><Input type="password" autoComplete="current-password" required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} data-testid="login-password" /></Field>
        </> : (
          <Field label={t("Authentication code")}><Input autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="text-center text-2xl tracking-[0.5em] h-14 num"
            value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.replace(/\D/g, "") })} data-testid="login-code" /></Field>
        )}
        {err && <p className="text-sm text-danger" role="alert">{err}</p>}
        <Button className="w-full" size="lg" loading={busy} data-testid="login-submit">{needCode ? t("Verify") : t("Sign in")}</Button>
        {needCode && <button type="button" className="w-full text-sm text-muted" onClick={() => { setNeedCode(false); setF({ ...f, code: "" }); setErr(""); }}>{t("Back")}</button>}
      </form>
    </Frame>
  );
}

export function Signup() {
  const { user, signup } = useAuth();
  const { t } = useT();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [f, setF] = useState({ name: "", business_name: "", email: params.get("email") || "", password: "", account_type: params.get("type") === "accountant" ? "accountant" : "business", accept_terms: false });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [ref] = useState(() => getRef());
  const [firm, setFirm] = useState("");
  useEffect(() => { if (ref) api.get(`/public/ref/${ref}`).then((r) => setFirm(r.firm)).catch(() => {}); }, [ref]);
  const next = safeNext(params.get("next"));
  if (user) return <Navigate to={next} replace />;
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr("");
    try { await signup({ ...f, ref: f.account_type === "business" ? ref : "" }); clearRef(); setOrg(""); nav(next === "/app" ? (f.account_type === "accountant" ? "/app/practice" : "/app?welcome=1") : next, { replace: true }); }
    catch (e2) { setErr(e2.message); }
    setBusy(false);
  };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const isAcct = f.account_type === "accountant";
  return (
    <Frame title={t("Create your account")} subtitle={firm && !isAcct ? t("Recommended by {firm}", { firm }) : t("Free to start. No card needed.")} footer={<>{t("Already have an account?")} <Link to={`/login${params.get("next") ? `?next=${encodeURIComponent(params.get("next"))}` : ""}`} className="text-brand font-semibold">{t("Sign in")}</Link></>}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-2" role="radiogroup">
          {[["business", Briefcase, t("I run a business")], ["accountant", Calculator, t("I'm an accountant")]].map(([k, Icon, l]) => (
            <button type="button" key={k} role="radio" aria-checked={f.account_type === k} onClick={() => setF({ ...f, account_type: k })} data-testid={`type-${k}`}
              className={`rounded-xl border p-3 text-left text-sm font-semibold transition ${f.account_type === k ? "border-brand bg-brand-soft text-brand" : "border-line hover:bg-surface-2"}`}>
              <Icon className="h-4 w-4 mb-1.5" />{l}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("Your name")}><Input required autoComplete="name" value={f.name} onChange={set("name")} data-testid="signup-name" /></Field>
          <Field label={isAcct ? t("Firm name") : t("Business name")}><Input value={f.business_name} onChange={set("business_name")} data-testid="signup-business" /></Field>
        </div>
        <Field label={t("Email")}><Input type="email" required autoComplete="email" value={f.email} onChange={set("email")} data-testid="signup-email" /></Field>
        <Field label={t("Password")} hint={t("At least 8 characters")}><Input type="password" required minLength={8} autoComplete="new-password" value={f.password} onChange={set("password")} data-testid="signup-password" /></Field>
        {isAcct && <p className="text-xs text-muted rounded-xl bg-surface-2 px-3 py-2">{t("Accountant accounts are free. Your clients invite you, or you add their businesses yourself.")}</p>}
        <label className="flex items-start gap-2.5 text-[13px] leading-snug cursor-pointer" data-testid="signup-terms">
          <input type="checkbox" required checked={f.accept_terms} onChange={(e) => setF({ ...f, accept_terms: e.target.checked })} className="mt-0.5 h-4 w-4 shrink-0 accent-[hsl(var(--brand))]" data-testid="signup-accept" />
          <span>{t("I accept the")} <a href="/legal/terms" target="_blank" rel="noopener" className="underline">{t("Terms of Service")}</a>, {t("the")} <a href="/legal/dpa" target="_blank" rel="noopener" className="underline">{t("Data Processing Agreement")}</a> {t("and have read the")} <a href="/legal/privacy" target="_blank" rel="noopener" className="underline">{t("Privacy Policy")}</a>{t(", on behalf of my business.")}</span>
        </label>
        {err && <p className="text-sm text-danger" role="alert">{err}</p>}
        <Button className="w-full" size="lg" loading={busy} disabled={!f.accept_terms} data-testid="signup-submit">{t("Create account")}</Button>
      </form>
    </Frame>
  );
}

export function AcceptInvite() {
  const { token } = useParams();
  const { user } = useAuth();
  const { t } = useT();
  const nav = useNavigate();
  const [info, setInfo] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get(`/public/invites/${token}`).then(setInfo).catch((e) => setErr(e.message)); }, [token]);
  const accept = async () => {
    setBusy(true); setErr("");
    try { const r = await api.post(`/invites/${token}/accept`); setOrg(r.org_id); nav(r.role === "accountant" ? "/app/practice" : "/app", { replace: true }); window.location.reload(); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  };
  if (!info && !err) return <PageLoader />;
  const back = encodeURIComponent(`/invite/${token}`);
  return (
    <Frame title={info ? t("Join {name}", { name: info.business }) : t("Invitation")} subtitle={info ? t("{who} invited you as {role}.", { who: info.invited_by || t("Someone"), role: t(info.role) }) : ""}>
      <div className="card p-5 text-center" data-testid="invite-card">
        <UserPlus className="h-8 w-8 text-brand mx-auto" />
        {err && <p className="text-sm text-danger mt-3" role="alert">{err}</p>}
        {info && (user ? (
          <>
            <p className="text-sm text-muted mt-3">{t("Signed in as {email}", { email: user.email })}</p>
            <Button className="w-full mt-5" size="lg" onClick={accept} loading={busy} data-testid="invite-accept">{t("Accept invitation")}</Button>
          </>
        ) : (
          <div className="mt-5 space-y-2">
            <Link to={`/signup?next=${back}&email=${encodeURIComponent(info.email)}${info.role === "accountant" ? "&type=accountant" : ""}`} className="flex h-12 items-center justify-center rounded-xl bg-brand text-white font-semibold">{t("Create an account")}</Link>
            <Link to={`/login?next=${back}`} className="flex h-12 items-center justify-center rounded-xl border border-line font-semibold">{t("I already have an account")}</Link>
          </div>
        ))}
      </div>
    </Frame>
  );
}
