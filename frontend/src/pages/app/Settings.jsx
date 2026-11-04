import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Building2, ImagePlus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { VAT_RATES } from "@/lib/format";
import { Button, Card, Field, Input, PageHeader, PageLoader, Select, Textarea } from "@/components/ui";

function resizeLogo(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) return reject(new Error("Choose an image file"));
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

export default function Settings() {
  const { user } = useAuth();
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get("/business").then(setF).catch((e) => toast.error(e.message)); }, []);
  if (!f) return <PageLoader />;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault(); setBusy(true);
    try { setF(await api.put("/business", { ...f, default_tax_rate: parseFloat(f.default_tax_rate) })); toast.success("Business details saved"); }
    catch (e2) { toast.error(e2.message); }
    setBusy(false);
  };
  return (
    <div className="animate-in max-w-3xl">
      <PageHeader title="Settings" subtitle="These details appear on every invoice, quote and order." />
      <form onSubmit={save} className="space-y-6">
        <Card className="p-5 sm:p-6">
          <div className="flex items-center gap-2 mb-5"><Building2 className="h-4 w-4 text-brand" /><p className="font-bold">Business</p></div>
          <div className="flex items-center gap-4 mb-5">
            <div className="h-16 w-36 rounded-xl border border-dashed border-line bg-surface-2 flex items-center justify-center overflow-hidden">
              {f.logo ? <img src={f.logo} alt="Logo" className="max-h-14 max-w-32 object-contain" /> : <ImagePlus className="h-5 w-5 text-muted" />}
            </div>
            <label className="cursor-pointer text-sm font-semibold text-brand">Upload logo
              <input type="file" accept="image/*" className="hidden" onChange={async (e) => { try { setF({ ...f, logo: await resizeLogo(e.target.files[0]) }); } catch (er) { toast.error(er.message); } }} />
            </label>
            {f.logo && <button type="button" className="text-sm text-muted hover:text-danger flex items-center gap-1" onClick={() => setF({ ...f, logo: "" })}><Trash2 className="h-3.5 w-3.5" />Remove</button>}
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Business name" className="sm:col-span-2"><Input value={f.business_name} onChange={set("business_name")} data-testid="biz-name" /></Field>
            <Field label="ΑΦΜ (tax number)"><Input value={f.afm} onChange={set("afm")} placeholder="9 digits" data-testid="biz-afm" /></Field>
            <Field label="ΔΟΥ (tax office)"><Input value={f.doy} onChange={set("doy")} /></Field>
            <Field label="Email"><Input type="email" value={f.business_email} onChange={set("business_email")} /></Field>
            <Field label="Phone"><Input value={f.business_phone} onChange={set("business_phone")} /></Field>
            <Field label="Address" className="sm:col-span-2"><Input value={f.address} onChange={set("address")} /></Field>
            <Field label="City"><Input value={f.city} onChange={set("city")} /></Field>
            <Field label="Postal code"><Input value={f.postal_code} onChange={set("postal_code")} /></Field>
            <Field label="Website" className="sm:col-span-2"><Input value={f.website} onChange={set("website")} /></Field>
          </div>
        </Card>
        <Card className="p-5 sm:p-6">
          <p className="font-bold mb-5">Getting paid</p>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="IBAN" hint="Printed on invoices and the client invoice page."><Input value={f.iban} onChange={set("iban")} placeholder="GR.." /></Field>
            <Field label="Default VAT rate"><Select value={f.default_tax_rate} onChange={set("default_tax_rate")}>{VAT_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}</Select></Field>
            <Field label="Payment instructions" className="sm:col-span-2"><Textarea value={f.payment_instructions} onChange={set("payment_instructions")} placeholder="e.g. Please include the invoice number as the payment reference." /></Field>
          </div>
        </Card>
        <Card className="p-5 sm:p-6">
          <p className="font-bold mb-1">Account</p>
          <p className="text-sm text-muted">Signed in as {user?.name} · {user?.email}</p>
        </Card>
        <div className="flex justify-end"><Button size="lg" loading={busy} data-testid="biz-save">Save changes</Button></div>
      </form>
    </div>
  );
}
