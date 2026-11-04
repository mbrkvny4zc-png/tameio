import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import QRCode from "qrcode";
import { Building2, Copy, CreditCard, Download, ImagePlus, KeyRound, Mail, RefreshCw, ShieldCheck, Sparkles, Tags, Trash2, Users, X } from "lucide-react";
import { api, download } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { VAT_RATES, date } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { useOrg } from "@/lib/org";
import { Badge, Button, Card, Field, IconBtn, Input, Modal, PageHeader, PageLoader, Select, Textarea, cx } from "@/components/ui";

function resizeLogo(file) {
  return new Promise((resolve, reject) => {
    if (!file?.type.startsWith("image/")) return reject(new Error("Choose an image file"));
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 480 / img.width, 200 / img.height);
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL("image/png"));
    };
    img.onerror = () => reject(new Error("That image couldn't be read"));
    img.src = URL.createObjectURL(file);
  });
}

function BusinessTab() {
  const { t } = useT();
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get("/business").then(setF).catch((e) => toast.error(e.message)); }, []);
  if (!f) return <PageLoader />;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault(); setBusy(true);
    try { setF(await api.put("/business", { ...f, default_tax_rate: parseFloat(f.default_tax_rate) })); toast.success(t("Business details saved")); }
    catch (e2) { toast.error(e2.message); }
    setBusy(false);
  };
  return (
    <form onSubmit={save} className="space-y-6">
      <Card className="p-5 sm:p-6">
        <div className="flex items-center gap-4 mb-5">
          <div className="h-16 w-36 rounded-xl border border-dashed border-line bg-surface-2 flex items-center justify-center overflow-hidden">
            {f.logo ? <img src={f.logo} alt={t("Logo")} className="max-h-14 max-w-32 object-contain" /> : <ImagePlus className="h-5 w-5 text-muted" />}
          </div>
          <label className="cursor-pointer text-sm font-semibold text-brand">{t("Upload logo")}
            <input type="file" accept="image/*" className="hidden" onChange={async (e) => { try { setF({ ...f, logo: await resizeLogo(e.target.files[0]) }); } catch (er) { toast.error(t(er.message)); } }} />
          </label>
          {f.logo && <button type="button" className="text-sm text-muted hover:text-danger" onClick={() => setF({ ...f, logo: "" })}>{t("Remove")}</button>}
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label={t("Business name")} className="sm:col-span-2"><Input value={f.business_name} onChange={set("business_name")} data-testid="biz-name" /></Field>
          <Field label={t("ΑΦΜ (tax number)")}><Input value={f.afm} onChange={set("afm")} placeholder={t("9 digits")} data-testid="biz-afm" /></Field>
          <Field label={t("ΔΟΥ (tax office)")}><Input value={f.doy} onChange={set("doy")} /></Field>
          <Field label={t("Email")}><Input type="email" value={f.business_email} onChange={set("business_email")} /></Field>
          <Field label={t("Phone")}><Input value={f.business_phone} onChange={set("business_phone")} /></Field>
          <Field label={t("Address")} className="sm:col-span-2"><Input value={f.address} onChange={set("address")} /></Field>
          <Field label={t("City")}><Input value={f.city} onChange={set("city")} /></Field>
          <Field label={t("Postal code")}><Input value={f.postal_code} onChange={set("postal_code")} /></Field>
          <Field label={t("Website")} className="sm:col-span-2"><Input value={f.website} onChange={set("website")} /></Field>
        </div>
      </Card>
      <Card className="p-5 sm:p-6">
        <p className="font-bold mb-5">{t("Getting paid")}</p>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="IBAN" hint={t("Printed on invoices and the client invoice page.")}><Input value={f.iban} onChange={set("iban")} placeholder="GR.." data-testid="biz-iban" /></Field>
          <Field label={t("Default VAT rate")}><Select value={f.default_tax_rate} onChange={set("default_tax_rate")}>{VAT_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}</Select></Field>
          <Field label={t("Payment instructions")} className="sm:col-span-2"><Textarea value={f.payment_instructions} onChange={set("payment_instructions")} placeholder={t("e.g. Please include the invoice number as the payment reference.")} /></Field>
        </div>
      </Card>
      <div className="flex justify-end"><Button size="lg" loading={busy} data-testid="biz-save">{t("Save changes")}</Button></div>
    </form>
  );
}

function TeamTab() {
  const { t } = useT();
  const [d, setD] = useState(null);
  const [f, setF] = useState({ email: "", role: "accountant" });
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => setD(await api.get("/team/members")), []);
  useEffect(() => { load().catch(() => {}); }, [load]);
  if (!d) return <PageLoader />;
  const invite = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      const r = await api.post("/team/invites", f);
      if (r.emailed) toast.success(t("Invitation sent to {email}", { email: f.email }));
      else { await navigator.clipboard?.writeText(r.url).catch(() => {}); toast.message(t("Email isn't set up — invitation link copied"), { description: r.url }); }
      setF({ ...f, email: "" }); load();
    } catch (e2) { toast.error(e2.message); }
    setBusy(false);
  };
  const remove = async (m) => { if (window.confirm(t("Remove {name}?", { name: m.name || m.email }))) { try { await api.del(`/team/members/${m.user_id}`); load(); } catch (e) { toast.error(e.message); } } };
  const changeRole = async (m, role) => { try { await api.put(`/team/members/${m.user_id}`, { role }); load(); } catch (e) { toast.error(e.message); } };
  return (
    <div className="space-y-6">
      {d.can_manage && (
        <Card className="p-5 sm:p-6">
          <p className="font-bold">{t("Invite someone")}</p>
          <p className="text-sm text-muted mb-4">{t("Invite your accountant (always free) or people who work with you.")}</p>
          <form onSubmit={invite} className="flex flex-col sm:flex-row gap-2">
            <Input type="email" required placeholder={t("their@email.gr")} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} data-testid="invite-email" />
            <Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} className="sm:w-44" data-testid="invite-role">
              <option value="accountant">{t("Accountant")}</option><option value="staff">{t("Staff")}</option><option value="admin">{t("Admin")}</option>
              {d.members.every((m) => m.role !== "owner") && <option value="owner">{t("Owner")}</option>}
            </Select>
            <Button loading={busy} data-testid="invite-send"><Mail className="h-4 w-4" />{t("Invite")}</Button>
          </form>
          <p className="text-[11px] text-muted mt-3">{t("Staff can create invoices, quotes and expenses. Admins can also change settings and invite people. Accountants see everything and can classify, export and close months.")}</p>
        </Card>
      )}
      <Card className="divide-y divide-line">
        {d.members.map((m) => (
          <div key={m.user_id} className="flex items-center gap-3 px-5 py-3.5">
            <div className="h-9 w-9 rounded-full bg-surface-2 flex items-center justify-center font-semibold text-sm">{(m.name || m.email)[0].toUpperCase()}</div>
            <div className="flex-1 min-w-0"><p className="text-sm font-semibold truncate">{m.name}{m.you && <span className="text-muted font-normal"> · {t("you")}</span>}</p><p className="text-xs text-muted truncate">{m.email}</p></div>
            {d.your_role === "owner" && m.role !== "owner" && !m.you ? (
              <select value={m.role} onChange={(e) => changeRole(m, e.target.value)} className="input h-8 w-32 text-xs">
                {["admin", "staff", "accountant"].map((r) => <option key={r} value={r}>{t(r)}</option>)}
              </select>
            ) : <Badge tone={m.role === "accountant" ? "violet" : m.role === "owner" ? "brand" : "neutral"}>{t(m.role)}</Badge>}
            {m.role !== "owner" && (d.can_manage || m.you) && <IconBtn icon={X} label={m.you ? t("Leave") : t("Remove")} tone="danger" onClick={() => remove(m)} />}
          </div>
        ))}
        {d.invites.map((i) => (
          <div key={i.id} className="flex items-center gap-3 px-5 py-3.5 bg-surface-2/40">
            <div className="h-9 w-9 rounded-full border border-dashed border-line" />
            <div className="flex-1 min-w-0"><p className="text-sm truncate">{i.email}</p><p className="text-xs text-muted">{t("Invited {when}", { when: date(i.created_at) })}</p></div>
            <Badge>{t(i.role)} · {t("pending")}</Badge>
            <IconBtn icon={X} label={t("Cancel invitation")} tone="danger" onClick={async () => { await api.del(`/team/invites/${i.id}`); load(); }} />
          </div>
        ))}
      </Card>
    </div>
  );
}

function PlanTab() {
  const { t } = useT();
  const [p, setP] = useState(null);
  useEffect(() => { api.get("/plan").then(setP).catch(() => {}); }, []);
  if (!p) return <PageLoader />;
  const rows = [["invoices_month", t("Invoices this month")], ["scans_month", t("AI scans this month")], ["suppliers", t("Suppliers")], ["members", t("Team members")]];
  return (
    <div className="space-y-6">
      <Card className="p-5 sm:p-6">
        <div className="flex items-center justify-between"><div><p className="text-sm text-muted">{t("Your plan")}</p><p className="text-2xl font-bold">{p.limits.name}</p></div><Sparkles className="h-6 w-6 text-brand" /></div>
        <div className="mt-6 space-y-4">
          {rows.map(([k, l]) => {
            const lim = p.limits[k], used = p.usage[k];
            return (
              <div key={k}>
                <div className="flex justify-between text-sm"><span>{l}</span><span className="num text-muted">{used} / {lim < 0 ? "∞" : lim}</span></div>
                {lim > 0 && <div className="mt-1.5 h-2 rounded-full bg-surface-2 overflow-hidden"><div className={cx("h-full rounded-full", used >= lim ? "bg-danger" : "bg-brand")} style={{ width: `${Math.min(100, (used / lim) * 100)}%` }} /></div>}
              </div>
            );
          })}
        </div>
      </Card>
      <div className="grid sm:grid-cols-3 gap-3">
        {Object.entries(p.plans).filter(([k]) => k !== "free").map(([k, v]) => (
          <Card key={k} className={cx("p-4", p.plan === k && "ring-2 ring-brand")}>
            <p className="font-bold">{v.name}</p><p className="text-sm"><b className="num text-lg">€{v.price}</b> / {t("month")}</p>
            <ul className="text-xs text-muted mt-2 space-y-0.5">
              <li>{v.invoices_month < 0 ? t("Unlimited invoices") : t("{n} invoices / month", { n: v.invoices_month })}</li>
              <li>{v.scans_month < 0 ? t("Unlimited scans") : t("{n} scans / month", { n: v.scans_month })}</li>
              <li>{v.suppliers < 0 ? t("Unlimited suppliers") : t("{n} suppliers", { n: v.suppliers })}</li>
              <li>{v.members < 0 ? t("Unlimited team") : t("{n} team member(s)", { n: v.members })}</li>
            </ul>
          </Card>
        ))}
      </div>
      <p className="text-xs text-muted">{t("Online plan changes are coming soon — contact us to upgrade today. Your accountant never counts toward your team.")}</p>
    </div>
  );
}

function PaymentsTab() {
  const { t } = useT();
  const [v, setV] = useState(null);
  const [r, setR] = useState(null);
  useEffect(() => { api.get("/payments/viva").then((x) => setV({ ...x, client_secret: "" })); api.get("/payments/reminders").then(setR); }, []);
  if (!v || !r) return <PageLoader />;
  const saveViva = async () => {
    const body = { ...v }; if (!body.client_secret) delete body.client_secret;
    try { const x = await api.put("/payments/viva", body); setV({ ...x, client_secret: "" }); toast.success(t("Saved")); } catch (e) { toast.error(e.message); }
  };
  const saveR = async () => { try { setR(await api.put("/payments/reminders", r)); toast.success(t("Saved")); } catch (e) { toast.error(e.message); } };
  return (
    <div className="space-y-6">
      <Card className="p-5 sm:p-6 space-y-4">
        <div className="flex items-center gap-2"><CreditCard className="h-4 w-4 text-brand" /><p className="font-bold">{t("Card payments with Viva Wallet")}</p>{v.enabled && <Badge tone="success" className="ml-auto">{t("On")}</Badge>}</div>
        <p className="text-sm text-muted">{t("Clients get a “Pay by card” button on the invoice page. Money goes straight to your Viva account; the invoice marks itself paid.")}</p>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label={t("Environment")}><Select value={v.environment} onChange={(e) => setV({ ...v, environment: e.target.value })}><option value="demo">{t("Demo (testing)")}</option><option value="live">{t("Live")}</option></Select></Field>
          <Field label={t("Payment source code")}><Input value={v.source_code} onChange={(e) => setV({ ...v, source_code: e.target.value })} /></Field>
          <Field label={t("Client ID")}><Input value={v.client_id} onChange={(e) => setV({ ...v, client_id: e.target.value })} autoComplete="off" /></Field>
          <Field label={t("Client secret")} hint={v.has_secret ? t("Saved. Leave blank to keep it.") : t("Stored encrypted.")}><Input type="password" value={v.client_secret} onChange={(e) => setV({ ...v, client_secret: e.target.value })} autoComplete="new-password" /></Field>
        </div>
        <p className="text-[11px] text-muted">{t("In Viva: Settings → API access for the client ID/secret; Sales → Online payments → Websites/apps for a payment source with success URL")} <span className="font-mono">{v.return_url}</span></p>
        <div className="flex items-center justify-between"><label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" className="h-4 w-4 accent-[hsl(var(--brand))]" checked={v.enabled} onChange={(e) => setV({ ...v, enabled: e.target.checked })} />{t("Show “Pay by card” on invoices")}</label><Button onClick={saveViva}>{t("Save")}</Button></div>
      </Card>
      <Card className="p-5 sm:p-6 space-y-4">
        <p className="font-bold">{t("Automatic payment reminders")}</p>
        <p className="text-sm text-muted">{t("Polite emails to clients with overdue invoices, with a link to view and pay.")}</p>
        <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" className="h-4 w-4 accent-[hsl(var(--brand))]" checked={r.enabled} onChange={(e) => setR({ ...r, enabled: e.target.checked })} data-testid="reminders-on" />{t("Send reminders automatically")}</label>
        <Field label={t("Days after the due date")} hint={t("Comma separated, e.g. 3, 10, 21")}><Input value={r.days.join(", ")} onChange={(e) => setR({ ...r, days: e.target.value.split(/[,\s]+/).map((x) => parseInt(x, 10)).filter((x) => !Number.isNaN(x)) })} /></Field>
        <Field label={t("Extra message (optional)")}><Textarea value={r.message} onChange={(e) => setR({ ...r, message: e.target.value })} /></Field>
        <div className="flex justify-end"><Button onClick={saveR}>{t("Save")}</Button></div>
      </Card>
    </div>
  );
}

function InboxTab() {
  const { t } = useT();
  const [d, setD] = useState(null);
  const [extra, setExtra] = useState("");
  const load = useCallback(async () => { const x = await api.get("/inbox/address"); setD(x); setExtra(x.allowed.join(", ")); }, []);
  useEffect(() => { load().catch(() => {}); }, [load]);
  if (!d) return <PageLoader />;
  const save = async () => { try { await api.put("/inbox/senders", { allowed: extra.split(/[,\s]+/).filter(Boolean) }); toast.success(t("Saved")); load(); } catch (e) { toast.error(e.message); } };
  return (
    <Card className="p-5 sm:p-6 space-y-4">
      <div className="flex items-center gap-2"><Mail className="h-4 w-4 text-brand" /><p className="font-bold">{t("Receipts by email")}</p></div>
      <p className="text-sm text-muted">{t("Forward e-receipts and supplier invoices to your own address. Attachments are read by AI and wait in Scan for a quick check.")}</p>
      {d.configured ? (
        <div className="flex items-center gap-2 rounded-xl bg-brand-soft px-4 py-3">
          <span className="font-mono text-sm text-brand truncate flex-1" data-testid="inbox-address">{d.address}</span>
          <IconBtn icon={Copy} label={t("Copy")} onClick={() => navigator.clipboard?.writeText(d.address).then(() => toast.success(t("Copied")))} />
          <IconBtn icon={RefreshCw} label={t("New address")} onClick={async () => { if (window.confirm(t("Create a new address? The old one stops working."))) { await api.post("/inbox/rotate"); load(); } }} />
        </div>
      ) : <p className="text-sm rounded-xl bg-warn/10 text-warn px-4 py-3">{t("Email receiving isn't set up on this server yet (INBOUND_DOMAIN and INBOUND_SECRET).")}</p>}
      <div>
        <p className="label">{t("Accepted from")}</p>
        <p className="text-sm">{d.members.join(", ")}</p>
        <Field label={t("Also accept from (emails or @domains)")} hint={t("e.g. e-receipts@shell.gr, @cosmote.gr")} className="mt-3"><Input value={extra} onChange={(e) => setExtra(e.target.value)} /></Field>
      </div>
      <div className="flex justify-end"><Button onClick={save}>{t("Save")}</Button></div>
    </Card>
  );
}

function CodesTab() {
  const { t } = useT();
  const [d, setD] = useState(null);
  useEffect(() => { api.get("/received/classification-map").then(setD).catch(() => {}); }, []);
  if (!d) return <PageLoader />;
  const save = async () => { try { setD({ ...d, ...(await api.put("/received/classification-map", { items: d.items })) }); toast.success(t("Saved")); } catch (e) { toast.error(e.message); } };
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-center gap-2"><Tags className="h-4 w-4 text-brand" /><p className="font-bold">{t("myDATA classification codes")}</p></div>
      <p className="text-sm text-muted mt-1 mb-5">{t("How each expense category is classified when purchase invoices are sent to AADE. Your accountant should confirm the E3 codes for your books.")}</p>
      <div className="space-y-2">
        {Object.entries(d.items).map(([k, v]) => (
          <div key={k} className="grid sm:grid-cols-[180px_1fr_150px] gap-2 items-center">
            <span className="text-sm font-medium">{t(d.labels[k])}</span>
            <select className="input h-9 text-xs" value={v.category} onChange={(e) => setD({ ...d, items: { ...d.items, [k]: { ...v, category: e.target.value } } })}>
              {Object.entries(d.mydata_categories).map(([c, l]) => <option key={c} value={c}>{c} · {l}</option>)}
            </select>
            <Input className="h-9 text-xs font-mono" placeholder="E3_…" value={v.e3_type} onChange={(e) => setD({ ...d, items: { ...d.items, [k]: { ...v, e3_type: e.target.value } } })} />
          </div>
        ))}
      </div>
      <div className="flex justify-end mt-5"><Button onClick={save}>{t("Save")}</Button></div>
    </Card>
  );
}

function SecurityTab() {
  const { t } = useT();
  const { user, refresh } = useAuth();
  const { current } = useOrg();
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState("");
  const [disable, setDisable] = useState(null);
  const [del, setDel] = useState(null);
  const start = async () => {
    const s = await api.post("/auth/2fa/setup");
    setSetup({ ...s, qr: await QRCode.toDataURL(s.otpauth_uri, { margin: 1, width: 360 }) });
  };
  const enable = async () => { try { await api.post("/auth/2fa/enable", { code }); toast.success(t("Two-step sign-in is on")); setSetup(null); setCode(""); refresh(); } catch (e) { toast.error(e.message); } };
  const turnOff = async () => { try { await api.post("/auth/2fa/disable", disable); toast.success(t("Two-step sign-in is off")); setDisable(null); refresh(); } catch (e) { toast.error(e.message); } };
  const deleteBiz = async () => { try { await api.post("/account/delete-business", del); toast.success(t("Business deleted")); window.location.assign("/app"); } catch (e) { toast.error(e.message); } };
  const owner = current?.role === "owner";
  return (
    <div className="space-y-6">
      <Card className="p-5 sm:p-6">
        <div className="flex items-center gap-2"><KeyRound className="h-4 w-4 text-brand" /><p className="font-bold">{t("Two-step sign-in")}</p>{user?.two_factor && <Badge tone="success" className="ml-auto">{t("On")}</Badge>}</div>
        <p className="text-sm text-muted mt-1 mb-4">{t("Ask for a code from an authenticator app (Google Authenticator, Authy, 1Password) when you sign in.")}</p>
        {user?.two_factor
          ? <Button variant="secondary" onClick={() => setDisable({ code: "", password: "" })}>{t("Turn off")}</Button>
          : <Button onClick={start} data-testid="2fa-start"><ShieldCheck className="h-4 w-4" />{t("Set up")}</Button>}
      </Card>
      <Card className="p-5 sm:p-6">
        <p className="font-bold">{t("Your data")}</p>
        <p className="text-sm text-muted mt-1 mb-4">{t("Download everything in this business — invoices, expenses, documents and uploaded files — at any time.")}</p>
        <Button variant="secondary" onClick={() => download("/account/export.zip", "tameio-export.zip").catch((e) => toast.error(e.message))}><Download className="h-4 w-4" />{t("Download all data")}</Button>
      </Card>
      {owner && (
        <Card className="p-5 sm:p-6 border-danger/30">
          <p className="font-bold text-danger">{t("Delete this business")}</p>
          <p className="text-sm text-muted mt-1 mb-4">{t("Permanently deletes all its invoices, expenses, suppliers and files. This can't be undone.")}</p>
          <Button variant="danger" onClick={() => setDel({ confirm: "", password: "" })}><Trash2 className="h-4 w-4" />{t("Delete business")}</Button>
        </Card>
      )}
      <Modal open={!!setup} onClose={() => setSetup(null)} title={t("Set up two-step sign-in")} description={t("Scan the QR code with your authenticator app, then enter the 6-digit code it shows.")}>
        {setup && (
          <div className="space-y-4 text-center">
            <img src={setup.qr} alt="QR" className="mx-auto h-44 w-44 rounded-xl border border-line" />
            <p className="text-[11px] text-muted">{t("Can't scan? Enter this key:")} <span className="font-mono break-all">{setup.secret}</span></p>
            <Input inputMode="numeric" maxLength={6} className="text-center text-xl tracking-[0.4em] h-12" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} data-testid="2fa-code" />
            <Button className="w-full" onClick={enable} disabled={code.length !== 6} data-testid="2fa-enable">{t("Turn on")}</Button>
          </div>
        )}
      </Modal>
      <Modal open={!!disable} onClose={() => setDisable(null)} title={t("Turn off two-step sign-in")} footer={<Button variant="danger" onClick={turnOff}>{t("Turn off")}</Button>}>
        {disable && <div className="space-y-3">
          <Field label={t("Password")}><Input type="password" value={disable.password} onChange={(e) => setDisable({ ...disable, password: e.target.value })} /></Field>
          <Field label={t("Code from your app")}><Input inputMode="numeric" maxLength={6} value={disable.code} onChange={(e) => setDisable({ ...disable, code: e.target.value })} /></Field>
        </div>}
      </Modal>
      <Modal open={!!del} onClose={() => setDel(null)} title={t("Delete {name}?", { name: current?.name })} footer={<Button variant="danger" onClick={deleteBiz} disabled={del?.confirm !== current?.name}>{t("Delete forever")}</Button>}>
        {del && <div className="space-y-3">
          <p className="text-sm text-muted">{t("Download your data first if you might need it. Type the business name to confirm.")}</p>
          <Field label={t("Business name")}><Input value={del.confirm} onChange={(e) => setDel({ ...del, confirm: e.target.value })} placeholder={current?.name} /></Field>
          <Field label={t("Password")}><Input type="password" value={del.password} onChange={(e) => setDel({ ...del, password: e.target.value })} /></Field>
        </div>}
      </Modal>
    </div>
  );
}

export default function Settings() {
  const { t } = useT();
  const { current } = useOrg();
  const [params, setParams] = useSearchParams();
  const practice = current?.kind === "practice";
  const tabs = practice
    ? [["business", t("Firm"), Building2], ["security", t("Security & data"), ShieldCheck]]
    : [["business", t("Business"), Building2], ["team", t("Team"), Users], ["plan", t("Plan"), Sparkles], ["payments", t("Payments"), CreditCard],
      ["inbox", t("Email inbox"), Mail], ["codes", t("Classification codes"), Tags], ["security", t("Security & data"), ShieldCheck]];
  const tab = tabs.find(([k]) => k === params.get("tab"))?.[0] || "business";
  return (
    <div className="animate-in max-w-4xl">
      <PageHeader title={t("Settings")} subtitle={practice ? t("Your firm and account.") : t("Business details, team, payments and security.")} />
      <div className="flex gap-1 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 mb-6 border-b border-line">
        {tabs.map(([k, l, Icon]) => (
          <button key={k} onClick={() => setParams({ tab: k })} data-testid={`tab-${k}`}
            className={cx("flex items-center gap-2 px-3 h-10 text-sm font-semibold border-b-2 -mb-px whitespace-nowrap", tab === k ? "border-brand text-brand" : "border-transparent text-muted hover:text-ink")}>
            <Icon className="h-4 w-4" />{l}
          </button>
        ))}
      </div>
      {tab === "business" && <BusinessTab />}
      {tab === "team" && <TeamTab />}
      {tab === "plan" && <PlanTab />}
      {tab === "payments" && <PaymentsTab />}
      {tab === "inbox" && <InboxTab />}
      {tab === "codes" && <CodesTab />}
      {tab === "security" && <SecurityTab />}
    </div>
  );
}
