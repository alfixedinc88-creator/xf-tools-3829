// Profit check — the pure math, no D1 / network here, so it can be tested
// with plain Node (profit-worker/test/calc.test.mjs).
//
// Money signs used everywhere below:
//   revenue      = what the buyer paid us for the item (price + shipping
//                  charged + gift wrap …) less promotions. Tax is NOT
//                  revenue: Amazon collects and pays it (tax_collected +
//                  tax_withheld, kept on each line for the record).
//   fees         = what Amazon kept, as a positive cost (a refunded fee is
//                  a negative cost).
//   label        = shipping label we paid (FBM orders only; the FBA fee
//                  already covers FBA shipping).
//   cost         = product cost = units × pieces per unit × cost per piece.
//   profit       = revenue − fees − label − cost.

const r2 = v => Math.round((+v || 0) * 100) / 100;
const r4 = v => Math.round((+v || 0) * 10000) / 10000;
const amt = m => (m && m.CurrencyAmount != null ? +m.CurrencyAmount : 0) || 0;
const cur = m => (m && m.CurrencyCode) || '';

// "4-2-3==2" → "4-2-3=2", "24-4-7=1__" → "24-4-7=1" (same clean-up the Reorder Planner uses).
export function cleanPart(s) {
  return String(s || '').trim().toUpperCase().replace(/\s*=\s*/g, '=').replace(/=+/g, '=').replace(/[_\-.\s]+$/, '');
}
// A real part #: digits-digits-digits(&digits)(=pack…). Legacy random Amazon MSKUs are not.
export function isPartNumber(s) {
  return /^\d+(-\d+){1,3}(&\d+)?[A-Z]?(=\d+[A-Z]*)?$/.test(s);
}
export function baseOf(part) { return String(part || '').split('=')[0]; }
// Pieces in one unit sold: the number right after the last '=' (30-3-4=10X → 10). No '=' → 1.
export function packOf(part) {
  const s = String(part || '');
  if (s.indexOf('=') === -1) return 1;
  const m = s.split('=').pop().match(/^(\d+)/);
  return m && +m[1] > 0 ? +m[1] : 1;
}

const isTax = t => /tax/i.test(t || '');
function feeBucket(type) {
  if (type === 'Commission') return 'referral';
  if (/^FBA/i.test(type || '')) return 'fba';
  return 'other';
}

function lineFromItem(kind, ev, it) {
  const charges = kind === 'S' ? it.ItemChargeList : it.ItemChargeAdjustmentList;
  const fees = kind === 'S' ? it.ItemFeeList : it.ItemFeeAdjustmentList;
  const promos = kind === 'S' ? it.PromotionList : it.PromotionAdjustmentList;
  const L = {
    kind, order_id: ev.AmazonOrderId || '', posted_date: ev.PostedDate || '', marketplace: ev.MarketplaceName || '',
    sku: String(it.SellerSKU || '').trim(), order_item_id: String((kind === 'S' ? it.OrderItemId : (it.OrderAdjustmentItemId || it.OrderItemId)) || ''),
    qty: +it.QuantityShipped || 0,
    item_price: 0, shipping_charged: 0, other_charges: 0, promotions: 0,
    tax_collected: 0, tax_withheld: 0,
    referral_fee: 0, fba_fee: 0, other_fees: 0, fee_detail: {}, currency: '',
  };
  for (const c of charges || []) {
    const a = amt(c.ChargeAmount); L.currency = L.currency || cur(c.ChargeAmount);
    if (isTax(c.ChargeType)) L.tax_collected += a;
    else if (c.ChargeType === 'Principal') L.item_price += a;
    else if (c.ChargeType === 'ShippingCharge') L.shipping_charged += a;
    else L.other_charges += a;
  }
  for (const f of fees || []) {
    const cost = -amt(f.FeeAmount); L.currency = L.currency || cur(f.FeeAmount);
    L[feeBucket(f.FeeType) + (feeBucket(f.FeeType) === 'other' ? '_fees' : '_fee')] += cost;
    L.fee_detail[f.FeeType] = r4((L.fee_detail[f.FeeType] || 0) + cost);
  }
  for (const p of promos || []) { L.promotions += amt(p.PromotionAmount); L.currency = L.currency || cur(p.PromotionAmount); }
  for (const w of it.ItemTaxWithheldList || []) for (const t of w.TaxesWithheld || []) L.tax_withheld += amt(t.ChargeAmount);
  for (const k of ['item_price', 'shipping_charged', 'other_charges', 'promotions', 'tax_collected', 'tax_withheld', 'referral_fee', 'fba_fee', 'other_fees']) L[k] = r4(L[k]);
  L.currency = L.currency || 'USD';
  L.line_key = [kind, L.order_id, L.order_item_id, L.sku, L.posted_date].join('|');
  return L;
}

// listFinancialEvents payload.FinancialEvents → { lines, other }.
//   lines — one per order item shipped (kind 'S') or refunded (kind 'R').
//   other — every other money event (storage, subscription, reimbursement,
//           coupons, ads …) as {key, list, type, posted_date, sku, amount},
//           shown on the page as "not tied to one order" — never dropped.
export function parseFinancialEvents(fe) {
  fe = fe || {};
  const lines = [], other = [];
  for (const ev of fe.ShipmentEventList || []) for (const it of ev.ShipmentItemList || []) lines.push(lineFromItem('S', ev, it));
  for (const ev of fe.RefundEventList || []) for (const it of ev.ShipmentItemAdjustmentList || []) lines.push(lineFromItem('R', ev, it));
  const add = (list, type, posted, sku, amount, currency, id) => {
    other.push({ key: [list, type, posted, sku || '', id || '', r4(amount)].join('|'), list, type: type || list, posted_date: posted || '', sku: sku || '', amount: r4(amount), currency: currency || 'USD' });
  };
  for (const ev of fe.ServiceFeeEventList || []) {
    for (const f of ev.FeeList || []) add('ServiceFee', f.FeeType || ev.FeeReason, ev.PostedDate || '', ev.SellerSKU, amt(f.FeeAmount), cur(f.FeeAmount), ev.AmazonOrderId || ev.FeeDescription);
  }
  for (const ev of fe.AdjustmentEventList || []) {
    const items = ev.AdjustmentItemList || [];
    if (items.length) items.forEach((i, n) => add('Adjustment', ev.AdjustmentType, ev.PostedDate, i.SellerSKU, amt(i.TotalAmount), cur(i.TotalAmount), n));
    else add('Adjustment', ev.AdjustmentType, ev.PostedDate, '', amt(ev.AdjustmentAmount), cur(ev.AdjustmentAmount));
  }
  // Anything else Amazon sends (chargebacks, guarantee claims, coupons, ads,
  // removals …): keep the list name and every money field we can find.
  const known = new Set(['ShipmentEventList', 'RefundEventList', 'ServiceFeeEventList', 'AdjustmentEventList']);
  for (const [list, evs] of Object.entries(fe)) {
    if (known.has(list) || !Array.isArray(evs)) continue;
    evs.forEach((ev, n) => {
      const money = sumMoney(ev);
      if (money.amount) add(list.replace(/EventList$/, ''), ev.TransactionType || ev.Type || ev.FeeType || ev.ChargeType || list.replace(/EventList$/, ''),
        ev.PostedDate || ev.postedDate || '', ev.SellerSKU || ev.SKU || '', money.amount, money.currency, ev.AmazonOrderId || ev.CouponId || ev.ReimbursementId || n);
    });
  }
  return { lines, other };
}
// Sum of the top-level money of an unknown event: prefer a "Total…" field, else every {CurrencyAmount} one level down.
function sumMoney(ev) {
  let total = null, currency = '';
  for (const [k, v] of Object.entries(ev || {})) {
    if (v && typeof v === 'object' && v.CurrencyAmount != null && /total/i.test(k)) { total = (total || 0) + amt(v); currency = cur(v); }
  }
  if (total == null) {
    total = 0;
    for (const v of Object.values(ev || {})) if (v && typeof v === 'object' && v.CurrencyAmount != null) { total += amt(v); currency = currency || cur(v); }
  }
  return { amount: total, currency };
}

// Cost per piece for a base part #, by the chosen basis.
//   cogs:   { [BASE]: { unit_price, landed_cogs } }
//   layers: { [BASE]: { cases, value } }   (value = Σ cases × price per piece, current stock batches)
export function costPerPiece(base, basis, cogs, layers) {
  const c = cogs[base];
  const unit = c && +c.unit_price > 0 ? +c.unit_price : 0;
  if (basis === 'batch') {
    const l = layers && layers[base];
    if (l && l.cases > 0 && l.value > 0) return { cpp: l.value / l.cases, src: 'stock batches (avg)' };
    if (unit) return { cpp: unit, src: 'unit price (no batches)' };
    return null;
  }
  if (basis === 'landed') {
    if (c && +c.landed_cogs > 0) return { cpp: +c.landed_cogs, src: 'landed (×1.5)' };
    if (unit) return { cpp: unit * 1.5, src: 'landed (×1.5)' };
    return null;
  }
  if (unit) return { cpp: unit, src: 'unit price' };
  return null;
}

// Which part # a seller SKU is: the Reorder Planner's alias (✏️ SKU fixes) first, else the SKU itself.
export function partForSku(sku, alias) {
  const up = String(sku || '').trim().toUpperCase();
  const a = alias[up] || alias[cleanPart(up)];
  const part = cleanPart(a || up);
  return { part, mapped: !!a, isPart: isPartNumber(part) };
}

// The whole profit table.
//   lines        — order / refund lines in the window (from profit_amazon_order_fees)
//   orderLines   — every 'S' line of those orders (also outside the window) for splitting a label
//   orders       — { [order_id]: { channel: 'AFN'|'MFN' } } from the Orders API
//   labels       — { [order_id]: total label cost } (distinct tracking #s)
//   cogs, layers, alias, settings { costBasis, thinPct }
export function buildProfit({ lines, orderLines, orders, labels, cogs, layers, alias, settings }) {
  settings = settings || {};
  const basis = settings.costBasis || 'landed';
  const thin = settings.thinPct != null ? +settings.thinPct : 15;
  orders = orders || {}; labels = labels || {}; alias = alias || {}; cogs = cogs || {}; layers = layers || {};

  // Shares of each FBM order's label: by the line's price + shipping charged, else by units. Shares add up to 100%.
  const byOrder = {};
  for (const l of orderLines || lines) if (l.kind === 'S') (byOrder[l.order_id] = byOrder[l.order_id] || new Map()).set(l.line_key, l);
  for (const l of lines) if (l.kind === 'S') (byOrder[l.order_id] = byOrder[l.order_id] || new Map()).set(l.line_key, l);
  const channelOf = l => {
    const o = orders[l.order_id];
    if (o && (o.channel === 'AFN' || o.channel === 'MFN')) return { ch: o.channel, guessed: false };
    const ls = [...((byOrder[l.order_id] && byOrder[l.order_id].values()) || [])];
    if (ls.some(x => x.fba_fee > 0)) return { ch: 'AFN', guessed: false };
    if (labels[l.order_id] != null) return { ch: 'MFN', guessed: false };
    return { ch: 'MFN', guessed: true };
  };
  const labelShare = l => {
    const total = labels[l.order_id];
    if (total == null) return null;
    const ls = [...byOrder[l.order_id].values()];
    const w = x => Math.max(0, x.item_price + x.shipping_charged);
    const sumW = ls.reduce((a, x) => a + w(x), 0);
    if (sumW > 0) return total * w(l) / sumW;
    const sumQ = ls.reduce((a, x) => a + x.qty, 0);
    return sumQ > 0 ? total * l.qty / sumQ : total / ls.length;
  };

  const rows = {}, detail = {}, fromLines = {};
  for (const l of lines) {
    const k = l.sku + '|' + l.marketplace + '|' + l.currency;
    const pm = partForSku(l.sku, alias);
    const cp = pm.isPart ? costPerPiece(baseOf(pm.part), basis, cogs, layers) : null;
    const pack = packOf(pm.part);
    const r = rows[k] = rows[k] || {
      key: k, sku: l.sku, marketplace: l.marketplace, currency: l.currency, part: pm.isPart ? pm.part : '', mapped: pm.mapped,
      base: pm.isPart ? baseOf(pm.part) : '', pack, costPerPiece: cp ? r4(cp.cpp) : null, costSrc: cp ? cp.src : null,
      units: 0, refundedUnits: 0, orders: 0, revenue: 0, refunds: 0, fees: 0, referral: 0, fba: 0, otherFees: 0,
      label: 0, cost: 0, noCostUnits: 0, fbmNoLabel: 0, channelGuessed: 0, fba_units: 0, fbm_units: 0, _orders: new Set(),
    };
    const ch = channelOf(l);
    const revenue = l.item_price + l.shipping_charged + l.other_charges + l.promotions;
    const fees = l.referral_fee + l.fba_fee + l.other_fees;
    let label = 0, cost = 0, flags = [];
    if (l.kind === 'S') {
      r.units += l.qty; r._orders.add(l.order_id);
      if (ch.ch === 'AFN') r.fba_units += l.qty; else r.fbm_units += l.qty;
      if (ch.guessed) { r.channelGuessed++; flags.push('FBM guessed'); }
      if (ch.ch === 'MFN') {
        const s = labelShare(l);
        if (s == null) { r.fbmNoLabel++; flags.push('no label cost'); } else label = s;
      }
      if (cp) cost = l.qty * pack * cp.cpp;
      else { r.noCostUnits += l.qty; flags.push('no cost'); }
    } else {
      r.refundedUnits += l.qty; r.refunds += revenue;
      // A refund gives back the money and some fees; the product cost is NOT
      // given back (we don't know if the item came back sellable).
    }
    r.revenue += revenue; r.fees += fees; r.referral += l.referral_fee; r.fba += l.fba_fee; r.otherFees += l.other_fees;
    r.label += label; r.cost += cost;
    const f = fromLines[l.currency] = fromLines[l.currency] || { units: 0, revenue: 0, fees: 0, label: 0, cost: 0 };
    if (l.kind === 'S') f.units += l.qty;
    f.revenue += revenue; f.fees += fees; f.label += label; f.cost += cost;
    (detail[k] = detail[k] || []).push({
      kind: l.kind, order_id: l.order_id, posted_date: l.posted_date, qty: l.qty, channel: ch.ch,
      item_price: l.item_price, shipping_charged: l.shipping_charged, other_charges: l.other_charges, promotions: l.promotions,
      referral_fee: l.referral_fee, fba_fee: l.fba_fee, other_fees: l.other_fees, fee_detail: l.fee_detail,
      tax_collected: l.tax_collected, tax_withheld: l.tax_withheld,
      revenue: r2(revenue), fees: r2(fees), label: r2(label), cost: r2(cost),
      profit: l.kind === 'S' && !cp ? null : r2(revenue - fees - label - cost), flags,
    });
  }

  const out = Object.values(rows).map(r => {
    const hasCost = r.noCostUnits === 0;
    const profit = r.revenue - r.fees - r.label - r.cost;
    const margin = r.revenue > 0 ? profit / r.revenue * 100 : null;
    let status = 'good';
    if (!hasCost) status = 'nocost';
    else if (profit < 0) status = 'loss';
    else if (margin == null || margin < thin) status = 'thin';
    return {
      key: r.key, sku: r.sku, marketplace: r.marketplace, currency: r.currency, part: r.part, mapped: r.mapped, base: r.base, pack: r.pack,
      costPerPiece: r.costPerPiece, costSrc: r.costSrc,
      units: r.units, refundedUnits: r.refundedUnits, orders: r._orders.size, fbaUnits: r.fba_units, fbmUnits: r.fbm_units,
      revenue: r2(r.revenue), refunds: r2(r.refunds), fees: r2(r.fees), referral: r2(r.referral), fba: r2(r.fba), otherFees: r2(r.otherFees),
      label: r2(r.label), cost: r2(r.cost),
      profit: hasCost ? r2(profit) : null, profitBeforeCost: r2(r.revenue - r.fees - r.label),
      perUnit: hasCost && r.units > 0 ? r2(profit / r.units) : null,
      margin: hasCost && margin != null ? Math.round(margin * 10) / 10 : null,
      status, noCostUnits: r.noCostUnits, fbmNoLabel: r.fbmNoLabel, channelGuessed: r.channelGuessed,
    };
  });

  // Totals per currency — computed twice: once from the rows, once straight
  // from the lines. The page shows both and ✅ only when they match.
  const totals = {};
  for (const r of out) {
    const t = totals[r.currency] = totals[r.currency] || { currency: r.currency, listings: 0, units: 0, refundedUnits: 0, revenue: 0, fees: 0, label: 0, cost: 0, profit: 0, noCostListings: 0, noCostRevenue: 0 };
    t.listings++; t.units += r.units; t.refundedUnits += r.refundedUnits; t.revenue += r.revenue; t.fees += r.fees; t.label += r.label; t.cost += r.cost;
    if (r.profit == null) { t.noCostListings++; t.noCostRevenue += r.revenue; } else t.profit += r.profit;
  }
  for (const c of Object.keys(totals)) {
    const t = totals[c], f = fromLines[c];
    for (const k of ['revenue', 'fees', 'label', 'cost', 'profit', 'noCostRevenue']) t[k] = r2(t[k]);
    t.margin = t.revenue - t.noCostRevenue > 0 ? Math.round(t.profit / (t.revenue - t.noCostRevenue) * 1000) / 10 : null;
    t.check = {
      units: [t.units, f.units], revenue: [t.revenue, r2(f.revenue)], fees: [t.fees, r2(f.fees)], label: [t.label, r2(f.label)], cost: [t.cost, r2(f.cost)],
    };
    // Rows are rounded to the cent, so allow ½ cent per listing of rounding.
    t.checkOk = Object.values(t.check).every(([a, b]) => Math.abs(a - b) <= 0.005 * t.listings + 0.001);
  }
  return { rows: out, detail, totals: Object.values(totals), settings: { costBasis: basis, thinPct: thin } };
}

// "Try a price": profit of one unit at a new price, from Amazon's fee estimate.
export function tryPrice({ price, shipping, fees, label, pieces, cpp }) {
  const revenue = (+price || 0) + (+shipping || 0);
  const cost = cpp != null ? (+pieces || 1) * cpp : null;
  const profit = cost == null ? null : revenue - (+fees || 0) - (+label || 0) - cost;
  return {
    revenue: r2(revenue), fees: r2(fees), label: r2(label), cost: cost == null ? null : r2(cost),
    profit: profit == null ? null : r2(profit), margin: profit == null || revenue <= 0 ? null : Math.round(profit / revenue * 1000) / 10,
  };
}
