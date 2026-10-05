# XFitting tools: rules for every change

## Why this app exists (the main point — keep it in mind for every change)

In the owner's words: all the app we are doing is **to save time**, and to
**keep everything in record**, so if we have issues we can find out where the
issue came from, and to **see what our workers are doing every day**, to make
sure they are doing their job and no one is just playing around.

So every feature should:
- save the workers steps and walking (the system decides / pre-fills, fewer
  taps, lists in walking order: Front BO → 2FL → FRONT, Middle BSMT → PR →
  GARAGE, Back C1 → C2 → BARN → C3 → C4 → C5);
- leave a record of who did what and when (History / logs), never a silent
  change;
- make problems easy to trace back to where they started.

## Don't change what already works

Anything the owner asked for before that is working stays exactly as it is.
Don't change, move, rename, hide or remove it unless the owner asks for
that change.
- Before a change, list the features it touches and check each one still
  works afterwards (re-run the earlier tests for them).
- If a change has to touch something that works, say so plainly in the PR
  and in the report to the owner, before it is merged.
- Run `node tests/keep-working.test.mjs` before every PR. It runs on every
  PR too ("Keep-working checks"); a ❌ means something that worked broke —
  fix it, never delete or loosen the check.
- Every time the owner reports something broken and it gets fixed, add a
  check for it to `tests/keep-working.test.mjs` in the same PR, so it can't
  quietly break again.

## History must always show the totals

Inventory → History shows, for every approved Stock In / Stock Out /
Transfer row, the **Part Total Before → After** (cases of that part #, every
shelf), and the report at the top shows the day's **Starting → Ending
cases**. Never leave the total blank without a reason:
- Pending rows say "after approval".
- If the total couldn't be worked out, the row says "⚠ not recorded" and why.
- Every screen that approves or writes an approved Stock In / Out / Transfer
  (Review, auto-approve, Audit, Receive PO, Reorder 📦 Received, Cancel)
  must record the before → after. A new one must too.
- "Today" / "Last N days" start at midnight New York time, not "24 hours ago".

## Stock Out pick rules (the system picks for the picker)

Two Stock Out tabs, Shelving first:
- **Stock Out Shelving** = our own shelves. Search by the parent part #
  (e.g. 30-3-4). The exact part # and bag count don't matter much.
- **Stock Out Big Company** = ships to our Amazon warehouse for ONE FBA
  listing. Search the WHOLE part # (e.g. 30-3-4=10X). Part # and bag count
  matter: least packing / rebagging, none is best.

**Rule #1, always first, on BOTH tabs, before any other rule or example:**
save FBA bags for their own FBA listing.
- Finish the bags with no FBA listing first.
- When an FBA part # is low, keep the other bags of the same count for it.
- If only FBA bags are left, look at Amazon sales history and even them out:
  never empty FBA #1 while FBA #2 still has a lot (later we would have to
  open #2 and rebag it for #1).
- For Big Company, the part # asked for is its own listing, so it comes first.

**Boxes still on a container's pallets come last, on both tabs.** A spot whose
cases are all still on a 📦 Received container's pallets (not moved off in 🚢
Container here) is hard to get at (pallets stand against each other). Use every
shelf spot first, FBA bags on shelves included, then the pallets (Rule #1 and
the rules below still apply among the pallets). On the Pull List the picker can
grab whatever box on the pallet is easiest and scan it (🔁 Replace) to swap the
item for it — same item (parent part #) only, recorded in the Stock Out notes.

Then Shelving: oldest first (fewer letters after the pack number = older),
one spot rather than two.

Then Big Company, least rebag work:
1. The same part # (e.g. =10X).
2. The same bag count with other letters (=5 / =5X for =5XX): just cover
   the label, no rebag.
3. Put 2 bags into one (=50 + =50 for =100).
4. Cut ONE bigger bag (=100 for =2 or =5), biggest first, then smaller.
5. Put 3–5 bags into one (=25 ×4 for =100; =5 ×5 for =25 when only =2
   and =5 are left).
6. Many small bags (=2 ×50 for =100) or mixed sizes: last, too much rebag.
Big Company counts pieces (Each/Case), so a case of =100 is never counted
as a case of =10X.

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
- Scanner "stopped working" (N77, Zebra DS2278)? Read `docs/SCANNERS.md`
  first: the known causes and the exact working settings are there.
- Never commit secrets (API keys, tokens, passwords).
- Every data request must stay behind a real sign-in (server-checked
  `X-Cred-Token`). Nobody should be able to browse the site or its data
  without a password.
- Don't edit Worker code in the Cloudflare dashboard. `worker/src/index.js`
  deploys from `main`.
- Validate Worker changes with
  `cd worker && npx -y wrangler@4 deploy --dry-run --outdir <tmp>`.
- The "Workers Builds: …" checks (xfitting-lookup, xfitting-profit) are
  always red on PR branches. That is expected: Cloudflare only builds `main`.
- Merge it yourself (owner's standing OK): when a change is done, open the PR
  and merge it as soon as the "keep-working" check is green on GitHub — don't
  wait for the owner to ask. Never merge with keep-working red or pending;
  fix it first. Merging to `main` deploys the Worker and GitHub Pages, so
  tell the owner what went live.
