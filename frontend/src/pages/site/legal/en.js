// Legal documents — English. {placeholders} are filled from the operator's details (Render environment: LEGAL_*).
// Templates written for a Greek B2B SaaS; have them reviewed by a Greek lawyer before relying on them.
// A section is [heading, blocks]; a block is a paragraph string or an array (a bulleted list).

export default {
  terms: {
    title: "Terms of Service",
    summary: "The agreement between your business and {company} for using {trade}. Please read it — by creating an account you accept it on behalf of your business.",
    sections: [
      ["1. Who we are", [
        "{trade} (“the Service”) is provided by {company}, {address}, ΑΦΜ {afm}, ΔΟΥ {doy}, ΓΕΜΗ {gemi} (“we”, “us”). Contact: {email}.",
        "These Terms, together with the Privacy Policy, the Cookie Policy and the Data Processing Agreement, form the agreement between us and the business or professional that opens an account (“you”).",
      ]],
      ["2. Business use only", [
        "The Service is for businesses, freelancers and accounting firms acting in the course of their trade or profession. It is not offered to consumers. The person who signs up confirms they are at least 18 and authorised to accept these Terms for the business.",
      ]],
      ["3. Your account", [
        ["Give accurate details and keep them up to date — they appear on your documents.", "Keep your password safe and turn on two-step sign-in. You are responsible for everything done under your account, including by team members and accountants you invite.", "Tell us straight away at {email} if you think your account has been misused."],
      ]],
      ["4. What the Service does — and what stays your responsibility", [
        "The Service helps you issue invoices, receipts, credit and delivery notes, record expenses, transmit documents to AADE myDATA using your own AADE credentials through the myDATA REST interface, track payments and deadlines, and work with your team and accountant.",
        "You remain responsible for your tax and accounting obligations: the correctness of every document (amounts, VAT rates and exemptions, withholding, stamp duty, document types, counterparties), sending them to myDATA on time, and keeping your records for as long as Greek law requires. Check documents before you issue them. The simulation mode does not send anything to AADE.",
        "{trade} is invoicing and bookkeeping software. Unless we tell you otherwise in writing, we are not an AADE-certified electronic invoicing provider (Πάροχος Ηλεκτρονικής Τιμολόγησης), and we do not act as your accountant or tax adviser.",
      ]],
      ["5. AI features and tax information", [
        "Receipt reading, category suggestions, invoice drafting, “Ask Tameio” and tax questions use artificial intelligence. Their output can be wrong or out of date. Nothing is saved until you confirm it, and you must check it before relying on it.",
        "Answers to tax questions are general information drawn from public sources (such as Taxheaven, ΑΑΔΕ and the official laws) with links so you can check them. They are not legal or tax advice for your situation — confirm with your accountant before acting.",
      ]],
      ["6. Plans, prices and payment", [
        "The plans and prices on our Pricing page apply. Prices exclude VAT. The free plan has the limits shown there. We may change prices or plans with at least 30 days' notice; the change applies from your next billing period, and you may cancel before it does.",
        "Paid plans are billed in advance for each month. If a payment is overdue we may, after a reminder, limit your account to read-only and export until it is settled. Fees already paid for a period are not refunded, except where the law requires it.",
      ]],
      ["7. Acceptable use", [
        "You must not use the Service to:",
        ["issue false, fictitious or misleading documents, or to evade tax;", "break the law or anyone's rights, or upload unlawful content or malware;", "access other customers' data, probe or bypass security, or overload the Service;", "copy, resell or reverse-engineer the Service, or scrape it with automated tools;", "share an account between several people instead of inviting them."],
        "We may suspend accounts involved in such use, and we may report suspected tax fraud to the authorities where the law requires.",
      ]],
      ["8. Your data", [
        "Your business data is yours. You give us the right to store and process it only to provide, secure and support the Service, as described in the Privacy Policy and the Data Processing Agreement. You can export all of it at any time from Settings.",
        "When you delete your business, we delete its data within 30 days; backups roll over within a further 30 days. Before deleting, export what Greek law requires you to keep.",
      ]],
      ["9. Third-party services", [
        "Some features depend on others: AADE (myDATA, ΑΦΜ registry), the EU VIES service, Viva Wallet for card payments, your email provider, your calendar app and online shops you connect. Their own terms apply, and we are not responsible for their availability or for their actions. If AADE's systems are down, documents may need to be sent later.",
      ]],
      ["10. Availability and changes", [
        "We work to keep the Service available and secure but do not promise it will be uninterrupted or error-free. We may improve or change features; if we remove a feature that is essential to a paid plan, we will tell you in advance and you may cancel. Features marked “beta” may change or be withdrawn.",
      ]],
      ["11. Accounting firms and the partner programme", [
        "Accountant accounts are free. An accountant sees a client's books only when invited by that client or when the firm set the client up. Referral links, attribution and revenue share are governed by a separate partner agreement.",
      ]],
      ["12. Intellectual property", [
        "The software, design and content of the Service belong to us or our licensors. You receive a non-exclusive, non-transferable right to use the Service while your account is active. Suggestions you send us may be used to improve the Service without obligation.",
      ]],
      ["13. Liability", [
        "Nothing in these Terms limits liability for intent or gross negligence, or any liability that cannot be limited under Greek law.",
        "Otherwise, we are not liable for indirect or consequential loss, lost profit, or fines and surcharges arising from documents, data or deadlines that are your responsibility under section 4. Our total liability in any 12 months is limited to the fees you paid us in those 12 months (or €100 if you use the free plan).",
      ]],
      ["14. Ending the agreement", [
        "You can stop using the Service and delete your business at any time. We may end the agreement with 30 days' notice, or immediately if you seriously breach these Terms. In all cases you will have at least 30 days to export your data, except where the law prevents it.",
      ]],
      ["15. Changes to these Terms", [
        "We may update these Terms. For important changes we will tell you by email or in the app at least 30 days in advance. If you continue using the Service after that, the new Terms apply; if you don't agree, you may cancel before then.",
      ]],
      ["16. Law and courts", [
        "Greek law applies. The courts of {courts} have jurisdiction, without prejudice to mandatory rules.",
      ]],
    ],
  },

  privacy: {
    title: "Privacy Policy",
    summary: "What personal data {trade} handles, why, who else sees it, and the rights you have under the GDPR.",
    sections: [
      ["1. Who is responsible", [
        "{company}, {address}, ΑΦΜ {afm} is the controller for the personal data of our users and website visitors. Contact for privacy matters: {privacy}.",
        "For the data your business enters about its own clients, suppliers and staff (for example names, ΑΦΜ and amounts on invoices), your business is the controller and we act as its processor under the Data Processing Agreement.",
      ]],
      ["2. What we collect", [
        ["Account data: name, email, hashed password, two-step sign-in settings, role and the business you belong to.", "Business data: business details and everything you create or upload — invoices, receipts, quotes, delivery notes, expenses and their files, supplier documents, bank statement lines, comments and @mentions.", "AI requests: receipts and documents you scan, questions you ask “Ask Tameio”, and tax questions.", "Support: messages, screenshots and the page you were on when you send feedback.", "Technical data: IP address, browser and device, sign-in times, security and error logs.", "Optional: which accounting firm referred you (only if you came through a firm's link)."],
      ]],
      ["3. Why we use it and the legal basis", [
        ["To provide the Service you signed up for, including AI features and myDATA transmission you request — performance of a contract (GDPR art. 6(1)(b)).", "To meet our own legal obligations, e.g. tax and accounting records for our invoices to you — legal obligation (art. 6(1)(c)).", "To keep the Service secure, prevent fraud, fix errors and improve it — our legitimate interests (art. 6(1)(f)).", "To send you service emails such as reminders, mentions and reports you set up — performance of a contract; you can switch reminders off.", "To credit an accounting firm that referred you, and to remember the referral on your device — legitimate interest, and your consent for the device storage."],
        "We do not sell personal data and do not use it for advertising.",
      ]],
      ["4. AI processing", [
        "Documents you scan and questions you ask are sent to our AI provider, Anthropic, to produce the result. Under our commercial terms Anthropic does not use this data to train its models. For tax questions, the AI searches public websites (such as taxheaven.gr and aade.gr); the search uses the wording of your question. AI results are suggestions you review — no decisions with legal effect are made automatically about you.",
      ]],
      ["5. Who receives data", [
        ["Hosting: Render (servers in Frankfurt, EU).", "Database: MongoDB Atlas on Amazon Web Services (Frankfurt, EU).", "AI: Anthropic PBC (USA).", "Email delivery: Resend (USA), when email is enabled.", "Card payments: Viva Wallet (Greece/EU), when you or your clients pay by card.", "Public authorities: AADE when you send documents to myDATA or look up an ΑΦΜ; the European Commission's VIES service for EU VAT numbers.", "People you choose: team members, your accountant, your clients (invoice links), and calendar apps you subscribe with your private link.", "Authorities or courts when the law requires it."],
      ]],
      ["6. Transfers outside the EU", [
        "Anthropic and Resend are in the USA. Transfers rely on the EU–US Data Privacy Framework where the provider is certified, and otherwise on the European Commission's Standard Contractual Clauses with additional safeguards.",
      ]],
      ["7. How long we keep it", [
        ["Account and business data: while your account is active; deleted within 30 days after you delete your business, and from backups within a further 30 days.", "Security and error logs: up to 90 days.", "Our own billing records: as long as Greek tax law requires.", "The documents you issue must be kept by your business for the period Greek law requires — export them before deleting your account."],
      ]],
      ["8. Your rights", [
        "You can ask for access, correction, deletion, restriction, portability, and object to processing based on legitimate interests; where we rely on consent you can withdraw it at any time (e.g. Cookie settings). Most of this you can do yourself in Settings → Security & data; otherwise write to {privacy}. We reply within one month.",
        "You can complain to the Hellenic Data Protection Authority, Kifisias 1-3, 115 23 Athens, www.dpa.gr.",
        "If your data is in a business's account (for example you are a client named on an invoice), please contact that business first — it decides how your data is used.",
      ]],
      ["9. Security", [
        "Encrypted connections, hashed passwords, optional two-step sign-in, encrypted storage of AADE and payment credentials, per-business access control, private links with long random tokens, and limited staff access on a need-to-know basis.",
      ]],
      ["10. Children", ["The Service is for businesses and is not intended for anyone under 18."]],
      ["11. Changes", ["We will post any changes here and tell users of important changes by email or in the app."]],
    ],
  },

  cookies: {
    title: "Cookie Policy",
    summary: "{trade} uses only what's needed to work, plus one optional item you can refuse. No advertising, analytics or third-party tracking cookies, and our fonts are served from our own site.",
    sections: [
      ["1. What we store on your device", [
        "Cookies and similar storage (localStorage, sessionStorage) are small pieces of data kept by your browser. Under Greek law 3471/2006 (art. 4 par. 5) and the GDPR we may store what is strictly necessary for a service you asked for; anything else needs your consent.",
      ]],
      ["2. Strictly necessary (always on)", [
        ["session — cookie, 30 days, keeps you signed in securely (HttpOnly).", "tameio_consent — your cookie choice, 12 months.", "tameio_lang — the language you chose.", "tameio_org — which business you're working in.", "tameio_nav_more, tameio_cal_view — how you arranged the menu and calendar.", "tameio_draft, tameio_last_page — unsaved form text and the page you were on (for bug reports); deleted when you close the tab."],
      ]],
      ["3. Optional (only with your consent)", [
        ["tameio_ref — remembers for 60 days which accounting firm's link brought you here, so the firm is credited if you sign up later. Without consent it is kept only until you close the tab."],
      ]],
      ["4. What we don't use", [
        "No analytics, advertising, social-media or other third-party cookies. Fonts and images are served from our own servers. If you click through to another service — for example Viva Wallet to pay, or Google Calendar — that service's own cookies and policy apply.",
      ]],
      ["5. Changing your choice", [
        "Use “Cookie settings” at the bottom of any page to change or withdraw your consent at any time. You can also delete stored data in your browser settings; you will then be asked again.",
      ]],
    ],
  },

  dpa: {
    title: "Data Processing Agreement",
    summary: "The GDPR article 28 terms under which {company} processes personal data on behalf of your business. It is part of the Terms of Service and applies automatically to every business account.",
    sections: [
      ["1. Parties and roles", [
        "Your business (the “Controller”) and {company} (the “Processor”). This Agreement covers personal data the Controller enters into or receives through {trade} about its clients, suppliers, staff and other people (the “Data”).",
      ]],
      ["2. Subject, duration, nature and purpose", [
        "Subject: hosting and processing of the Data to provide the Service. Duration: for as long as the Controller's account exists, plus the deletion periods below. Nature: storage, organisation, retrieval, transmission (e.g. to AADE at the Controller's request), AI-assisted reading, and deletion. Purpose: providing invoicing, bookkeeping, compliance and collaboration features.",
        "Categories of data subjects: the Controller's clients, suppliers, employees, contacts and users. Types of data: names, contact details, ΑΦΜ and other identifiers, addresses, transaction and payment details, bank statement lines, uploaded documents and messages. The Controller should not upload special categories of data (art. 9 GDPR) unless strictly necessary.",
      ]],
      ["3. Processor obligations", [
        ["Process the Data only on the Controller's documented instructions — the Terms, the settings it chooses and the actions it takes in the Service — unless the law requires otherwise, in which case we inform the Controller where allowed.", "Ensure that people authorised to access the Data are bound by confidentiality.", "Apply appropriate technical and organisational measures (see section 6).", "Assist the Controller, as far as possible, in answering data-subject requests and with security, impact assessments and consultations (arts. 32–36 GDPR).", "Notify the Controller without undue delay, and where possible within 48 hours, after becoming aware of a personal data breach affecting the Data, with the information available.", "Make available the information needed to demonstrate compliance and allow reasonable audits, normally through documentation and written answers, with reasonable notice and at the Controller's cost."],
      ]],
      ["4. Sub-processors", [
        "The Controller authorises the following sub-processors: Render (hosting, EU); MongoDB Atlas / Amazon Web Services (database, EU); Anthropic PBC (AI processing, USA); Resend (email delivery, USA); Viva Wallet (card payments, EU) where used. We impose data-protection obligations on them equivalent to this Agreement and remain responsible for them.",
        "We will announce new sub-processors at least 30 days in advance (on this page and by email). The Controller may object on reasonable data-protection grounds; if we can't address the objection, the Controller may terminate the affected service.",
      ]],
      ["5. International transfers", [
        "Transfers outside the EEA happen only with an adequate safeguard: an adequacy decision (including the EU–US Data Privacy Framework for certified recipients) or the Standard Contractual Clauses with supplementary measures.",
      ]],
      ["6. Security measures", [
        ["Encryption in transit (TLS) and of stored credentials (AADE keys, payment keys).", "Hashed passwords, optional two-step sign-in, session controls.", "Strict separation of each business's data and role-based access.", "Backups, monitoring, error logging and rate limiting.", "Least-privilege staff access, only to provide support or keep the Service running."],
      ]],
      ["7. End of processing", [
        "When the Controller deletes its business or the agreement ends, we delete the Data within 30 days and from backups within a further 30 days, unless EU or Greek law requires us to keep it. The Controller can export the Data at any time before deletion.",
      ]],
      ["8. Other terms", [
        "Liability follows the Terms of Service. If this Agreement and the Terms conflict on data protection, this Agreement prevails. Greek law applies.",
      ]],
    ],
  },

  notice: {
    title: "Legal notice",
    summary: "Information about the operator of this website and service (Presidential Decree 131/2003, art. 4).",
    sections: [
      ["Operator", [
        ["Company: {company}", "Trade name: {trade}", "Address: {address}", "ΑΦΜ: {afm} · ΔΟΥ: {doy}", "ΓΕΜΗ: {gemi}", "Email: {email}", "Phone: {phone}"],
      ]],
      ["Disputes", [
        "We prefer to solve problems directly — write to {email}. Greek law applies and the courts of {courts} have jurisdiction.",
      ]],
      ["Content", [
        "Tax information on this site and in the app is general information, not legal or tax advice. Links to other websites (such as Taxheaven and ΑΑΔΕ) are provided for convenience; we are not responsible for their content.",
      ]],
    ],
  },
};
