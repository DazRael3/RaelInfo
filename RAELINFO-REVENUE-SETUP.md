# RaelInfo Revenue Phase — Operator Setup

This guide configures the revenue groundwork added in version 3.2. It does not enable guessed affiliate links, ads, payments or subscriptions. Start with the D1 migration and private owner dashboard; activate partner offers only after the partner has approved RaelInfo and supplied its own tracking URL.

## A. Apply the second D1 migration

Open PowerShell in the repository root:

```powershell
cd "C:\Users\d139c\FamBot\SimonSays\Dig\RI"
npx wrangler@latest d1 migrations list raelinfo-production --remote --env production
npm run db:migrate:remote
npx wrangler@latest d1 migrations list raelinfo-production --remote --env production
```

Only apply `0002_revenue.sql` after confirming `0001_initial.sql` is already applied and the target is `raelinfo-production` in the `production` environment. The new tables are `affiliate_clicks`, `affiliate_conversions`, `daily_site_events`, `pro_interest`, and `business_inquiries`. Verify with this D1 Console query:

```sql
SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;
```

## B. Create an owner dashboard token

Generate a random token locally in PowerShell (Node.js 20+):

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

In Cloudflare → Workers & Pages → `raelinfo` → Settings → Variables and Secrets → Production, add `RAELINFO_ADMIN_TOKEN` as a **Secret** using the generated value. Do not put this token in GitHub, source code, browser JavaScript, `.env.example`, `.dev.vars.example`, or a chat. Save and redeploy.

Open `https://raelinfo.pages.dev/admin/revenue.html`, paste the token, and load the report. The dashboard is a private reporting tool; it is not linked from the public navigation. Its API requires the bearer token. The page keeps the token in memory only and offers a Clear button.

## C. Enable first-party revenue configuration

Add the following Production settings in Cloudflare Pages:

- Name: `PARTNER_INQUIRIES_ENABLED`
- Type: Variable
- Value: `false` until the operator identity/contact and retention schedule are published; only then change to `true`.

- Name: `PARTNER_OFFERS_JSON`
- Type: Variable (not a secret)
- Value: `[]`

Leave it as `[]` until a partner accepts RaelInfo and gives you an authorized tracking URL. No offer should appear by default.

After approval, replace `[]` with a compact JSON array. Example only; the following item is disabled and the destination is a non-real placeholder:

```json
[
  {
    "id": "replace-with-approved-offer-id",
    "partnerName": "Approved partner name",
    "title": "Compare relevant service options",
    "description": "Review current fees, eligibility and terms with the provider.",
    "destinationUrl": "https://example.com/replace-with-real-approved-tracking-url",
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

To activate a genuine offer, use the actual partner-provided HTTPS tracking URL and set both `active` and `approved` to the JSON boolean `true` only after written approval and verification of the permitted placement and market. Use a separate offer ID for each distinct country/tracking link if appropriate. Allowed categories: `housing`, `saving`, `debt`, `crossborder`, `planning`. Allowed markets: `US`, `CA`. Allowed currencies: `USD`, `CAD`. Offers are filtered by the visitor's selected market, calculator category and currency. The backend rejects non-HTTPS links, unapproved offers, duplicate IDs and invalid markets/categories.

Potential programs to apply to (not a guarantee of acceptance):

- Wise Website Partnerships: https://wise.com/gb/affiliate-program/ . Wise says website partners apply and receive tracking links after acceptance. Confirm geography, placement and permitted wording with the program.
- Wealthsimple Affiliate Guidelines: https://www.wealthsimple.com/en-ca/legal/affiliate-guidelines . Review its current Canadian-specific eligibility and disclosure rules; do not offer a Canadian-only promotion to US visitors.

Do not invent commission rates, benefits, “best” claims, approval status or tracking links. Keep each sponsored disclosure next to the offer. Partner click counts are redirect requests, not unique visitors or confirmed sales.

## D. Enable Cloudflare Web Analytics

In Cloudflare → Workers & Pages → `raelinfo` → Metrics → Web Analytics → Enable. Cloudflare Pages can automatically inject its Web Analytics snippet on the next deployment. The service is described by Cloudflare as free and privacy-first. This is separate from RaelInfo's D1 aggregate event counts. Review applicable privacy requirements and the Cloudflare privacy notice before enabling other analytics or advertising.

## E. Review the owner dashboard

The dashboard shows:

- Partner outbound clicks grouped by offer, market, category and placement.
- Conversion/commission amounts manually entered from partner-network reports.
- Aggregate calculator, scenario export/import and print events for the last 30 days.
- Pro-interest count.
- Partnership inquiries from `/partners.html`.

Affiliate conversion records are **manual**. Use partner-network reports as the source of truth. Enter the actual commission amount, not the customer's purchase amount, and use a non-personal transaction/reference ID only. Mark amounts `pending` until the network confirms them payable; use `approved` only when confirmed; record reversals as `reversed`. The same offer ID/reference updates an existing record.

Business inquiries are stored in D1 and reviewed manually at the dashboard. The form does not send an automatic acknowledgement. It collects business contact data only with consent. Before inviting public inquiries, replace the legal operator/contact placeholders in `public/privacy.html` and `public/terms.html`, publish a monitored privacy contact, and establish a retention/deletion schedule.

The Pro-interest control is a voluntary research signal only. It is not a paid subscription, payment authorization, email marketing opt-in or promise of a launch. Billing is not included in this phase.

## F. Advertising and recurring revenue later

No ad network code, payment processor, paid subscription or automated email campaign is installed by this phase. Apply to an ad network such as AdSense only after the website has complete operator information, useful original pages, clear navigation, accurate policies and a real publisher approval. Do not paste ad code or claim acceptance before approval. Add subscriptions only after validating willingness to pay, publishing terms and refund/cancellation rules, and choosing a payment processor.

## G. Validate after deployment

After GitHub push and successful Cloudflare deployment:

- `https://raelinfo.pages.dev/api/health` should show the database and provider state; it also reports the count of configured approved offers and whether the admin token exists.
- `https://raelinfo.pages.dev/api/partners?market=US` and `...?market=CA` should return an empty `offers` array while `PARTNER_OFFERS_JSON=[]`.
- `https://raelinfo.pages.dev/partners.html` should load the business inquiry form.
- `https://raelinfo.pages.dev/admin/revenue.html` should request the owner token; without it, the reporting API must return 401.

Do not switch Namecheap DNS during this stage. Complete the Cloudflare preview tests and confirm privacy/terms/operator details first.
