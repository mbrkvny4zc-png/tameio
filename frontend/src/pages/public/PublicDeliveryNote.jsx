import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { MapPin, ShieldCheck, Truck } from "lucide-react";
import { api } from "@/lib/api";
import { date } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { Badge, PageLoader } from "@/components/ui";
import { PublicFrame } from "@/pages/public/PublicInvoice";

/** What the driver, the recipient or a roadside inspector sees after scanning the note's QR. */
export default function PublicDeliveryNote() {
  const { t } = useT();
  const { token } = useParams();
  const [data, setData] = useState(undefined);
  useEffect(() => { api.get(`/public/delivery-notes/${token}`).then(setData).catch(() => setData(null)); }, [token]);
  if (data === undefined) return <PageLoader />;
  if (!data) return <PublicFrame><div className="card p-10 text-center text-muted">{t("This delivery note isn't available.")}</div></PublicFrame>;
  const { note: n, business: b, mydata: md } = data;
  const addr = (a) => `${[a.street, a.number].filter(Boolean).join(" ")}, ${[a.postal_code, a.city].filter(Boolean).join(" ")}`;
  const tone = { issued: "brand", delivered: "success", cancelled: "danger" }[n.status] || "neutral";
  return (
    <PublicFrame biz={b}>
      <div className="card p-6 sm:p-8" data-testid="public-dn">
        <div className="flex items-start justify-between gap-4">
          <div><p className="text-xs uppercase tracking-[0.14em] text-muted">{t("Delivery note")}</p><h1 className="text-2xl font-bold mt-1">{n.number}</h1>
            <p className="text-sm text-muted mt-1">{b.business_name}{b.afm ? ` · ΑΦΜ ${b.afm}` : ""}</p></div>
          <Badge tone={tone}>{t({ issued: "In transit", delivered: "Delivered", cancelled: "Cancelled" }[n.status] || n.status)}</Badge>
        </div>
        <div className="mt-6 grid sm:grid-cols-2 gap-3">
          {[["Loading from", n.loading_address, null], ["Delivering to", n.delivery_address, n.recipient_name]].map(([l, a, who]) => (
            <div key={l} className="rounded-xl bg-surface-2 p-4 text-sm"><p className="text-xs text-muted flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{t(l)}</p>
              {who && <p className="font-semibold mt-1">{who}</p>}<p className="mt-0.5">{addr(a)}</p></div>
          ))}
        </div>
        <p className="mt-4 text-sm flex items-center gap-2 text-muted"><Truck className="h-4 w-4" />{date(n.dispatch_date)} {n.dispatch_time}{n.vehicle_number ? ` · ${n.vehicle_number}` : ""} · {t(data.purpose_label)}</p>
        <div className="mt-5 divide-y divide-line border-y border-line">
          {n.items.map((i, k) => <div key={k} className="flex justify-between py-3 text-sm"><span>{i.description}</span><span className="num font-semibold">{i.qty} {t(data.units[i.unit] || "")}</span></div>)}
        </div>
        {md?.mark && (
          <div className="mt-5 rounded-xl border border-line p-4 text-sm flex items-start gap-3">
            <ShieldCheck className="h-5 w-5 text-success shrink-0" />
            <div><p className="font-semibold">{t("Reported to AADE myDATA")}</p><p className="font-mono text-xs mt-1">ΜΑΡΚ {md.mark}</p>
              {md.simulated && <p className="text-xs text-warn mt-1">{t("Simulation — not a real AADE record")}</p>}</div>
          </div>
        )}
      </div>
    </PublicFrame>
  );
}
