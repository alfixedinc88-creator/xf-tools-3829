# Orders → containers → SKU Mgr: every piece counted once

Owner (2026-10-10): "if we make that simple mistake, we're going to have big issues in the future."
Reorder → 📜 Rules (no double count) shows the same rules on the page.

**Each piece is in ONE place only:**
🏭 still owed on an order → 🚢 on the water in a container → 🏬 in SKU Mgr after 📦 Received.

1. **🏭 Order sheet** (Stage = Ordered). Its quantities count as *still owed by the vendor*.
2. **🚢 Start-ship / container sheet** (Stage = Shipped). Always pick **Made for order**: the order it was made for, or
   **All open orders — oldest first**.
   - Each part # comes off the OLDEST order first (8-18-26 before 9-14-26), then the next one.
   - Example: 8-18-26 ordered 8-8-8 200 pcs and the container ships 200 pcs. 8-18-26 then has **0** left, and the
     200 pcs are counted only on the water.
3. **Vendor codes.** A vendor code fixed with ✏️ (mapped to our part #) is matched as our part #, so it still comes
   off the right order line.
4. **Shipped more than ordered, or not on any order.** The extra counts only on the water. The container's 🔍 Check
   lists it as "not on an order".
5. **The same container imported again** (new packing list, SAME title):
   - What it took before goes back on the order(s), then it is taken again with the new quantities. Never twice.
   - If "Made for order" is left empty, it takes from the same order(s) as last time.
6. **The same order sheet imported again.** The order keeps **ordered − already shipped**, and the page shows this
   after the import. It never puts shipped pieces back on the order.
7. **📦 Received.** The container's lines become a Stock In in SKU Mgr (shown in History) and come OFF "on the water"
   at the same moment. Never also type the same container into SKU Mgr by hand. Receive PO and a hand Stock In do
   NOT take anything off "on the water", so a Reorder container must come in with its 📦 Received button.
8. **🗑 Remove** (cancelled or wrong import). What the container took off orders goes back on those orders. SKU Mgr is
   not touched.
9. **Everything reads the same lines.** The Reorder Planner, 📊 Stock Levels and SKU Mgr's 🚢 incoming all use them:
   what to order = sales need − SKU Mgr − FBA − on the water − still owed.

**Where to check:**
- Reorder → 📋 Still with the vendor: ordered − shipped = still owed ✓, by vendor, with order and ship dates.
- Each order's 📋 What's left.
- Each container's 🔍 Check.
- 📊 Stock Levels (✅ adds up to SKU Mgr + Reorder).
- Every import, take and receive is in Reorder → 📜 History.

Code: `reorderIncomingTake`, `reorderCatalogImport` (subtracts `reorder_take` when an order is re-imported),
`reorderPutBackTakes`, `/reorder/fix/incoming-receive`, `reorderOrdersStatus`, `inventoryStockOverview`.
Checks: the "Orders and containers" block in `tests/keep-working.test.mjs`.
