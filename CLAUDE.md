# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Hebennus — e-commerce SPA for an oversize/athletic clothing brand (Lima, Perú). Vue 3 + Vite frontend, Supabase backend (Postgres + Auth + Storage + Edge Functions), Resend for transactional email, Izipay (Lyra/krypton) as the card/Yape payment gateway. Deployed on Vercel.

**The codebase — code, comments, UI copy, commit messages — is in Spanish.** Match that when editing.

## Commands

```bash
npm run dev        # Vite dev server → http://localhost:5173
npm run build      # production build → dist/ (sourcemaps off), then generates dist/sitemap.xml
npm run preview    # serve dist/ locally

# Backend (Supabase) — requires the CLI (installed as a devDependency, use npx):
npx supabase db push                          # apply migrations in supabase/migrations/
npx supabase functions deploy <name>          # deploy one Edge Function
npx supabase secrets set KEY=value            # set a server-side secret
```

There is **no test runner and no linter** configured. Do not invent `npm test`/`npm run lint`.

`build` runs `scripts/gen-sitemap.mjs` after `vite build`: it queries active products from Supabase and writes `dist/sitemap.xml`. By design it **never fails the build** (any error → `console.warn` + exit 0), so a missing/unreachable Supabase just yields a sitemap with only static routes.

Backend changes require both a `db push` (schema/RPCs/RLS) and a `functions deploy` (server logic) — they are separate deploy steps. See `supabase/PRODUCTION_DEPLOYMENT.md` for the exact prod checklist (including which functions must stay **absent** from prod).

## Security model (read before touching data access)

The anon key is **public by design**; the real security boundary is **Row Level Security (RLS)** in Postgres. Never put the `service_role` key in frontend code.

- **Reads** happen directly from the browser: `supabase.from('products').select('*, product_variants(*)')`. RLS restricts this to `is_active = true` catalog rows. This is why `.env` with the anon key is safe to ship.
- **Sensitive writes** go through Edge Functions that hold the `service_role` key server-side (`supabase/functions/`). They validate inputs (e.g. `create-order` re-reads prices from the DB and never trusts the browser's `unit_price`).
- **Admin** is gated by the `is_admin()` RPC (checks the `admins` table). Admin writes are a mix of direct `supabase.from(...)` calls (allowed by `..._admin_*` RLS policies that call `is_admin()`) and `SECURITY DEFINER` RPCs (`create_product`, `admin_set_order_status`, `admin_marcar_pagado`).

## Architecture

**Frontend** (`src/`, Vue 3 `<script setup>`):
- `main.js` — mounts the app, registers `@unhead/vue` (per-page `<head>`/SEO) and the global `v-reveal` directive (fade-up-on-scroll; `.stagger` modifier reveals children in sequence).
- `router/index.js` — vue-router in **history mode** (clean URLs; `vercel.json` rewrites all routes to `index.html` so `/admin` etc. don't 404 on reload). Home/Colección/Producto/404 are eager; everything else is lazy (Checkout pulls in the heavy Izipay SDK). `/admin` has a `requiresAdmin` guard using `useAuth` (it waits for `auth.ready` before deciding). Customer-facing account routes: `/cuenta` (login/registro), `/mis-pedidos`, `/privacidad`.
- `App.vue` — owns the **cart** (persisted to `localStorage` key `hebennus-cart`, strictly validated/sanitized on load via `isValidItem`/`sanitizeCart`, synced across tabs via the `storage` event). Cart ops are exposed with `provide`/`inject` (`addToCart`, `openQuickBuy`, `cart`, `clearCart`) — child pages inject rather than emit. The store chrome (nav/footer/cart/toast) is hidden on `/admin`.

**`src/lib/`** — singletons and helpers:
- `supabase.js` — the single Supabase client. `config.js` — store constants (shipping thresholds, drop date, social handles) + reads `VITE_*` env.
- `useAuth.js` — **global auth singleton** (`user`/`isAdmin`/`ready`) covering **both customer accounts and admin**: exposes `signUp`/`signIn`/`signInWithGoogle` (Google OAuth, gated by `VITE_GOOGLE_OAUTH_ENABLED`), email-code verification, and password reset. `isAdmin` is true only if the user is in the `admins` table (via the `is_admin()` RPC). ⚠️ Never `await` inside the `onAuthStateChange` callback — awaiting anything that calls `getSession()` (e.g. `rpc`) deadlocks gotrue-js's internal lock (symptom: "Guardando…" hangs forever). `checkAdmin()` is deliberately deferred with `setTimeout(…, 0)`. `signOut()` also calls `purgeSupabaseTokens()` as a safety net.
- `useTheme.js` — light/dark theme with persistence. `useSeo.js` — per-page `<head>`/SEO helpers over `@unhead/vue`. `useModal.js` — modal/scroll-lock helper. `validation.js` — shared client-side input validation. `soporte.js`/`reclamos.js` — support-ticket ("reclamos") client logic. `adminErrors.js` — admin error normalization/messages.
- `order.js` — `createOrder()` invokes the `create-order` Edge Function. In DEV, if the function is unreachable it returns a stub (`HB-DEV001`); real backend errors always propagate.
- `izipay.js` — mounts the krypton embedded payment form. Credentials never touch the browser: the `formToken` + public key come from the `izipay-formtoken` Edge Function. `KR` is a global singleton — `removeForms()` before re-mounting, and handlers are re-registered on every mount (krypton replaces, not stacks). The `izipay-validate` call verifies the signed response but the **IPN is the source of truth**.
- `pedidos.js` — single source for order-status values/labels/colors (`ESTADOS`, must match `orders.status`). `storage.js` — client-side image compression (resize ≤1400px, WebP ~0.82) before upload to the public `product-images` bucket, keeping cost at $0 (no paid Supabase image transforms). `prendas.js` — derives body zone (upper/low) from `tipo_prenda`.

**Backend** (`supabase/`):
- `functions/create-order/` — validates payload + prices, applies shipping and the first-order 10% welcome discount server-side, inserts atomically via the `create_order` RPC, records marketing consent, sends confirmation email (Resend). **Payment-method-aware:** `contraentrega` (default) decrements stock + emails immediately; `izipay` and `yape_manual` set `defer_stock=true` → order stays `pendiente`, stock is NOT decremented, and no confirmation email is sent here.
- `functions/izipay-*` — `izipay-formtoken` (create session token for a real pending order), `izipay-validate` (HMAC-verify + durably persist the browser callback), `izipay-ipn` (server-to-server notification, durably persisted before confirmation). Both call `process_izipay_payment_event`, which validates amount/currency/shop/method/transaction and records exact per-item inventory movements. ⚠️ `izipay-token` and `izipay-formtoken-test` still exist on disk as **DEV-only test scaffolding** for the admin "Tests de pago" tab (`AdminPaymentTests.vue`, rendered only under `import.meta.env.DEV`). They must **never be deployed to production** — `supabase/PRODUCTION_DEPLOYMENT.md` treats their absence as a requirement.
- `functions/track-product-view` — rate-limited public entrypoint for product analytics; the underlying RPC is service-role only.
- `functions/create-ticket` — public support/"reclamos" intake (backs `SoporteWidget.vue`; managed in `/admin` → Reclamos). `functions/baja-marketing` — one-click marketing unsubscribe. `functions/admin-enviar-campana` (send marketing campaign), `admin-notificar-envio` (shipping-notification email), `admin-delete-user`, `check-email`. `_shared/` holds `email.ts` (HTML builders) and `hmac.ts`.
- `migrations/` — timestamped, **idempotent** (`create if not exists`, `create or replace`, `pg_policies` guards) so they're safe to re-run against prod. Order status values live in `pedidos.js` on the frontend and must stay in sync with the DB.

**SEO / social previews** (`api/producto-preview.js`): a **Vercel Edge Function** (not a Supabase function — plain Web APIs, no npm deps). Crawlers (WhatsApp, `facebookexternalhit`, Twitterbot…) don't run JS, so they'd only see the static shell. `vercel.json` rewrites `/producto/:slug` → `/api/producto-preview?slug=:slug`; the function fetches the product from Supabase REST and rewrites the existing `<title>`/OG/Twitter/canonical tags **in place** inside the same `index.html` shell (never appends duplicates). It is written to **never 500** — any failure falls back to the shell or a minimal HTML. Regular users still get the normal SPA via the catch-all `/(.*)` → `/index.html` rewrite.

## Payment / order flow

Three `payment_method` values: `contraentrega` (cash on delivery, default), `yape_manual` (coordinated via WhatsApp, confirmed by the owner in `/admin` → `admin_marcar_pagado`), `izipay` (card/Yape, auto-confirmed by the IPN). For the two deferred methods, **stock is only decremented once payment is confirmed** — creating an order does not reserve stock for them.

## Product image model (see also user memory)

- `card_images` — photos shown on catalog cards (independent).
- `images` — the gallery on the product detail page.
- `images_by_color` — **DEPRECATED**, do not build on it.

Product grid must stay **3 columns desktop / 2 tablet & mobile** (never 4); cards are intentionally large.

## Env vars

Frontend (`.env`, git-ignored; see `.env.example`): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_WHATSAPP_NUMERO`, `VITE_IZIPAY_ENABLED`, `VITE_GOOGLE_OAUTH_ENABLED`. Server secrets (Edge Functions, set via `supabase secrets set`): `RESEND_API_KEY`, `RESEND_FROM`, `STORE_EMAIL`, and the Izipay set — `IZIPAY_USERNAME`, `IZIPAY_PASSWORD`, `IZIPAY_PUBLIC_KEY`, `IZIPAY_HMAC`, and optionally `IZIPAY_SHOP_ID`, `IZIPAY_ALLOWED_PAYMENT_METHODS`, `ALLOWED_ORIGINS`. `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` are injected automatically by Supabase.

## Deploy

Vercel: build `npm run build`, output `dist/`, SPA rewrites + security headers in `vercel.json`. The CSP is intentionally shipped as `Content-Security-Policy-Report-Only` (not enforced) so it can be validated in prod without breaking the Izipay/krypton checkout — flip the header key to `Content-Security-Policy` once reports are clean. `.github/workflows/keep-warm.yml` pings the Supabase REST API twice daily to keep the free-tier project from auto-pausing after ~7 days of inactivity.
