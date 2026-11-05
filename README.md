# Tameio

Invoicing, AADE myDATA e-invoicing, AI receipt scanning and supplier compliance for Greek small businesses.

> "Tameio" (ταμείο) is a working name — rename it in `frontend/src/components/Logo.jsx` (`APP_NAME`), `frontend/index.html` and `APP_NAME` in `backend/.env`.

## What's in it

| Area | Features |
|---|---|
| **Sales** | Clients · quotes with an online accept/decline page · sales orders · invoices (recurring, client link, print/PDF, email) · gap-free numbering |
| **myDATA** | Pre-flight validation (ΑΦΜ checksum, VAT rates, document types) · simulation / AADE test / live modes · ΜΑΡΚ + QR on invoices · cancellation · credit notes (5.1) linked to the original ΜΑΡΚ · reported invoices are locked · transmission log |
| **Spending** | Expenses with categories · **AI scanning** of receipt/invoice photos and PDFs (Claude, structured output) with duplicate detection and arithmetic checks · purchase orders → expenses |
| **Suppliers** | Bilingual (EL/EN) self-service onboarding portal · required documents with expiry tracking · review/approve · renewal reminders · "Can I pay them?" check · IBAN-change fraud guard |
| **Insights** | Dashboard · income vs expenses by month and category · profit · VAT payable estimate · CSV exports for the accountant |
| **Retail & delivery** | Quick counter receipts (ΑΛΠ 11.1 / ΑΠΥ 11.2) reported to myDATA in one step · digital delivery notes (9.3) with ΜΑΡΚ, QR, print view and a public scan page · delivery notes drafted from an invoice |
| **Ask Tameio** | Plain-language questions about your own books (Greek or English), answered by Claude from an aggregated snapshot — the model never queries the database |
| **Faster entry** | ΑΦΜ auto-fill (EU VIES, or AADE's registry service when credentials are set) · saved products & services · duplicate invoice · Excel/CSV import of clients, products and past invoices with column auto-matching |
| **Ease of use** | Grouped, shorter menu · Ctrl/⌘+K search · "+ New" menu · first-run checklist with removable sample data · Settings in four tabs |

## Stack

- **Backend:** FastAPI + MongoDB (motor). `backend/app/`
- **Frontend:** React 18 + Vite + Tailwind, Radix dialogs, Recharts. `frontend/src/`
- **AI:** Anthropic API (`claude-opus-5-5`), server-side refusal fallback enabled. `backend/app/ai.py`

## Run locally

```bash
# backend (needs MongoDB running)
cd backend
cp .env.example .env            # add ANTHROPIC_API_KEY to enable scanning
pip install -r requirements-dev.txt
uvicorn app.main:app --reload --port 8000

# frontend (proxies /api to :8000)
cd frontend
npm install
npm run dev                     # http://localhost:5173
```

Tests (no MongoDB or API key needed — in-memory DB, AI mocked):

```bash
cd backend && python -m pytest -q
```

## Landing-page photos

The landing page expects film-style photos in `frontend/public/photos/` (`hero.jpg`, `kafeneio.jpg`, `carpenter.jpg`, `accountant.jpg`,
`florist.jpg`, `taverna.jpg`, `mechanic.jpg`, `phone-receipt.jpg`, `grocery.jpg`). Until they exist, warm placeholder plates are shown.
Put the generated originals in `frontend/photos-src/` (`hero.png`, `sheet-a.png`, `sheet-b.png` — the 2×2 sheets are cut automatically,
and any file named like a target, e.g. `taverna.jpg`, is used as-is) and run `python3 frontend/scripts/prepare_photos.py`.

## Deploying

- Serve `frontend/dist` (after `npm run build`) and the API from the **same domain** (e.g. `/api` reverse-proxied to uvicorn), or set `VITE_API_URL` and `CORS_ORIGINS` for separate domains. Session cookies are `SameSite=Lax`.
- Set `COOKIE_SECURE=true`, a strong `MYDATA_ENCRYPTION_KEY`, and `PUBLIC_URL`.
- `UPLOAD_DIR` holds scanned receipts and supplier documents: put it on persistent storage (or swap for S3).
- The in-process rate limiter and scheduler assume a single API process; with several workers, move them to Redis / a dedicated worker.

## Before going live

- **myDATA:** tested against the simulation and mocked AADE responses only. Run the AADE test environment (`mydataapidev`) with real credentials before production.
- **B2B e-invoicing mandate:** issuing B2B e-invoices under Law 5222/2025 generally requires a certified e-invoicing provider. This app reports to myDATA via the REST API; confirm the compliance route with an accountant/lawyer.
- **Pricing** on the landing page (`PLANS` in `frontend/src/pages/Landing.jsx`) is placeholder; there's no billing yet.
- **Email** needs a Resend API key and a verified sending domain.
- **Delivery notes (9.3)** follow the published myDATA fields (move purpose, addresses, dispatch date/time, vehicle, `isDeliveryNote`). AADE's digital delivery-note rollout adds lifecycle steps (e.g. transfer completion) that aren't implemented yet — test in `mydataapidev` and confirm with an accountant.
- **ΑΦΜ lookup** uses EU VIES by default (name + address for VAT-registered businesses). For ΔΟΥ and activities, set `AADE_REGISTRY_USER` / `AADE_REGISTRY_PASS` (AADE "Αναζήτηση Βασικών Στοιχείων Μητρώου" credentials).
