# CLAUDE.md

## System

**Personalized Milestone Basket Engine** — tailored for infant & toddler retail (Shilav style).

The system takes a customer profile (baby age in months, past purchases, location) and produces a
personalized product basket: the items this baby needs *next*, based on developmental milestones,
the current season/weather, and what the parent has not bought yet.

## Language & UI

- **Modern Hebrew** throughout the interface. All user-facing strings are Hebrew — no English labels
  in the UI.
- `dir="rtl"` on the root `<html>` element; layouts, icons, and animations must respect RTL
  (use logical CSS properties — `ms-*` / `me-*` / `ps-*` / `pe-*` — never `ml-*` / `mr-*`).
- **Pastel warm Shilav colors** — soft peach, cream, dusty pink, warm sand, muted mint. No harsh
  saturated primaries. Rounded corners, generous whitespace, gentle shadows.
- **Mobile-first** design. Build the small-breakpoint layout first, then enhance upward with
  `sm:` / `md:` / `lg:`.
- Icons come from `lucide-react`. Class composition uses `clsx` + `tailwind-merge`.

## Core Architecture

### `lib/types.ts`

TypeScript interfaces shared by every layer. No logic, no data — types only.

- `Product` — a catalog item (category, age range in months, season, price, stock).
- `CustomerProfile` — a parent + their baby (baby age in months, city, preferences).
- `PurchaseHistory` — what a given customer already bought, and when.
- `MilestoneRule` — a developmental stage and the item categories it requires.
- `GeneratedBasket` — the engine's output: chosen products, per-item reasoning, total price.

### `lib/mockData.ts`

28 realistic Shilav products spanning the 0–36m stages, plus 6 customer profiles with past
purchases. Hebrew product names and descriptions. Categories include clothing, onesies (בגדי גוף),
footies (אוברולים), crawling pants, sleep sacks (שקי שינה), and weaning feeding sets.
This is the single source of truth for demo data — the engine reads from here.

### `lib/engine.ts`

The core **gap-analysis algorithm**. Given a `CustomerProfile`, it:

1. Resolves the baby's current + upcoming milestone stage from age in months.
2. Expands that stage into a **milestone checklist** of required item categories (`MilestoneRule`).
3. Subtracts what the customer already owns (`PurchaseHistory`) → the **gaps**.
4. Filters candidate products by age range, season/weather, and stock.
5. Scores and ranks the remainder, returning a `GeneratedBasket` with a Hebrew reason per item.

Rules: pure functions, no I/O, fully deterministic — the same profile must always yield the same
basket so the demo is reproducible.

### `lib/campaignEngine.ts`

Builds every outbound campaign proposal, in **two separate streams**:

1. **Lifecycle (primary, high volume)** — the routine business case, and the default tab in
   the console. A parent enters the funnel once they have gone quiet for 2.5+ months; they are
   then segmented by what changed: a size jump on the growth index, a season turning, or
   neither. Copy is a **template** (`{{parentName}}`, `{{babyName}}`, `{{nextSize}}`, …) so one
   approval covers a whole segment while each parent still gets their own baby's details;
   `renderCampaignMessage` resolves it per recipient.
2. **Anomaly (secondary, reactive)** — cold snaps, heatwaves and surplus stock. Each city is
   compared against its own 7-day average. This stream is deliberately kept in its own queue so
   it can never crowd out the routine milestone work.

Audience projections (`estimatedReach`, `projectedRevenue`) are **estimates** scaled from the
seeded sample by the documented `PROJECTION` constants — not measured figures. Swap them for a
real CRM count before trusting them.

Every detection creates a **pending campaign** (never auto-sends) for a human to approve.

## Conventions

- App Router (`app/`), TypeScript strict, no `src/` directory.
- Import alias `@/*` maps to the project root — e.g. `import { Product } from '@/lib/types'`.
- Business logic lives in `lib/`; `app/` holds routing and presentation only.
- Prices are in ILS (₪) as plain numbers; format at the display layer.
- Ages are always expressed in **months** as integers.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
