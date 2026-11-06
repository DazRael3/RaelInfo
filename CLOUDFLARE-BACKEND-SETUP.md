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
