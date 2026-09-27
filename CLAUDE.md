# XFitting tools: rules for every change

## Inventory numbers must always add up (most important rule)

Inventory counts are the most important data in this repo. A double count or
a missed count leads to wrong reorders and costs real money. This applies to
anything that reads, writes, moves, converts or displays stock:

- SKU Mgr / `master_list` (cases, units per case)
- Stock In / Stock Out / Transfer / Receive (`inventory_log`, Inventory Sheet)
- Pull lists, Pack & Ship picking
- Reorder Planner (stock on the shelf, FBA stock, on the way / incoming, other pack sizes)
- Any sync, import, merge, alias / "map to part #", or clean-up of part #s

**Rule: old total + what was added − what was taken out = new total, exactly.**
Example: 100 pieces on hand + 50 pieces added = 150 pieces. There are no
exceptions, no matter what else the change does.

### Before any change that touches inventory numbers
1. Write down the current totals the change could affect (pieces and units,
   per part and overall) using realistic test data. Include several pack sizes
   of the same part, FBA and non-FBA part #s, and more than one shipment.

### After the change
2. Recompute the totals and check them against the rule above:
   - Nothing counted twice. A quantity must not be added in full to more than
     one row, part or pack size. If it is shared out, the shares must add up
     to 100%.
   - Nothing silently dropped. Anything left out must be shown clearly to the
     user (for example in red as "not counted").
   - Pieces = units × pack size, converted correctly between pack sizes.
3. If any total does not match, the change is wrong. Fix it before
   committing or opening a PR. Never ship a mismatch.
4. In the PR description and the report to the user, show the check: a table
   of expected vs counted totals, each marked ✅ match.

## Other standing rules
- Never commit secrets (API keys, tokens, passwords).
- Every data request must stay behind a real sign-in (server-checked
  `X-Cred-Token`). Nobody should be able to browse the site or its data
  without a password.
- Don't edit Worker code in the Cloudflare dashboard. `worker/src/index.js`
  deploys from `main`.
- Validate Worker changes with
  `cd worker && npx -y wrangler@4 deploy --dry-run --outdir <tmp>`.
- The "Workers Builds: xfitting-lookup" check is always red on PR branches.
  That is expected: Cloudflare only builds `main`.
- The repo owner merges PRs. Merging to `main` deploys the Worker and GitHub
  Pages.
