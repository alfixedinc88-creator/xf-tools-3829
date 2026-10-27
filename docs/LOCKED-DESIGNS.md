# Locked designs (owner: "working perfect, don't change it anymore")

A locked design stays exactly as it is at its commit. Don't change how it
works or looks unless the owner asks for that change in words. If a change
elsewhere has to touch it, say so plainly in the PR and to the owner first.

## How the owner saves / restores one

- Every app page has a small **🔒** button (bottom right) — **Owner only**
  (the server checks the account is an Owner). It opens **Save this design**:
  pick the tab (the open one is already picked, or "Whole page"), an optional
  note, **🔒 Save this design now**. A tab with parts that work on their own
  can be saved part by part (owner: "if only one goes bad I only change that
  one back"): Transfer → SKU / Part# / UPC / Name and Transfer → 🚢 Container
  here (list `DSUBS` in xf-access.js; add more there). Restoring a part puts
  back only that part's code (e.g. the `xfr…` code mode='code' path, not
  Container here's `xfrGo…` / `xfrCont…`), nothing else.
- Each save is kept on the server (D1 `design_saves` + `design_save_parts`)
  with the date, who, the exact commit the website + Worker ran (from
  `version.json`, written by the Pages deploy) and the page code as served.
  Saves are only ever added: there is no route to change or delete one.
- The same panel lists every saved design of that page, newest first:
  **⬇ Download** (a .txt with the info + the page code) or **📋 For Claude**
  (one line: "Bring back <tab> (<page>) to the design saved <date> — saved
  design #N, commit <sha> …").
- When the owner gives that line or file: check out that commit
  (`git show <commit>:inventory.html`, `git show <commit>:worker/src/index.js`),
  diff that tab's code against now, and put back only that tab's code (its
  screens, rules and the Worker routes behind it). Every other tab stays as it
  is now. Re-run `node tests/keep-working.test.mjs`, show the inventory check,
  and say in the PR what was put back. If only the tab's look / steps changed
  and later fixes elsewhere depend on new code, say so plainly before merging.

## Locked

| Design | Locked on | Commit | What it covers |
|---|---|---|---|
| 🏬 Stock Out Shelving | 2026-10-07 | `347cb71` | Inventory → Stock Out Shelving: search by parent part #, pick rules (Rule #1 FBA bags, oldest first, one spot, pallets last), Pull List, Grabbed / None Found / 🔁 Replace, saved batches, and the Worker routes behind them. |

## Changes the owner asked for on a locked design

| Design | Date | Owner's words | What changed |
|---|---|---|---|
| 🏬 Stock Out Shelving | 2026-10-09 | "if there's different quantities in the box, make sure we go FIFO … when there's different quantities in the box in the same spot, let the person double check the quantities of the box" | Same part #, different box size (Each/Case): the older SKU Mgr row first (`invFifoBoxSize`), before "one spot" (shelving) and in Big Company's order. The 2-box-size check on Grabbed also covers "Found on Shelf + Pull" rows. Everything else unchanged. |
| 🏬 Stock Out Shelving | 2026-10-17 | "=OLD always first … open box or damage box … they will add FIRST after the part # (8-8-8=OLDFIRST, 8-8-8=10FIRST) … must use that first, always first" | Part #s ending in FIRST are used first (before Rule #1, pallets and "one spot"), then =OLD (before, =OLD counted as 3 letters in the plan and could come after =10). Both are taken even if that means more than one spot. Pull List: FIRST rows above =OLD. Part # check: …FIRST is a normal ending. Big Company unchanged. |
| 🏬 Stock Out Shelving | 2026-10-27 | "the Stock Out Big Company double scan to make sure they grab the right item works fine — I want it to do the same for Stock Out Shelving too, so no more click on Grabbed, they have to scan it to double check they get the right stuff" | ✓ Grabbed on a Shelving Pull List item opens the same 📷 box scan as Big Company: every case scanned, each must be the exact part # on the line (wrong item / bag size refused and kept). A box already scanned in the scan-to-grab box or 🔁 Replace counts as box 1. "It's really …" (label wrong) and 🔓 "no barcode" are Admin only. No WiFi: the phone's stock copy checks known barcodes. Pick rules, Pull List, None Found, saved batches unchanged. |
| 🏬 Stock Out Shelving | 2026-10-27 | "everything under Stock Out Big Company must be for Big Company, like ungrabbed, grabbed info; Stock Out Shelving is for Stock Out Shelving — those two need to be separated, don't share the info" | The Pull List (Ungrabbed / Grabbed / None Found, "N of M grabbed"), 📷 scan-to-grab, 🗑 Clear, ⚠ Retry, 💾 Saved For Later and the Admin "everyone's un-grabbed" card show and act on this tab's items only (Big Company = dest 'company'; everything else = Shelving). What a spot still has free still counts both tabs' items (same boxes). Pick rules unchanged. |
