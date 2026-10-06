# xfitting-images worker (Image Maker)

Backend for `imagemaker.html`: keeps the saved image designs and the record
of who saved, changed, deleted and downloaded which picture.

This is a **separate** Cloudflare Worker, kept apart so the main worker
(`worker/src/index.js`, xfitting-lookup) doesn't grow, and so editing the
image tool can never change anything else by mistake.

The picture work (remove background, multiply, move, text) runs in the
browser. Image Maker still works without this worker; only **Save**,
**Saved designs** and **Record** need it.

- Code: `src/index.js`
- Config: `wrangler.toml` (this folder). The root `wrangler.toml` is the main worker's; leave it alone.
- Validate: `npx -y wrangler@4 deploy -c images-worker/wrangler.toml --dry-run --outdir <tmp>`
- Checked by `node tests/keep-working.test.mjs` (sign-in, save, change, delete, record).

## What it reads and writes

| | Tables |
|---|---|
| Reads (never writes) | `cred_sessions`, `cred_users`, `cred_levels`, `cred_user_roles` (sign-in) |
| Writes (its own) | `img_designs` (saved designs; delete only marks them deleted), `img_log` (the record) |

Every request needs a real sign-in (`X-Cred-Token`, the same login as every page).

## One-time setup in Cloudflare (the owner does this once)

1. Cloudflare dashboard → Workers & Pages → Create → *Import a repository* →
   pick `alfixedinc88-creator/xf-tools-3829`.
   - Project name: `xfitting-images`
   - Production branch: `main`
   - Root directory: `/`
   - Build command: *(empty)*
   - Deploy command: `npx wrangler deploy -c images-worker/wrangler.toml`
2. After the first deploy the address should be
   `https://xfitting-images.alfixedinc88.workers.dev`. If it is different,
   tell Claude: `IMAGES_URL` at the top of the script in `imagemaker.html` must match.
3. No secrets needed. D1 (`xfitting-d1`) comes from `wrangler.toml`.

If a deploy ever breaks it: Workers & Pages → xfitting-images → Deployments → "…" → Rollback.
The main worker (xfitting-lookup) is not affected by this worker at all.
