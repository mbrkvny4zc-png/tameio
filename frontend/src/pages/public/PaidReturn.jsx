import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle2, XCircle } from "lucide-react";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { PageLoader } from "@/components/ui";
import { PublicFrame } from "@/pages/public/PublicInvoice";

/** Viva Wallet sends the client here: /i/paid?t=<transactionId>&s=<orderCode>. */
export default function PaidReturn() {
  const { t } = useT();
  const [params] = useSearchParams();
  const [r, setR] = useState(null);
  useEffect(() => {
    const tx = params.get("t"), s = params.get("s");
    if (!tx || !s) { setR({ status: "not_paid" }); return; }
    api.post("/public/payments/viva/confirm", { t: tx, s }).then(setR).catch(() => setR({ status: "error" }));
  }, [params]);
  if (!r) return <PageLoader />;
  const ok = r.status === "paid";
  return (
    <PublicFrame>
      <div className="card shadow-lift rounded-3xl p-8 text-center" data-testid="paid-return">
        {ok ? <CheckCircle2 className="h-12 w-12 text-success mx-auto" /> : <XCircle className="h-12 w-12 text-danger mx-auto" />}
        <h1 className="text-2xl font-extrabold mt-4">{ok ? t("Payment received — thank you!") : t("The payment didn't go through")}</h1>
        <p className="text-sm text-muted mt-2">{ok ? t("Your invoice is marked as paid.") : t("No money was taken. You can try again from the invoice.")}</p>
        {r.token && <Link to={`/i/${r.token}`} className="inline-flex mt-6 h-11 px-5 items-center rounded-xl border border-line font-semibold">{t("Back to the invoice")}</Link>}
      </div>
    </PublicFrame>
  );
}
