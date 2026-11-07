# RaelInfo — Cloudflare Pages Functions + D1 + Supabase Auth setup

This is an overlay update for the existing RaelInfo repository. It preserves existing GitHub-only files such as `CNAME`, `LICENSE`, and `og-card.png`.

## What this update adds

- Cloudflare Pages Functions under the repository-root `functions/` directory.
- Shared server-side helpers in `functions-shared/`.
- D1 migration `migrations/0001_initial.sql`.
- `public/_routes.json` so Pages Functions run only on `/api/*`; the rest of the site remains static assets.
- Supabase Auth integration for email/password registration, email confirmation, sign-in, refreshable sessions and sign-out.
- D1-backed user profile and portfolio storage, provider-response cache and request rate-limit buckets.
- API routes for health, crypto, FX, stock quotes, business news, SEC filings, authentication and portfolio management.
- Updated frontend login and portfolio calls.

Supabase Auth manages passwords and sessions. D1 stores the RaelInfo user profile and portfolio data. There is intentionally no D1 sessions table.

## 1. Apply the overlay to your local Windows project

Download `RaelInfo-Cloudflare-Backend-Update.zip`, then open PowerShell:

```powershell
Set-Location "C:\Users\d139c\FamBot\SimonSays\Dig\RI"
Expand-Archive -Path "$HOME\Downloads\RaelInfo-Cloudflare-Backend-Update.zip" -DestinationPath . -Force
```

This extracts the new/updated files into the existing repository. It does not contain or replace your `.env`, `.dev.vars`, `data/users.json`, `CNAME`, `LICENSE`, or `og-card.png`.

Run the local syntax checks:

```powershell
npm run check
```

The current `.gitignore` excludes `.env`, `.dev.vars`, private JSON data, local databases, certificates and `node_modules`.

Before staging, verify secrets are ignored and not tracked:

```powershell
git check-ignore -v .env .dev.vars data/users.json
git ls-files -- .env .dev.vars data/users.json
git status --short
```

The first command should show ignore rules. The second command should print nothing. Review `git status --short`; do not stage real credentials or private user data.

## 2. Create a Supabase project for authentication

Create a Free project at https://supabase.com/dashboard.

In **Project Settings → API Keys** (wording may vary slightly):

- Copy the Project URL for `SUPABASE_URL`.
- Copy the Publishable key (`sb_publishable_...`) for `SUPABASE_PUBLISHABLE_KEY`.
- Optionally copy the Secret key (`sb_secret_...`) for `SUPABASE_SECRET_KEY`; this enables self-service account deletion. Do not expose it in frontend code or commit it.

In **Authentication → URL Configuration**:

- Site URL: `https://raelinfo.pages.dev`
- Add redirect URL: `https://raelinfo.pages.dev/login.html`

In **Authentication → Providers → Email**, enable email/password sign-ups and keep email confirmation enabled. New users must confirm their address before signing in if confirmation is enabled.

The default Supabase email sender has strict rate limits. It is acceptable for initial low-volume testing, but configure a supported SMTP provider before inviting a larger audience.

**Free-plan caveat:** Supabase Free currently has usage limits and inactive projects can be paused after a period of inactivity. It is suitable for initial testing and low-volume experimentation, but do not promise uninterrupted production availability without monitoring and a recovery plan.

## 3. Apply the D1 database schema to the remote database

The Cloudflare Pages project already has a D1 binding named `DB` pointing to `raelinfo-production`. Do not create another binding.

From the local repository root:

```powershell
npx wrangler@latest login
npx wrangler@latest d1 migrations list raelinfo-production --remote
npx wrangler@latest d1 migrations apply raelinfo-production --remote
```

Review the database name carefully and approve applying `migrations/0001_initial.sql` to `raelinfo-production`.

The migration creates:

- `users`
- `portfolio_positions`
- `provider_cache`
- `rate_limits`

Supabase Auth owns user credentials and sessions, so D1 does not store passwords or session tokens.

## 4. Commit and push the backend update to GitHub

After extracting the overlay and reviewing `git status`:

```powershell
git add -A
git diff --cached --check
```

Inspect the staged file list. Then commit and push:

```powershell
git -c commit.gpgsign=false commit -m "Add Cloudflare Pages Functions and D1 backend"
git push
```

If Git reports a conflict or non-fast-forward error, stop and inspect it; do not force-push.

Because your Pages project is connected to `main`, Cloudflare should automatically create a new deployment. Its build log should now discover the repository-root `functions/` directory. The previous message `No Functions dir found. Skipping.` should no longer appear.

Keep the Pages build settings unchanged:

- Root directory: `/`
- Build command: blank
- Build output directory: `public`
- Production branch: `main`

The `functions/` and `functions-shared/` directories must remain at the repository root, alongside `public/`, not inside `public/`.

## 5. Add Cloudflare production variables and secrets

In **Cloudflare Dashboard → Workers & Pages → raelinfo → Settings → Variables and Secrets**, select the **Production** environment.

Add:

| Name | Type | Required | Value |
|---|---|---:|---|
| `SUPABASE_URL` | Variable | Yes | Your Supabase Project URL |
| `SUPABASE_PUBLISHABLE_KEY` | Secret or Variable | Yes | Your `sb_publishable_...` key |
| `APP_ORIGIN` | Variable | Yes | `https://raelinfo.pages.dev/login.html` |
| `SEC_USER_AGENT` | Variable | For SEC | `RaelInfo/3.0 contact=YOUR-MONITORED-EMAIL@example.com` |
| `SUPABASE_SECRET_KEY` | Secret | Optional | Your `sb_secret_...` key; enables account deletion |
| `ALPHA_VANTAGE_KEY` | Secret | Optional | Stock provider key; confirm public display rights first |
| `FMP_KEY` | Secret | Optional | Stock provider key; confirm public display rights first |
| `EODHD_KEY` | Secret | Optional | Stock provider key; confirm public display rights first |
| `STOCK_PROVIDER_ORDER` | Variable | Optional | `alpha,fmp,eod` |

Replace the example SEC email with a real monitored email address. SEC EDGAR requires an identifying User-Agent with contact information.

`SUPABASE_SECRET_KEY` bypasses Supabase Row Level Security. Store it only as a Cloudflare Secret. Never put it in GitHub, `.env.example`, `.dev.vars.example`, or browser code. If you do not configure it, account deletion stays disabled; normal registration, sign-in and portfolio features can still work.

Do not add `SUPABASE_SECRET_KEY` as a plain text variable. Do not put real keys in GitHub repository files.

## 6. Verify the preview before touching Namecheap DNS

After the new Cloudflare deployment succeeds and the variables are saved, redeploy the latest production deployment if needed so the environment is active.

Open these endpoints on `https://raelinfo.pages.dev`:

- `/api/health` — should show `ok: true`, `database: true`, and `providers.auth: true`.
- `/api/crypto` — CoinLore BTC, ETH and SOL market data.
- `/api/fx?from=USD&to=CAD` — Frankfurter reference rate.
- `/api/news?q=stock%20market` — GDELT article results.
- `/api/filings?cik=320193` — SEC submissions once `SEC_USER_AGENT` is configured.
- `/login.html` — registration and sign-in screen.

Register using an email address you control, confirm the email, then sign in. Add a test portfolio position, reload and verify that it persists. Test with a second account and confirm it cannot see the first account's positions. Test logout.

Only test account deletion if `SUPABASE_SECRET_KEY` is configured and you are comfortable permanently deleting the test account.

## Important limits and known test status

- The app uses public/no-key CoinLore, Frankfurter and GDELT endpoints for crypto, FX and news. Provider availability and usage policies can change.
- Stock-provider free plans may prohibit public redistribution or commercial display. Do not publish stock quotes until you have confirmed the provider grants the necessary rights.
- SEC requests require a real monitored contact email and must respect SEC fair-access limits.
- The source was syntax-checked, dynamically imported, and the D1 migration was exercised locally against SQLite, including portfolio cascade deletion. A live Supabase signup and live Cloudflare Functions deployment were not tested from the build environment. The Cloudflare deployment log after pushing is the next platform-level verification.
- No penetration test has been performed. Complete all smoke tests and review privacy/terms wording before accepting real users or advertising the portfolio feature as a secure financial vault.

**Do not change Namecheap nameservers or DNS yet.** Keep the existing domain routing as-is until the Pages Functions, D1 migration, Supabase authentication and portfolio isolation have all passed preview tests. The Namecheap/Cloudflare DNS transition is a later, separate step.


## 8. Revenue phase: partner offers, measurement and owner reporting

The revenue features are intentionally disabled until the operator has approved partner agreements and real tracking destinations. The default `PARTNER_OFFERS_JSON=[]` means no affiliate offers are shown. Do not insert guessed links, personal referral codes, example URLs, or partner names before approval.

### 8.1 Apply to partner programs; configure only after approval

Potential programs to review (approval and geography are determined by each provider):

- Wise Website Partnerships: https://wise.com/gb/affiliate-program/ . Wise reviews applicants and supplies a unique tracking link after acceptance. Confirm that the program authorizes the intended RaelInfo pages, countries and placements.
- Wealthsimple Affiliate Program (Canada): https://www.wealthsimple.com/en-ca/legal/affiliate-guidelines and https://help.wealthsimple.com/hc/en-ca/articles/29448182409499-Wealthsimple-Affiliate-Referral-Program . Confirm current eligibility, terms and permitted placements; do not target US residents with a Canada-only promotion.

Do not state a commission rate or guarantee an approval unless the signed/current program terms support it. Add one offer per partner/market/tracking URL when distinct URLs or terms apply.

### 8.2 Configure approved partner offers

In Cloudflare Dashboard → Workers & Pages → `raelinfo` → Settings → Variables and Secrets → Production, add a plain-text Variable named `PARTNER_OFFERS_JSON`.

Until a partner accepts RaelInfo, set its value to:

```json
[]
```

After written approval and receipt of a genuine tracking URL, set the value to a compact JSON array. Example structure only; this example is deliberately disabled and its URL is not a real partner link:

```json
[
  {
    "id": "replace-with-real-offer-id",
    "partnerName": "Replace with approved partner name",
    "title": "Compare relevant service options",
    "description": "Review the provider's current fees, eligibility and terms.",
    "destinationUrl": "https://example.com/replace-with-approved-tracking-url",
    "categories": ["crossborder"],
    "markets": ["CA"],
    "currencies": ["CAD"],
    "cta": "Review provider details",
    "active": false,
    "approved": false,
    "approvedAt": ""
  }
]
```

Required fields and constraints:

- `id`: unique lowercase ID, 2–48 characters, letters/numbers/underscore/hyphen.
- `destinationUrl`: the actual partner-provided tracking URL, HTTPS only.
- `categories`: one or more of `housing`, `saving`, `debt`, `crossborder`, `planning`.
- `markets`: `US`, `CA`, or both, only where the partner authorizes the market.
- `currencies`: `USD`, `CAD`, or both, as appropriate.
- `active` and `approved`: both must be the boolean `true` before the offer is displayed or redirected.
- `approvedAt`: approval date for the operator's internal reference.

The website filters by selected market, calculator category and displayed currency. Use separate offer IDs/URLs where a partner issues different tracking links or terms by country. Wealthsimple's program must be configured for Canada only unless its current written terms explicitly authorize another market. Keep the JSON compact and below 24 KB. Save the production variable and redeploy Pages so Functions receive the new value.

Offers returned by `/api/partners` omit the destination URL. A click goes to `/api/affiliate/click`, which validates the offer and market, records an aggregate outbound redirect request in D1, then redirects to the configured HTTPS destination. Clicks are not unique visitors, confirmed signups or commissions; automated requests may be included. The disclosure is rendered beside each active offer.

### 8.3 Set up the owner revenue dashboard

Generate a random owner token on your Windows computer from PowerShell:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Copy the generated value. In Cloudflare → Workers & Pages → `raelinfo` → Settings → Variables and Secrets → Production, add `RAELINFO_ADMIN_TOKEN` as a **Secret** (not a plain Variable). Use the generated value. Do not place it in source code, GitHub, `.env.example`, `.dev.vars.example`, or a shared chat. Redeploy after saving.

Open `https://raelinfo.pages.dev/admin/revenue.html`, paste the token into the password field, and select Load private report. The token is held in the page's memory only and is cleared when you clear it or close/reload the page. The dashboard endpoint is protected by the bearer token; the HTML page itself is not private data.

The owner dashboard shows affiliate click counts, manually recorded conversion/commission amounts, aggregate site events, Pro-interest count and business partnership inquiries. It does not automatically import network conversions, process money, create subscriptions, reconcile a bank account or calculate tax.

### 8.4 Record actual affiliate conversions

Use the affiliate network's own reporting as the source of truth. When the network reports a conversion/commission, enter the network reference ID (not the customer's name/email), actual commission amount, currency, market, status and date in the owner dashboard. Use `pending` until the network confirms the commission is payable; use `approved` only when confirmed; use `reversed` for reversals. Re-entering the same offer ID and network reference updates the existing record.

Keep partner network records for reconciliation and taxation. Do not enter customer personal information or customer financial details in the conversion reference field.

### 8.5 Business partnerships and B2B leads

The public form is available at `https://raelinfo.pages.dev/partners.html`. It accepts affiliate, sponsorship and calculator-licensing inquiries and stores the submitted business contact details in D1. The form includes consent and a honeypot, applies rate limiting, and does not send an automatic email acknowledgement. Review submissions at `/admin/revenue.html`; respond manually from the owner dashboard. Publish an accurate operator/privacy contact and decide a retention schedule before publicly inviting inquiries. Delete leads when they are no longer needed, subject to applicable recordkeeping obligations.

The form is lead capture, not a signed agreement or a guarantee of a response. Do not promise audience sizes, results or reach that you cannot substantiate.

### 8.6 Pro interest is not a subscription

The RaelInfo Pro section lets signed-in visitors voluntarily register or withdraw interest in possible future features. It does not charge, create a subscription, send marketing email, or promise a launch date. Billing is not implemented. Do not describe anyone as a paying Pro customer based on this list.

### 8.7 Measurement and free website analytics

The backend aggregates calculator use, scenario import/export, print and Pro-interest events by date/category/market. It does not send calculator amounts, balance values, portfolio holdings, or account IDs in these event records. D1 rate-limiting stores a one-way hash of an IP-derived key; no raw IP is stored in that rate-limit table. Affiliate redirects store offer, category, market, placement and timestamp, not the visitor's calculator inputs.

Enable Cloudflare Web Analytics separately: Cloudflare Dashboard → Workers & Pages → `raelinfo` → Metrics → Web Analytics → Enable. Cloudflare says Pages automatically adds the snippet on the next deployment and describes Web Analytics as free and privacy-first. Review the current Cloudflare and applicable privacy requirements before enabling any other advertising or tracking service. Do not add Google AdSense code until your AdSense account/site is approved and you have implemented the publisher's required consent and policy setup.

### 8.8 Revenue table migration

Apply `migrations/0002_revenue.sql` to the existing production D1 database after confirming `0001_initial.sql` is already applied:

```powershell
npx wrangler@latest d1 migrations list raelinfo-production --remote --env production
npm run db:migrate:remote
npx wrangler@latest d1 migrations list raelinfo-production --remote --env production
```

The second migration creates `affiliate_clicks`, `affiliate_conversions`, `daily_site_events`, `pro_interest`, and `business_inquiries`. It does not change existing portfolio rows. Verify the tables in D1 Console before enabling affiliate offers or taking partner inquiries.

### 8.9 Launch controls and commercial safeguards

- Keep the construction banner off only after owner/contact details, privacy/terms, live market-data labels, partner approval and key user journeys have been reviewed.
- `PARTNER_OFFERS_JSON=[]` is the safe default; no offer should be enabled without a written approval and working tracking URL.
- Start with a small number of relevant offers and monitor user experience. Do not place affiliate offers above or instead of calculator results.
- No ad network, payment processor, paid subscription, auto-email sequence or automatic affiliate conversion feed is installed by this release.
- Use partner network reports for conversions and commissions; the RaelInfo dashboard is a manual operating ledger, not independent proof of earnings.
- Before public launch, replace the operator/contact placeholders in both privacy and terms pages and define retention for business inquiries and conversion records.


Revenue inquiry gate: `PARTNER_INQUIRIES_ENABLED` defaults to `false`. The partner form remains visibly disabled until the operator has completed the contact and retention details in the Privacy Notice and Terms. Set it to `true` in Cloudflare Production only after those details are reviewed and ready.
