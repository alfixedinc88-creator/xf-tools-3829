# xfitting-lookup worker

Backend for the XFitting tools (`https://xfitting-lookup.alfixedinc88.workers.dev`).

- Code: `src/index.js`
- Config: `../wrangler.toml` (repo root)
- Deploys: automatic on push to `main` through Cloudflare Workers Builds.

Secrets and variables (Google, eBay, Amazon, Veeqo, Walmart, Shopify keys,
PINs, sheet IDs) live in the Cloudflare dashboard under
**Settings → Variables and Secrets**. Never put them in this folder.

Cloudflare build settings: root directory `/` (or empty), build command empty,
deploy command `npx wrangler deploy`. If a deploy ever breaks the API, roll back
from Workers & Pages → xfitting-lookup → Deployments → "…" → Rollback.

## Auto Label (Veeqo) + cancellation watch

Pack & Ship → **🤖 Auto Label** tab (management only). Everything is **off** until it's switched on there.

- **Preview only** – each run works out what it would do (buy / wait / merge / hold / cancelled), but buys nothing.
- **Auto buy labels** – buys labels through Veeqo, up to the per-run and per-day limits. It won't buy anything until one label has been bought by hand with **Test buy ONE label**.
- **Over 20 lb** – never auto-printed. The order goes on the **⚖️ Re-weigh list**, where you can print it by hand in Veeqo, or weigh the items and type the real weight (e.g. bin 23-2-3, 100 pieces = 19.99 lb). Saved weights (D1 `weight_overrides`, per bin) are used on every later order and in Pack & Ship's weight estimate. If Veeqo's own product weight still disagrees with the real weight, the order is held as "Fix weight in Veeqo".
- **Cancellation watch** – checks Amazon, eBay, Walmart, Shopify and Veeqo for cancelled orders. If a cancelled order already has a label, it goes on the 🗑️ Cancellation list. Cancelled orders are never bought, whatever the mode.

Runs by itself on the worker's cron (`autolabelCron`, at most every "Run at most every (min)"), so the Cloudflare **Cron Triggers** need a schedule that fires often enough, e.g. `*/15 * * * *`. Printing happens through Veeqo **DirectPrint** as soon as a label is bought.
