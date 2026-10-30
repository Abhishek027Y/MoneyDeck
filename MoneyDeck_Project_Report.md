# MoneyDeck — Institutional FDR Management & Verification System (AICTE)

**Project Report — Status, Structure & Issues**

- **Report date:** 30 Oct 2026
- **Origin:** UI designed in Google Stitch; inspected via Google Antigravity (5 pages exported as `code.html` + `screen.png`).
- **Status:** Front-end prototype (Phase 1-A wiring completed). No backend, database, authentication, AI/OCR, or bank API integration yet.

---

## 1. Project Structure

```
MoneyDeck\
├─ index.html                          Entry stub → redirects to login page
├─ MoneyDeck_Project_Report.md         This report
└─ stitch_moneydeck_institutional_fdr_management\
   ├─ moneydeck_institutional_access_secure_login\
   │    ├─ code.html                   Login (College / AICTE Officer dual-tab, captcha, MFA banner)
   │    └─ screen.png
   ├─ college_portal_institutional_fdr_management_dashboard\
   │    ├─ code.html                   College Dashboard (KPIs, FDR register, correspondence, events)
   │    └─ screen.png
   ├─ college_portal_submit_new_fdr_batch_submission_gateway\
   │    ├─ code.html                   Batch Submission Gateway (4-step wizard, static Step 2 shown)
   │    └─ screen.png
   ├─ aicte_officer_executive_fdr_overview_dashboard\
   │    ├─ code.html                   AICTE Officer Dashboard (maturity alerts, verification queue, filter drawer)
   │    └─ screen.png
   ├─ aicte_officer_fdr_verification_workspace_ai_engine\
   │    ├─ code.html                   Verification Workspace (60/40 split: document viewer + 4-tab extraction panel)
   │    └─ screen.png
   └─ institutional_fdr_platform\
        └─ DESIGN.md                   Design system tokens & component spec (no page wired)
```

**Technology:** Static HTML, Tailwind CSS via CDN (`cdn.tailwindcss.com`), Inter + Material Symbols via Google Fonts CDN. No build step, no local CSS/JS assets, no git-tracked build artifacts. 6 `screen.png` files are local (no expiring image URLs in 5 of 6 pages).

## 2. Existing Pages & Functionality

| Page | Current behavior |
|------|------------------|
| `index.html` | JS redirect (`location.replace`) to login; manual fallback link for no-JS. |
| **Login** | Role tabs (College / Officer), password toggle, captcha generator (display-only), "Remember device" checkbox, MFA banner. Submitting (any credentials — validation not implemented) redirects after ~700 ms: College → College Dashboard, Officer → AICTE Dashboard. |
| **College Dashboard** | KPI cards (Total / Verified / Pending / Upcoming maturities), statutory renewal alert banner, FDR register table (3 static rows: HDFC, SBI, PNB), officer correspondence feed, recent statutory events. Toast helper `showComingSoon()` for unbuilt features. Hero "+ Submit New FDR" navigates to Batch Submission Gateway. |
| **Batch Submission Gateway** | Static render of Step 2 of 4 ("FDR Parameters"): Group A bank info, Group B FDR financials, tenor calc, batch docket sidebar, statutory norms. Wizard navigation is **not** implemented (Phase 1-B). |
| **AICTE Officer Dashboard** | Urgent maturity alerts, verification queue, working filter drawer (open/apply/reset toasts), `dispatchNotice()` toast, `openVerificationModal()` → Verification Workspace. |
| **Verification Workspace** | Best-built page: split 60% document viewer (FDR receipt, annexures, security elements) / 40% 4-tab extracted-data verification panel, Verify & Report-Problem modals, toast system. |

## 3. Known Issues (as of Phase 1-A)

### Navigation gaps (pages still on `href="#"` — deferred, not lost)
- College sidebar: My FDR Records, Renew FDR, Release Requests, Officer Comments, Alerts & Notices, Institution Details, Language Prefs, Notification Config → **no target pages exist** (Phase 1-C candidates).
- AICTE sidebar: Colleges & FDRs, Problem Reports, Release Requests, Audit Log, Settings → no target pages.
- Login footer: Help & Support, Privacy Policy, Terms of Use → dead links.
- Hidden legacy markup: `#new-fdr-modal` "Submit New FDR Modal" remains in College Dashboard HTML but is now unreachable from the sidebar (sidebar navigates to the Gateway instead). Kept intentionally (no deletions in Phase 1-A).

### Broken / expiring assets 🔴 (approved fix pending)
- ~~`aicte_officer_executive_fdr_overview_dashboard/code.html` header uses a Stitch-hosted logo~~ → **Fixed in Phase 1-A.5 (commit `ddca946`):** both dead Stitch-hosted `aida` logo images (header + sidebar brand) were replaced with the same CSS "MD" monogram used on the other pages (32×32, navy `primary-container` #142B49, white bold, `rounded-lg`, `shadow-sm`, `shrink-0`). The officer profile photo (`aida-public` URL) still loads and was left untouched.

### Design-system / environment
- Tailwind dev-mode CDN + two different Material Symbols stylesheet variants across pages (visual parity acceptable, duplicate requests).
- No offline fallback: pages render unstyled without internet (CDN dependency).
- Two character-encoding artifacts present in AICTE dashboard footer text ("v4.2 •" renders with replacement glyphs in some viewers) — display-only, untouched.

### Authentication & routing
- No session state: dashboards open directly via URL without login (prototype-intended; revisit in Phase 2).
- Credentials/captcha are not validated (simulated login).
- `openVerificationModal(collegeCode, fdrNo)` accepts params but always opens the same workspace page (fine in prototype).

## 4. Development Status

| Phase | Scope | Status |
|-------|-------|--------|
| Baseline | Git initialized; original unmodified Stitch export committed (`37fe807`). | ✅ Done (Phase 1-A) |
| 1-A | Safety & wiring: navigation fixes, Sign Out, Portal Home link, single redirect. | ✅ Done (this phase) |
| 1-B | Front-end interactivity: wizard steps/`localStorage` drafts, register "Details", batch docket accumulation. | ⏸ Awaiting approval |
| 1-C | Missing pages (My FDR Records, Alerts & Notices, Problem Reports, Audit Log, …). | ⏸ Awaiting approval |
| 2+ | Backend, database, real auth/sessions, AI/OCR extraction, bank/scheduled-bank APIs. | ❌ Explicitly out of scope (client instruction) |

## 5. Phase 1-A Change Log (files modified)

| File | Change |
|------|--------|
| `index.html` | Removed redundant `<meta http-equiv="refresh">`; kept single JS `location.replace` redirect + no-JS fallback link. |
| `college_portal_institutional_fdr_management_dashboard/code.html` | Sidebar "Submit New FDR" link now navigates to Batch Submission Gateway (was `openNewFdrModal()` — dead modal flow). Hero button already navigated. |
| `aicte_officer_fdr_verification_workspace_ai_engine/code.html` | Sidebar "Overview Dashboard" now links to AICTE Executive Dashboard (was `href="#"`). Added compact **Sign Out** link in officer profile widget. |
| `aicte_officer_executive_fdr_overview_dashboard/code.html` | Added compact **Sign Out** link in sidebar footer (below Statutory Server status). |
| `moneydeck_institutional_access_secure_login/code.html` | Added subtle **"Portal Home"** link in brand section → `index.html`. |
| `MoneyDeck_Project_Report.md` | Created (this file). |

**Not modified (by design):** all `screen.png` files, `DESIGN.md`, layout/colors/typography/components of any page, Batch Submission Gateway page (wizard interactivity deferred to Phase 1-B).

## 6. Fit-Gap Notes for Future Phases (reference only)

- Design system source of truth: `institutional_fdr_platform/DESIGN.md` (navy `#142B49`, teal `#2F657A`, Inter, tabular figures `tnum`, 4px/8px radii, split verification panels ≥1280px).
- Statutory language consistently references AICTE Approval Process Handbook Reg. 14.2, tripartite joint lien (Institute + AICTE + Bank), SFMS/NPCI gateway, NWRO regional bureaus — keep future features aligned with these terms.
