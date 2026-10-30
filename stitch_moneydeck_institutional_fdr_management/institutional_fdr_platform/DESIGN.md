---
name: Institutional FDR Platform
colors:
  surface: '#f8f9ff'
  surface-dim: '#cfdbec'
  surface-bright: '#f8f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eef4ff'
  surface-container: '#e4efff'
  surface-container-high: '#dee9fb'
  surface-container-highest: '#d8e3f5'
  on-surface: '#111c29'
  on-surface-variant: '#44474e'
  inverse-surface: '#26313e'
  inverse-on-surface: '#e9f1ff'
  outline: '#74777e'
  outline-variant: '#c4c6ce'
  surface-tint: '#4a5f80'
  primary: '#001631'
  on-primary: '#ffffff'
  primary-container: '#142b49'
  on-primary-container: '#7d93b6'
  inverse-primary: '#b2c8ed'
  secondary: '#2f657a'
  on-secondary: '#ffffff'
  secondary-container: '#b0e4fd'
  on-secondary-container: '#32677d'
  tertiary: '#001045'
  on-tertiary: '#ffffff'
  tertiary-container: '#002174'
  on-tertiary-container: '#6b8aff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#d5e3ff'
  primary-fixed-dim: '#b2c8ed'
  on-primary-fixed: '#021c39'
  on-primary-fixed-variant: '#324867'
  secondary-fixed: '#bce9ff'
  secondary-fixed-dim: '#9acee6'
  on-secondary-fixed: '#001f2a'
  on-secondary-fixed-variant: '#104d61'
  tertiary-fixed: '#dce1ff'
  tertiary-fixed-dim: '#b7c4ff'
  on-tertiary-fixed: '#001551'
  on-tertiary-fixed-variant: '#0039b5'
  background: '#f8f9ff'
  on-background: '#111c29'
  surface-variant: '#d8e3f5'
typography:
  headline-xl:
    fontFamily: Inter
    fontSize: 30px
    fontWeight: '700'
    lineHeight: 38px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.015em
  headline-md:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 24px
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 18px
  label-md:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '500'
    lineHeight: 18px
  label-sm:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.04em
  tabular-num:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 1rem
  gutter-desktop: 1.5rem
  margin: 1rem
  margin-desktop: 2rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1.25rem
  space-xl: 2rem
---

## Brand & Style

This design system establishes an authoritative, reliable, and rigorously structured visual identity tailored for statutory regulatory bodies, institutional banking liaisons, and collegiate administrative executives handling Fixed Deposit Receipts (FDR). 

The emotional signature prioritizes fiduciary trust, regulatory compliance, precision, and operational transparency. Interfaces must instill procedural confidence, presenting complex multi-tier approvals, financial instruments, and audit trails without ambiguity.

The design movement is **Corporate / Modern** anchored in institutional banking principles:
- **Zero Decorative Noise**: Strictly avoid gratuitous gradients, synthetic glows, glassmorphism, or non-functional ornamental artwork.
- **Architectural Utility**: Prioritize dense data legibility, tabular figure alignments, explicit system statuses, and predictable interaction flows.
- **High-Fidelity Governance**: Emphasize explicit structural demarcation via crisp hairline dividers, precise micro-labels, and standardized compliance iconography.

## Colors

The palette enforces legal and financial authority through deep oceanic navy, balanced slate teal, and institutional neutrals:

### Core Foundation
- **Primary Navy (`#142B49`)**: Anchors primary navigation chrome, top-level headings, dominant action buttons, and active workflow states.
- **Secondary Teal (`#245B70`)**: Governs analytical metrics, secondary actions, supporting navigational accents, and section hierarchy.
- **Background (`#F3F5F7`)**: Base institutional canvas providing soft, low-strain contrast across long audit sessions.
- **Surface (`#FFFFFF`)**: Pure white containers, data grids, modal panels, and elevated document sheets.
- **Primary Text (`#202B38`)**: High-contrast, WCAG AAA compliant text for primary financial figures and body content.
- **Secondary Text (`#667085`)**: Controlled tone for metadata, field labels, timestamps, and column headers.
- **Border (`#E2E7ED`)**: Hairline boundary token for table grids, inputs, cards, and structural separators.

### Compliance & Status Colors
To ensure immediate recognition across dense FDR verification queues, statuses pair an accessible background tint with a high-contrast foreground stroke and text:
- **Verified (`#1E7E34`)**: Validated FDRs, compliant collaterals, and cleared audits. Tint: `#EAF6ED`.
- **Pending (`#D97706`)**: Banking settlement queues, awaiting joint signatures, or officer review. Tint: `#FEF7EC`.
- **Action Required (`#DC2626`)**: Encashment discrepancies, bank guarantee rejections, or missing endorsements. Tint: `#FEF2F2`.
- **Information (`#1D4ED8`)**: Advisory notices, circular updates, and regulatory guidelines. Tint: `#EFF4FE`.
- **Expired (`#991B1B`)**: Matured without renewal, forfeited instruments, or lapsed tenures. Tint: `#FBEAEA`.
- **Archived (`#4B5563`)**: Decommissioned accounts, reconciled past tenures, and closed cycles. Tint: `#F3F4F6`.

## Typography

The typography is built entirely on **Inter** to leverage its uniform neutral anatomy, tall x-height, and robust rendering engine across cross-platform administrative terminals.

- **Tabular Figures (`tnum`)**: Mandatory for all financial amounts, FDR account numbers, maturity dates, interest rates, and institutional codes. Ensures vertical decimal and digit alignment across large tables.
- **Letter Spacing**: Constrained tracking across headline tiers prevents visual sprawling; slight uppercase tracking (`0.04em`) applied to `label-sm` ensures crisp readability in status chips and table headers.
- **Hierarchical Discipline**: Reserve bold weights (`700`) strictly for page-level financial aggregate sums and core dashboard titles. Body content relies strictly on standard regular (`400`) and medium (`500`) weights.

## Layout & Spacing

The platform uses a fixed-fluid structural hybrid designed for administrative screens:

- **Navigation Shell**: A fixed `250px` left sidebar coupled with a persistent `56px` utility header containing quick search, role designation (e.g., Regional Directorate vs. Institution Registrar), and institutional notifications.
- **Content Area**: Fluid canvas with maximum responsive utility. Employs a standard 12-column grid inside data workspaces with `1.5rem` (`24px`) gutters on desktop.
- **Data Comparison Split Panels**: Dual-pane verification workspaces reserve `50% / 50%` screen split at `>= 1280px` to compare physical scanned FDR certificates side-by-side with digitized bank API ledger entries.
- **Responsive Breakpoints**:
  - **Desktop (`>= 1200px`)**: Full sidebar visible, split comparison panels active, dense multi-column tabular grids.
  - **Tablet (`768px - 1199px`)**: Sidebar collapses to an icon-only or drawer navigation, split panels collapse to tabbed comparison modes.
  - **Mobile (`< 768px`)**: Stacked cards replace multi-column tables; non-essential financial audit metadata collapses behind detail disclosures.

## Elevation & Depth

This system avoids ambient drop shadows and floating skeuomorphic depth. Visual hierarchy is established via **tonal structural layering** and **low-contrast precision outlines**:

- **Layer 0 (Canvas Base)**: `#F3F5F7` background.
- **Layer 1 (Data Surfaces & Workspaces)**: `#FFFFFF` panels, cleanly separated from the canvas by a single crisp `1px` border (`#E2E7ED`).
- **Layer 2 (Overlays & Side Drawers)**: Verification flyouts and slide-in audit trails utilize a 1px solid border (`#E2E7ED`) paired with a functional, non-tinted, sharp shadow: `0 4px 16px rgba(20, 43, 73, 0.08)`.
- **Layer 3 (Modals & Verification Confirmations)**: Centered action modals use `0 8px 24px rgba(20, 43, 73, 0.12)` with a solid `#142B49` scrim at `40%` opacity to block background distractions during statutory approvals.

## Shapes

The design system employs **Soft** geometry (`roundedness: 1`), strictly avoiding pill shapes, circular buttons, or bubbly contours.

- **Base Radius (`0.25rem` / `4px`)**: Buttons, input fields, dropdown trigger elements, status badges, and pagination controls.
- **Card & Table Shell Radius (`0.5rem` / `8px`)**: Financial data cards, split-pane comparison frames, and document viewer viewports.
- **Interior Micro-Elements (`2px` - `4px`)**: Checkboxes, toggle tracks, and table row selection indicators.
- **Corners on Tables**: Outer boundary container corners share the `8px` radius; interior data cells are strictly squared with clean horizontal borders.

## Components

### Buttons
- **Primary**: Background `#142B49`, text `#FFFFFF`, 4px border radius, font-size 14px, medium weight. Hover state deepens to `#0E1E33`. Active state `#091422`.
- **Secondary**: Surface `#FFFFFF`, border `1px solid #E2E7ED`, text `#202B38`. Hover state fills with `#F3F5F7`.
- **Destructive/Encashment**: Background `#DC2626`, text `#FFFFFF`. Hover `#B91C1C`.
- **Dimensions**: Default button height is compact at `36px` (padding `0 14px`) to preserve vertical screen efficiency.

### Status Badges & Chips
- Non-pill, rectangular with subtle `4px` corner radius.
- Padding: `2px 8px`, typography: `11px`, weight 600, uppercase letter-spacing `0.04em`.
- Composition: Solid `1px` border matching the status color at 30% alpha, filled with 10% alpha background tint, text in full-saturation status color (e.g., Pending: border `#D977064D`, background `#FEF7EC`, text `#D97706`).

### Input Fields & Controls
- **Height**: Standardized `36px` matching action buttons.
- **Border**: `1px solid #E2E7ED`, background `#FFFFFF`, text `#202B38`.
- **Focus**: `1px solid #142B49` with a crisp `2px` focus ring offset at `rgba(20, 43, 73, 0.15)`. No blurry glows.
- **Labels**: Top-aligned, 12px weight 500, secondary text color `#667085`.

### Structured Financial Tables
- **Header**: Height `38px`, background `#F8FAFC`, border-bottom `1px solid #E2E7ED`, uppercase text in `11px` weight 600 `#667085`.
- **Rows**: Alternating hover fill `#F8FAFC`, height `48px`, border-bottom `1px solid #E2E7ED`.
- **Numerical Alignment**: Monetary amounts right-aligned with tabular numbers enabled; dates and statuses center-aligned; institution metadata left-aligned.

### Checkboxes & Radios
- Square 16px dimensions with a 2px border radius.
- Unchecked: `1.5px solid #CBD5E1`, background `#FFFFFF`.
- Checked: `#142B49` fill with an accessible pure-white checkmark icon.

### Breadcrumb Navigation
- Sits immediately beneath the utility header.
- Text: 12px medium weight. Separator: forward slash `/` in `#94A3B8`. Terminal breadcrumb (active page) rendered in bold `#202B38`.

### Split Comparison Verification Panels
- Dual-column workspace dividing digital submission data from uploaded bank FDR PDFs/scans.
- Synchronized scroll locks, metadata pin toggles, and unified "Approve / Reject FDR" compliance bottom bar fixed across the screen bottom.