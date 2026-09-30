# xfitting-profit worker (Profit Check)

Backend for `profit.html`: whether each listing makes or loses money after
marketplace fees, shipping labels and product cost.

This is a **separate** Cloudflare Worker, kept apart so the main worker
(`worker/src/index.js`, xfitting-lookup) doesn't grow.

- Code: `src/index.js` (routes, Amazon calls, D1) and `src/calc.js` (the math)
- Config: `wrangler.toml` (this folder). The root `wrangler.toml` is the main worker's; leave it alone.
- Numbers test: `node profit-worker/test/calc.test.mjs`
- Validate: `npx -y wrangler@4 deploy -c profit-worker/wrangler.toml --dry-run --outdir <tmp>`

## What it reads and writes

| | Tables |
|---|---|
| Reads (never writes) | `cred_sessions`, `cred_users`, `cred_levels`, `cred_user_roles` (sign-in), `cogs`, `cost_layer`, `reorder_alias`, `ship_manifest_log` |
| Writes (its own) | `profit_amazon_order_fees`, `profit_amazon_other_events`, `profit_amazon_orders`, `profit_settings`, `profit_log` |

It never writes to inventory tables and never changes a live price.
Every request needs a real sign-in (`X-Cred-Token`, the same login as every
page) with the **mgmt** permission.

## One-time setup in Cloudflare (the owner does this once)

1. **Create the worker.** Cloudflare dashboard → Workers & Pages → Create →
   *Import a repository* → pick `alfixedinc88-creator/xf-tools-3829`.
   - Project name: `xfitting-profit`
   - Production branch: `main`
   - Root directory: `/`
   - Build command: *(empty)*
   - Deploy command: `npx wrangler deploy -c profit-worker/wrangler.toml`
2. **Check the address.** After the first deploy it should be
   `https://xfitting-profit.alfixedinc88.workers.dev`. If it is different,
   tell Claude: `PROFIT_URL` at the top of the script in `profit.html` must match.
3. **Add the secrets.** Workers & Pages → xfitting-profit → Settings →
   Variables and Secrets → Add → type **Secret**. Copy the values from
   xfitting-lookup's own settings (same names):
   - `AMAZON_CLIENT_ID`
   - `AMAZON_CLIENT_SECRET`
   - `AMAZON_REFRESH_TOKEN`
   - `AMAZON_MARKETPLACE_ID` (optional, plain text; defaults to `ATVPDKIKX0DER`, Amazon.com)
   Later phases (not used yet, don't add until asked): `EBAY_CLIENT_ID`,
   `EBAY_CLIENT_SECRET`, `EBAY_REFRESH_TOKEN`, `WALMART_CLIENT_ID`,
   `WALMART_CLIENT_SECRET`, `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`,
   `SHOPIFY_STORE_DOMAIN`.
4. **Daily schedule.** Already in `wrangler.toml` (`7 9 * * *` = 09:07 UTC
   every day). Check it under Settings → Triggers → Cron Triggers after the
   first deploy.
5. **D1.** The `DB` binding (`xfitting-d1`) comes from `wrangler.toml`. Nothing to click.
6. **Amazon app permissions.** The SP-API app needs these roles in Seller
   Central → Apps & Services → Develop Apps: *Finance and Accounting*
   (fees), *Pricing* (fee estimates for "Try a price"), *Inventory and Order
   Tracking* (orders). If a role is missing, the page shows Amazon's error
   (403 Unauthorized). After adding a role, the refresh token may need to be
   re-authorized.
7. Open `profit.html` → **Pull the last 90 days again** once to fill the history.

If a deploy ever breaks it: Workers & Pages → xfitting-profit → Deployments → "…" → Rollback.
The main worker (xfitting-lookup) is not affected by this worker at all.
