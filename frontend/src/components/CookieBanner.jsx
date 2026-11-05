import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Cookie } from "lucide-react";
import { useT } from "@/lib/i18n";
import { getConsent, setConsent } from "@/lib/consent";
import { applyRefConsent } from "@/lib/referral";

/**
 * Cookie notice shown on the first visit (website and app). "Necessary only" is as easy as "Accept",
 * nothing optional is stored before a choice, and the choice can be changed any time from the footer.
 */
export default function CookieBanner() {
  const { t: tr } = useT();
  const [open, setOpen] = useState(() => !getConsent());
  const [details, setDetails] = useState(false);
  const [referral, setReferral] = useState(() => !!getConsent()?.choices?.referral);
  useEffect(() => {
    const h = () => { setReferral(!!getConsent()?.choices?.referral); setDetails(true); setOpen(true); };
    window.addEventListener("tameio:consent-open", h);
    return () => window.removeEventListener("tameio:consent-open", h);
  }, []);
  if (!open) return null;
  const save = (choices) => { setConsent(choices); applyRefConsent(!!choices.referral); setOpen(false); setDetails(false); };
  return (
    <div className="fixed inset-x-0 bottom-0 z-[60] p-3 sm:p-5 pointer-events-none" role="dialog" aria-modal="false" aria-labelledby="cookie-title" data-testid="cookie-banner">
      <div className="pointer-events-auto max-w-[720px] mx-auto rounded-2xl border border-black/10 bg-[#fffdf8] text-[#1f1a14] shadow-[0_20px_60px_-20px_rgb(0_0_0/0.35)] p-5">
        <div className="flex items-start gap-3">
          <Cookie className="h-5 w-5 mt-0.5 shrink-0 text-[#b4532a]" />
          <div className="min-w-0">
            <p id="cookie-title" className="font-semibold">{tr("Cookies and your privacy")}</p>
            <p className="text-[14px] text-[#5b5248] mt-1 leading-relaxed">
              {tr("We only use what's needed to sign you in and remember your settings. With your permission, we also remember for 60 days if an accounting firm sent you here, so they're credited. No advertising or tracking cookies.")}{" "}
              <Link to="/legal/cookies" className="underline underline-offset-2" onClick={() => setOpen(false)}>{tr("Cookie policy")}</Link>
            </p>
          </div>
        </div>
        {details && (
          <div className="mt-4 space-y-2 text-[14px]" data-testid="cookie-details">
            <label className="flex items-start gap-3 rounded-xl border border-black/10 p-3 opacity-80">
              <input type="checkbox" checked disabled className="mt-1 h-4 w-4" />
              <span><b>{tr("Strictly necessary")}</b> · {tr("Always on")}<br /><span className="text-[#5b5248]">{tr("Sign-in, security, language and the settings you choose. The service can't work without them.")}</span></span>
            </label>
            <label className="flex items-start gap-3 rounded-xl border border-black/10 p-3 cursor-pointer">
              <input type="checkbox" checked={referral} onChange={(e) => setReferral(e.target.checked)} className="mt-1 h-4 w-4 accent-[#1f1a14]" data-testid="cookie-referral" />
              <span><b>{tr("Referral")}</b><br /><span className="text-[#5b5248]">{tr("Remembers for 60 days which accounting firm recommended Tameio to you, so they're credited if you sign up later.")}</span></span>
            </label>
          </div>
        )}
        <div className="mt-4 flex flex-wrap gap-2 justify-end">
          {details ? (
            <button onClick={() => save({ referral })} className="h-10 px-4 rounded-full border border-[#1f1a14] text-[14px] font-semibold" data-testid="cookie-save">{tr("Save my choices")}</button>
          ) : (
            <button onClick={() => setDetails(true)} className="h-10 px-4 rounded-full text-[14px] font-semibold underline underline-offset-4" data-testid="cookie-choose">{tr("Choose")}</button>
          )}
          <button onClick={() => save({ referral: false })} className="h-10 px-4 rounded-full border border-[#1f1a14] text-[14px] font-semibold" data-testid="cookie-necessary">{tr("Necessary only")}</button>
          <button onClick={() => save({ referral: true })} className="h-10 px-4 rounded-full bg-[#1f1a14] text-[#f6f1e7] text-[14px] font-semibold" data-testid="cookie-accept">{tr("Accept all")}</button>
        </div>
      </div>
    </div>
  );
}
