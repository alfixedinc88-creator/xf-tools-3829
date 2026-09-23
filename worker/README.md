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
