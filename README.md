# RaelInfo — Node.js financial platform (free-first build)

This package turns the prior RaelInfo static site into a same-origin Node.js/Express application while preserving the existing RI branding, responsive financial calculators, CoinLore crypto cards, USD/CAD converter, theme, scenario save/export/import, print-to-PDF and construction-mode switch.

The code uses free/open-source Node packages and no required paid API. Crypto, FX and news use public no-key data endpoints. Stock quotes require at least one optional provider key; SEC filings require a real identifying contact in the SEC User-Agent setting.

## Project structure

```text
raelinfo-production/
├── server.js                  # Express API, proxy/cache, auth, portfolio, SEC, news
├── config.js                  # Reads keys/settings from environment variables
├── package.json
├── scripts/
│   └── check-inline-module.mjs # Syntax-check the dashboard inline module
├── .env.example               # Copy to .env and configure
├── .gitignore
├── README.md
├── data/
│   └── users.json             # Small single-server account/portfolio store (private)
└── public/
    ├── index.html             # Existing RaelInfo dashboard + backend feature panels
    ├── login.html             # Sign-in and account registration
    ├── style.css              # Backend panels and login styles
    ├── app.js                 # Dashboard wiring
    ├── charts.js              # Dependency-free canvas portfolio allocation chart
    ├── crypto.js              # Same-origin crypto API client
    ├── fx.js                  # Same-origin FX API client
    ├── news.js                # GDELT article search/rendering
    ├── filings.js             # SEC EDGAR submission renderer
    ├── portfolio.js           # Authenticated portfolio form and chart
    ├── sw.js                  # PWA cache; API responses are never cached by the SW
    ├── manifest.webmanifest
    ├── privacy.html
    ├── terms.html
    ├── 404.html
    ├── robots.txt
    ├── sitemap.xml
    ├── icon-192.png
    ├── icon-512.png
    ├── apple-touch-icon.png
    └── icons/raelinfo.svg
```

`data/` and `.env` are outside `public/`; Express serves only `public/`. Do not move the user database or `.env` under the public directory.

## 1. Requirements and local run

- Node.js 20.11 or newer (Node 22 LTS recommended).
- npm.
- HTTPS in production. For local development, `http://localhost` is acceptable.

From this project directory:

```bash
npm install
```

Copy `.env.example` to `.env`, edit it, then start the server:

```bash
# macOS / Linux
cp .env.example .env

# Windows PowerShell
Copy-Item .env.example .env

npm start
```

Open `http://localhost:3000`. For development with automatic server restarts, use `npm run dev`.

Run syntax checks with:

```bash
npm run check
```

Do not open `public/index.html` directly with a `file://` URL. The account system, API proxy and service worker require the Node server.

## 2. Free data sources and limits

### Crypto — CoinLore (no API key)

The Node backend proxies:

```text
https://api.coinlore.net/api/ticker/?id=90,80,48543
```

The application uses CoinLore for BTC, ETH and SOL. The CoinLore docs confirm that a comma-separated list of IDs can be passed in one ticker request; BTC is `90` and ETH is `80`. The site retains the prior package's SOL ID `48543`. Crypto data is aggregated and indicative, not an executable exchange quote. The backend caches the result for 60 seconds; the existing browser panel refreshes every two minutes and also keeps its last successful snapshot locally.

Docs: https://www.coinlore.com/cryptocurrency-data-api/v3

### USD/CAD — Frankfurter (no API key)

```text
GET /api/fx?from=USD&to=CAD
```

The backend calls Frankfurter's v2 rate endpoint and caches rates for six hours. This is a daily reference rate, not a bank, card-network, broker or remittance quote.

Docs: https://frankfurter.dev/

### Business/market news — GDELT DOC API (no API key)

```text
GET /api/news?q=stock%20market%20OR%20economy
```

The server requests up to 15 article records from the recent seven-day window, caches results for five minutes and returns only article metadata and original publisher links. GDELT can throttle or temporarily fail; the UI reports this without breaking the calculators.

Docs/project: https://www.gdeltproject.org/ and https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/

**NewsAPI is deliberately not used for production news.** Its free Developer plan is for development/testing only and its terms prohibit use outside a development environment. `NEWS_API_KEY` is retained in `config.js` for future migration, but this build does not call NewsAPI.

### SEC filings — SEC EDGAR (no API key)

```text
GET /api/filings?cik=320193
```

Set `SEC_USER_AGENT` in `.env` to your application name and a real, monitored contact email. The example value in `.env.example` is a placeholder and will not enable the route. The server normalizes CIKs to ten digits, requests `data.sec.gov/submissions/CIK##########.json`, caches for 15 minutes and throttles requests to about one per second. The frontend links to original SEC filing documents.

The SEC API does not support browser CORS; this is one reason the request runs through the backend. Follow SEC fair-access guidance and do not increase request concurrency without reviewing current requirements.

Docs: https://www.sec.gov/edgar/sec-api-documentation and https://www.sec.gov/about/developer-resources

### Stock quotes — optional providers

The stock quote endpoint is:

```text
GET /api/stock?symbol=AAPL
```

Configure one or more keys in `.env`:

```dotenv
STOCK_PROVIDER_ORDER=alpha,fmp,eod
ALPHA_VANTAGE_KEY=your_key
FMP_KEY=your_key
EODHD_KEY=your_key
```

The server tries the enabled providers in the configured order, validates the quote, caches a successful response for two minutes, and falls back to the next enabled provider if one fails.

- **Alpha Vantage:** the free service currently documents 25 requests per day. Its default Global Quote is end-of-day; real-time and 15-minute delayed US market data are premium, and the provider says commercial real-time use requires contacting sales. Do not label this free endpoint real-time.
  - https://www.alphavantage.co/support/
  - https://www.alphavantage.co/documentation/
- **Financial Modeling Prep:** this build uses the current `/stable/quote` endpoint. Free-plan access and data-display rights may be limited; review your account's live plan and terms before public display.
  - https://site.financialmodelingprep.com/developer/docs/quickstart
  - https://site.financialmodelingprep.com/developer/docs
- **EOD Historical Data:** its published free plan documents 20 API calls per day and limited functionality. Verify that your exact key permits the real-time endpoint before enabling it.
  - https://eodhd.com/help/plans

A key being free to obtain does **not** automatically grant commercial redistribution/display rights. Before using stock quotes on a public monetized site, confirm exchange, provider and display licensing. If no provider key is configured, the stock widget displays a clear configuration message; all other tools continue working.

`COINGECKO_API_KEY` and `NEWS_API_KEY` are included in the config key object for future use, but neither is required or called in this build.

## 3. API routes

| Method | Route | Auth | Purpose |
|---|---|---|---|
| GET | `/api/health` | Public | Backend/provider health summary (never returns keys) |
| GET | `/api/crypto` | Public | CoinLore BTC/ETH/SOL ticker proxy |
| GET | `/api/fx?from=USD&to=CAD` | Public | Frankfurter reference rate proxy |
| GET | `/api/stock?symbol=AAPL` | Public | Stock quote provider rotation |
| GET | `/api/news?q=...` | Public | GDELT news search |
| GET | `/api/filings?cik=320193` | Public | SEC EDGAR recent submissions |
| POST | `/api/auth/register` | Public, rate-limited | Create account |
| POST | `/api/auth/login` | Public, rate-limited | Sign in |
| GET | `/api/auth/me` | Public | Current session status and CSRF token |
| POST | `/api/auth/logout` | Session + CSRF | Sign out |
| POST | `/api/auth/delete` | Session + CSRF + password | Delete account and portfolio |
| GET | `/api/portfolio` | Session | Read own positions |
| POST | `/api/portfolio/add` | Session + CSRF | Add own position |
| DELETE | `/api/portfolio/:id` | Session + CSRF | Delete own position |

## 4. Authentication and user database notes

- Passwords are hashed using Node's built-in `crypto.scrypt`; plaintext passwords are never written to `users.json`.
- Usernames are normalized to lowercase and validated. Passwords must be at least 12 characters.
- Session cookies are `HttpOnly`, `SameSite=Strict`, and `Secure` in production.
- Mutating authenticated routes require a per-session CSRF token and same-origin request checks.
- Login/registration and general API requests have rate limits.
- `users.json` is stored outside the static folder and written via a temporary file + atomic rename.
- The current session map is in server memory. A server restart signs users out; this is expected for this lightweight build.
- The JSON database is a **small single-instance starter store**, not a production-grade multi-process database. It is not encrypted at rest by this code. Protect the server disk, restrict file permissions, use backups, and do not run multiple server instances sharing this file. For meaningful public scale, migrate to SQLite or PostgreSQL with managed backups, persistent storage, account recovery and monitoring.
- There is no email verification, password reset email or MFA. Users can permanently delete their account and portfolio from the dashboard; implement recovery/MFA before storing sensitive personal data.

## 5. Configuration

Important environment variables:

| Variable | Required | Description |
|---|---|---|
| `NODE_ENV` | Production | Set `production` on the deployed server |
| `PORT` | No | Defaults to `3000` |
| `SESSION_DAYS` | No | Session duration; defaults to 7 days |
| `APP_BASE_URL` | Recommended | Canonical server URL for operator reference |
| `ALLOWED_ORIGIN` | Recommended | Exact production origin, e.g. `https://raelinfo.com` |
| `STOCK_PROVIDER_ORDER` | No | Provider fallback sequence |
| `ALPHA_VANTAGE_KEY` | Optional | Alpha Vantage key |
| `FMP_KEY` | Optional | FMP key |
| `EODHD_KEY` | Optional | EODHD key |
| `SEC_USER_AGENT` | Needed for SEC | App name + real contact email |

Never paste actual API keys into `config.js`, HTML or frontend JavaScript. Add them to `.env` locally or to your hosting provider's encrypted environment-variable settings. Never upload `.env` to GitHub or include it in the ZIP you publish.

## 6. Construction mode

In `public/index.html`, find:

```js
const UNDER_CONSTRUCTION = false;
```

Set it to `true` to show the construction banner, hide partner offers and request `noindex,nofollow`. Set it to `false` for normal public presentation. This is a display/SEO switch, **not access control**. Use hosting-level access protection if the preview must be private.

## 7. Deployment

This is now a **Node.js application**, not a static-only site. You cannot deploy only the `public/` folder to GitHub Pages and expect account/API features to work. Deploy the project root to a Node-compatible host, then:

1. Set `NODE_ENV=production` and `ALLOWED_ORIGIN=https://your-domain`.
2. Add API keys and `SEC_USER_AGENT` as encrypted environment variables in the host dashboard.
3. Attach persistent disk/storage for `data/users.json`, or point the application at a persistent volume before accepting registrations.
4. Run `npm install` and `npm start` as the host's build/start commands.
5. Enable HTTPS and verify that `/`, `/login.html`, `/api/health`, `/api/crypto`, `/api/fx?from=USD&to=CAD`, `/api/news` and configured `/api/filings` behave as expected.
6. Back up `data/users.json` securely and test restoring it.
7. Keep `.env` and `data/users.json` out of the public web root and source control if they contain live account records.

The source code and public data endpoints are free. **Hosting a persistent Node server may not be free indefinitely.** Many free hosting tiers sleep, limit outbound requests, or use ephemeral disks. Confirm that your selected host supports a persistent writable data volume before account registration. Do not accept portfolio data on an ephemeral filesystem.

## 8. Privacy and financial-use boundaries

- Financial calculator inputs stay in the browser and are not posted to account APIs.
- Portfolio holdings are sent to RaelInfo's server only when a signed-in visitor uses the portfolio feature.
- Stock symbols, news search queries and CIKs are proxied through the backend to named public/configured providers.
- No analytics or advertising pixels are installed by default.
- Public feeds may be delayed, incomplete, stale or unavailable. Displayed prices are not trade quotes or financial advice.
- Replace the operator/contact placeholders in `public/privacy.html` and `public/terms.html`, and have the pages reviewed before public launch.

## 9. Pre-launch checklist

1. Replace all operator/legal placeholders in privacy and terms pages.
2. Confirm public display/redistribution rights for each stock-data provider.
3. Add a real SEC contact email to `SEC_USER_AGENT` and review SEC fair-access guidance.
4. Choose a Node host with persistent storage, HTTPS and backups.
5. Set a unique `.env` secret configuration and never commit it.
6. Test account registration, login, logout, password rejection, account deletion and portfolio ownership isolation.
7. Check provider fallback and caching with invalid/expired keys and rate-limit responses.
8. Test on actual iOS Safari, Android Chrome and desktop browsers.
9. Review applicable privacy, consumer-financial, investment-advice and data licensing obligations before monetizing.
