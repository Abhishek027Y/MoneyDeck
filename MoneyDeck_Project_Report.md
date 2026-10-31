# MoneyDeck — Institutional FDR Management & Verification System (AICTE)

**Project Report — Status, Structure & Issues**

- **Report date:** 31 Oct 2026
- **Origin:** UI designed in Google Stitch; inspected via Google Antigravity (5 pages exported as `code.html` + `screen.png`).
- **Status:** MVP integration is in progress. Express/SQLite APIs, session authentication, role-gated college/officer workflows, document upload/OCR, evidence-backed bank confirmation, and audit logging are implemented. The API suite currently passes 27 tests. Direct bank APIs remain unconfigured and are never represented as confirmed.

---

## 1. Project Structure

```
MoneyDeck\
├─ index.html                          Entry stub → redirects to login page
├─ MoneyDeck_Project_Report.md         This report
├─ app\
│  ├─ assets\                           Shared authenticated frontend client + shell
│  ├─ college\                          FDR register, detail, notices, releases, etc.
│  └─ officer\                          Audit log, colleges, problems, releases, etc.
├─ server\
│  ├─ src\                              Express API, SQLite migrations, routes, OCR
│  └─ tests\                            Node test-runner API suite
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

**Technology:** Static HTML/Tailwind via CDN with shared vanilla-JS frontend assets; Express API with SQLite, cookie sessions, CSRF protection, role checks, local PDF storage, and OCR adapters. No frontend build step. Six `screen.png` files are local.

## 2. Existing Pages & Functionality

| Page | Current behavior |
|------|------------------|
| `index.html` | JS redirect (`location.replace`) to login; manual fallback link for no-JS. |
| **Login** | College/officer tabs, password visibility, and role-based login through the server session API; unauthorized portal access redirects to login. MFA/captcha remain prototype UI and are not security factors. |
| **College Dashboard** | Live API-backed KPI cards, FDR register, officer correspondence, notices, and release actions. The Stitch layout is retained. |
| **Batch Submission Gateway** | Four-step wizard with validation, staging, and local draft metadata. Final submission creates a server-side batch and FDR records; a selected receipt PDF is uploaded to the lead record and queued for OCR. If the empty form is used for a demo, PDF selection fills visibly disclosed synthetic sample fields (not OCR output or bank verification). The API enforces PDF signature/type and a 10 MB limit. If upload fails after the batch is accepted, the user is directed to that record to retry instead of being told that the batch failed. |
| **My FDR Records / FDR Details** | Authenticated institution-scoped register with filters and pagination; record detail includes PDF versions, OCR comparison, status history, bank confirmation, and audit trail. |
| **AICTE Officer Dashboard** | Live dashboard metrics and verification queue; dashboard actions open the selected FDR in the workspace. |
| **Verification Workspace** | Live queue and FDR detail, authorized PDF preview/download, OCR comparison, verification decisions (approval submits to the decision API with a default review comment when none is entered), problem reporting, and evidence-backed manual bank confirmation. |
| **Audit Log** | Officer-only, searchable/paginated view of the append-only audit log. |

## 3. Known Issues (as of Phase 1-A)

### Remaining navigation gaps
- Primary College and AICTE sidebar workflows are wired to authenticated app pages or Stitch dashboards.
- Login footer links for Help & Support, Privacy Policy, and Terms of Use still need destinations.
- Hidden legacy markup: `#new-fdr-modal` "Submit New FDR Modal" remains in College Dashboard HTML but is now unreachable from the sidebar (sidebar navigates to the Gateway instead). Kept intentionally (no deletions in Phase 1-A).

### Broken / expiring assets 🔴 (approved fix pending)
- ~~`aicte_officer_executive_fdr_overview_dashboard/code.html` header uses a Stitch-hosted logo~~ → **Fixed in Phase 1-A.5 (commit `ddca946`):** both dead Stitch-hosted `aida` logo images (header + sidebar brand) were replaced with the same CSS "MD" monogram used on the other pages (32×32, navy `primary-container` #142B49, white bold, `rounded-lg`, `shadow-sm`, `shrink-0`). The officer profile photo (`aida-public` URL) still loads and was left untouched.

### Design-system / environment
- Tailwind dev-mode CDN + two different Material Symbols stylesheet variants across pages (visual parity acceptable, duplicate requests).
- No offline fallback: pages render unstyled without internet (CDN dependency).
- Two character-encoding artifacts present in AICTE dashboard footer text ("v4.2 •" renders with replacement glyphs in some viewers) — display-only, untouched.

### Authentication & routing
- Server sessions use an HttpOnly cookie; mutating API routes require CSRF validation and role/permission checks.
- Captcha and MFA visuals are not backed by a real captcha/MFA provider.
- Bank API adapters require authorized integration credentials; until configured, only evidence-backed manual confirmation is available.

## 4. Development Status

| Phase | Scope | Status |
|-------|-------|--------|
| Baseline | Git initialized; original unmodified Stitch export committed (`37fe807`). | ✅ Done (Phase 1-A) |
| 1-A | Safety & wiring: navigation fixes, Sign Out, Portal Home link, single redirect. | ✅ Done (commit `fde09c9`) |
| 1-A.5 | AICTE dashboard dead logo → CSS "MD" monogram. | ✅ Done (commit `b413b3c`) |
| 1-B | Four-step wizard, local draft metadata, server-side batch submission, real PDF upload, register/details. | ✅ Integrated |
| 1-C | College FDR records/details and prioritized officer pages (verification, bank confirmation, audit log). | ✅ Implemented |
| 2 | Express API, SQLite, sessions/CSRF/RBAC, document storage, OCR comparison, audit logging, manual bank-evidence workflow. | ✅ MVP implemented |
| 2+ | Production identity/MFA, external bank integrations, and deployment hardening. | ⏳ Not configured / future work |

## 5. Phase 1-A Change Log (files modified)

| File | Change |
|------|--------|
| `index.html` | Removed redundant `<meta http-equiv="refresh">`; kept single JS `location.replace` redirect + no-JS fallback link. |
| `college_portal_institutional_fdr_management_dashboard/code.html` | Sidebar "Submit New FDR" link now navigates to Batch Submission Gateway (was `openNewFdrModal()` — dead modal flow). Hero button already navigated. |
| `aicte_officer_fdr_verification_workspace_ai_engine/code.html` | Sidebar "Overview Dashboard" now links to AICTE Executive Dashboard (was `href="#"`). Added compact **Sign Out** link in officer profile widget. |
| `aicte_officer_executive_fdr_overview_dashboard/code.html` | Added compact **Sign Out** link in sidebar footer (below Statutory Server status). |
| `moneydeck_institutional_access_secure_login/code.html` | Added subtle **"Portal Home"** link in brand section → `index.html`. |
| `MoneyDeck_Project_Report.md` | Created (this file). |

## 5-B. Phase 1-B Historical Change Log (files modified)

| File | Change |
|------|--------|
| `college_portal_submit_new_fdr_batch_submission_gateway/code.html` | **[M]** The only Phase 1-B code change. Minimal markup edits: (1) both "Save Draft" buttons → `saveFdrDraft()`; (2) upload card & "Replace" → real hidden `<input type="file" accept="application/pdf">` via `pickFdrDocument()`; (3) added id `uploaded-file-meta`; (4) added id `modal-bank-ref`; (5) inserted one honest **prototype disclosure** note in Step 3 (amber note in the existing design tokens) + hidden file input. Appended one readable `<script>` block at `</body>` overriding the generated stubs (`goToStep`, `validateAndGoToStep3`, `updateReviewValues`, `recalcTenor`, `formatPrincipalAmount`, `handleIfscLookup`, `updateBankDetails`, `addCurrentFdrToBatch`, `updateBatchUI`, `openFinalConfirmModal`, `processFinalSubmission`, `showToast`, plus new `saveFdrDraft`, `pickFdrDocument`, `handleFdrFileSelect`, `removeBatchEntry`, `renderBatch`) with complete client-side logic. All visual classes copied from the original UI. **No `alert()` remains** (replaced by the in-page styled toast + per-field error styling `.md-field-error`). |
| `MoneyDeck_Project_Report.md` | Status & change log updated. |

**Byte-integrity proof:** reverting the eight Phase 1-B insertions/replacements from the gateway file reproduces the Phase 1-A.5 commit content **byte-for-byte** (verified). No other page was touched in Phase 1-B.

### Phase 1-B behavior notes
- Draft key: `moneydeck_fdr_draft_v1` (plain JSON: form values, staged entries, document *name/size only*, current step). Document **files are never persisted** — browsers cannot keep file handles, so a restored draft asks the user to re-select the PDF.
- localStorage disclaimer shown verbatim in the Save Draft toast: *"...Prototype only — not a secure or official record store."*
- After successful submission, the server reference is shown and the user is redirected to the FDR register. If the separately uploaded PDF fails, the accepted batch is preserved and the user is sent to the lead record to retry the upload.

**Not modified (by design):** all `screen.png` files, `DESIGN.md`, layout/colors/typography/components of any page. (The Batch Submission Gateway logic was deferred to Phase 1-B and implemented there without touching any visual design.)

## 6. Fit-Gap Notes for Future Phases (reference only)

- Design system source of truth: `institutional_fdr_platform/DESIGN.md` (navy `#142B49`, teal `#2F657A`, Inter, tabular figures `tnum`, 4px/8px radii, split verification panels ≥1280px).
- Statutory language consistently references AICTE Approval Process Handbook Reg. 14.2, tripartite joint lien (Institute + AICTE + Bank), SFMS/NPCI gateway, NWRO regional bureaus — keep future features aligned with these terms.
