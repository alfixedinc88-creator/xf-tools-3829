# xfitting-lookup worker

Backend for the XFitting tools (`https://xfitting-lookup.alfixedinc88.workers.dev`).

- Code: `src/index.js`
- Config: `wrangler.toml`
- Deploys: automatic on push to `main` through Cloudflare Workers Builds.

Secrets and variables (Google, eBay, Amazon, Veeqo, Walmart, Shopify keys,
PINs, sheet IDs) live in the Cloudflare dashboard under
**Settings → Variables and Secrets**. Never put them in this folder.
