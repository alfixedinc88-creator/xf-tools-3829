// Numbers check for the Profit Check (CLAUDE.md: numbers must add up).
// Run:  node profit-worker/test/calc.test.mjs
// Realistic data: one part (30-3-4) sold in 4 pack sizes (=5 via an old
// Amazon MSKU, =10X FBA, =50 FBM, =100 FBM), a 2-item FBM order sharing one
// label, a promotion, a refund, a SKU with no part #, a part # with no cost,
// account fees (subscription, storage, reimbursement), and the same Amazon
// page pulled twice. Every expected number below is worked out by hand.
import { parseFinancialEvents, buildProfit, packOf, partForSku, tryPrice } from '../src/calc.js';

const $ = a => ({ CurrencyCode: 'USD', CurrencyAmount: a });
const ch = (t, a) => ({ ChargeType: t, ChargeAmount: $(a) });
const fee = (t, a) => ({ FeeType: t, FeeAmount: $(a) });
const item = (sku, id, qty, charges, fees, promos, withheld) => ({
  SellerSKU: sku, OrderItemId: id, QuantityShipped: qty, ItemChargeList: charges, ItemFeeList: fees || [],
  PromotionList: (promos || []).map(a => ({ PromotionType: 'Coupon', PromotionId: 'P', PromotionAmount: $(a) })),
  ItemTaxWithheldList: withheld ? [{ TaxCollectionModel: 'MarketplaceFacilitator', TaxesWithheld: [ch('MarketplaceFacilitatorTax-Principal', withheld)] }] : [],
});
const ship = (order, date, items) => ({ AmazonOrderId: order, PostedDate: date, MarketplaceName: 'Amazon.com', ShipmentItemList: items });

const page = {
  ShipmentEventList: [
    // A — FBA, 2 × 30-3-4=10X, tax collected and withheld by Amazon
    ship('111-A', '2026-09-20T10:00:00Z', [item('30-3-4=10X', 'a1', 2, [ch('Principal', 25.98), ch('Tax', 1.82)], [fee('Commission', -3.90), fee('FBAPerUnitFulfillmentFee', -6.44)], [], -1.82)]),
    // B — FBM, one order, two pack sizes, ONE label ($8.40) to split
    ship('111-B', '2026-09-21T10:00:00Z', [
      item('30-3-4=50', 'b1', 1, [ch('Principal', 19.99)], [fee('Commission', -3.00)]),
      item('30-3-4=100', 'b2', 1, [ch('Principal', 34.99)], [fee('Commission', -5.25)])]),
    // C — FBM =100 with shipping charged and a $3 coupon, label $7.10
    ship('111-C', '2026-09-22T10:00:00Z', [item('30-3-4=100', 'c1', 1, [ch('Principal', 34.99), ch('ShippingCharge', 4.99)], [fee('Commission', -5.70)], [-3.00])]),
    // D — FBA =10X, refunded below
    ship('111-D', '2026-09-23T10:00:00Z', [item('30-3-4=10X', 'd1', 1, [ch('Principal', 12.99)], [fee('Commission', -1.95), fee('FBAPerUnitFulfillmentFee', -3.22)])]),
    // E — old Amazon MSKU, mapped to 30-3-4=5 in the Reorder Planner; FBM, label $5.00
    ship('111-E', '2026-09-24T10:00:00Z', [item('AB-XY12-QZ', 'e1', 3, [ch('Principal', 19.47)], [fee('Commission', -2.92)])]),
    // F — MSKU with no part # at all, not in the Orders table, no label
    ship('111-F', '2026-09-25T10:00:00Z', [item('ZZ-9999', 'f1', 1, [ch('Principal', 9.99)], [fee('Commission', -1.50)])]),
    // G — FBA part # with no cost on file
    ship('111-G', '2026-09-26T10:00:00Z', [item('28-2-8=25', 'g1', 1, [ch('Principal', 15.99)], [fee('Commission', -2.40), fee('FBAPerUnitFulfillmentFee', -3.86)])]),
  ],
  RefundEventList: [{
    AmazonOrderId: '111-D', PostedDate: '2026-09-27T10:00:00Z', MarketplaceName: 'Amazon.com',
    ShipmentItemAdjustmentList: [{ SellerSKU: '30-3-4=10X', OrderAdjustmentItemId: 'd1r', QuantityShipped: 1,
      ItemChargeAdjustmentList: [ch('Principal', -12.99)], ItemFeeAdjustmentList: [fee('Commission', 1.95), fee('RefundCommission', -0.39)] }],
  }],
  ServiceFeeEventList: [{ PostedDate: '2026-09-15T00:00:00Z', FeeList: [fee('Subscription', -39.99)] }],
  AdjustmentEventList: [{ AdjustmentType: 'REVERSAL_REIMBURSEMENT', PostedDate: '2026-09-18T00:00:00Z', AdjustmentAmount: $(10.00),
    AdjustmentItemList: [{ SellerSKU: '30-3-4=10X', Quantity: '1', TotalAmount: $(10.00) }] }],
  FBALiquidationEventList: [],
  StorageFeeEventList: [{ PostedDate: '2026-09-10T00:00:00Z', TotalAmount: $(-12.34) }],
};

let fails = 0;
const eq = (name, got, want) => {
  const ok = typeof want === 'number' ? Math.abs(got - want) < 0.005 : got === want;
  if (!ok) fails++;
  console.log(`${ok ? '✅' : '❌'} ${name}: expected ${want}, counted ${got}`);
  return ok;
};

// Pulling the same page twice must not count anything twice (the DB saves by line_key).
const p1 = parseFinancialEvents(page), p2 = parseFinancialEvents(page);
const byKey = new Map(); [...p1.lines, ...p2.lines].forEach(l => byKey.set(l.line_key, l));
const otherByKey = new Map(); [...p1.other, ...p2.other].forEach(o => otherByKey.set(o.key, o));
const lines = [...byKey.values()];
console.log('— Parsing Amazon finance events');
eq('order lines after pulling the page twice', lines.length, 9);
eq('other (not per-order) events', otherByKey.size, 3);
eq('other events total $', [...otherByKey.values()].reduce((a, o) => a + o.amount, 0), -39.99 + 10.00 - 12.34);
// Amazon's own payout for line A = all charges + fees + promos + tax withheld = our revenue − fees (tax nets to 0).
const A = lines.find(l => l.order_id === '111-A');
eq('line A: Amazon payout = revenue − fees', A.item_price + A.tax_collected + A.tax_withheld - (A.referral_fee + A.fba_fee + A.other_fees), 25.98 - 10.34);

console.log('— Pack sizes');
eq('30-3-4=10X pieces', packOf('30-3-4=10X'), 10);
eq('30-3-4=5 pieces', packOf('30-3-4=5'), 5);
eq('30-3-4 (no =) pieces', packOf('30-3-4'), 1);
eq('old MSKU maps to part #', partForSku('ab-xy12-qz', { 'AB-XY12-QZ': '30-3-4=5' }).part, '30-3-4=5');

const input = {
  lines, orderLines: lines,
  orders: { '111-A': { channel: 'AFN' }, '111-B': { channel: 'MFN' }, '111-C': { channel: 'MFN' }, '111-D': { channel: 'AFN' }, '111-E': { channel: 'MFN' }, '111-G': { channel: 'AFN' } },
  labels: { '111-B': 8.40, '111-C': 7.10, '111-E': 5.00 },
  cogs: { '30-3-4': { unit_price: 0.20, landed_cogs: 0.30 } },
  layers: {}, alias: { 'AB-XY12-QZ': '30-3-4=5' },
  settings: { costBasis: 'landed', thinPct: 15 },
};
const res = buildProfit(input);
const row = sku => res.rows.find(r => r.sku === sku);

console.log('— Per listing (landed cost $0.30 / piece)');
const X = row('30-3-4=10X');
eq('=10X units', X.units, 3); eq('=10X refunded units', X.refundedUnits, 1);
eq('=10X revenue (25.98 + 12.99 − 12.99)', X.revenue, 25.98);
eq('=10X fees (10.34 + 5.17 − 1.95 + 0.39)', X.fees, 13.95);
eq('=10X label (FBA)', X.label, 0);
eq('=10X cost (3 × 10 pcs × 0.30; refund not given back)', X.cost, 9.00);
eq('=10X profit', X.profit, 3.03); eq('=10X status (11.7% < 15%)', X.status, 'thin');
const F50 = row('30-3-4=50');
eq('=50 label share (8.40 × 19.99 / 54.98)', F50.label, 3.05);
eq('=50 cost (50 pcs × 0.30)', F50.cost, 15.00);
eq('=50 profit (19.99 − 3.00 − 3.0541 − 15)', F50.profit, -1.06); eq('=50 status', F50.status, 'loss');
const H = row('30-3-4=100');
eq('=100 units', H.units, 2);
eq('=100 revenue (34.99 + 34.99 + 4.99 − 3.00)', H.revenue, 71.97);
eq('=100 label (5.3459 + 7.10)', H.label, 12.45);
eq('=100 cost (2 × 100 × 0.30)', H.cost, 60.00);
eq('=100 profit', H.profit, -11.43); eq('=100 status', H.status, 'loss');
eq('label shares of order B add up to 100%', F50.label + H.label - 7.10, 8.40);
const E = row('AB-XY12-QZ');
eq('old MSKU part #', E.part, '30-3-4=5'); eq('old MSKU cost (3 × 5 × 0.30)', E.cost, 4.50);
eq('old MSKU profit (19.47 − 2.92 − 5.00 − 4.50)', E.profit, 7.05); eq('old MSKU status', E.status, 'good');
const Z = row('ZZ-9999');
eq('no-part MSKU profit is blank, not 0', Z.profit, null); eq('no-part MSKU status', Z.status, 'nocost');
eq('no-part MSKU flagged: FBM guessed', Z.channelGuessed, 1); eq('no-part MSKU flagged: no label', Z.fbmNoLabel, 1);
const G = row('28-2-8=25');
eq('part # with no cost: status', G.status, 'nocost'); eq('part # with no cost: profit before cost', G.profitBeforeCost, 15.99 - 6.26);

console.log('— Totals (USD) = sum of rows = sum of lines');
const T = res.totals[0];
const sum = k => res.rows.reduce((a, r) => a + (r[k] || 0), 0);
eq('units', T.units, 11); eq('units = sum of rows', T.units, sum('units'));
eq('revenue', T.revenue, 163.39); eq('revenue = sum of rows', T.revenue, sum('revenue'));
eq('fees', T.fees, 38.58); eq('fees = sum of rows', T.fees, sum('fees'));
eq('labels (8.40 + 7.10 + 5.00)', T.label, 20.50); eq('labels = sum of rows', T.label, sum('label'));
eq('product cost', T.cost, 88.50); eq('cost = sum of rows', T.cost, sum('cost'));
eq('profit of listings with a cost', T.profit, -2.41); eq('profit = sum of rows', T.profit, sum('profit'));
eq('listings with no cost (shown, not in profit)', T.noCostListings, 2);
eq('their revenue', T.noCostRevenue, 25.98);
eq('rows-vs-lines self check', T.checkOk, true);
eq('every line is in some row', res.rows.reduce((a, r) => a + (res.detail[r.key] || []).length, 0), lines.length);

console.log('— Cost basis switch (unit price $0.20 / piece)');
const U = buildProfit({ ...input, settings: { costBasis: 'unit', thinPct: 15 } });
eq('cost at unit price (88.50 × 0.20 / 0.30)', U.totals[0].cost, 59.00);
eq('profit at unit price (−2.41 + 29.50)', U.totals[0].profit, 27.09);

console.log('— Try a price');
const t = tryPrice({ price: 39.99, shipping: 0, fees: 6.00, label: 7.10, pieces: 100, cpp: 0.30 });
eq('try $39.99 for =100 FBM: profit (39.99 − 6.00 − 7.10 − 30)', t.profit, -3.11);
eq('try a price with no cost on file: profit blank', tryPrice({ price: 10, fees: 1, pieces: 1, cpp: null }).profit, null);

console.log(fails ? `\n❌ ${fails} check(s) failed` : '\n✅ all checks match');
process.exit(fails ? 1 : 0);
