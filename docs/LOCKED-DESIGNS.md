# Locked designs (owner: "working perfect, don't change it anymore")

A locked design stays exactly as it is at its commit. Don't change how it
works or looks unless the owner asks for that change in words. If a change
elsewhere has to touch it, say so plainly in the PR and to the owner first.

## How the owner saves / restores one

- Every app page has a small **🔒** button (bottom right) — **Owner only**
  (the server checks the account is an Owner). It opens **Save this design**:
  pick the tab (the open one is already picked, or "Whole page"), an optional
  note, **🔒 Save this design now**.
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
