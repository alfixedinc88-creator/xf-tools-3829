# Box / bag UPC codes (vendors #1 and #2)

From the owner, 2026-10-01: `vendor-1-2-box-bag-upc.xlsx`. It was updated the same day: tab #1 gained 12 part #s (202-4-10, 31-1-3, 31-1-5, 43-4-11 and 43-4-12 pack sizes). Both tabs are read.

- `vendor-1-2-box-bag-upc.xlsx`: the file exactly as received.
- `vendor-1-2-box-bag-upc.csv`: the cleaned list: part #, outside box UPC, inside bag UPC.
  It has 475 part #s (476 rows, because `4-2-3=10` has two UPC sets). UPCs saved as numbers ("840428904241.0") were turned back into digits.
- `worker/src/vendor-upc.js`: the same list, built into the Worker. A scanned box or bag
  UPC finds its part # (Inventory lookup, Transfer → 🚢 Container here). Container here's
  "no box UPC" list counts these as having one.

Rebuild the `.csv` and `.js` from a new file the same way, so that every scan keeps working. The previous file is in git history.

## Not saved: these rows need fixing in the file

| Row | What's there | Why |
|---|---|---|
| 43–46, 53–56 | UPCs only (840428904746… 840428904814) | no part # |
| 460, 462 | UPCs only (00810139937920, 00810139937951) | no part # |
| 96 | `201-2-9=10-` · B08JKXRRDQ / X002NLKDCZ | an Amazon ASIN / FNSKU, not UPCs |
| 172 | `5-1-1=5` | no UPC |
| 196 | `5-3-1=5` · "no fba" | no UPC |
| 344 | `23-5-3=25` | no UPC |

Notes:
- Row 433 `23-6-4=25` has only a bag UPC.
- `4-2-3=10` appears twice with two different UPC sets (rows 280 and 281). Both scan to `4-2-3=10`.
