# Box / bag UPC codes (vendors #1 and #2)

From the owner: `vendor-1-2-box-bag-upc.xlsx`. The latest version (2026-10-01, 3rd file) has two tabs:

- **#1**: the full list (about 3,100 rows).
- **#2**: the earlier list.

Both tabs are read. Earlier versions are in git history.

- `vendor-1-2-box-bag-upc.csv`: the cleaned list, with these columns:
  - part #;
  - outside box UPC;
  - inside bag UPC;
  - the part # as written in the file, when it was changed.

  It has 2,806 part #s in 2,819 rows. A few part #s have two UPC sets (old and new packaging), and both scan to the part #.
- `worker/src/vendor-upc.js`: the same list, built into the Worker. A scanned box or bag UPC finds its part # (Inventory lookup, Transfer → 🚢 Container here). Container here's "no box UPC" list counts these as having one.

## Cleaning rules (applied the same way every time)

- UPCs saved as numbers (`840428904241.0`) are turned back into digits. Leading zeros are ignored when scanning.
- A **C right after the parent part #** is dropped (the owner's rule). For example `28-4-1C=2X` → `28-4-1=2X` and `28-2-1&2C=2` → `28-2-1&2=2`. The CSV keeps the part # as written.
- A trailing `-` is dropped (`30-3-5=25-` → `30-3-5=25`).
- Kept as written: `=1W.1C` / `=10W.2C` style pack sizes, and `61853-K=1X` style part #s.

## Skipped (owner: skip these)

| What | Rows | Why |
|---|---|---|
| no part # (UPCs only) | 95 | can't tell which item |
| `.=2X`, `.=5X`, `.=10X`, `.=1X` | 52 | no parent part # |
| part # with a note, no UPC (`25-6-4=50X/100X`, `29-1-1=2XX/5XX`) | 4 | note only. These part #s get their UPCs from other rows |
| no UPC | 11 | `10-2-1=1`, `28-4-4=1X`, `25-6-3=10`, `201-3-6=10`, `29-3-7=5`, `29-3-6=25`, `26-4-5=100` (tab #1) · `5-1-1=5`, `5-3-1=5`, `23-5-3=25` (tab #2) · `201-2-9=10-` has an Amazon ASIN/FNSKU, not UPCs |

Rebuild the `.csv` and `.js` from a new file with the same rules, so that every scan keeps working.
