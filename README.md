# Pennyplan · CVS coupon & trip planner

A usable, account-free personal couponing app built with Next.js App Router, TypeScript, React, Tailwind CSS, Zod, and React Hook Form. Track products and coupons, protect spend deals, roll ExtraBucks, compare substitutions, and keep a shopping history. Data stays in the browser; export JSON backups to keep it safe.

## Run locally

Use Node.js 24 (Node 22.9+ also meets Next.js requirements).

```sh
npm install
npm run dev
```

Open http://localhost:3000. No environment variables or database are required. The app starts with an empty workspace: no mock trips, products, coupons, or rewards. Unchanged sample trips from the first release are hidden automatically; customized and completed trips are preserved.

```sh
npm test
npm run typecheck
npm run lint
npm run build
npm start
```

## Deploy on Vercel

[Import this repository into Vercel](https://vercel.com/new/import?s=https%3A%2F%2Fgithub.com%2Farcthh%2FcvsApp)

1. Sign in to Vercel and import `arcthh/cvsApp` from GitHub.
2. Select **Next.js**, leave the root directory at the repository root, and use the default install/build commands (`npm install`, `npm run build`).
3. Select Node.js 24 if offered; no environment variables are necessary.
4. Deploy. Future pushes to `main` trigger production deployments when Git integration is enabled.

Alternatively, authenticate the Vercel CLI and run `npx vercel --prod` in this repository. A Vercel account/project connection is required to create the hosted deployment.

## What is included

- Dashboard with planned retail, discounts, cash, rewards, coupons, groups, and recent trips.
- Editable products, optional sale prices, quantities, categories, image URLs, and notes.
- Coupon inventory with search, expiration/status/category/type filters, and trip attachment.
- Manufacturer, digital, CRT, dollar, percent, BOGO, spend/save, spend/reward, quantity/reward, and custom fixed-value offers.
- Deal groups with required coupons, spend/quantity thresholds, rewards, discounts, and transaction locks.
- Manual transaction assignment, naming, reordering, and ExtraBucks redemption caps.
- Deterministic optimizer with five modes and transparent recommendations, run in a Web Worker.
- ExtraBucks wallet with expiration, planned/available/partial/used statuses and a usage ledger.
- Scenario duplication, product substitutions, comparison tables, and calculation access.
- Beginner transaction instructions, responsive mobile cards, recorded trip history, lifetime totals.
- Validated localStorage persistence and JSON backup import/export. No external product images are fetched.
- Calculation and optimization unit tests; GitHub Actions runs tests, types, lint, and build.

## How to use it

1. Create a trip and enter its settings, starting rewards, date, and estimated tax rate.
2. Add products and attach trip coupons (or select saved inventory coupons).
3. Create deal groups to protect thresholds. Enter each discount/reward once, either in a coupon or group.
4. Assign product lines to transactions. Locked group splits are rejected; saving a locked group consolidates overlapping transactions safely.
5. Optimize, inspect the proposed order and totals, then apply it. You can still reorder manually.
6. Create a scenario to try substitutions and compare results. Its name field opens empty and focused; type a name and press Enter or click away to save. Click any trip/scenario title to rename it directly.
7. After shopping, record the plan as completed to snapshot the estimates, consume attached inventory coupon uses, and update linked wallet rewards. Enter earned reward expiration dates from the receipt.

Wallet balances and manually typed trip starting balances are separate. **Use current wallet balance** links the eligible wallet rewards for the trip's shopping date. Refresh it before recording if another completed trip has consumed those rewards. A recorded trip is read-only; create a scenario to reuse it. History records the displayed estimates, not actual receipts.

## Calculation rules

All stored monetary values are integer cents. Money inputs allow at most two decimal places. Percentage discounts and estimated transaction taxes round to the nearest cent.

- Product subtotal = quantity × (sale price, when supplied, otherwise retail price).
- BOGO pairs units from most expensive to least expensive and discounts the cheaper unit of each pair. An unpaired unit pays full price. BOGO 40% on two $4.69 items discounts $1.88; BOGO 50% on two $3.79 items discounts $1.90.
- Promotions apply first, then manufacturer/store dollar coupons, then percentage coupons. Percentage coupons operate on the remaining eligible subtotal. Threshold coupon spend uses the sale subtotal **before coupons**; group thresholds can use before- or after-coupon spend.
- Eligible filters combine explicit product IDs, brand, category, and optional sale exclusion. One coupon record applies once per transaction up to its available uses; a dollar coupon value is a total discount, not a per-unit discount. Coupon minimum quantities determine eligible unit counts.
- Discounts cap at the remaining value of their eligible products. Allocation uses product line order; shared discounts and EB are assigned sequentially to eligible lines, and per-product effective unit cost rounds for display. This does not change transaction totals.
- Manufacturer stacking reserves at least one unit, or the coupon's minimum quantity, and prevents reuse of that unit by another manufacturer coupon. A digital manufacturer coupon must still use the **manufacturer** stacking class. Complex store-specific stacking rules need manual verification.
- Group qualification requires its complete product list in the transaction, its quantity/spend requirements, and its required coupon (if configured). Rewards are not inferred from product names. Cross-transaction cumulative spend offers are not modeled.
- ExtraBucks use = minimum of eligible remaining subtotal, available balance, and an optional user cap. Ineligible products can be excluded. ExtraBucks cannot pay the estimated tax.
- Cash = after-coupon subtotal − ExtraBucks used + estimated tax. Rewards earned become available **after** payment, never in that same transaction. Balances and payments cannot go negative.
- Tax is configurable from 0–25%, using sale subtotal, after-coupon subtotal, or after-EB subtotal. Default zero means tax has not been estimated; choose your actual basis/rate.
- Effective net cost = cash paid + ExtraBucks used − ExtraBucks earned. This accounts for the value of previously owned rewards; it is not just cash minus newly earned rewards.
- History savings % = (retail value − cash paid) / retail value. The lifetime average is the arithmetic mean of completed trips' savings percentages.

Reward amounts are treated as divisible balances, as requested by the partial-use wallet model. The app does **not** simulate individual certificate forfeiture, redemption denomination rules, returns, historical offer limits, automatic CVS 98% threshold tolerance, complex percent-off exclusions, or cash rebates. Adjust estimates for actual offer/receipt terms. The app does not scrape CVS, guarantee coupon acceptance, or auto-select replacement products.

## Optimizer

`src/services/optimizer.ts` is independent of the UI and persistence:

1. Union overlapping deal groups and threshold/quantity/BOGO coupon dependencies into protected product blocks.
2. Evaluate every block ordering for up to seven blocks; above seven use a deterministic beam search retaining up to 80 partial orders at each depth.
3. Simulate complete orders using the shared calculation engine and available reward balance.
4. Also compare adjacent pair merges and one all-items transaction. Merge partitions are sampled, not searched exhaustively.
5. Try splitting independent product quantities (up to six units per line and fourteen resulting product lines) only when no deal or coupon depends on them; retain a split only if it improves the selected score.
6. Score using the selected mode: total cash; maximum single cash payment; rewards earned; ending rewards; or balanced cash + one quarter of maximum payment. Tie breaks prefer smaller cash/reward balances and payments. Fixed reward totals can make some modes return the same order.

An "every ordering checked" result proves only the best ordering of its protected blocks under the model and greedy allowed EB redemption. It is **not** a proof of a global optimum over all possible product splits, merge partitions, coupon assignments, certificate denominations, and redemption amounts. The UI says when the heuristic search is used and explains the resulting totals. The worker keeps larger searches from blocking form interactions.

## Architecture and future database integration

```text
src/app/                  App Router shell, routes, global Tailwind/CSS design
src/components/app.tsx    App navigation and page interactions
src/components/forms.tsx  React Hook Form editors, validated with Zod
src/components/ui.tsx     Summary, transaction, deal, threshold and badge components
src/lib/models.ts         Versioned domain models and Zod schemas
src/lib/money.ts          Cent conversion, formatting, dates and identifiers
src/lib/seed.ts           Empty initial state and blank trips
src/services/calculations.ts  Pure financial and eligibility functions
src/services/optimizer.ts     Deterministic search and grouping
src/services/optimizer.worker.ts  Background worker adapter
src/services/storage.ts       StateRepository + localStorage adapter
 tests/                       Calculation and optimization fixtures
```

Replace `StateRepository` with an authenticated API adapter to add Supabase/Postgres later. Persist versioned trips, product/coupon/group entities, scenario relationships, transaction assignments, reward ledger entries, and completion snapshots under a user ID. Keep server credentials private, implement row-level authorization, and perform server-side schema validation. Financial and optimizer services do not depend on browser storage.

LocalStorage is per browser and origin; it is not cross-device synchronization. Importing a valid backup replaces the current collection. Storage failures are reported; a malformed saved payload is preserved until the user explicitly saves changes, and the original backup can be exported.

Independent planner; not affiliated with CVS.
