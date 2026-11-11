# RaelInfo — Cloudflare Pages + D1 + Supabase Auth

RaelInfo is a responsive financial utility application for U.S./Canadian calculations, market data, public-company filings, and an optional user portfolio.

## Production architecture

- **GitHub**: source control and automatic deployment trigger.
- **Cloudflare Pages**: static website in `public/` plus server-side Pages Functions in the repository-root `functions/` directory.
- **Cloudflare D1**: user profile records, portfolio positions, provider response cache, and hashed rate-limit buckets.
- **Supabase Auth (Free plan)**: email/password identity, password hashing, email confirmation, and refreshable authentication sessions. This avoids running expensive password-hashing loops inside the Cloudflare Workers Free CPU budget.

Passwords and Supabase session tokens are not stored in D1. Supabase Auth manages credentials and sessions; the Pages Functions keep access and refresh tokens in `HttpOnly` cookies. The browser receives a separate CSRF token for state-changing requests. D1 stores each user's own portfolio rows keyed by the Supabase Auth user ID.

## Repository layout

```text
functions/                  Cloudflare Pages Functions (server-side API)
functions-shared/           Shared server-side helpers (not public assets)
migrations/                 D1 SQL migrations
public/                     Pages build output / public website
  _routes.json              Invokes Functions only for /api/*
  index.html
  login.html
  app.js
  portfolio.js
  ...
server.js                   Optional local Node/Express development server
config.js                   Local Node/Express configuration
.env.example                Local-only sample settings (no secrets)
.dev.vars.example           Local Wrangler Functions sample (no secrets)
```

The Pages build configuration must remain:

- Project: `raelinfo`
- Production branch: `main`
- Root directory: `/`
- Build command: blank
- Build output directory: `public`

The `functions/` folder must be at the repository root, alongside `public/`. Do not place it inside `public/`.

## 1. Create and configure Supabase Auth

Create a free Supabase project at https://supabase.com/dashboard.

In **Project Settings → API Keys**, copy:

- Project URL → `SUPABASE_URL`
- Publishable API key (`sb_publishable_...`) → `SUPABASE_PUBLISHABLE_KEY` (a legacy `anon` key also works)
- Secret API key (`sb_secret_...`) → `SUPABASE_SECRET_KEY` (optional; enables self-service account deletion)

The secret key bypasses Supabase Row Level Security. Store it only as a Cloudflare Secret; never put it in browser code, GitHub, or `.env.example`. The legacy `service_role` key is accepted as a compatibility fallback, but Supabase is moving projects to publishable/secret keys.

In **Authentication → URL Configuration**:

- Site URL: `https://raelinfo.pages.dev`
- Redirect URL allowlist: `https://raelinfo.pages.dev/login.html`

Under **Authentication → Providers → Email**, make sure email/password signups are enabled and keep email confirmation enabled. If testing locally with Wrangler, also allow `http://localhost:8788/login.html` as a redirect URL.

Later, after the custom domain is moved to Cloudflare, add `https://raelinfo.com/login.html` to the redirect allowlist and change the Site URL as appropriate.

Keep email confirmation enabled for production. New users will receive a confirmation email, then return to the login page. Supabase's default email sender has strict rate limits; configure a reputable SMTP provider before inviting many users. The Supabase Free plan currently includes 50,000 monthly active users, but inactive Free projects can pause after seven days with insufficient database activity.

## 2. Apply the D1 schema

The Cloudflare Pages project already has a D1 binding named `DB` pointing to `raelinfo-production`.

From the repository root on Windows PowerShell, authenticate Wrangler and apply the migration to the **remote production database**:

```powershell
npx wrangler@latest login
npx wrangler@latest d1 migrations list raelinfo-production --remote
npx wrangler@latest d1 migrations apply raelinfo-production --remote
```

Confirm the CLI asks to apply `migrations/0001_initial.sql` to `raelinfo-production` and approve it. Do not use `--local` for production. The migration creates `users`, `portfolio_positions`, `provider_cache`, and `rate_limits` tables. It intentionally does not create a D1 `sessions` table because Supabase Auth owns credentials and sessions.

## 3. Add Cloudflare Pages production variables/secrets

Open **Cloudflare Dashboard → Workers & Pages → raelinfo → Settings → Variables and Secrets**. Add these to the **Production** environment:

| Name | Type | Required | Value |
|---|---|---:|---|
| `SUPABASE_URL` | Variable | Yes | Your Supabase project URL |
| `SUPABASE_PUBLISHABLE_KEY` | Secret or Variable | Yes | Supabase publishable/anon key |
| `APP_ORIGIN` | Variable | Yes | `https://raelinfo.pages.dev/login.html` initially |
| `SEC_USER_AGENT` | Variable | For SEC | `RaelInfo/3.0 contact=YOUR-MONITORED-EMAIL@example.com` |
| `SUPABASE_SECRET_KEY` | Secret | Optional | Supabase secret API key (`sb_secret_...`); only for account deletion. A legacy service_role key is accepted as a fallback. |
| `ALPHA_VANTAGE_KEY` | Secret | Optional | Stock provider key; confirm public display rights first |
| `FMP_KEY` | Secret | Optional | Stock provider key; confirm public display rights first |
| `EODHD_KEY` | Secret | Optional | Stock provider key; confirm public display rights first |
| `STOCK_PROVIDER_ORDER` | Variable | Optional | `alpha,fmp,eod` |

Do not add `.env` or `.dev.vars` to GitHub. `SUPABASE_SECRET_KEY` must be stored as a Cloudflare Secret, not a plain-text variable.

## 4. Deploy Functions

Commit and push the new `functions/`, `functions-shared/`, and `migrations/` directories and updated frontend files to GitHub `main`. Cloudflare Pages should build automatically. In the deployment log, the previous message `No Functions dir found` should disappear. The new `public/_routes.json` limits Functions execution to `/api/*`, so static files continue to be served as assets.

## 5. Smoke tests

After deployment, open these URLs on the Pages preview:

- `/api/health` — should return `ok: true`, `database: true`, and `providers.auth: true`.
- `/api/crypto` — CoinLore prices (BTC, ETH, SOL).
- `/api/fx?from=USD&to=CAD` — daily reference rate from Frankfurter.
- `/api/news?q=stock%20market` — official SEC, Federal Reserve and Bank of Canada financial announcements, filtered locally.
- `/api/filings?cik=320193` — SEC submissions, after `SEC_USER_AGENT` is configured.
- `/login.html` — email registration/sign-in via Supabase Auth.

Create a test account using an email you control, confirm the email, sign in, add a portfolio position, reload the page, and confirm it remains saved. Test with two accounts to confirm that each sees only its own portfolio. Test sign-out. Test account deletion only after the optional `SUPABASE_SECRET_KEY` Cloudflare Secret is configured.

## 6. Local development

The legacy Node/Express server remains available for local development and uses a local JSON user store. Production Cloudflare Pages Functions use Supabase Auth and D1. These are separate local/production auth implementations; do not copy local `data/users.json` into production.

For local Node development:

```powershell
Copy-Item .env.example .env
npm install
npm start
```

For local Pages Functions development, copy `.dev.vars.example` to `.dev.vars`, fill in test Supabase values, and add `http://localhost:8788/login.html` to the Supabase redirect allowlist. Get the D1 database ID from the Cloudflare D1 dashboard (or run `npx wrangler@latest d1 info raelinfo-production`). Then run the Pages dev server with a local D1 simulation:

```powershell
npx wrangler@latest pages dev public --d1 DB=YOUR-D1-DATABASE-ID
```

Wrangler uses local persisted D1 state by default; this command does not point local development at production data. Use a separate test database for local/preview work whenever possible. Do not casually run production migrations against a local database or vice versa.

## 7. Security and operational notes

- Use Supabase email confirmation and keep the project URL allowlist narrow.
- `SUPABASE_SECRET_KEY` bypasses Supabase Row Level Security; it is optional and used only by the account deletion handler. Store it as a Cloudflare Secret and never expose it to browsers. The account-deletion control stays hidden until this key is configured. The legacy `service_role` key is supported only as a compatibility fallback.
- D1 uses parameterized prepared statements for user data. Portfolio queries always filter by the authenticated Supabase user ID.
- Rate-limit buckets store a one-way hash of the connecting IP, not the raw IP.
- Provider responses are cached in D1 to reduce third-party calls. SEC requests require an honest monitored contact email and remain subject to SEC fair-access limits.
- Stock provider free plans may prohibit public redistribution or commercial display. Do not expose stock quotes until the provider's terms grant the necessary rights.
- This application is an educational planning tool, not a bank, brokerage, financial adviser, or encrypted financial vault. Do not ask users to enter bank passwords, brokerage credentials, or highly sensitive personal identifiers.
- The application has not been penetration-tested. Complete the smoke tests, verify authentication behavior and review privacy/terms language before accepting real users or promoting it as production financial software.


## Revenue features (v3.2)

This release adds a progressive, approval-first revenue foundation:

- Contextual partner recommendations by selected market (`US` / `CA`), calculator category and currency.
- `PARTNER_OFFERS_JSON` configuration with allowlisted markets/categories, HTTPS destinations and two explicit approval switches (`active` and `approved`). It defaults to `[]`; no partner links are enabled by default.
- First-party affiliate click redirects and aggregate daily calculator/scenario/print event counts in D1. No calculator amounts, account IDs or portfolio holdings are sent in these event records.
- An owner-only dashboard at `/admin/revenue.html`, protected by a server-side `RAELINFO_ADMIN_TOKEN` secret, to review aggregate clicks, manually reconcile affiliate-network conversions, Pro interest and partnership inquiries.
- A public B2B partnership inquiry page at `/partners.html`; form submission is disabled by default until the operator publishes contact/retention details and sets `PARTNER_INQUIRIES_ENABLED=true`.
- A voluntary RaelInfo Pro interest list. This is not a paid subscription and no billing or marketing-email system is implemented.
- Four standalone SEO calculator pages for mortgage, compound interest, debt payoff and USD/CAD.

Before using revenue features, apply `migrations/0002_revenue.sql` to the existing D1 database and follow the **Revenue phase** instructions in `CLOUDFLARE-BACKEND-SETUP.md`. Keep `PARTNER_OFFERS_JSON=[]` until a partner has approved RaelInfo and provided an authorized tracking URL. Generate `RAELINFO_ADMIN_TOKEN` locally and add it as a Cloudflare Production Secret; never commit the value.

Potential partner applications (approval is not guaranteed): Wise Website Partnerships: https://wise.com/gb/affiliate-program/ ; Wealthsimple Affiliate Guidelines: https://www.wealthsimple.com/en-ca/legal/affiliate-guidelines . Confirm market eligibility and the exact permitted placement with each program before enabling an offer. Wealthsimple's referral terms cited in its current program are for eligible Canadian residents; do not offer it in the US without explicit written authorization.

Enable free Cloudflare Web Analytics in Workers & Pages → `raelinfo` → Metrics → Web Analytics. Google AdSense, paid subscriptions, payment processing and automatic affiliate conversion imports are not included; apply to ad/affiliate programs first and add billing only after demand and legal/tax review. The owner dashboard is a manual ledger, not a bank balance or guaranteed income report.
