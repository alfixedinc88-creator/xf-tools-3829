# Vendor sheets → Reorder "⬆ Import vendor sheet" (JQ #1, EFF #2, YAO #3)

Owner (2026-10-20): "when I upload the info to you to work on the Import vendor sheet, make sure you know what you are
doing. Normally I just give the sheet and your **📄 Download template: vendor info** — the tab **Reorder Planner vendor
sheet**. Make sure you do the same thing for **EFF #2**."

When the owner hands over a vendor's file (JQ = #1, EFF = #2, YAO = #3), turn it into OUR template layout,
the same way for every vendor, so Reorder → ⬆ Import vendor sheet reads it right the first time.

## 1. Which kind of sheet is it?

| The file is… | Stage on Reorder | Our template (📄 Download template, Stage picked first) | Tab name |
|---|---|---|---|
| Product info: part #s, UPCs, ASINs, carton sizes, prices | (no Title, no Stage) | **Vendor info**: `Part # · Description · Item No. · Outside Box UPC Code · Inside Bag UPC Code · FBA ASIN · Inner Bag (pcs) · Master Carton (pcs) · Price per piece · Weight each (lb)` | `Vendor sheet` (the owner calls it "Reorder Planner vendor sheet") |
| An order the vendor is still making (e.g. "10-20-26 order") | 🏭 Ordered + a Title | **Order**: `Part # · Description · Item No. · Cases · Qty · Price per piece · Weight each (lb)` (+ `Master Carton (pcs)` if the vendor gives pieces per carton) | `Order` |
| A container that shipped (packing list, CIPL) | 🚢 Shipped + a Title + Made for order | **Packing list**: `Pallet · PO · Part # · Description · Item No. · Boxes (CTN) · Pieces (QTY PCS) · Pcs per box · Price per piece · Weight each (lb)` + a `TOTAL` row | `Packing list` |

The vendor's own CIPL / detailed packing list can also be imported as it is (the importer reads `CTN`, `QTY / PCS`,
`PCS/CTN`, merged 2-row headers). Use the template when the vendor's file is messy.

## 2. The numbers (most important — docs/ORDERS-AND-CONTAINERS.md)

- **Order sheets: the CARTONS are the number** (owner 2026-10-20: "the cartons are our boxes — use that number instead
  of QTY"). Units = Cases × bags per carton: the sheet's `Master Carton (pcs)` ÷ pack size, else ✏️ Case qty, else SKU
  Mgr Ea/Case ÷ pack size, else the vendor info sheet's carton. QTY is only used when no carton size is known; the
  📋 Import check lists every line where QTY and cartons disagree, and every line that used QTY.
- **Container packing lists:** Boxes (CTN) per pallet and Pieces (QTY PCS); units = pieces ÷ pack size. Pcs per box is
  checked against them (a difference is listed to count on arrival). Keep the TOTAL row so the import refuses a file that
  does not add up.
- Never invent or round a quantity. A line with a part # but no cartons / pieces is listed, not guessed.

## 3. Part #s

- Our part # format: `24-6-7=10`, `30-4-6=10X`, `24-2-1&2=10X`. One row per pack size.
- The importer cleans `==` → `=`, a trailing `-` / `_` / `.` / `+`, and `=10-X` → `=10X`. A vendor code that is not our
  part # is mapped once with ✏️ / "Map to part #" (remembered for every import).
- `…C=…` part #s that are their own item (vendor list) stay as written.
- UPCs as TEXT (leading zeros stay); the outside box UPC in `Outside Box UPC Code`, the inside bag UPC in `Inside Bag UPC
  Code` (26-4-3=100 once had them swapped — 🔢 Check every UPC catches it).

## 4. Doing it (for Claude)

1. Read every tab of the vendor's file; find the header row (it may not be row 1; JQ and EFF put a title block on top).
2. Map each vendor column to the template column above, by meaning (not position), the same way for JQ #1 and EFF #2 —
   only the vendor picked on Reorder differs. Names the importer already understands: cartons = `Cartons` / `Cases` /
   `CTN` / `CTNS` / `Boxes`; pieces = `QTY` / `PCS` / `Quantity`; pieces per carton = `PCS/CTN` / `per carton` /
   `Master Carton`. If a column's meaning is unclear (bags or pieces? per carton or total?), ask the owner — don't guess.
   (No EFF or JQ sample file is kept in this repo yet; when the owner sends one, note its exact column names here.)
3. Write the template file (.xlsx, the tab name from the table above, UPC columns as text).
4. Check before handing it back, and show the owner a table: lines, part #s, cartons, pieces (and pallets for a
   container) in the vendor's file vs in ours — each ✅ match. Anything left out is listed with why.
5. The owner imports it: Reorder → Vendor (#1 / #2 / #3) → Title → Stage → ⬆ Import vendor sheet, then reads the
   📋 Import check (cartons counted, QTY that disagreed, lines not counted).
