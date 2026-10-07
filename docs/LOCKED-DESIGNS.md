# Locked designs (owner: "working perfect, don't change it anymore")

A locked design stays exactly as it is at its commit. Don't change how it
works or looks unless the owner asks for that change in words. If a change
elsewhere has to touch it, say so plainly in the PR and to the owner first.

## How the owner saves / restores one

- Inventory → 🏬 Stock Out Shelving → **🔒 Save this design** (admin / owner
  only, bottom of the tab) downloads `stock-out-shelving-design-<date>.txt`.
  The file names the exact commit the website + Worker ran at that moment
  (from `version.json`, written by the Pages deploy) and holds the page source.
- Owner gives that file back and says "change it back": check out that commit
  (`git show <commit>:inventory.html`, `git show <commit>:worker/src/index.js`),
  diff the Stock Out Shelving code against now, and put back only that tab's
  code (screens, pick rules, pull list, its Worker routes). Every other tab
  stays as it is now. Re-run `node tests/keep-working.test.mjs`, show the
  inventory check, and say in the PR what was put back.

## Locked

| Design | Locked on | Commit | What it covers |
|---|---|---|---|
| 🏬 Stock Out Shelving | 2026-10-07 | `347cb71` | Inventory → Stock Out Shelving: search by parent part #, pick rules (Rule #1 FBA bags, oldest first, one spot, pallets last), Pull List, Grabbed / None Found / 🔁 Replace, saved batches, and the Worker routes behind them. |
