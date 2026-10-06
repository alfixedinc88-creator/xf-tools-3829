// Keep-working checks — features the owner already asked for that must NOT
// break when something else changes (see CLAUDE.md "Don't change what
// already works"). Runs the real Worker code (worker/src/index.js) against
// an in-memory SQLite copy of the database; no network, no secrets.
//
//   node tests/keep-working.test.mjs        (Node 22+)
//
// Runs on every pull request (.github/workflows/checks.yml). When you fix
// something the owner reported, add a check for it here.
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require0 = createRequire(import.meta.url);

const workerPath = fileURLToPath(new URL('../worker/src/index.js', import.meta.url));
let failed = 0, passed = 0;
const check = (name, ok, got) => { if (ok) { passed++; console.log('  ✅ ' + name); } else { failed++; console.log('  ❌ ' + name + '  — got: ' + JSON.stringify(got)); } };

// ── fake D1 + Google Sheets ─────────────────────────────────────────────
const sq = new DatabaseSync(':memory:');
const norm = v => v === undefined ? null : v;
const DB = { prepare(sql) { let args = []; const st = { bind(...a) { args = a.map(norm); return st; },
  async run() { const r = sq.prepare(sql).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: r.changes } }; },
  async all() { return { results: sq.prepare(sql).all(...args).map(x => ({ ...x })) }; },
  async first() { const r = sq.prepare(sql).get(...args); return r ? { ...r } : null; } }; return st; },
  async batch(l) { for (const s of l) await s.run(); } };
const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const PK = '-----BEGIN PRIVATE KEY-----\n' + Buffer.from(await crypto.subtle.exportKey('pkcs8', kp.privateKey)).toString('base64') + '\n-----END PRIVATE KEY-----';
globalThis.fetch = async (u) => { u = String(u); const J = x => new Response(JSON.stringify(x));
  if (u.includes('oauth2')) return J({ access_token: 't', expires_in: 3600 });
  return J({ values: [], updates: { updatedRange: 'Inventory_Log!A9:R9' }, replies: [] }); };
const env = { DB, CLIENT_EMAIL: 'test@example.com', PRIVATE_KEY: PK, SHEET_ID: 'TEST' };

sq.exec(`CREATE TABLE master_list (id INTEGER PRIMARY KEY, sku TEXT, base_sku TEXT, name TEXT, part_num TEXT, location TEXT, cases REAL, units_per_case REAL, vendor TEXT, price REAL, prev_notes TEXT, sheet_row INTEGER, updated_at TEXT);
INSERT INTO master_list (id, base_sku, name, part_num, location, cases, units_per_case, sheet_row) VALUES
  (1, '23-2-3', 'Tee', '23-2-3=2', 'A1=1-1-1', 5, 100, 2), (2, '23-2-3', 'Tee', '23-2-3=2', 'B1=1-1-1', 3, 100, 3), (3, '40-1-1', 'Elbow', '40-1-1=1', 'C1=1-1-1', 4, 50, 4);
CREATE TABLE inventory_log (id INTEGER PRIMARY KEY AUTOINCREMENT, sheet_row INTEGER, timestamp TEXT, type TEXT, part_num TEXT, location TEXT, cases REAL, initials TEXT, notes TEXT, status TEXT, verified_by TEXT, verified_at TEXT, overwrite_loc TEXT, is_new INTEGER, is_placeholder INTEGER, master_row_index TEXT, sku TEXT, transfer_id TEXT, paired_location TEXT, name TEXT, master_id INTEGER, added_at TEXT, grabbed_at TEXT);
CREATE TABLE locations (location TEXT PRIMARY KEY, prefix TEXT, active INTEGER, created_at TEXT);
CREATE TABLE products (sku TEXT, name TEXT);`);

const worker = (await import(workerPath)).default;
const call = (u, o = {}) => worker.fetch(new Request('https://w' + u, o), env, { waitUntil() {} });
await call('/auth/login', { method: 'POST', body: '{"username":"x","password":"y"}' }); // creates the sign-in tables
const salt = crypto.getRandomValues(new Uint8Array(16));
const km = await crypto.subtle.importKey('raw', new TextEncoder().encode('password1'), 'PBKDF2', false, ['deriveBits']);
const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, km, 256);
const hex = a => [...a].map(b => b.toString(16).padStart(2, '0')).join('');
const u = sq.prepare('INSERT INTO cred_users (username, password_hash, display_name, active, created_at) VALUES (?,?,?,1,?)').run('tester', hex(salt) + ':' + hex(new Uint8Array(bits)), 'TS', new Date().toISOString());
for (const role of ['mgmt', 'ops', 'mobile', 'admin']) sq.prepare('INSERT INTO cred_user_roles (user_id, role) VALUES (?,?)').run(u.lastInsertRowid, role);
const login = await (await call('/auth/login', { method: 'POST', body: '{"username":"tester","password":"password1"}' })).json();
const H = { 'X-Cred-Token': login.token, 'Content-Type': 'application/json' };
const get = async p => (await (await call(p, { headers: H })).json());
const post = async (p, b) => (await (await call(p, { method: 'POST', headers: H, body: JSON.stringify(b) })).json());
const row = id => sq.prepare('SELECT status, total_before b, total_after a, total_warning w FROM inventory_log WHERE id=?').get(id);
const shelf = () => sq.prepare('SELECT SUM(cases) t FROM master_list').get().t;

console.log('\nSign-in');
check('data needs a sign-in (no token → 401)', (await call('/inventory/history?days=1')).status === 401, null);

console.log('\nHistory: Part Total Before → After on every approved entry');
const lo = await post('/inventory/log', { type: 'OUT', partNum: '23-2-3=2', sku: '23-2-3=2', location: 'A1=1-1-1', cases: 2, initials: 'TS', notes: '[SHELVING]', masterId: 1 });
const pend = await get('/inventory/pending');
const it = (pend.items || []).find(x => x.d1Id === lo.d1Id);
check('Stock Out is Pending until approved', it && row(lo.d1Id).status === 'Pending', row(lo.d1Id));
await post('/inventory/verify', { rowIndex: it.rowIndex, action: 'Approved', item: it });
check('manual approve records 8 → 6', row(lo.d1Id).b === 8 && row(lo.d1Id).a === 6, row(lo.d1Id));
await post('/inventory/review-mode', { mode: 'auto' });
const li = await post('/inventory/log', { type: 'IN', partNum: '23-2-3=2', sku: '23-2-3=2', location: 'B1=1-1-1', cases: 4, initials: 'TS', notes: '', masterId: 2 });
check('auto approve records 6 → 10', li.autoApproved && row(li.d1Id).b === 6 && row(li.d1Id).a === 10, row(li.d1Id));
const before = shelf();
const rp = await post('/inventory/receive-apply', { partNum: '40-1-1=1', baseSku: '40-1-1', pallet: 'PO9-1', cases: 6, initials: 'TS' });
const rid = sq.prepare("SELECT MAX(id) id FROM inventory_log WHERE notes LIKE '[RECEIVE PO%'").get().id;
check('Receive PO records 4 → 10', rp.ok && row(rid).b === 4 && row(rid).a === 10, { rp, row: rid && row(rid) });
check('Receive PO: shelf total went up by exactly 6', shelf() === before + 6, { before, after: shelf() });
const hist = await get('/inventory/history?days=1&status=all');
const blank = hist.rows.filter(r => r.status === 'Verified' && /^(IN|OUT)$/.test(r.type) && r.total_before == null && !r.total_warning);
check('History list sends the totals; no approved row is blank', hist.ok && blank.length === 0, blank);
await post('/inventory/review-mode', { mode: 'manual' });

console.log('\nHistory: day cut-off is midnight New York time');
const nyToday = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const yest = (() => { const d = new Date(nyToday + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); })();
const nyOff = k => { const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'shortOffset' }).formatToParts(new Date(k + 'T12:00:00Z')).find(x => x.type === 'timeZoneName').value; const h = parseInt(p.replace('GMT', ''), 10); return (h < 0 ? '-' : '+') + String(Math.abs(h)).padStart(2, '0') + ':00'; };
sq.prepare("INSERT INTO inventory_log (timestamp,type,part_num,location,cases,initials,notes,status) VALUES (?, 'OUT', '23-2-3=2', 'A1=1-1-1', 1, 'YY', '', 'Verified')").run(new Date(yest + 'T23:55:00' + nyOff(yest)).toISOString());
const today = await get('/inventory/history?days=1&status=all');
check('"Today" leaves out yesterday 11:55 PM', !today.rows.some(r => r.initials === 'YY'), today.rows.map(r => r.initials + ' ' + r.timestamp));
const y = await get('/inventory/history-summary?date=' + yest);
check('picking yesterday shows it', y.byPerson.some(p => p.initials === 'YY'), y.byPerson);

console.log('\nHistory report: Starting cases count only approved entries');
await post('/inventory/log', { type: 'OUT', partNum: '23-2-3=2', sku: '23-2-3=2', location: 'A1=1-1-1', cases: 1, initials: 'PP', notes: '', masterId: 1 });
const sm = await get('/inventory/history-summary?days=1');
const netToday = sq.prepare(`SELECT SUM(CASE WHEN type='IN' THEN cases ELSE -cases END) n FROM inventory_log WHERE status='Verified' AND type IN ('IN','OUT') AND timestamp >= ?`).get(new Date(nyToday + 'T00:00:00' + nyOff(nyToday)).toISOString()).n || 0;
check('Ending = shelf total now', sm.endingCases === shelf(), { ending: sm.endingCases, shelf: shelf() });
check('Starting = Ending − approved changes today (pending not counted)', sm.startingCases === sm.endingCases - netToday, { starting: sm.startingCases, ending: sm.endingCases, netToday });

console.log('\nStock Out: product photo by parent part # (from Picking)');
await get('/ship/print-log?date=' + nyToday); // creates the shipping tables
sq.prepare('INSERT INTO ship_manifest_log (date, tracking, line_items) VALUES (?,?,?)').run(nyToday, '1ZTESTPHOTO000001', JSON.stringify([{ s: '1=TEE 1/2', q: 1, b: '23-2-3', i: 'https://img.example/tee.jpg' }]));
const ph = await get('/inventory/photos?bases=23-2-3,40-1-1');
check('photo from a Picking order is saved for its parent part #', ph.photos && ph.photos['23-2-3'] === 'https://img.example/tee.jpg', ph);
const lk = await get('/inventory/lookup?code=23-2-3%3D2');
check('every pack size of the parent shares it (lookup 23-2-3=2)', lk.photo === 'https://img.example/tee.jpg', lk.photo);
await post('/inventory/product-photo', { baseSku: '23-2-3', imageUrl: 'https://img.example/tee-new.jpg', editedBy: 'TS' });
sq.prepare('INSERT INTO ship_manifest_log (date, tracking, line_items) VALUES (?,?,?)').run(nyToday, '1ZTESTPHOTO000002', JSON.stringify([{ s: '2=TEE', q: 1, b: '23-2-3', i: 'https://img.example/other.jpg' }]));
const ph2 = await get('/inventory/photos?bases=23-2-3');
check('a photo set by hand on Product Photos wins', ph2.photos['23-2-3'] === 'https://img.example/tee-new.jpg', ph2);
const u2 = sq.prepare('INSERT INTO cred_users (username, password_hash, display_name, active, created_at) VALUES (?,?,?,1,?)').run('picker', hex(salt) + ':' + hex(new Uint8Array(bits)), 'PK', new Date().toISOString());
sq.prepare('INSERT INTO cred_user_roles (user_id, role) VALUES (?,?)').run(u2.lastInsertRowid, 'ops');
const pk = await (await call('/auth/login', { method: 'POST', body: '{"username":"picker","password":"password1"}' })).json();
const pr = await call('/inventory/product-photo', { method: 'POST', headers: { 'X-Cred-Token': pk.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ baseSku: '23-2-3', imageUrl: 'https://x/y.jpg' }) });
check('only management can change a photo', pr.status === 403, pr.status);
check('photos need a sign-in', (await call('/inventory/photos?bases=23-2-3')).status === 401, null);

// Reorder → container 📦 Received: pieces go into SKU Mgr right, History has totals, pallets are kept, no double receive
console.log('\nReorder → container 📦 Received → SKU Mgr');
sq.prepare("INSERT INTO master_list (base_sku, name, part_num, location, cases, units_per_case) VALUES ('60-1-1','coupling','60-1-1=10','C1=1-1-2',3,100), ('60-1-1','coupling','60-1-1=10','GARAGE',5,100)").run();
const CT = 'Container KW-TEST';
await post('/reorder/vendor-catalog/import', { vendor: 'KW', title: CT, stage: 'shipped', last: true, file: 'kw.xlsx', rows: [
  { part: '60-1-1=10', raw: '60-1-1=10', qty: 400, cases: 20, pcs: 4000, case_pcs: 200, src_rows: '5, 6', description: 'coupling' },
  { part: '60-2-2=1', raw: '60-2-2=1', qty: 1000, cases: 10, pcs: 1000, case_pcs: 100, src_rows: '7', description: 'elbow' } ] });
await post('/reorder/fix/pallets', { title: CT, vendor: 'KW', file: 'kw.xlsx', lines: [
  { pallet: '1', part: '60-1-1=10', raw: '60-1-1=10', cases: 12, pcs: 2400, units: 240, pcsPerCtn: 200, row: '5' },
  { pallet: '2', part: '60-1-1=10', raw: '60-1-1=10', cases: 8, pcs: 1600, units: 160, pcsPerCtn: 200, row: '6' },
  { pallet: '2', part: '60-2-2=1', raw: '60-2-2=1', cases: 10, pcs: 1000, units: 1000, pcsPerCtn: 100, row: '7' } ] });
const pcs = p => sq.prepare('SELECT SUM(cases * units_per_case) t FROM master_list WHERE part_num = ?').get(p).t || 0;
const pcsBefore = [pcs('60-1-1=10'), pcs('60-2-2=1')];
const rcvLines = [{ key: '60-1-1=10', part: '60-1-1=10', cases: 20, description: 'coupling' }, { key: '60-2-2=1', part: '60-2-2=1', cases: 10, description: 'elbow' }];
const rcv = await post('/reorder/fix/incoming-receive', { title: CT, location: 'GARAGE', lines: rcvLines });
check('container Received: SKU Mgr pieces go up by exactly the packing list (4,000 + 1,000)', rcv.ok && pcs('60-1-1=10') === pcsBefore[0] + 4000 && pcs('60-2-2=1') === pcsBefore[1] + 1000, { rcv, before: pcsBefore, after: [pcs('60-1-1=10'), pcs('60-2-2=1')] });
const newRow = sq.prepare("SELECT cases, units_per_case u FROM master_list WHERE part_num='60-2-2=1' AND location='GARAGE'").get();
check('container Received: a new spot gets Each/Case = pieces per box (100)', newRow && newRow.u === 100 && newRow.cases === 10, newRow);
const rl = sq.prepare("SELECT part_num, status, total_before b, total_after a FROM inventory_log WHERE notes LIKE '[RECEIVED] Container KW-TEST%' ORDER BY id").all();
check('container Received: History has Before → After (8 → 28, 0 → 10)', rl.length === 2 && rl.every(r => r.status === 'Verified') && rl[0].b === 8 && rl[0].a === 28 && rl[1].b === 0 && rl[1].a === 10, rl);
// Owner: "we have to stay at 100% match on quantities, can't change any numbers" — boxes of 200 pcs are never turned into cases of 100.
const gRows = sq.prepare("SELECT cases, units_per_case u FROM master_list WHERE part_num='60-1-1=10' AND location='GARAGE' ORDER BY id").all();
check('container Received: GARAGE keeps its 5 cases of 100 pcs; the 20 boxes of 200 pcs get their own row (20 × 200)', gRows.length === 2 && gRows[0].cases === 5 && gRows[0].u === 100 && gRows[1].cases === 20 && gRows[1].u === 200, gRows);
const pr2 = await get('/inventory/pallets/received');
const kwp = (pr2.lines || pr2.pallets || pr2.rows || []).filter(x => x.title === CT);
check('container Received: every pallet line is still listed, at GARAGE', kwp.length === 3 && kwp.every(x => x.location === 'GARAGE'), pr2);
// Owner: "when we do the inventory out / stock out reports, let them know which pallet that inventory is on".
const wh = await post('/inventory/containers/where', { parts: ['60-1-1=10', '60-2-2=1', '99-9-9=1'] });
const w1 = (wh.where || {})['60-1-1=10'] || [], w2 = (wh.where || {})['60-2-2=1'] || [];
check('Stock Out: which pallet — 60-1-1=10 on pallets 1 (12 boxes) and 2 (8), 60-2-2=1 on pallet 2 (10), all stocked in at GARAGE; unknown part: none',
  wh.ok && w1.length === 2 && w1.some(x => x.pallet === '1' && x.left === 12) && w1.some(x => x.pallet === '2' && x.left === 8) && w2.length === 1 && w2[0].pallet === '2' && w2[0].left === 10
    && w1.concat(w2).every(x => x.location === 'GARAGE' && x.title === CT) && !(wh.where || {})['99-9-9=1'], wh);
const invH = (await import('node:fs')).readFileSync(fileURLToPath(new URL('../inventory.html', import.meta.url)), 'utf8');
// Owner: "use the FBA one on location first if the rest is still on pallets — pallets are hard to get at".
const lkP = await get('/inventory/lookup?code=' + encodeURIComponent('60-1-1=10'));
const lkG = (lkP.locations || []).find(l => l.location === 'GARAGE'), lkC = (lkP.locations || []).find(l => l.location === 'C1=1-1-2');
check('Stock Out lookup marks boxes still on pallets per spot: GARAGE 60-1-1=10 has 20 on pallets, the shelf spot none', lkG && lkG.palletBoxes === 20 && lkC && !lkC.palletBoxes, { lkG, lkC });
check('Stock Out picks shelf spots (FBA bags too) before spots still on pallets, on both tabs; Pull List 🔁 Replace; None Found offers one more spot',
  /function invOnPallet\(l\)/.test(invH) && (invH.match(/\[false, true\]\.forEach\(function\(onPal\)/g) || []).length === 2 && /if \(a\._pick\.pallet !== b\._pick\.pallet\)/.test(invH)
  && /if \(A\.pallet !== B\.pallet\)/.test(invH) && /window\.invPalletReplace = function/.test(invH) && /\[REPLACED: asked for /.test(invH)
  && /window\.invNoneFoundAlt = function/.test(invH) && /window\.invNoneFoundNow = function/.test(invH), null);
check('which pallet needs a sign-in', (await call('/inventory/containers/where', { method: 'POST', body: '{"parts":["60-1-1=10"]}' })).status === 401, null);
check('Stock Out pull list, its spot list and Stock Out Reports all show the pallet', /ipull-loc'>" \+ item\.location \+ "<\/div>" \+ invPalletSpan\(item\.partNum/.test(invH)
  && /iloc-name'>" \+ loc\.location \+ "<\/div>" \+ invPalletSpan\(/.test(invH) && /s\.sku \? invPalletSpan\(s\.sku, ''\)/.test(invH), null);
const again = await post('/reorder/fix/incoming-receive', { title: CT, location: 'GARAGE', lines: rcvLines });
check('container Received twice: nothing added the 2nd time', pcs('60-1-1=10') === pcsBefore[0] + 4000 && again.results.every(r => r.skipped), again);

console.log('\nReorder → 🔥 Sold-out pallets report');
const so = await get('/inventory/containers/soldout?title=' + encodeURIComponent(CT));
const soBy = k => so.lines.filter(l => l.part === k);
check('received container: part # with 0 on every shelf before is sold out, on its pallet', so.ok && soBy('60-2-2=1').length === 1 && soBy('60-2-2=1')[0].soldOut && soBy('60-2-2=1')[0].pallet === '2' && soBy('60-2-2=1')[0].basis === 'history' && soBy('60-2-2=1')[0].stockBefore === 0, so);
check('report shows the name and description of each item (not blank)', soBy('60-2-2=1')[0].description === 'elbow' && soBy('60-1-1=10').every(l => l.name === 'coupling' && l.description === 'coupling'), so.lines.map(l => [l.part, l.name, l.description]));
check('received container: part # that had stock (8 cases) is not sold out', soBy('60-1-1=10').length === 2 && soBy('60-1-1=10').every(l => !l.soldOut && l.stockBefore === 8), soBy('60-1-1=10'));
const CT2 = 'Container KW-TEST2';
await post('/reorder/vendor-catalog/import', { vendor: 'KW', title: CT2, stage: 'shipped', last: true, file: 'kw2.xlsx', rows: [
  { part: '60-1-1=10', raw: '60-1-1=10', qty: 100, cases: 5, pcs: 1000, case_pcs: 200, src_rows: '5', description: 'coupling' },
  { part: '60-3-3=1', raw: '60-3-3=1', qty: 300, cases: 3, pcs: 300, case_pcs: 100, src_rows: '6', description: 'tee' } ] });
await post('/reorder/fix/pallets', { title: CT2, vendor: 'KW', file: 'kw2.xlsx', lines: [
  { pallet: 'A', part: '60-1-1=10', raw: '60-1-1=10', cases: 5, pcs: 1000, units: 100, pcsPerCtn: 200, row: '5' },
  { pallet: 'B', part: '60-3-3=1', raw: '60-3-3=1', cases: 3, pcs: 300, units: 300, pcsPerCtn: 100, row: '6' } ] });
sq.prepare("INSERT INTO master_list (base_sku, name, part_num, location, cases, units_per_case) VALUES ('60-3-3','1/2 tee','60-3-3=5','C2=1-1-1',0,500)").run();
const shelfBeforeReport = shelf();
const so2 = await get('/inventory/containers/soldout?title=' + encodeURIComponent(CT2));
check('not received yet: uses SKU Mgr now (60-3-3=1 sold out on pallet B, 60-1-1=10 not)', so2.ok && so2.lines.some(l => l.part === '60-3-3=1' && l.soldOut && l.pallet === 'B' && l.basis === 'now') && so2.lines.some(l => l.part === '60-1-1=10' && !l.soldOut), so2);
check('no name on that part #: uses the name of another pack size of the same parent', so2.lines.some(l => l.part === '60-3-3=1' && l.name === '1/2 tee' && l.description === 'tee'), so2.lines.map(l => [l.part, l.name, l.description]));
check('the report never changes a count', shelf() === shelfBeforeReport, { before: shelfBeforeReport, after: shelf() });
check('the report needs a sign-in', (await call('/inventory/containers/soldout?title=' + encodeURIComponent(CT))).status === 401, null);

console.log('\nContainer here → 🗑 Delete a container put in by mistake');
const mkCont = async (T, part) => {
  await post('/reorder/vendor-catalog/import', { vendor: 'KW', title: T, stage: 'shipped', last: true, file: 'dup.xlsx', rows: [{ part, raw: part, qty: 50, cases: 5, pcs: 500, case_pcs: 100, src_rows: '5', description: 'dup' }] });
  await post('/reorder/fix/pallets', { title: T, vendor: 'KW', file: 'dup.xlsx', lines: [{ pallet: '1', part, raw: part, cases: 5, pcs: 500, units: 50, pcsPerCtn: 100, row: '5' }] });
};
const hasCont = async T => ((await get('/inventory/containers')).containers || []).some(c => c.title === T);
const palletsOf = T => sq.prepare('SELECT COUNT(*) n FROM reorder_pallet WHERE title = ?').get(T).n;
const shelfBeforeDel = shelf();
await mkCont('Container DUP', '60-4-4=1');
const d0 = await post('/inventory/containers/delete', { title: 'Container DUP', reason: 'imported twice' });
check('still On the way: not deleted (remove it on Reorder first)', !d0.ok && /On the way/.test(d0.error) && palletsOf('Container DUP') === 1, d0);
await post('/reorder/fix/incoming-remove', { title: 'Container DUP', reason: 'imported twice' });
check('never 📦 Received (e.g. a double removed on Reorder): not shown in Container here', !(await hasCont('Container DUP')) && palletsOf('Container DUP') === 1, null);
const dNo = await (await call('/inventory/containers/delete', { method: 'POST', headers: { 'X-Cred-Token': pk.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Container DUP', reason: 'x' }) })).status;
check('only management can delete a container', dNo === 403, dNo);
// Owner: "for Inventory → Transfer the container info like Delete container — only Admin level can change it".
const um = sq.prepare('INSERT INTO cred_users (username, password_hash, display_name, active, created_at) VALUES (?,?,?,1,?)').run('manager1', hex(salt) + ':' + hex(new Uint8Array(bits)), 'MG', new Date().toISOString());
for (const role of ['mgmt', 'ops']) sq.prepare('INSERT INTO cred_user_roles (user_id, role) VALUES (?,?)').run(um.lastInsertRowid, role);
const mg = await (await call('/auth/login', { method: 'POST', body: '{"username":"manager1","password":"password1"}' })).json();
const dMg = await call('/inventory/containers/delete', { method: 'POST', headers: { 'X-Cred-Token': mg.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Container DUP', reason: 'x' }) });
const invHt = (await import('node:fs')).readFileSync(fileURLToPath(new URL('../inventory.html', import.meta.url)), 'utf8');
// Owner: "Container here — after opening the pallets, click somewhere to show all the items not done yet / nowhere yet".
check('Container here: 📋 Not done yet button shows only items still left on the pallets (all pallets), flags "nowhere yet", and toggles back',
  /window\.xfrContToggleLeft = function/.test(invHt) && /📋 Not done yet: /.test(invHt) && /nowhere yet<\/span>/.test(invHt) && /if \(onlyLeft\) groups = groups\.map/.test(invHt), null);
check('a manager who is not an Admin can\'t delete a container (403, pallets stay); the screen shows 🗑 Delete container and the box-UPC fill-in to Admins only',
  dMg.status === 403 && palletsOf('Container DUP') === 1 && /\(xfrIsAdmin\(\) \? '<button class="isearch-btn"[^\n]*xfrContDelete\(\)/.test(invHt)
    && /window\.xfrMissingUpcSave = function\(i\) \{\n    if \(!xfrIsAdmin\(\)\)/.test(invHt) && /window\.xfrContDelete = function[^\n]*\n[^\n]*\n    if \(!xfrIsAdmin\(\)\)/.test(invHt), dMg.status);
const d1 = await post('/inventory/containers/delete', { title: 'Container DUP', reason: 'imported twice' });
check('delete removes its pallets, SKU Mgr unchanged', d1.ok && d1.boxes === 5 && palletsOf('Container DUP') === 0 && shelf() === shelfBeforeDel, { d1, shelf: shelf(), before: shelfBeforeDel });
check('delete is logged in Reorder → History with who and why', sq.prepare("SELECT COUNT(*) n FROM reorder_history WHERE detail LIKE '%Deleted container \"Container DUP\"%imported twice%'").get().n === 1, sq.prepare('SELECT * FROM reorder_history ORDER BY id DESC LIMIT 2').all());
const dR = await post('/inventory/containers/delete', { title: CT, reason: 'test' });
check('a 📦 Received container asks first (its stock is in SKU Mgr), nothing deleted', !dR.ok && dR.needConfirm && dR.received.length === 2 && await hasCont(CT), dR);
const shelfR = shelf();
const dR2 = await post('/inventory/containers/delete', { title: CT, reason: 'test', confirmReceived: true });
check('after confirming, only the pallets go — SKU Mgr stock stays the same', dR2.ok && !(await hasCont(CT)) && shelf() === shelfR, { dR2, before: shelfR, after: shelf() });
await mkCont('Container MOVED', '60-5-5=1');
await post('/reorder/fix/incoming-remove', { title: 'Container MOVED', reason: 'test' });
const mvId = sq.prepare("SELECT id FROM reorder_pallet WHERE title = 'Container MOVED'").get().id;
sq.prepare('INSERT INTO pallet_move (pallet_id, cases, to_location, at) VALUES (?,?,?,?)').run(mvId, 2, 'C1=1-1-1', new Date().toISOString());
const dM = await post('/inventory/containers/delete', { title: 'Container MOVED', reason: 'test' });
check('boxes already moved off a pallet: not deleted', !dM.ok && /already moved/.test(dM.error) && palletsOf('Container MOVED') === 1, dM);

console.log('\nPack & Ship: Printed Today tiles don\'t flood Veeqo');
{
  const realFetch = globalThis.fetch; let veeqoCalls = 0;
  globalThis.fetch = async (u, o) => { if (String(u).includes('api.veeqo.com')) { veeqoCalls++; return new Response('[]', { headers: { 'Content-Type': 'application/json' } }); } return realFetch(u, o); };
  env.VEEQO_API_KEY = 'test';
  const ps = [];
  for (let i = 0; i < 3; i++) ps.push(await get('/veeqo/print-status?date=' + nyToday));
  const first = veeqoCalls;
  await Promise.all([get('/veeqo/print-status?date=2020-01-01'), get('/veeqo/print-status?date=2020-01-01')]);
  globalThis.fetch = realFetch; delete env.VEEQO_API_KEY;
  check('3 screens asking = 1 Veeqo pull (2 calls), same numbers', ps.every(p => p.ok && p.printedToday && p.printedToday.total === 0) && first === 2, { first, ps: ps.map(p => p.ok) });
  check('2 asks at the same moment share one pull', veeqoCalls - first === 2, veeqoCalls - first);
}

console.log('\nStock In: a scanned UPC never becomes the part #');
{
sq.exec("CREATE TABLE IF NOT EXISTS upc (id INTEGER PRIMARY KEY AUTOINCREMENT, variant_id TEXT, sku TEXT NOT NULL, base_sku TEXT NOT NULL, inside_upc TEXT, outside_upc TEXT, updated_at TEXT)");
sq.prepare("INSERT INTO upc (sku, base_sku, inside_upc, outside_upc) VALUES ('31-1-2=5XX','31-1-2','','012345678905')").run();
sq.prepare("INSERT INTO master_list (base_sku, name, part_num, location, cases, units_per_case) VALUES ('31-1-2','elbow','31-1-2=5XX','C3=1-1-1',2,50), ('32-2-2','tee','32-2-2=10','C3=1-1-2',1,100)").run();
const u1 = await get('/inventory/lookup?code=012345678905');
check('UPC in the UPC list → its part # (31-1-2=5XX)', u1.partNum === '31-1-2=5XX' && u1.locations.some(l => l.location === 'C3=1-1-1'), { partNum: u1.partNum });
const u2 = await get('/inventory/lookup?code=12345678905');
check('same UPC with the leading 0 dropped by the scanner → same part #', u2.partNum === '31-1-2=5XX', u2.partNum);
const u3 = await get('/inventory/lookup?code=098765432109');
check('unknown UPC: no part # made from the barcode (asks instead)', u3.partNum === null && u3.upcNotLinked === true, u3);
const shelfUpc = shelf();
const bad = await (await call('/inventory/log', { method: 'POST', headers: H, body: JSON.stringify({ type: 'IN', partNum: '098765432109', sku: '098765432109', location: 'GARAGE', cases: 3, initials: 'TS', isNew: true }) })).json();
check('Stock In with a barcode as the part # is refused, SKU Mgr unchanged', bad.ok === false && /UPC barcode/.test(bad.error) && shelf() === shelfUpc && !sq.prepare("SELECT COUNT(*) n FROM master_list WHERE part_num = '098765432109'").get().n, bad);
const lk1 = await post('/inventory/upc-link', { upc: '098765432109', part: 'NOPE-1=1' });
check('linking a UPC to a part # that does not exist is refused', lk1.ok === false, lk1);
const lk2 = await post('/inventory/upc-link', { upc: '098765432109', part: '32-2-2=10' });
const u4 = await get('/inventory/lookup?code=098765432109');
check('after linking once, the UPC scans straight to its part #', lk2.ok && u4.partNum === '32-2-2=10', { lk2, partNum: u4.partNum });
const u5 = await get('/inventory/lookup?code=31-1-2%3D5XX');
check('typing the part # still works as before', u5.partNum === '31-1-2=5XX', u5.partNum);
}

console.log('\nStock Out Reports: a "c" after the parent part # is dropped (27-3-4c → 27-3-4)');
{
  await get('/inventory/stockouts?status=open'); // makes the table
  sq.prepare("INSERT INTO ship_stockout_log (date, timestamp, sku, bin_location, status) VALUES (?,?,?,?, 'open')").run(nyToday, new Date().toISOString(), '25-3-2c=10', '27-3-4c');
  const so = (await get('/inventory/stockouts?status=open')).stockouts.find(x => x.binLocation.startsWith('27-3-4'));
  check('report shows 27-3-4 (not 27-3-4c) and 25-3-2=10', so && so.binLocation === '27-3-4' && so.sku === '25-3-2=10', so);
  const raw = sq.prepare("SELECT bin_location FROM ship_stockout_log WHERE bin_location = '27-3-4c'").get();
  check('what the picker reported is kept as it was (record not changed)', !!raw, raw);
  sq.prepare("INSERT INTO master_list (base_sku, name, part_num, location, cases, units_per_case) VALUES ('27-3-4','cap','27-3-4=5','C4=1-1-1',3,50)").run();
  const lc = await get('/inventory/lookup?code=27-3-4c');
  check('looking up 27-3-4c finds parent 27-3-4', lc.baseSku === '27-3-4' && lc.locations.some(l => l.partNum === '27-3-4=5'), { baseSku: lc.baseSku, partNum: lc.partNum });
  const lx = await get('/inventory/lookup?code=31-1-2%3D5XX');
  check('letters after "=" are left alone (31-1-2=5XX)', lx.partNum === '31-1-2=5XX', lx.partNum);
}

console.log('\nContainer here: only containers already 📦 Received on Reorder');
{
  const T1 = 'Container ONWATER';
  await post('/reorder/vendor-catalog/import', { vendor: 'KW', title: T1, stage: 'shipped', last: true, file: 'w.xlsx', rows: [{ part: '60-6-6=1', raw: '60-6-6=1', qty: 10, cases: 1, pcs: 100, case_pcs: 100, src_rows: '5', description: 'x' }] });
  await post('/reorder/fix/pallets', { title: T1, vendor: 'KW', file: 'w.xlsx', lines: [{ pallet: '1', part: '60-6-6=1', raw: '60-6-6=1', cases: 1, pcs: 100, units: 100, pcsPerCtn: 100, row: '5' }] });
  const before = await hasCont(T1);
  const srch = await get('/inventory/containers/pallets?q=ONWATER');
  await post('/reorder/fix/incoming-receive', { title: T1, location: 'GARAGE', lines: [{ key: '60-6-6=1', part: '60-6-6=1', cases: 1, description: 'x' }] });
  const after = await hasCont(T1);
  const srch2 = await get('/inventory/containers/pallets?q=ONWATER');
  check('still on the way: not in Container here (list or search)', !before && srch.lines.length === 0, { before, n: srch.lines.length });
  check('after 📦 Received: shows in Container here (list and search)', after && srch2.lines.length === 1, { after, n: srch2.lines.length });
  const byTitle = await get('/inventory/containers/pallets?title=' + encodeURIComponent('Container KW-TEST2'));
  check('opening a container by name (Reorder sold-out report) still works before receiving', byTitle.ok && byTitle.lines.length === 2, byTitle.lines && byTitle.lines.length);
}

console.log('\nStock Out: Sold Out label + None Found count');
{
  const inc = await get('/inventory/incoming?base=60-1-1');
  check('"coming soon" for the Sold Out label lists what is on the way for that parent', inc.ok && inc.lines.some(l => l.part === '60-1-1=10' && l.title === 'Container KW-TEST2'), inc);
  const lb = await post('/inventory/soldout-label', { part: '60-3-3=1', base: '60-3-3', name: 'tee', incoming: 'x', how: 'browser' });
  const lr = sq.prepare('SELECT by_user, part FROM soldout_label_log ORDER BY id DESC LIMIT 1').get();
  check('every Sold Out label printed is recorded with who printed it', lb.ok && lr && lr.by_user === 'TS' && lr.part === '60-3-3=1', lr);
  const shelfNf = shelf();
  const nf = await post('/inventory/log', { type: 'IN', partNum: '32-2-2=10', sku: '32-2-2', location: 'C3=1-1-2', cases: 2, initials: 'TS', notes: '[AUDIT] [NONE FOUND COUNT] System: 1 → Actual: 3 (diff: +2)', masterId: sq.prepare("SELECT id FROM master_list WHERE part_num='32-2-2=10'").get().id });
  const nfRow = row(nf.d1Id);
  check('None Found count: SKU Mgr changes only by the counted difference, with History before → after', nf.ok && nfRow.status === 'Verified' ? (nfRow.b === 1 && nfRow.a === 3 && shelf() === shelfNf + 2) : (nfRow.status === 'Pending' && shelf() === shelfNf), { nfRow, shelf: shelf(), shelfNf });
}

console.log('\nVendor names hidden from workers · box UPCs · photos (Admins)');
{
  const T = 'JQ 1002';
  await post('/reorder/vendor-catalog/import', { vendor: 'JQ', title: T, stage: 'shipped', last: true, file: 'jq-1002.xlsx', rows: [{ part: '33-3-3=10', raw: '33-3-3=10', qty: 30, cases: 3, pcs: 300, case_pcs: 100, src_rows: '5', description: 'tee' }] });
  await post('/reorder/fix/pallets', { title: T, vendor: 'JQ', file: 'jq-1002.xlsx', lines: [{ pallet: '1', part: '33-3-3=10', raw: '33-3-3=10', cases: 3, pcs: 300, units: 30, pcsPerCtn: 100, row: '5' }] });
  await post('/reorder/fix/incoming-receive', { title: T, location: 'GARAGE', lines: [{ key: '33-3-3=10', part: '33-3-3=10', cases: 3, description: 'tee' }] });
  const cl = await get('/inventory/containers');
  const hs = await get('/inventory/history?days=1&status=all');
  check('a worker (not the owner) sees "#1 1002", never the vendor name', cl.containers.some(c => c.title === '#1 1002') && !/\bJQ\b/.test(JSON.stringify(cl)) && !hs.rows.some(r => /\bJQ\b/.test(r.notes || '')), cl.containers.map(c => c.title));
  const byMasked = await get('/inventory/containers/pallets?title=' + encodeURIComponent('#1 1002'));
  check('opening "#1 1002" still finds the real container', byMasked.ok && byMasked.lines.length === 1 && byMasked.lines[0].part === '33-3-3=10', byMasked);
  const own = sq.prepare('INSERT INTO cred_users (username, password_hash, display_name, active, created_at) VALUES (?,?,?,1,?)').run('owner1', hex(salt) + ':' + hex(new Uint8Array(bits)), 'OW', new Date().toISOString());
  for (const role of ['mgmt', 'owner']) sq.prepare('INSERT INTO cred_user_roles (user_id, role) VALUES (?,?)').run(own.lastInsertRowid, role);
  const ol = await (await call('/auth/login', { method: 'POST', body: '{"username":"owner1","password":"password1"}' })).json();
  const oc = await (await call('/inventory/containers', { headers: { 'X-Cred-Token': ol.token } })).json();
  check('the owner still sees the real name', oc.containers.some(c => c.title === T), oc.containers.map(c => c.title));
  const mu = await get('/inventory/containers/missing-upc');
  check('Container here lists pallet items with no box UPC (33-3-3=10 has none)', mu.ok && mu.missing.some(x => x.part === '33-3-3=10'), mu);
  await post('/inventory/upc-link', { upc: '00810097207066', part: '33-3-3=10' });
  const mu2 = await get('/inventory/containers/missing-upc');
  const lk = await get('/inventory/lookup?code=00810097207066');
  check('after saving its box UPC: not missing anymore, and the box scan finds 33-3-3=10', !mu2.missing.some(x => x.part === '33-3-3=10') && lk.partNum === '33-3-3=10', { mu2: mu2.missing.map(x => x.part), lk: lk.partNum });
  const mg = sq.prepare('INSERT INTO cred_users (username, password_hash, display_name, active, created_at) VALUES (?,?,?,1,?)').run('mgr1', hex(salt) + ':' + hex(new Uint8Array(bits)), 'MG', new Date().toISOString());
  sq.prepare('INSERT INTO cred_user_roles (user_id, role) VALUES (?,?)').run(mg.lastInsertRowid, 'mgmt');
  const ml = await (await call('/auth/login', { method: 'POST', body: '{"username":"mgr1","password":"password1"}' })).json();
  const pm = await call('/inventory/product-photo', { method: 'POST', headers: { 'X-Cred-Token': ml.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ baseSku: '33-3-3', imageUrl: 'https://x/y.jpg' }) });
  const pa = await post('/inventory/product-photo', { baseSku: '33-3-3', imageUrl: 'https://img.example/tee33.jpg', editedBy: 'TS' });
  check('only Admins change product photos (manager 403, Admin saves)', pm.status === 403 && pa.ok !== false && (await get('/inventory/photos?bases=33-3-3')).photos['33-3-3'] === 'https://img.example/tee33.jpg', { mgr: pm.status, pa });
}

console.log('\nSold Out labels: phone → office PC print queue');
{
  await post('/inventory/soldout-label', { part: '60-3-3=1', base: '60-3-3', name: 'tee', incoming: 'x', how: 'queue' });
  const q1 = await get('/inventory/soldout-label/queue');
  const mine = (q1.labels || []).filter(l => l.part === '60-3-3=1');
  check('a label sent from the phone waits for the office PC (with who sent it)', q1.ok && mine.length === 1 && mine[0].by_user === 'TS', q1);
  await post('/inventory/soldout-label/printed', { ids: mine.map(l => l.id) });
  const q2 = await get('/inventory/soldout-label/queue');
  const pr = sq.prepare('SELECT printed_at, printed_by FROM soldout_label_log WHERE id = ?').get(mine[0].id);
  check('once printed on the PC it leaves the list, with who printed it on record', !(q2.labels || []).some(l => l.id === mine[0].id) && pr.printed_at && pr.printed_by === 'TS', { q2, pr });
}

console.log('\nVendor #1/#2 box + bag UPC list (data/upc) — scanner finds the part #');
{
  const t = async (code, part) => (await get('/inventory/lookup?code=' + code)).partNum === part;
  check('box UPC 00810097206540 → 24-1-2=1, bag UPC 00810097206533 → 24-1-2=1', await t('00810097206540', '24-1-2=1') && await t('00810097206533', '24-1-2=1'), null);
  check('UPC typed into the sheet as a number (840428904241.0) still found → 26-5-2=2X', await t('840428904241', '26-5-2=2X'), null);
  check('updated list: new 202-4-10=2XX box 840428935962 and 43-4-12=2X bag 840428945053 scan to them', await t('840428935962', '202-4-10=2XX') && await t('840428945053', '43-4-12=2X'), null);
  check('3rd file: 27-3-1=1W.1C box 840428927486 → 27-3-1=1W.1C; 28-4-1C=2X box 810139931782 → 28-4-1C=2X (its own part #), 28-4-1=2X box 810139931720 → 28-4-1=2X; 61853-K=1X box 00840428943714 → 61853-K=1X', await t('840428927486', '27-3-1=1W.1C') && await t('810139931782', '28-4-1C=2X') && await t('810139931720', '28-4-1=2X') && await t('28-4-1C%3D2X', '28-4-1C=2X') && await t('00840428943714', '61853-K=1X'), null);
  check('".=2X" rows are not saved (their UPC 00840428942359 finds nothing)', (await get('/inventory/lookup?code=00840428942359')).partNum == null, null);
  check('a part # with two box UPCs (4-2-3=10) — both scan to it', await t('840428900175', '4-2-3=10') && await t('00810139935872', '4-2-3=10'), null);
}

console.log('\nC part #s (27-3-4C=2X) keep their own part # but share the parent 27-3-4');
{
  sq.prepare("INSERT INTO master_list (base_sku, name, part_num, location, cases, units_per_case) VALUES ('27-3-4C','elbow C','27-3-4C=2X','C3=1-1-1',4,200), ('27-3-4','elbow','27-3-4=5','C3=1-1-2',6,100)").run();
  const a = await get('/inventory/lookup?code=27-3-4');
  const parts = (a.locations || []).map(l => l.partNum || l.part || l.sku);
  check('Stock Out lookup of parent 27-3-4 shows both 27-3-4=5 and 27-3-4C=2X shelves', a.baseSku === '27-3-4' && JSON.stringify(a.locations).includes('27-3-4C=2X') && JSON.stringify(a.locations).includes('27-3-4=5'), { base: a.baseSku, parts });
  const c = await get('/inventory/lookup?code=27-3-4C%3D2X');
  check('looking up 27-3-4C=2X keeps its own part #, parent 27-3-4', c.partNum === '27-3-4C=2X' && c.baseSku === '27-3-4', { partNum: c.partNum, base: c.baseSku });
  const cases = (a.locations || []).reduce((n, l) => n + (parseFloat(l.cases) || 0), 0);
  check('no double count: parent 27-3-4 shelves total 3 (C4) + 4 (C part #) + 6 = 13 cases, each shelf once', cases === 13 && a.locations.length === 3, { cases, locs: a.locations });
}

console.log('\n📍 Location Plan: where each parent goes; Container here tells them');
{
  await get('/inventory/location-plan'); // makes the tables
  sq.prepare("INSERT INTO reorder_pallet (title, vendor, pallet, part, description, cases, updated_at) VALUES ('LP SHIP','KW','1','70-1-1=5','plug',2,?), ('LP SHIP','KW','1','70-2-2=10','cap',4,?)").run(new Date().toISOString(), new Date().toISOString());
  sq.prepare("INSERT INTO master_list (base_sku, name, part_num, location, cases, units_per_case) VALUES ('70-1-1','1/2 Plug','70-1-1=5','C1=1-1-1',3,100)").run();
  sq.prepare("INSERT OR IGNORE INTO locations (location, prefix, active) VALUES ('BARN=1-1-1','BARN=',1), ('C5=1-1-1','C5=',1)").run();
  const shelf0 = shelf();
  const L = await get('/inventory/location-plan');
  const p1 = (L.parents || []).find(p => p.base === '70-1-1'), p2 = (L.parents || []).find(p => p.base === '70-2-2');
  check('lists every parent part # with its name, where it is now, and boxes on the containers', L.ok && p1 && p1.name === '1/2 Plug' && p1.spots[0].location === 'C1=1-1-1' && p1.ships.some(x => x.title === 'LP SHIP' && x.left === 2) && p2 && p2.name === 'cap' && L.containers.some(c => c.title === 'LP SHIP' && c.parents === 2), { p1, p2, c: L.containers });
  const no = await call('/inventory/location-plan', { method: 'POST', headers: { 'X-Cred-Token': pk.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ base: '70-1-1', plan: 'BARN' }) });
  check('only management can set the plan', no.status === 403, no.status);
  const sv = await post('/inventory/location-plan', { items: [{ base: '70-1-1=5', plan: 'barn' }, { base: '70-2-2', plan: 'C5=1-1-1' }] });
  const bad = await post('/inventory/location-plan', { base: '70-2-2', plan: 'BARN 1 2' });
  const lg = await get('/inventory/location-plan/log?base=70-1-1');
  check('saves BARN (any pack size → its parent) and an exact spot; a bad one is refused; who/when is kept', sv.ok && sv.saved.length === 2 && !bad.ok && lg.log.length === 1 && lg.log[0].new_plan === 'BARN' && lg.log[0].by_user === 'TS', { sv, bad, lg });
  const s1 = await get('/inventory/suggest-location?usePlan=1&partNum=70-1-1%3D5&fromLoc=GARAGE');
  const s0 = await get('/inventory/suggest-location?partNum=70-1-1%3D5&fromLoc=GARAGE');
  check('Container here (usePlan): "goes to BARN", BARN shelves first', s1.plan === 'BARN' && !s1.planExact && s1.emptyNearby[0] === 'BARN=1-1-1', s1);
  check('other screens (no usePlan) get the same answer as before', !s0.plan && s0.existing[0].location === 'C1=1-1-1' && !s0.emptyNearby.length, s0);
  const s2 = await get('/inventory/suggest-location?usePlan=1&partNum=70-2-2%3D10&fromLoc=GARAGE');
  check('an exact spot plan is sent as the exact spot', s2.plan === 'C5=1-1-1' && s2.planExact, s2);
  await post('/inventory/location-plan', { base: '70-1-1', plan: '' });
  check('clearing a plan removes it (and is kept in the log); counts never change', !(await get('/inventory/location-plan')).parents.find(p => p.base === '70-1-1').plan && (await get('/inventory/location-plan/log?base=70-1-1')).log.length === 2 && shelf() === shelf0, null);
  check('the plan needs a sign-in', (await call('/inventory/location-plan')).status === 401, null);
  // one pack size gets its own plan: 70-1-1=10 → PR, the rest of 70-1-1 → BSMT
  sq.prepare("INSERT INTO master_list (base_sku, name, part_num, location, cases, units_per_case) VALUES ('70-1-1','1/2 Plug','70-1-1=10','C1=1-1-2',2,50)").run();
  sq.prepare("INSERT OR IGNORE INTO locations (location, prefix, active) VALUES ('PR=1-1-1','PR=',1), ('BSMT=1-1-1','BSMT=',1)").run();
  const pv = await post('/inventory/location-plan', { items: [{ base: '70-1-1', plan: 'BSMT' }, { part: '70-1-1=10', plan: 'pr' }] });
  const a10 = await get('/inventory/suggest-location?usePlan=1&partNum=70-1-1%3D10&fromLoc=GARAGE');
  const a5 = await get('/inventory/suggest-location?usePlan=1&partNum=70-1-1%3D5&fromLoc=GARAGE');
  check('70-1-1=10 → PR (its own plan); 70-1-1=5 → BSMT (the parent plan)', pv.ok && a10.plan === 'PR' && a10.planLevel === 'part' && a10.planPart === '70-1-1=10' && a10.emptyNearby[0] === 'PR=1-1-1' && a5.plan === 'BSMT' && a5.planLevel === 'parent' && a5.emptyNearby[0] === 'BSMT=1-1-1', { a10, a5 });
  const Lv = (await get('/inventory/location-plan')).parents.find(p => p.base === '70-1-1');
  check('the list shows the parent plan and each pack size with its own plan', Lv.plan === 'BSMT' && Lv.vars.some(v => v.part === '70-1-1=10' && v.plan === 'PR' && v.cases === 2) && Lv.vars.some(v => v.part === '70-1-1=5' && !v.plan && v.left === 2), Lv);
  const lg2 = await get('/inventory/location-plan/log?base=70-1-1');
  await post('/inventory/location-plan', { items: [{ part: '70-1-1=10', plan: '' }] });
  const a10b = await get('/inventory/suggest-location?usePlan=1&partNum=70-1-1%3D10&fromLoc=GARAGE');
  const badPart = await post('/inventory/location-plan', { items: [{ part: '70-1-1', plan: 'PR' }] });
  check('pack-size change is in the parent\'s log; clearing it goes back to the parent plan; a part # with no pack size is refused', lg2.log.some(l => l.base === '70-1-1=10' && l.new_plan === 'PR') && a10b.plan === 'BSMT' && a10b.planLevel === 'parent' && !badPart.ok && shelf() === shelf0 + 2, { a10b, badPart });
  // 🚢 Container here: 2 suggested spots per item (plan first, then where most of the parent is), + each line's move history
  sq.prepare("INSERT OR IGNORE INTO locations (location, prefix, active) VALUES ('BSMT=','BSMT=',1), ('C1=','C1=',1)").run(); // area names saved as locations: never suggested
  const rc = await post('/inventory/containers/pallet-recs', { parts: ['70-1-1=5', '70-2-2=10', '70-9-9=1'], fromLoc: 'GARAGE' });
  const r5 = rc.recs['70-1-1=5'], r10 = rc.recs['70-2-2=10'], r9 = rc.recs['70-9-9=1'];
  check('suggested spots are real shelves: plan BSMT, no BSMT stock → empty shelf BSMT=1-1-1 (never the bare "BSMT="); exact plan C5=1-1-1 → none; no plan + no stock → 2 empty shelves; at most 2', rc.ok && r5.plan === 'BSMT' && r5.recs[0].location === 'BSMT=1-1-1' && r5.recs[0].why === 'empty shelf' && r10.plan === 'C5=1-1-1' && r10.recs.length === 0 && !r9.plan && r9.recs.length === 2 && r9.recs.every(x => /empty/.test(x.why)) && [r5, r9].every(r => r.recs.every(x => /=\d/.test(x.location)) && r.recs.length <= 2), rc);
  await post('/inventory/location-plan', { items: [{ base: '70-1-1', plan: 'C1' }] });
  const rcC1 = await post('/inventory/containers/pallet-recs', { parts: ['70-1-1=5'], fromLoc: 'GARAGE' });
  check('plan C1 → only C1 shelves already holding 70-1-1, most first (3 then 2), never more than 2', rcC1.recs['70-1-1=5'].recs.map(x => x.location).join() === 'C1=1-1-1,C1=1-1-2', rcC1);
  await post('/inventory/location-plan', { items: [{ base: '70-1-1', plan: '' }] });
  const rcN = await post('/inventory/containers/pallet-recs', { parts: ['70-1-1=5'], fromLoc: 'GARAGE' });
  check('no plan: the shelf holding the most of the same parent (any pack size) comes first', rcN.recs['70-1-1=5'].recs[0].location === 'C1=1-1-1' && /has 3 cases of 70-1-1/.test(rcN.recs['70-1-1=5'].recs[0].why), rcN);
  const lpId = sq.prepare("SELECT id FROM reorder_pallet WHERE title = 'LP SHIP' AND part = '70-1-1=5'").get().id;
  sq.prepare('INSERT INTO pallet_move (pallet_id, cases, to_location, by_user, at) VALUES (?,?,?,?,?)').run(lpId, 1, 'C1=1-1-1', 'TS', new Date().toISOString());
  const pl = await get('/inventory/containers/pallets?title=LP%20SHIP');
  const ln = pl.lines.find(l => l.id === lpId);
  check('a pallet line shows its transfers (how many, where, who) and moved + left = on the pallet', ln.moves.length === 1 && ln.moves[0].to === 'C1=1-1-1' && ln.moves[0].by === 'TS' && ln.moved + ln.left === ln.cases && ln.left === 1, ln);
  sq.prepare('DELETE FROM pallet_move WHERE pallet_id = ?').run(lpId);
}

console.log('\nTransfer: grab 3, "no more of this item left in this spot" → spot set to 0, History kept');
{
  sq.prepare("INSERT INTO master_list (base_sku, name, part_num, location, cases, units_per_case) VALUES ('80-1-1','cap','80-1-1=5','C1=2-2-2',8,100), ('80-1-1','cap','80-1-1=5','C1=2-2-3',4,100)").run();
  const sid = sq.prepare("SELECT id FROM master_list WHERE part_num='80-1-1=5' AND location='C1=2-2-2'").get().id;
  const tot = () => sq.prepare("SELECT SUM(cases) t FROM master_list WHERE part_num='80-1-1=5'").get().t;
  const before = tot();
  const sc = await get('/inventory/spot-check?part=80-1-1%3D5&location=C1%3D2-2-2');
  check('spot check: 8 on record at C1=2-2-2; the next spot C1=2-2-3 (4) is listed to check', sc.ok && sc.recorded === 8 && sc.others[0].location === 'C1=2-2-3' && sc.others[0].cases === 4, sc);
  await post('/inventory/review-mode', { mode: 'auto' });
  const tr = await post('/inventory/transfer', { partNum: '80-1-1=5', sku: '80-1-1=5', fromLocation: 'C1=2-2-2', fromMasterId: sid, toLocation: 'BARN=9-9-9', isNewLocation: true, cases: 3, initials: 'TS', notes: '[SCAN PUT-AWAY]' });
  const nf = await post('/inventory/log', { type: 'OUT', partNum: '80-1-1=5', location: 'C1=2-2-2', cases: 0, initials: 'TS', masterId: sid, noneFound: true,
    notes: '[NONE FOUND ON SHELF] [TRANSFER] C1=2-2-2 checked empty after taking 3 — 5 of the 8 on record not found' });
  const at = l => (sq.prepare("SELECT SUM(cases) c FROM master_list WHERE part_num='80-1-1=5' AND location=?").get(l).c) || 0;
  const after = tot();
  check('8 at C1=2-2-2, take 3 → BARN, rest not found: C1=2-2-2 = 0, BARN = 3, C1=2-2-3 still 4; part total ' + before + ' → ' + (before - 5) + ' (exactly the 5 not found)', tr.ok !== false && nf.ok && at('C1=2-2-2') === 0 && at('BARN=9-9-9') === 3 && at('C1=2-2-3') === 4 && after === before - 5, { before, after, c1: at('C1=2-2-2'), barn: at('BARN=9-9-9'), tr, nf });
  const h = sq.prepare("SELECT type, cases, status, notes, total_before b, total_after a FROM inventory_log WHERE part_num='80-1-1=5' ORDER BY id").all();
  check('History keeps it: the transfer and "[NONE FOUND ON SHELF] … 5 of the 8 not found", with the part total before → after', h.some(r => /TRANSFER/.test(r.type)) && h.some(r => /NONE FOUND/.test(r.notes) && /5 of the 8/.test(r.notes) && r.status === 'Verified' && r.b === before && r.a === before - 5), h);
  await post('/inventory/review-mode', { mode: 'manual' });
}

console.log('\n🧪 Test switch: ON → do anything → OFF puts everything back');
{
  const dump = () => JSON.stringify({ ml: sq.prepare('SELECT * FROM master_list ORDER BY id').all(), log: sq.prepare('SELECT * FROM inventory_log ORDER BY id').all() });
  const before = dump(), shelf0 = shelf(), logN0 = sq.prepare('SELECT COUNT(*) n FROM inventory_log').get().n;
  const pkOn = await call('/admin/test-mode/on', { method: 'POST', headers: { 'X-Cred-Token': pk.token, 'Content-Type': 'application/json' }, body: '{}' });
  check('only Admins can turn test on (Ops 403)', pkOn.status === 403, pkOn.status);
  const on = await post('/admin/test-mode/on', {});
  const acc = await get('/auth/access');
  check('Admin turns test on; every page is told (banner)', on.ok && acc.test && acc.test.on && acc.test.by === 'TS', { on, test: acc.test });
  let sheetWrites = 0; const f0 = globalThis.fetch;
  globalThis.fetch = async (u, o) => { if (String(u).includes('sheets') && o && /PUT|POST/.test(o.method || '')) sheetWrites++; return f0(u, o); };
  await post('/inventory/review-mode', { mode: 'auto' });
  const tr = await post('/inventory/transfer', { partNum: '23-2-3=2', sku: '23-2-3=2', fromLocation: 'A1=1-1-1', fromMasterId: 1, toLocation: 'GARAGE', isNewLocation: true, cases: 1, initials: 'TS', notes: 'test' });
  const si = await post('/inventory/log', { type: 'IN', partNum: '40-1-1=1', sku: '40-1-1=1', location: 'C1=1-1-1', cases: 7, initials: 'TS', notes: '', masterId: 3 });
  globalThis.fetch = f0;
  const changed = dump() !== before;
  check('during the test everything works as usual (transfer + stock in are saved)', changed && tr.success !== false && si.autoApproved && shelf() === shelf0 + 7, { tr, si: si.autoApproved, shelf: shelf(), shelf0 });
  check('during the test the Google Sheet is not written', sheetWrites === 0, sheetWrites);
  const blk = await call('/inventory/soldout/set-qty', { method: 'POST', headers: H, body: '{}' });
  check('during the test marketplace changes are blocked', blk.status === 423, blk.status);
  const off = await post('/admin/test-mode/off', {});
  const logN1 = sq.prepare('SELECT COUNT(*) n FROM inventory_log').get().n;
  check('turning test off puts SKU Mgr + History back exactly (shelf ' + shelf0 + ' cases, ' + logN0 + ' log rows)', off.ok && dump() === before && shelf() === shelf0 && logN1 === logN0, { off, shelf: shelf(), shelf0, logN1, logN0 });
  const st = await get('/admin/test-mode');
  const snaps = sq.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name LIKE 'tmsnap__%'").get().n;
  check('still signed in after; the test is on record (on + off, who, what was put back); copies cleaned up', !st.on && st.log.length >= 2 && st.log[0].action === 'off' && st.log[0].by_user === 'TS' && JSON.parse(st.log[0].detail).erased.inventory_log && snaps === 0, { st, snaps });
  const acc2 = await get('/auth/access');
  check('after off: banner gone, marketplace changes allowed again', acc2.test && acc2.test.on === false && (await call('/inventory/soldout/set-qty', { method: 'POST', headers: H, body: '{}' })).status !== 423, acc2.test);
  await post('/inventory/review-mode', { mode: 'manual' });
}

console.log('\nScanner phones: "hide the keyboard" also works on boxes that open by themselves');
{
  const { readFileSync } = await import('node:fs');
  const xa = readFileSync(fileURLToPath(new URL('../xf-access.js', import.meta.url)), 'utf8');
  // Owner: "Transfer → scan the box always pops the keyboard, even with hiding on" — the Put away
  // popup focused its box before the setting reached it. The box must be keyboard-off BEFORE focus.
  check('keyboard-off is set before a box gets focus (page code .focus(), a tap) and right when a popup draws it', /HTMLElement\.prototype\.focus = function/.test(xa) && /addEventListener\(ev, function \(e\)[\s\S]{0,120}mute\(el\)/.test(xa) && /m\.addedNodes/.test(xa), null);
  // Owner: "when scan the box the keyboard will not pop up, but next step keyboard will pop up" — the cases box
  // after scanning the spot is type=number, and phones ignore inputmode="none" on number boxes. While hidden,
  // number boxes must become text boxes (turned back on ⌨️ Show keyboard), and page code can't switch it back on.
  check('keyboard-off also covers number boxes (cases / how many) and boxes whose inputmode the page changes later', /function mute\(el\)[\s\S]{0,400}\^number\$[\s\S]{0,120}setAttribute\('type', 'text'\)/.test(xa) && /function unmute\(el\)[\s\S]{0,120}xfKbType/.test(xa) && /attributeFilter: \['inputmode', 'type'\]/.test(xa), null);
  const pages = ['inventory.html', 'packship.html', 'warehouse.html'].map(f => readFileSync(fileURLToPath(new URL('../' + f, import.meta.url)), 'utf8'));
  const v = (pages[0].match(/xf-access\.js\?v=([\w]+)/) || [])[1];
  check('every page loads the same (new) xf-access.js version', v && pages.every(h => h.includes('xf-access.js?v=' + v)), v);
}

console.log('\nHistory report: Total In / Total Out add up; Transfers show cases; 🚢 Container here shows cases and pallets');
{
  // Owner: "History still not showing total in and total out", "Transfers: I want to see how many cases",
  // "Container here: how many cases and how many pallets they done".
  const s0 = await get('/inventory/history-summary?days=1');
  const ap0 = s0.approved || {};
  check('report shows Total In and Total Out (approved cases), and Started + In − Out = Ended',
    s0.ok && typeof ap0.casesIn === 'number' && typeof ap0.casesOut === 'number' && Math.abs(s0.startingCases + ap0.casesIn - ap0.casesOut - s0.endingCases) < 1e-9 && s0.endingCases === shelf(),
    { start: s0.startingCases, approved: s0.approved, end: s0.endingCases, shelf: shelf() });
  const ts = new Date().toISOString();
  sq.exec(`INSERT INTO master_list (id, sku, base_sku, name, part_num, location, cases, units_per_case, sheet_row) VALUES
    (9201, 'HC-1', 'HC-1', 'Hist cap', 'HC-1=5', 'GARAGE', 10, 5, 0), (9202, 'HC-2', 'HC-2', 'Hist plug', 'HC-2=5', 'GARAGE', 10, 5, 0)`);
  sq.prepare(`INSERT INTO reorder_pallet (title, vendor, pallet, part, description, cases, updated_at) VALUES
    ('HIST CT','KW','1','HC-1=5','cap',2,?), ('HIST CT','KW','1','HC-2=5','plug',1,?), ('HIST CT','KW','2','HC-1=5','cap',3,?)`).run(ts, ts, ts);
  const pid = (pl, part) => sq.prepare("SELECT id FROM reorder_pallet WHERE title='HIST CT' AND pallet=? AND part=?").get(pl, part).id;
  const all0 = shelf(), x0 = s0.transferCases || 0;
  const mv = (part, mid, to, n, line) => post('/inventory/transfer', { partNum: part, sku: part, fromLocation: 'GARAGE', fromMasterId: mid, toLocation: to, isNewLocation: true,
    cases: n, initials: 'HS', notes: line ? '[CONTAINER SCAN] HIST CT · Pallet x' : 'plain', palletLineId: line || undefined });
  await mv('HC-1=5', 9201, 'C1=7-1-1', 2, pid('1', 'HC-1=5'));   // pallet 1: 2 of 3 boxes
  await mv('HC-2=5', 9202, 'C1=7-1-2', 1, pid('1', 'HC-2=5'));   // pallet 1: last box → emptied
  await mv('HC-1=5', 9201, 'C1=7-1-3', 1, pid('2', 'HC-1=5'));   // pallet 2: 1 of 3 boxes
  await mv('HC-1=5', 9201, 'BARN=7-1-1', 2, 0);                  // a plain transfer, not Container here
  const s1 = await get('/inventory/history-summary?days=1');
  const hs = (s1.byPerson || []).find(p => p.initials === 'HS') || {};
  check('Transfers show cases moved: +6 (2 + 1 + 1 + 2), and HS has 4 transfers / 6 cases', (s1.transferCases - x0) === 6 && hs.transfers === 4 && hs.transferCases === 6, { before: x0, after: s1.transferCases, hs });
  check('🚢 Container here: 4 cases, 2 pallets worked on, 1 emptied (overall and for HS)',
    s1.container && s1.container.cases === 4 && s1.container.pallets === 2 && s1.container.palletsFinished === 1
      && hs.container && hs.container.cases === 4 && hs.container.pallets === 2 && hs.container.palletsFinished === 1, { all: s1.container, hs: hs.container });
  // Owner: "a time frame how long it takes them to transfer 1 pallet — each pallet, from open to close".
  const op = await post('/inventory/containers/pallet-open', { title: 'HIST CT', vendor: 'KW', pallet: '1' });
  // 30 min ago — but never before today's midnight in New York ("Today" starts there; right after midnight the test would cross into yesterday)
  const nyNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })), sinceMidnight = (nyNow.getHours() * 60 + nyNow.getMinutes()) * 60000 + nyNow.getSeconds() * 1000;
  const base = Date.now() - Math.min(30 * 60000, Math.max(0, sinceMidnight - 60000)), at = m => new Date(base + m * 60000).toISOString();
  sq.prepare("UPDATE pallet_open SET at=? WHERE title='HIST CT' AND pallet='1'").run(at(0));               // opened at 0
  const outIds = sq.prepare("SELECT m.out_log_id id, p.pallet, p.part FROM pallet_move m JOIN reorder_pallet p ON p.id = m.pallet_id WHERE p.title='HIST CT' ORDER BY m.id").all();
  const setT = (i, m) => sq.prepare('UPDATE inventory_log SET timestamp=? WHERE id=?').run(at(m), outIds[i].id);
  setT(0, 10); setT(1, 25); setT(2, 20);                                                                   // pallet 1: boxes at 10 and 25 min (emptied); pallet 2: one box at 20
  const s2 = await get('/inventory/history-summary?days=1');
  const pl = (s2.container && s2.container.palletList) || [], p1 = pl.find(x => x.pallet === '1') || {}, p2 = pl.find(x => x.pallet === '2') || {};
  check('open is recorded (who, when) — Container here → pallet opened', op.ok && sq.prepare("SELECT by_user FROM pallet_open WHERE title='HIST CT'").get().by_user === 'TS', op);
  check('pallet 1: opened → last box moved = 25 min, finished, by HS; pallet 2: not finished, 0 min so far (no open on record → from 1st box)',
    p1.finished === true && p1.minutes === 25 && p1.fromOpen === true && p1.moved === 3 && p1.boxes === 3 && p1.people.join() === 'HS'
      && p2.finished === false && p2.minutes === 0 && p2.fromOpen === false, { p1, p2 });
  check('average per emptied pallet: 25 min (overall and for HS)', s2.container.avgMinutes === 25 && ((s2.byPerson || []).find(p => p.initials === 'HS') || {}).container.avgMinutes === 25, { all: s2.container.avgMinutes });
  check('transfers do not change the warehouse total, and the report still adds up', shelf() === all0 && Math.abs(s1.startingCases + s1.approved.casesIn - s1.approved.casesOut - s1.endingCases) < 1e-9,
    { shelf: shelf(), all0, s1: [s1.startingCases, s1.approved, s1.endingCases] });
  sq.exec("DELETE FROM master_list WHERE part_num IN ('HC-1=5','HC-2=5'); DELETE FROM reorder_pallet WHERE title='HIST CT'; DELETE FROM pallet_open WHERE title='HIST CT'");
}

console.log('\nEveryone\'s Un-grabbed items: Admin and up can delete them (recorded, and the phone can\'t bring them back)');
{
  // Owner: "Everyone's un-grabbed items — Admins and up can delete the un-grabbed from that account".
  const mine = [{ key: '23-2-3=2|A1=1-1-1', partNum: '23-2-3=2', location: 'A1=1-1-1', cases: '1', addedAt: '2026-10-01T09:00:00.000Z' },
                { key: '23-2-3=2|B1=1-1-1', partNum: '23-2-3=2', location: 'B1=1-1-1', cases: '2', addedAt: '2026-10-01T09:01:00.000Z' },
                { key: '40-1-1=1|C1=1-1-1', partNum: '40-1-1=1', location: 'C1=1-1-1', cases: '1', addedAt: '2026-10-01T09:02:00.000Z', grabbed: true, submitted: true }];
  await post('/inventory/pull/mine', { items: mine });
  const all = await get('/inventory/pull/all'), me = (all.people || []).find(p => p.displayName === 'TS') || {};
  check('Everyone\'s list shows my 2 un-grabbed items with an id each', me.ungrabbed && me.ungrabbed.length === 2 && me.ungrabbed.every(i => i.id), me);
  const d1 = await post('/inventory/pull/delete', { userId: me.userId, ids: [me.ungrabbed[0].id] });
  const left = JSON.parse(sq.prepare('SELECT items FROM inventory_pull_user WHERE user_id=?').get(me.userId).items);
  check('Admin deletes 1 un-grabbed item → 1 un-grabbed + the grabbed one stay', d1.ok && d1.deleted === 1 && left.length === 2 && left.some(i => i.grabbed), { d1, left });
  const back = await post('/inventory/pull/mine', { items: mine });
  const left2 = JSON.parse(sq.prepare('SELECT items FROM inventory_pull_user WHERE user_id=?').get(me.userId).items);
  check('the phone saving its old list can\'t put it back, and is told to drop it', back.ok && back.removed.length === 1 && left2.length === 2 && !left2.some(i => i.location === 'A1=1-1-1'), { back, left2 });
  const d2 = await post('/inventory/pull/delete', { userId: me.userId, all: true });
  const log = await get('/inventory/pull/delete-log');
  check('"Delete all" removes only the un-grabbed (grabbed stays); every delete is recorded (who, whose, what)', d2.ok && d2.deleted === 1
    && JSON.parse(sq.prepare('SELECT items FROM inventory_pull_user WHERE user_id=?').get(me.userId).items).length === 1 && log.log.length === 2 && log.log.every(x => x.by === 'TS' && x.who === 'TS'), log);
  check('deleting needs a sign-in', (await call('/inventory/pull/delete', { method: 'POST', body: '{}' })).status === 401, null);
  await post('/inventory/pull/mine', { items: [] });
}

console.log('\nHistory: Part Total in pieces too (cases × Each/Case)');
{
  // Owner: "Inventory → History → Inventory Log History: why still not showing total pieces before and total pieces left".
  sq.exec(`INSERT INTO master_list (id, sku, base_sku, name, part_num, location, cases, units_per_case, sheet_row) VALUES
    (9301,'PC-1','PC-1','pc','PC-1=10','A1=9-9-1',5,10,0), (9302,'PC-1','PC-1','pc','PC-1=10','A1=9-9-2',3,10,0),
    (9303,'PC-2','PC-2','pc','PC-2=5','A1=9-9-3',4,5,0), (9304,'PC-2','PC-2','pc','PC-2=5','A1=9-9-4',2,6,0)`);
  const now = new Date().toISOString();
  sq.prepare(`INSERT INTO inventory_log (timestamp,type,part_num,location,cases,initials,notes,status,total_before,total_after,total_scope) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(now, 'OUT', 'PC-1=10', 'A1=9-9-1', 2, 'PCT', '', 'Verified', 10, 8, 'part');
  sq.prepare(`INSERT INTO inventory_log (timestamp,type,part_num,location,cases,initials,notes,status,total_before,total_after,total_scope) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(now, 'OUT', 'PC-2=5', 'A1=9-9-3', 1, 'PCT', '', 'Verified', 7, 6, 'part');
  const hp = await get('/inventory/history?days=1&initials=PCT&status=all');
  const r1 = hp.rows.find(r => r.part_num === 'PC-1=10'), r2 = hp.rows.find(r => r.part_num === 'PC-2=5');
  check('PC-1=10 (Each/Case 10 on every shelf): 10 → 8 cases = 100 → 80 pieces', r1 && r1.each === 10 && r1.total_before * r1.each === 100 && r1.total_after * r1.each === 80, r1);
  check('PC-2=5 (Each/Case 5 on one shelf, 6 on another): no guessed pieces — says why', r2 && !r2.each && /differs between shelves/.test(r2.each_note || ''), r2);
  const invHp = (await import('node:fs')).readFileSync(fileURLToPath(new URL('../inventory.html', import.meta.url)), 'utf8');
  check('History table shows the pieces line (= before → after pcs) under the cases', /' pcs<\/div>'/.test(invHp) && /Part Total Before → After<div[^>]*>cases · pieces/.test(invHp), null);
  sq.exec("DELETE FROM master_list WHERE id BETWEEN 9301 AND 9304; DELETE FROM inventory_log WHERE initials='PCT'");
}

console.log('\nHistory: whole-inventory total before → after on every row');
{
  // Owner: "History total before and after — I want the total of the whole inventory too, like right now 17,562; take one case → 17,561".
  const whole = () => sq.prepare('SELECT SUM(cases) t FROM master_list WHERE cases > 0').get().t;
  const wrow = id => sq.prepare('SELECT wh_before b, wh_after a, total_before tb, total_after ta FROM inventory_log WHERE id=?').get(id);
  await post('/inventory/review-mode', { mode: 'auto' });
  const w0 = whole();
  const o1 = await post('/inventory/log', { type: 'OUT', partNum: '23-2-3=2', sku: '23-2-3=2', location: 'B1=1-1-1', cases: 1, initials: 'WH', notes: '', masterId: 2 });
  const r1 = wrow(o1.d1Id);
  check('Stock Out 1 case → whole inventory ' + w0 + ' → ' + (w0 - 1) + ' (and the part total still kept)', o1.autoApproved && r1.b === w0 && r1.a === w0 - 1 && r1.a === whole() && r1.tb - r1.ta === 1, { r1, w0, now: whole() });
  const i1 = await post('/inventory/log', { type: 'IN', partNum: '23-2-3=2', sku: '23-2-3=2', location: 'B1=1-1-1', cases: 3, initials: 'WH', notes: '', masterId: 2 });
  const r2 = wrow(i1.d1Id);
  check('next Stock In 3 cases starts where the last one ended: ' + (w0 - 1) + ' → ' + (w0 + 2), r2.b === r1.a && r2.a === w0 + 2 && r2.a === whole(), r2);
  const cx = await post('/inventory/cancel-entry', { id: i1.d1Id, cancelledBy: 'WH' });
  const cr = sq.prepare("SELECT wh_before b, wh_after a FROM inventory_log WHERE notes LIKE '[CANCELLED ENTRY #" + i1.d1Id + "]%'").get();
  check('Cancel that Stock In: whole inventory ' + (w0 + 2) + ' → ' + (w0 - 1) + ' on the cancel line', cx.ok && cr && cr.b === w0 + 2 && cr.a === w0 - 1 && cr.a === whole(), { cx, cr });
  const hw = await get('/inventory/history?days=1&initials=WH&status=all');
  check('History sends wh_before / wh_after with each row', hw.rows.some(r => r.wh_before === w0 && r.wh_after === w0 - 1), hw.rows.map(r => [r.type, r.wh_before, r.wh_after]));
  await post('/inventory/review-mode', { mode: 'manual' });
}

console.log('\nHistory: Cancel works on a None Found (puts back what it set to 0)');
{
  // Owner: None Found at GARAGE for 26-1-2=2X was a mistake (3 → 0 cs); Cancel said "Could not find the matching row in Master List".
  sq.exec(`INSERT INTO master_list (id, sku, base_sku, name, part_num, location, cases, units_per_case, sheet_row) VALUES
    (9401,'26-1-2','26-1-2','ball valve','26-1-2=2X','GARAGE',3,50,0), (9402,'26-1-2','26-1-2','ball valve','26-1-2=2X','C1=9-4-1',2,50,0)`);
  const pt = () => sq.prepare("SELECT SUM(cases) t FROM master_list WHERE part_num='26-1-2=2X'").get().t;
  const whole = () => sq.prepare('SELECT SUM(cases) t FROM master_list WHERE cases > 0').get().t;
  await post('/inventory/review-mode', { mode: 'auto' });
  const nf = async () => post('/inventory/log', { type: 'OUT', partNum: '26-1-2=2X', sku: '26-1-2=2X', location: 'GARAGE', cases: 0, initials: 'NF', notes: '[SHELVING] [NONE FOUND ON SHELF]', noneFound: true, masterId: 9401 });
  const w0 = whole();
  const n1 = await nf();
  const g = () => (sq.prepare("SELECT cases FROM master_list WHERE part_num='26-1-2=2X' AND location='GARAGE'").get() || {}).cases;
  const r9401 = () => sq.prepare('SELECT cases, location FROM master_list WHERE id=9401').get();
  check('None Found approved: GARAGE 3 → 0 (spot freed: its location cleared — why Cancel used to fail), part total 5 → 2', n1.autoApproved && r9401().cases === 0 && r9401().location === '' && pt() === 2, { n1, r: r9401(), pt: pt() });
  const c1 = await post('/inventory/cancel-entry', { id: n1.d1Id, cancelledBy: 'NF' });
  const cl = sq.prepare("SELECT type, cases, notes, total_before b, total_after a, wh_before wb, wh_after wa FROM inventory_log WHERE notes LIKE '[CANCELLED ENTRY #" + n1.d1Id + "]%'").get();
  check('Cancel the None Found → the same row back at GARAGE with 3, part total 2 → 5, whole inventory back to ' + w0 + ', recorded "putting back the 3 case(s)"',
    c1.ok && g() === 3 && r9401().location === 'GARAGE' && pt() === 5 && whole() === w0 && cl && cl.type === 'IN' && cl.cases === 3 && cl.b === 2 && cl.a === 5 && cl.wa === w0 && /putting back the 3 case/.test(cl.notes), { c1, cl, g: g() });
  // Spot row gone after the None Found → Cancel makes it again (Each/Case from the other shelf)
  const n2 = await nf();
  sq.exec('DELETE FROM master_list WHERE id=9401');
  const c2 = await post('/inventory/cancel-entry', { id: n2.d1Id, cancelledBy: 'NF' });
  const re = sq.prepare("SELECT cases, units_per_case u, base_sku FROM master_list WHERE part_num='26-1-2=2X' AND location='GARAGE'").get();
  check('spot row gone → Cancel makes GARAGE again with 3 cases, Each/Case 50, parent 26-1-2; part total 2 → 5', c2.ok && re && re.cases === 3 && re.u === 50 && re.base_sku === '26-1-2' && pt() === 5, { c2, re });
  // A None Found where the system already had 0 → nothing to put back
  sq.exec("UPDATE master_list SET cases=0 WHERE part_num='26-1-2=2X' AND location='GARAGE'");
  const n3 = await nf();
  const c3 = await post('/inventory/cancel-entry', { id: n3.d1Id, cancelledBy: 'NF' });
  check('None Found when the system already had 0 → Cancel says nothing to put back, nothing changes', !c3.ok && /nothing to put back/.test(c3.error) && g() === 0, c3);
  await post('/inventory/review-mode', { mode: 'manual' });
  sq.exec("DELETE FROM master_list WHERE part_num='26-1-2=2X'");
}

console.log('\nSKU Mgr: the parent follows the Part #, wrong parents can be fixed, every edit is in History');
{
  // Owner: "search 30-1-8 in SKU Mgr but 24-3-1 pops up, Part # 24-3-1=10XX" — the row's Part # was changed
  // in SKU Mgr, but its parent stayed 30-1-8 (Save sent the old parent, the update never touched base_sku).
  sq.exec(`INSERT INTO master_list (id, sku, base_sku, name, part_num, location, cases, units_per_case, sheet_row) VALUES
    (9101, '30-1-8', '30-1-8', 'Coupler', '30-1-8=10XX', 'BARN=9-1-1', 5, 10, 0),
    (9102, '30-1-8', '30-1-8', 'Coupler', '30-1-8=10XX', 'C1=9-1-1', 2, 10, 0),
    (9103, '24-3-1', '24-3-1', 'Big Tee', '24-3-1=10XX', 'C2=9-1-1', 4, 10, 0),
    (9104, '30-1-8', '30-1-8', 'Coupler', '24-3-1=10XX', 'C3=9-1-1', 3, 10, 0),
    (9105, '30-1-8', '30-1-8', 'Coupler', '30-1-8=2XX', 'C4=9-1-1', 6, 50, 0)`);
  const pt = p => sq.prepare('SELECT SUM(cases) t FROM master_list WHERE part_num=?').get(p).t || 0;
  const all0 = shelf(), a0 = pt('30-1-8=10XX'), b0 = pt('24-3-1=10XX');
  const lastEdit = () => sq.prepare("SELECT * FROM inventory_log WHERE type='EDIT' ORDER BY id DESC LIMIT 1").get();
  const parts = async q => ((await get('/inventory/sku-search?q=' + q)).results || []).map(r => r.part_num + '@' + r.location);
  check('before: the wrong-parent row 24-3-1=10XX shows when searching 30-1-8 (the reported problem)', (await parts('30-1-8')).includes('24-3-1=10XX@C3=9-1-1'), await parts('30-1-8'));

  // 1) Change a row's Part # in SKU Mgr — even an old page that still sends the old parent.
  const ed = await post('/inventory/sku-row', { mode: 'update', d1Id: 9102, sheetRow: 0, partNum: '24-3-1=10XX', name: 'Coupler', location: 'C1=9-1-1', cases: 2, sku: '30-1-8', unitsPerCase: 10, price: 0, vendor: '', prevNotes: '' });
  const r2 = sq.prepare('SELECT sku, base_sku FROM master_list WHERE id=9102').get(), e1 = lastEdit();
  check('Part # changed 30-1-8=10XX → 24-3-1=10XX: parent goes with it (24-3-1), not left on 30-1-8', ed.ok && r2.base_sku === '24-3-1' && r2.sku === '24-3-1', r2);
  check('…and it no longer shows when searching 30-1-8; it shows under 24-3-1', !(await parts('30-1-8')).includes('24-3-1=10XX@C1=9-1-1') && (await parts('24-3-1')).includes('24-3-1=10XX@C1=9-1-1'), await parts('30-1-8'));
  check('…History has the edit: who, Part # old → new, Parent old → new, 24-3-1=10XX total ' + b0 + ' → ' + (b0 + 2) + ', 30-1-8=10XX ' + a0 + ' → ' + (a0 - 2),
    e1 && e1.initials === 'TS' && e1.status === 'Verified' && /\[SKU MGR EDIT\]/.test(e1.notes) && /Part #: 30-1-8=10XX → 24-3-1=10XX/.test(e1.notes) && /Parent: 30-1-8 → 24-3-1/.test(e1.notes)
      && e1.total_before === b0 && e1.total_after === b0 + 2 && !e1.total_warning && new RegExp('30-1-8=10XX total ' + a0 + ' → ' + (a0 - 2)).test(e1.notes)
      && pt('24-3-1=10XX') === b0 + 2 && pt('30-1-8=10XX') === a0 - 2 && shelf() === all0, e1);

  // 2) Saving with nothing changed adds no History line; a cases change is recorded old → new with the Part Total.
  const n0 = sq.prepare("SELECT COUNT(*) n FROM inventory_log WHERE type='EDIT'").get().n;
  await post('/inventory/sku-row', { mode: 'update', d1Id: 9102, sheetRow: 0, partNum: '24-3-1=10XX', name: 'Coupler', location: 'C1=9-1-1', cases: 2, unitsPerCase: 10, price: 0, vendor: '', prevNotes: '' });
  check('Save with nothing changed → no extra History line', sq.prepare("SELECT COUNT(*) n FROM inventory_log WHERE type='EDIT'").get().n === n0, null);
  await post('/inventory/sku-row', { mode: 'update', d1Id: 9101, sheetRow: 0, partNum: '30-1-8=10XX', name: 'Coupler', location: 'BARN=9-1-1', cases: 6, unitsPerCase: 10, price: 0, vendor: 'Secret Vendor Co', prevNotes: '' });
  const e2 = lastEdit();
  check('cases 5 → 6 in SKU Mgr → History "Cases: 5 → 6", 30-1-8=10XX total ' + (a0 - 2) + ' → ' + (a0 - 1) + '; vendor name not written to History',
    /Cases: 5 → 6/.test(e2.notes) && e2.total_before === a0 - 2 && e2.total_after === a0 - 1 && /Vendor changed/.test(e2.notes) && !/Secret/.test(e2.notes) && shelf() === all0 + 1, e2);

  check('SKU Mgr cases 5 → 6 → whole inventory +1 on its History line', e2.wh_after - e2.wh_before === 1 && e2.wh_after === sq.prepare('SELECT SUM(cases) t FROM master_list WHERE cases > 0').get().t, e2);
  // 3) 🧬 Parent ≠ Part #: lists only the wrong row, fixes only what's ticked, cases untouched, recorded.
  sq.exec("INSERT INTO products (sku, name) VALUES ('24-3-1', 'Big Tee')"); // 24-3-1 rows now say Big Tee and Coupler → name comes from the products list
  const mm = await get('/inventory/parent-mismatch');
  const mine = (mm.rows || []).filter(r => r.id >= 9101 && r.id <= 9105);
  check('🧬 list: only 24-3-1=10XX @ C3 (parent 30-1-8 → 24-3-1, name Coupler → Big Tee)', mm.ok && mine.length === 1 && mine[0].id === 9104 && mine[0].parentNow === '30-1-8' && mine[0].parentRight === '24-3-1' && mine[0].nameRight === 'Big Tee', mine);
  const b1 = pt('24-3-1=10XX'), all1 = shelf();
  const fx = await post('/inventory/parent-mismatch', { ids: [9104] });
  const r4 = sq.prepare('SELECT sku, base_sku, name, cases FROM master_list WHERE id=9104').get(), e3 = lastEdit();
  check('fix: parent 24-3-1, name Big Tee, cases still 3; 24-3-1=10XX total ' + b1 + ' → ' + b1 + ' (unchanged), warehouse total unchanged',
    fx.ok && fx.count === 1 && r4.base_sku === '24-3-1' && r4.sku === '24-3-1' && r4.name === 'Big Tee' && r4.cases === 3 && pt('24-3-1=10XX') === b1 && shelf() === all1, { fx, r4 });
  check('…History "[PARENT FIX]" by TS with Parent 30-1-8 → 24-3-1 and total ' + b1 + ' → ' + b1, /\[PARENT FIX\] 24-3-1=10XX @ C3=9-1-1/.test(e3.notes) && /Parent: 30-1-8 → 24-3-1/.test(e3.notes) && e3.initials === 'TS' && e3.total_before === b1 && e3.total_after === b1 && !e3.total_warning, e3);
  check('…list now clean, and searching 30-1-8 shows only 30-1-8 parts', !((await get('/inventory/parent-mismatch')).rows || []).some(r => r.id >= 9101 && r.id <= 9105) && (await parts('30-1-8')).every(x => x.startsWith('30-1-8')), await parts('30-1-8'));
  check('the 🧬 fix needs a sign-in', (await call('/inventory/parent-mismatch')).status === 401, null);
  sq.exec("DELETE FROM master_list WHERE id BETWEEN 9101 AND 9105; DELETE FROM products WHERE sku='24-3-1'");
}

// Owner: "Stock In / Found on Shelf — take off the location drop-down (2FL= C1=), we scan the spot; the spot label already has 2FL= or C1= in it".
{
  const { readFileSync } = await import('node:fs');
  const ih = readFileSync(fileURLToPath(new URL('../inventory.html', import.meta.url)), 'utf8');
  const fn = (ih.match(/function invFullSpotLabel\(v\) \{[\s\S]*?\n  \}/) || [''])[0];
  const full = fn ? new Function(fn + '; return invFullSpotLabel;')() : () => 'missing';
  check('Stock In / Found on Shelf has no area drop-down (quick add, + Add New Location); the scanned label is the whole location',
    !/id="inv-qa-prefix"|id="inv-newloc-prefix"/.test(ih) && /var location = invFullSpotLabel\(qaShelf\)/.test(ih) && /var newLoc = invFullSpotLabel\(newLocRaw\)/.test(ih)
      && full(' c1=5-1-3 ') === 'C1=5-1-3' && full('2FL=11-2-10') === '2FL=11-2-10' && full('BARN=5-1') === 'BARN=5-1' && full('5-1-3') === '' && full('') === '' && full('=5-1') === '', fn ? null : 'invFullSpotLabel not found');
  // Owner (later): "Stock Out location search — yes, remove that also, all of our spot barcodes come with the main location".
  check('Stock Out location search: no area drop-down either; the scanned label is the whole spot', !/id="inv-loc-scan-prefix"/.test(ih) && /loc = \(g\('inv-loc-scan-shelf'\)/.test(ih), null);
  check('…the other tabs keep their area drop-downs (Stock Out found elsewhere, Transfer, Audit)', /id="inv-fel-prefix"/.test(ih) && /id="xfr-loc-scan-prefix"/.test(ih) && /id="inv-audit-loc-prefix"/.test(ih), null);
}

// Owner: "Container here — scanning the outside box takes a while for the pallet to pop up, and after we scan
// the location it takes a while too" / "extra box found on the pallet: scan the outside box, how many extra
// cases, pieces per case, scan the location" / "Not done yet in each pallet; keep the front page short".
console.log('\n🚢 Container here: fast scan & move, extra boxes found on a pallet, Not done yet per pallet');
{
  const T = 'Container FAST';
  await post('/inventory/review-mode', { mode: 'manual' });
  await post('/reorder/vendor-catalog/import', { vendor: 'KW', title: T, stage: 'shipped', last: true, file: 'f.xlsx', rows: [{ part: '61-1-1=5', raw: '61-1-1=5', qty: 50, cases: 10, pcs: 500, case_pcs: 50, src_rows: '5', description: 'cap' }] });
  await post('/reorder/fix/pallets', { title: T, vendor: 'KW', file: 'f.xlsx', lines: [{ pallet: '7', part: '61-1-1=5', raw: '61-1-1=5', cases: 10, pcs: 500, units: 50, pcsPerCtn: 50, row: '5' }] });
  await post('/reorder/fix/incoming-receive', { title: T, location: 'GARAGE', lines: [{ key: '61-1-1=5', part: '61-1-1=5', cases: 10, description: 'cap' }] });
  await post('/inventory/upc-link', { upc: '081234500001', part: '61-1-1=5' });
  const pc = () => sq.prepare("SELECT SUM(cases * units_per_case) t FROM master_list WHERE part_num = '61-1-1=5'").get().t || 0;
  const moved = () => sq.prepare("SELECT COALESCE(SUM(m.cases), 0) n FROM pallet_move m JOIN reorder_pallet p ON p.id = m.pallet_id WHERE p.title = ?").get(T).n;
  const sc = await get('/inventory/containers/scan?code=081234500001');
  check('box scan in ONE trip: outside box UPC → 61-1-1=5, its pallet 7 and that pallet ready to show (spots with their SKU Mgr row, suggested shelves, box UPCs)',
    sc.ok && sc.part === '61-1-1=5' && sc.lines.length === 1 && sc.view && sc.view.ok && sc.view.lines.length === 1 && sc.view.lines[0].stock.some(x => x.location === 'GARAGE' && x.masterId && x.pending === 0)
      && (sc.view.upcs['61-1-1=5'] || []).includes('81234500001') && !!sc.view.recs['61-1-1=5'], sc);
  check('…a box UPC not saved yet → part: null, so the screen still asks for the part # (as before)', (await get('/inventory/containers/scan?code=099999999999')).part === null, null);
  check('…the 2 suggested shelves are the same as before (pallet-recs)', JSON.stringify(sc.view.recs['61-1-1=5']) === JSON.stringify((await post('/inventory/containers/pallet-recs', { parts: ['61-1-1=5'], fromLoc: 'GARAGE' })).recs['61-1-1=5']), null);
  const pv = await get('/inventory/containers/pallet-view?title=' + encodeURIComponent(T) + '&vendor=KW&pallet=7');
  check('opening a pallet is ONE trip (pallet-view: lines + suggested shelves + photos + box UPCs + extras)', pv.ok && pv.lines.length === 1 && pv.recs && pv.photos && pv.upcs && Array.isArray(pv.extras), pv);
  // scan & go move without a lookup: the Worker re-checks the spot has the cases
  const gid = sq.prepare("SELECT id FROM master_list WHERE part_num='61-1-1=5' AND location='GARAGE'").get().id, lid = sc.lines[0].id;
  sq.prepare('UPDATE master_list SET cases = 2 WHERE id = ?').run(gid);
  const m0 = moved();
  const tm = await post('/inventory/transfer', { partNum: '61-1-1=5', sku: '61-1-1=5', fromLocation: 'GARAGE', fromMasterId: gid, toLocation: 'C1=6-1-1', cases: 3, initials: 'TS', notes: '[CONTAINER SCAN] ' + T + ' · Pallet 7', palletLineId: lid, checkHave: true });
  check('scan & go move: the spot only has 2 → moving 3 is refused, nothing logged, pallet unchanged', !tm.ok && /Only 2 case/.test(tm.error) && moved() === m0, tm);
  sq.prepare('UPDATE master_list SET cases = 10 WHERE id = ?').run(gid);
  const ok1 = await post('/inventory/transfer', { partNum: '61-1-1=5', sku: '61-1-1=5', fromLocation: 'GARAGE', fromMasterId: gid, toLocation: 'C1=6-1-1', cases: 3, initials: 'TS', notes: '[CONTAINER SCAN] ' + T + ' · Pallet 7', palletLineId: lid, checkHave: true });
  const tm2 = await post('/inventory/transfer', { partNum: '61-1-1=5', sku: '61-1-1=5', fromLocation: 'GARAGE', fromMasterId: gid, toLocation: 'C1=6-1-1', cases: 7.5, initials: 'TS', notes: '', palletLineId: lid, checkHave: true });
  check('…3 moves (pallet 3 moved); then 7.5 more is refused — 3 are waiting for approval, so only 7 are free', ok1.ok && moved() === m0 + 3 && !tm2.ok, { ok1, tm2 });
  // ➕ extra boxes found on the pallet
  const p0 = pc(), mv0 = moved();
  const e1 = await post('/inventory/containers/extra', { title: T, vendor: 'KW', pallet: '7', part: '61-1-1=5', boxes: 2, pcsPerBox: 50, toLocation: 'c1=6-1-2' });
  // Owner (later): "we add those boxes to our SKU Mgr too, so we can start using them" — approved right away, even with Review on manual.
  check('extra 2 boxes × 50 pcs → new spot C1=6-1-2 (Review on manual): in SKU Mgr right away, Stock In Verified, by TS', e1.ok && e1.autoApproved && !e1.warn
    && sq.prepare('SELECT status FROM inventory_log WHERE id = ?').get(e1.d1Id).status === 'Verified' && sq.prepare('SELECT initials FROM inventory_log WHERE id = ?').get(e1.d1Id).initials === 'TS', e1);
  const nr = sq.prepare("SELECT cases, units_per_case u FROM master_list WHERE part_num='61-1-1=5' AND location='C1=6-1-2'").get(), lg = row(e1.d1Id);
  check('…C1=6-1-2 has 2 cases of 50 pcs (Each/Case from the box), pieces ' + p0 + ' → ' + pc() + ' (+100); History ' + lg.b + ' → ' + lg.a,
    nr && nr.cases === 2 && nr.u === 50 && pc() === p0 + 100 && lg.a - lg.b === 2 && moved() === mv0, { nr, lg, p: pc() });
  const p1 = pc(), g1 = sq.prepare('SELECT cases FROM master_list WHERE id = ?').get(gid).cases;
  const e2 = await post('/inventory/containers/extra', { title: T, vendor: 'KW', pallet: '7', part: '61-1-1=5', boxes: 4, pcsPerBox: 25, toLocation: 'GARAGE' });
  const own = sq.prepare("SELECT cases, units_per_case u FROM master_list WHERE part_num='61-1-1=5' AND location='GARAGE' AND units_per_case=25").get();
  check('extra 4 boxes × 25 pcs at GARAGE (its cases are 50 pcs): box quantities never change — own row 4 × 25, the 50-pc row stays ' + g1 + ', pieces +100, pallet count unchanged',
    e2.ok && e2.ownRow && e2.cases === 4 && own && own.cases === 4 && sq.prepare('SELECT cases FROM master_list WHERE id = ?').get(gid).cases === g1 && pc() === p1 + 100 && moved() === mv0
      && /\[EXTRA ON PALLET\] Container FAST · Pallet 7 — 4 extra box\(es\) × 25 pcs \(own row: GARAGE also has 61-1-1=5 in boxes of 50 pcs\)/.test(sq.prepare('SELECT notes FROM inventory_log WHERE id = ?').get(e2.d1Id).notes), { e2, own });
  const pv2 = await get('/inventory/containers/pallet-view?title=' + encodeURIComponent(T) + '&vendor=KW&pallet=7');
  check('…both extras show on pallet 7, with who and where', pv2.extras.length === 2 && pv2.extras.every(x => x.by === 'TS') && pv2.extras.map(x => x.toLoc).join() === 'C1=6-1-2,GARAGE', pv2.extras);
  const bad = await Promise.all([{ pcsPerBox: 0 }, { toLocation: '6-1-3' }, { part: '99-9-9=9' }, { boxes: 0 }].map(o => post('/inventory/containers/extra', { title: T, vendor: 'KW', pallet: '7', part: '61-1-1=5', boxes: 1, pcsPerBox: 50, toLocation: 'C1=6-1-3', ...o })));
  check('extra refused without pieces per box, without a full shelf label, for an unknown part #, or 0 boxes', bad.every(x => !x.ok), bad.map(x => x.error));
  check('box scan, pallet view and extra need a sign-in', (await call('/inventory/containers/scan?code=1')).status === 401 && (await call('/inventory/containers/pallet-view?title=x&pallet=1')).status === 401
    && (await call('/inventory/containers/extra', { method: 'POST', body: '{}' })).status === 401, null);
  const { readFileSync } = await import('node:fs');
  const ih = readFileSync(fileURLToPath(new URL('../inventory.html', import.meta.url)), 'utf8');
  check('screen: a box of the open pallet is matched on the phone; a move does not look the part up again; ➕ Extra box button',
    /function xfrGoLocalMatch\(code\)/.test(ih) && /checkHave: true/.test(ih) && /Extra box found on this pallet \(not on its list\)/.test(ih) && /window\.xfrExtraSave = function/.test(ih), null);
  check('screen: 📋 Not done yet on each pallet; the main one kept (smaller); box UPCs / photos / search and sold-out / print folded under ⚙ More',
    /📋 Not done yet on this pallet: /.test(ih) && /window\.xfrContPalLeft = function/.test(ih) && /id="xfr-cont-more"/.test(ih) && /⚙ More: 🔥 sold-out pallets · 🖨 print/.test(ih), null);
}

// Owner: "we transfer or any other thing we do must stay at same box quantities, 100% match, can't change any numbers"
// + "two different pcs on the same column → one extra step in Stock Out to confirm the right box"
// + "boxes taken off a pallet in Stock Out: boxes left go down, with a history of when, who, how many".
console.log('\nBox sizes never change · Transfer touches only its own row · Stock Out off a pallet');
{
  await post('/inventory/review-mode', { mode: 'auto' });
  sq.exec(`INSERT INTO master_list (id, base_sku, name, part_num, location, cases, units_per_case, sheet_row) VALUES
    (9201, '62-1-1', 'nut', '62-1-1=40', 'GARAGE', 10, 40, 0), (9202, '62-1-1', 'nut', '62-1-1=40', 'C1=9-2-1', 2, 20, 0),
    (9203, '62-2-2', 'bolt', '62-2-2=1', 'C1=9-2-2', 5, 10, 0), (9204, '62-1-1', 'nut', '62-1-1=40', 'C1=9-2-3', 1, 40, 0)`);
  const C = id => sq.prepare('SELECT cases FROM master_list WHERE id = ?').get(id).cases;
  const readFileSync0 = () => require0('node:fs').readFileSync(fileURLToPath(new URL('../inventory.html', import.meta.url)), 'utf8');
  const pcs = p => sq.prepare('SELECT SUM(cases * units_per_case) t FROM master_list WHERE part_num = ?').get(p).t || 0;
  const p0 = pcs('62-1-1=40'), other0 = C(9203), allRows0 = sq.prepare('SELECT SUM(cases) t FROM master_list WHERE id NOT IN (9201,9202,9203,9204)').get().t;
  // the same box size: adds to that row only (rows made in D1 all have sheet_row 0 — every one of them used to get the cases)
  const t1 = await post('/inventory/transfer', { partNum: '62-1-1=40', sku: '62-1-1=40', fromLocation: 'GARAGE', fromMasterId: 9201, toLocation: 'C1=9-2-3', cases: 3, initials: 'TS', notes: '' });
  check('Transfer 3 × 62-1-1=40 GARAGE → C1=9-2-3 (same 40-pc boxes): GARAGE 10 → ' + C(9201) + ', C1=9-2-3 1 → ' + C(9204) + '; no other row changes (another item stays ' + other0 + ')',
    t1.autoApproved && C(9201) === 7 && C(9204) === 4 && C(9202) === 2 && C(9203) === other0 && sq.prepare('SELECT SUM(cases) t FROM master_list WHERE id NOT IN (9201,9202,9203,9204)').get().t === allRows0 && pcs('62-1-1=40') === p0,
    sq.prepare('SELECT id, location, cases FROM master_list WHERE id BETWEEN 9201 AND 9204').all());
  // another box size at the destination: its own row, numbers unchanged
  const t2 = await post('/inventory/transfer', { partNum: '62-1-1=40', sku: '62-1-1=40', fromLocation: 'GARAGE', fromMasterId: 9201, toLocation: 'C1=9-2-1', cases: 5, initials: 'TS', notes: '' });
  const own = sq.prepare("SELECT cases, units_per_case u FROM master_list WHERE part_num = '62-1-1=40' AND location = 'C1=9-2-1' ORDER BY id").all();
  check('5 cases of 40 pcs onto a shelf of 20-pc cases: stay 5 cases of 40 pcs (own row), the 20-pc row stays 2; pieces ' + p0 + ' = ' + pcs('62-1-1=40'),
    t2.autoApproved && own.length === 2 && own[0].cases === 2 && own[0].u === 20 && own[1].cases === 5 && own[1].u === 40 && C(9201) === 2 && pcs('62-1-1=40') === p0, own);
  const h2 = sq.prepare("SELECT total_before b, total_after a, total_warning w FROM inventory_log WHERE type = 'TRANSFER_IN' ORDER BY id DESC LIMIT 1").get();
  check('…History: part total unchanged, no ⚠ warning', h2.b === h2.a && !h2.w, h2);
  // Stock Out takes from the exact row picked (a spot can hold 2 box sizes now)
  sq.exec(`INSERT INTO master_list (id, base_sku, name, part_num, location, cases, units_per_case, sheet_row) VALUES
    (9211, '64-1-1', 'tee', '64-1-1=5', 'C2=9-1-1', 8, 20, 0), (9212, '64-1-1', 'tee', '64-1-1=5', 'C2=9-1-1', 4, 40, 0), (9213, '64-1-1', 'tee', '64-1-1=5', 'BARN=9-1-1', 6, 20, 77)`);
  const so1 = await post('/inventory/log', { type: 'OUT', partNum: '64-1-1=5', sku: '64-1-1=5', location: 'C2=9-1-1', cases: 1, initials: 'PK', notes: '[SHELVING]', masterId: 9212 });
  check('Stock Out of the 40-pc box (row picked): only that row goes down (4 → 3); the 20-pc row stays 8', so1.autoApproved && C(9212) === 3 && C(9211) === 8 && C(9213) === 6, [C(9211), C(9212), C(9213)]);
  const so2 = await post('/inventory/log', { type: 'OUT', partNum: '64-1-1=5', sku: '64-1-1=5', location: 'C2=9-1-1', cases: 2, initials: 'PK', notes: '[SHELVING]' });
  check('a Stock Out with no row id at a spot whose rows have no sheet row: taken at THAT spot (C2 8 → 6), never another spot\'s row (BARN stays 6)', so2.autoApproved && C(9211) === 6 && C(9213) === 6 && C(9212) === 3, [C(9211), C(9212), C(9213)]);
  const pk = readFileSync0();
  check('Pull List sends the picked row\'s id with the Stock Out', /masterId: item\.masterId \|\| null, \/\/ the exact SKU Mgr row picked/.test(pk), null);
  // Stock Out: 2 box sizes at one spot → extra confirm step (screen)
  const { readFileSync } = await import('node:fs');
  const ih = readFileSync(fileURLToPath(new URL('../inventory.html', import.meta.url)), 'utf8');
  check('Stock Out: a spot with 2 box sizes of the same part # → its own Pull List item per size, "📦 Grab the box of N pcs" and a confirm before Grabbed (noted in History)',
    /function invBoxSizes\(partNum, location\)/.test(ih) && /var key = invPullItemKey\(part\.partNum, loc\)/.test(ih) && (ih.match(/function invPullKey\(/g) || []).length === 1 && /📦 Grab the box of /.test(ih) && /comes in 2 box sizes here/.test(ih) && /\[BOX SIZE CHECKED: /.test(ih), null);
  check('Container here: a box UPC not saved yet is typed in by Admins only', /if \(!xfrIsAdmin\(\)\) \{ invFlash\('Box UPC ' \+ code \+ ' is not saved yet/.test(ih), null);
  // Stock Out off a pallet
  const T = 'Container PAL-OUT';
  await post('/reorder/vendor-catalog/import', { vendor: 'KW', title: T, stage: 'shipped', last: true, file: 'po.xlsx', rows: [{ part: '63-1-1=10', raw: '63-1-1=10', qty: 60, cases: 6, pcs: 600, case_pcs: 100, src_rows: '5', description: 'cap' }] });
  await post('/reorder/fix/pallets', { title: T, vendor: 'KW', file: 'po.xlsx', lines: [
    { pallet: 'A', part: '63-1-1=10', raw: '63-1-1=10', cases: 4, pcs: 400, units: 40, pcsPerCtn: 100, row: '5' },
    { pallet: 'B', part: '63-1-1=10', raw: '63-1-1=10', cases: 2, pcs: 200, units: 20, pcsPerCtn: 100, row: '5' } ] });
  sq.exec("INSERT INTO master_list (base_sku, name, part_num, location, cases, units_per_case) VALUES ('63-1-1', 'cap', '63-1-1=10', 'GARAGE', 3, 100)"); // 3 loose boxes already in GARAGE
  await post('/reorder/fix/incoming-receive', { title: T, location: 'GARAGE', lines: [{ key: '63-1-1=10', part: '63-1-1=10', cases: 6, description: 'cap' }] });
  const left = async () => { const w = ((await post('/inventory/containers/where', { parts: ['63-1-1=10'] })).where || {})['63-1-1=10'] || []; return Object.fromEntries(w.map(x => [x.pallet, x.left])); };
  const gid = sq.prepare("SELECT id FROM master_list WHERE part_num = '63-1-1=10' AND location = 'GARAGE' ORDER BY id LIMIT 1").get().id;
  const g0 = sq.prepare("SELECT SUM(cases) t FROM master_list WHERE part_num = '63-1-1=10' AND location = 'GARAGE'").get().t;
  check('setup: GARAGE has ' + g0 + ' boxes of 63-1-1=10 (3 loose + 6 on pallets A 4 / B 2)', g0 === 9 && JSON.stringify(await left()) === '{"A":4,"B":2}', await left());
  const crBefore = JSON.stringify((await get('/inventory/history-summary?days=1')).container);
  const o1 = await post('/inventory/log', { type: 'OUT', partNum: '63-1-1=10', sku: '63-1-1=10', location: 'GARAGE', cases: 2, initials: 'PK', notes: '[SHELVING]', masterId: gid });
  check('Stock Out 2 from GARAGE: the 3 loose boxes cover it — pallets stay A 4 / B 2', o1.ok && JSON.stringify(await left()) === '{"A":4,"B":2}', await left());
  const o2 = await post('/inventory/log', { type: 'OUT', partNum: '63-1-1=10', sku: '63-1-1=10', location: 'GARAGE', cases: 3, initials: 'PK', notes: '[SHELVING]', masterId: gid });
  const l2 = await left();
  check('Stock Out 3 more: 1 loose left, so 2 came off a pallet — pallet B (fewest left) 2 → 0, A stays 4; GARAGE 9 → 4 = boxes left on pallets (4)',
    o2.ok && l2.A === 4 && !l2.B && sq.prepare("SELECT SUM(cases) t FROM master_list WHERE part_num = '63-1-1=10' AND location = 'GARAGE'").get().t === 4, l2);
  const crAfter = JSON.stringify((await get('/inventory/history-summary?days=1')).container);
  check('…boxes taken by a Stock Out are not counted as 🚢 Container here work in the History report', crBefore === crAfter && crBefore !== undefined, { crBefore, crAfter });
  const bid = sq.prepare("SELECT id FROM reorder_pallet WHERE title = ? AND pallet = 'B'").get(T).id;
  const hs = await get('/inventory/containers/line-history?id=' + bid);
  check('🕘 pallet B history: PK took 2 box(es) → 🛒 Stock Out, with the time', hs.ok && hs.moves.length === 1 && hs.moves[0].by === 'PK' && hs.moves[0].cases === 2 && hs.moves[0].kind === 'stockout' && !!hs.moves[0].at, hs);
  const cx = await post('/inventory/cancel-entry', { id: o2.d1Id, cancelledBy: 'TS' });
  check('…that Stock Out cancelled → its boxes are back in GARAGE and on pallet B (2 again)', cx.ok && JSON.stringify(await left()) === '{"A":4,"B":2}' && sq.prepare("SELECT SUM(cases) t FROM master_list WHERE part_num = '63-1-1=10' AND location = 'GARAGE'").get().t === 7, await left());
  check('pallet history needs a sign-in', (await call('/inventory/containers/line-history?id=' + bid)).status === 401, null);
  await post('/inventory/review-mode', { mode: 'manual' });
}

// Owner: "History — total pcs too: Started With / Ended With in pieces, pieces in and out, and pieces under Whole inventory on each entry".
console.log('\nHistory: pieces (start → end, in / out, whole inventory per entry)');
{
  await post('/inventory/review-mode', { mode: 'auto' });
  sq.exec(`INSERT INTO master_list (id, base_sku, name, part_num, location, cases, units_per_case, sheet_row) VALUES
    (9301, '65-1-1', 'cap', '65-1-1=50', 'C3=1-1-1', 4, 50, 0), (9302, '65-1-1', 'cap', '65-1-1=50', 'C3=1-1-2', 2, 25, 0),
    (9303, '65-2-2', 'plug', '65-2-2=1', 'C3=1-1-3', 3, 0, 0)`);
  const W = () => sq.prepare('SELECT SUM(CASE WHEN COALESCE(units_per_case,0) > 0 THEN cases * units_per_case ELSE 0 END) p FROM master_list WHERE cases > 0').get().p;
  const s0 = await get('/inventory/history-summary?days=1');
  const w0 = W();
  const a = await post('/inventory/log', { type: 'IN', partNum: '65-1-1=50', sku: '65-1-1=50', location: 'C3=1-1-1', cases: 2, initials: 'TS', notes: '', masterId: 9301 });
  const w1 = W();
  const b = await post('/inventory/log', { type: 'OUT', partNum: '65-1-1=50', sku: '65-1-1=50', location: 'C3=1-1-2', cases: 1, initials: 'TS', notes: '[SHELVING]', masterId: 9302 });
  const c = await post('/inventory/log', { type: 'OUT', partNum: '65-2-2=1', sku: '65-2-2=1', location: 'C3=1-1-3', cases: 1, initials: 'TS', notes: '[SHELVING]', masterId: 9303 });
  const L = id => sq.prepare('SELECT pcs_each e, wh_pcs_before b, wh_pcs_after a FROM inventory_log WHERE id = ?').get(id);
  const la = L(a.d1Id), lb = L(b.d1Id), lc = L(c.d1Id);
  check('Stock In 2 boxes of 50 pcs: whole inventory ' + w0 + ' → ' + (w0 + 100) + ' pcs on its History line (+100)', la.e === 50 && la.b === w0 && la.a === w0 + 100 && w1 === w0 + 100, la);
  check('Stock Out 1 box of 25 pcs (other size, own line): whole inventory −25 pcs', lb.e === 25 && lb.b === w0 + 100 && lb.a === w0 + 75, lb);
  check('Stock Out from a line with no Each/Case: pieces not recorded (never a made-up number)', lc.e == null && lc.b == null && lc.a == null, lc);
  const s1 = await get('/inventory/history-summary?days=1'), P = s1.pieces || {};
  check('report: Started + Pcs In − Pcs Out = Ended (pieces), Ended = pieces on the shelves now (' + W() + ')',
    Math.abs(P.starting + P.in - P.out - P.ending) < 0.01 && P.ending === W(), P);
  check('report: today\'s pieces in +100 and out +25 more than before; the entry with no Each/Case is listed apart (1 entry, 1 case), and the shelves\' cases with no Each/Case are named',
    Math.abs(P.in - (s0.pieces.in + 100)) < 0.01 && Math.abs(P.out - (s0.pieces.out + 25)) < 0.01 && P.unknownEntries === s0.pieces.unknownEntries + 1 && P.noEachCasesNow >= 2, { before: s0.pieces, after: P });
  check('report: Stock In / Stock Out cards have pieces too', P.stockIn >= 100 && P.stockOut >= 25, P);
  const h = await get('/inventory/history?days=1&status=all');
  const ha = (h.rows || []).find(r => r.id === a.d1Id || r.d1Id === a.d1Id);
  check('History list sends whole-inventory pieces with each entry', ha && ha.wh_pcs_after === w0 + 100 && ha.pcs_each === 50, ha);
  const { readFileSync } = await import('node:fs');
  const ih = readFileSync(fileURLToPath(new URL('../inventory.html', import.meta.url)), 'utf8');
  check('screen: "Pieces In Stock" (Started With + Pcs In − Pcs Out = Ended With) under the cases; pieces under "Whole inventory" on each entry',
    /Pieces In Stock/.test(ih) && /id="hist-rp-start"/.test(ih) && /id="hist-rp-end"/.test(ih) && /r\.wh_pcs_before != null && r\.wh_pcs_after != null/.test(ih), null);
  await post('/inventory/review-mode', { mode: 'manual' });
}

// Owner: "using phone to test Transfer → Container here, try to scan, but it says load failed".
console.log('\nContainer here: a failed fast load never stops the scan');
{
  const { readFileSync } = await import('node:fs');
  const ih = readFileSync(fileURLToPath(new URL('../inventory.html', import.meta.url)), 'utf8');
  check('pallet-view fails (network / old Worker / server error) → the pallet loads the old way (pallets + suggested spots + photos)',
    /var legacy = function\(\) \{/.test(ih) && /why = \(d && d\.error\) \|\| 'pallet-view not ok'; return legacy\(\);/.test(ih) && /return legacy\(\); \}\);/.test(ih), null);
  check('the fast box scan fails → the full lookup as before; nothing shows a bare "Load failed" — it says what failed',
    /fast scan failed:/.test(ih) && /Pallets did not load: /.test(ih) && /Pallet did not load: /.test(ih) && /Screen error: /.test(ih), null);
  const wk = readFileSync(fileURLToPath(new URL('../worker/src/index.js', import.meta.url)), 'utf8');
  check('server: photos / suggested spots / box UPCs failing never stop the pallet from showing; the scan still returns its pallets if the pallet view fails',
    /soft\(productPhotoMap\(env, parts\), \{\}, 'photos'\)/.test(wk) && /out\.viewError = /.test(wk), null);
}

// Owner: "Extra Items found at the bottom of each pallet … we add those boxes to our SKU Mgr too, so we can start using them".
{
  const { readFileSync } = await import('node:fs');
  const ih = readFileSync(fileURLToPath(new URL('../inventory.html', import.meta.url)), 'utf8');
  check('➕ Extra items found on this pallet: at the bottom of an opened pallet and of every pallet in the container list (opens that pallet ready to scan)',
    (ih.match(/➕ Extra items found on this pallet<\/button>/g) || []).length === 2 && /window\.xfrExtraOnPallet = function\(btn\)/.test(ih) && /xfrGo\.pendingExtra === title/.test(ih), null);
}

// Owner: "Container here — keyboards keep popping up; 1 suggested spot; not on this pallet → Extra package / Cancel;
// extra boxes 1–8 / More, pieces 100…1000 / Other, then scan the spot; no waiting after the spot scan; WiFi down → resent later".
console.log('\nContainer here: no keyboard, tap buttons, no waiting, WiFi-safe');
{
  const { readFileSync } = await import('node:fs');
  const ih = readFileSync(fileURLToPath(new URL('../inventory.html', import.meta.url)), 'utf8');
  const names = [...ih.matchAll(/\n\s*function\s+((?:inv|xfr)[\w$]*)\s*\(/g), ...ih.matchAll(/\n\s*window\.((?:inv|xfr)[\w$]*)\s*=\s*function/g)].map(m => m[1]);
  const dup = names.filter((n, i) => names.indexOf(n) !== i);
  check('no two page functions share a name (one silently replaces the other — it broke the Pull List key and a pop-up)', dup.length === 0, dup);
  check('scan box never opens the phone keyboard; ⌨ types on purpose; Moving is − N + with a number pad; no typing boxes in the steps',
    /id="xfr-cont-box" type="text" inputmode="none"/.test(ih) && /window\.xfrTypeOn = function/.test(ih) && /window\.xfrGoStep = function/.test(ih) && /window\.xfrKeypad = function/.test(ih)
      && !/id="xfr-go-loc"|id="xfr-ex-boxes"|id="xfr-ex-pcs"|id="xfr-ex-loc"|id="xfr-ex-part"/.test(ih), null);
  check('one suggested spot', /R\.recs\.slice\(0, 1\)/.test(ih) && /Suggested spot:/.test(ih), null);
  check('a box not on the pallet → pop-up: ➕ Extra package found on this pallet / Cancel', /function xfrNotOnPallet\(part, lines\)/.test(ih) && /➕ Extra package found on this pallet<\/button>/.test(ih), null);
  check('extra boxes: 1–8 + More…, pieces 100 150 200 250 300 500 1000 + Other…, then scan the spot', /\[1, 2, 3, 4, 5, 6, 7, 8\]/.test(ih) && /\[100, 150, 200, 250, 300, 500, 1000\]/.test(ih) && /More…/.test(ih) && /Other…/.test(ih), null);
  check('no waiting: the move and the extra show at once and save through the phone outbox (WiFi down → sent later, never twice)',
    /invPost\(W \+ '\/inventory\/containers\/extra'/.test(ih) && /function xfrGoAddPhoneQueue\(\)/.test(ih) && /No waiting \(owner\): the screen moves on right away/.test(ih), null);
  const T = 'Container FAST';
  const rid = 'kw-extra-dup-1';
  const before = sq.prepare("SELECT COUNT(*) n FROM inventory_log WHERE notes LIKE '[EXTRA ON PALLET]%'").get().n;
  const d1 = await post('/inventory/containers/extra', { title: T, vendor: 'KW', pallet: '7', part: '61-1-1=5', boxes: 1, pcsPerBox: 50, toLocation: 'C1=6-1-9', _requestId: rid });
  const d2 = await post('/inventory/containers/extra', { title: T, vendor: 'KW', pallet: '7', part: '61-1-1=5', boxes: 1, pcsPerBox: 50, toLocation: 'C1=6-1-9', _requestId: rid });
  const oc = await post('/inventory/outbox/check', { ids: [rid] });
  check('extra sent twice from the outbox (same id): saved once, and the outbox check says "saved"', d1.ok && d2.ok && sq.prepare("SELECT COUNT(*) n FROM inventory_log WHERE notes LIKE '[EXTRA ON PALLET]%'").get().n === before + 1
    && sq.prepare("SELECT cases FROM master_list WHERE location = 'C1=6-1-9'").get().cases === 1 && oc.results[rid].state === 'saved', { d1, d2, oc });
}

console.log('\nTransfer SKU/Part#/UPC: scan → spot → tap how many → cart → scan box / how many / spot; never more than the spot has');
{
  const { readFileSync } = await import('node:fs');
  const ih = readFileSync(fileURLToPath(new URL('../inventory.html', import.meta.url)), 'utf8');
  check('no 1–4 explanation list — one line says what to scan now', /Scan the box you need to move/.test(ih) && !/st\(4, 'At the new spot/.test(ih), null);
  check('scan box has no phone keyboard (⌨ to type); Product Name still types', /id="xfr-search-inp" type="text" inputmode="none"/.test(ih) && /id="xfr-search-kb"/.test(ih) && /if \(mode === 'name'\) \{ inp\.removeAttribute\('inputmode'\)/.test(ih), null);
  check('how many boxes: buttons 1–10 + More… (number pad), no typing boxes in grab / put-away', /function xfrNumGrid\(fn, max\)/.test(ih) && /\[1,2,3,4,5,6,7,8,9,10\]/.test(ih) && /xfrNumGrid\('xfrGrabAdd', have\)/.test(ih) && /xfrNumGrid\('xfrPutN', item\.cases\)/.test(ih)
    && !/id="xfr-grab-n"|id="xfr-grab-loc"|id="xfr-put-n"|id="xfr-put-loc"|id="xfr-put-box"/.test(ih) && /id="xfr-put-scan" type="text" inputmode="none"/.test(ih), null);
  check('put-away: no waiting, through the phone outbox, Worker re-checks the spot (checkHave), refused → back in the cart',
    /\[SCAN PUT-AWAY\]'\)\.trim\(\), checkHave: true/.test(ih) && /refused: the boxes go back in the cart/.test(ih) && /function xfrLkCache\(code, d\)/.test(ih), null);
  // Inventory rule: a transfer can never move more than its FROM spot has
  // (it used to cut FROM to 0 and still add the full count at TO — boxes out of nothing).
  const fromRow = sq.prepare("SELECT id, cases FROM master_list WHERE part_num = '61-1-1=5' AND location = 'C1=6-1-9'").get();
  const pcsAll = () => sq.prepare('SELECT SUM(cases * COALESCE(units_per_case, 0)) t FROM master_list').get().t;
  const casesAll = () => sq.prepare('SELECT SUM(cases) t FROM master_list').get().t;
  const p0 = pcsAll(), c0 = casesAll();
  const ch = await post('/inventory/transfer', { partNum: '61-1-1=5', sku: '61-1-1=5', fromLocation: 'C1=6-1-9', fromMasterId: fromRow.id, toLocation: 'C1=6-1-8', isNewLocation: true, cases: fromRow.cases + 4, initials: 'KW', checkHave: true });
  check('put-away of more boxes than the spot has → refused by the Worker (checkHave), nothing logged', ch.ok === false && /Only .* case\(s\) of 61-1-1=5/.test(ch.error || ''), ch);
  const t = await post('/inventory/transfer', { partNum: '61-1-1=5', sku: '61-1-1=5', fromLocation: 'C1=6-1-9', fromMasterId: fromRow.id, toLocation: 'C1=6-1-8', isNewLocation: true, cases: fromRow.cases + 4, initials: 'KW' });
  const v = await post('/inventory/transfer/verify', { action: 'Approved', outItem: { partNum: '61-1-1=5', location: 'C1=6-1-9', cases: fromRow.cases + 4, rowIndex: t.outD1Id, d1Id: t.outD1Id, masterId: fromRow.id }, inItem: { location: 'C1=6-1-8', isNew: true, rowIndex: t.inD1Id, d1Id: t.inD1Id } });
  check('approving a transfer of ' + (fromRow.cases + 4) + ' from a spot with ' + fromRow.cases + ' is refused — cases ' + c0 + ' = ' + casesAll() + ', pieces ' + p0 + ' = ' + pcsAll(),
    v.ok === false && /can't move/.test(v.error || '') && casesAll() === c0 && pcsAll() === p0 && !sq.prepare("SELECT 1 FROM master_list WHERE location = 'C1=6-1-8'").get(), { v, c: casesAll(), p: pcsAll() });
}

console.log('\nContainer here: ⚠ box UPC doesn\'t match its part # (confirm → on the container until fixed)');
{
  const { readFileSync } = await import('node:fs');
  const ih = readFileSync(fileURLToPath(new URL('../inventory.html', import.meta.url)), 'utf8');
  check('warning first (UPC code is not matching with SKU?) with Confirm / Cancel; sent through the phone outbox',
    /UPC code is not matching with SKU\?/.test(ih) && /onclick="xfrUpcConfirm\(\)"/.test(ih) && /invPost\(W \+ '\/inventory\/containers\/upc-issue'/.test(ih), null);
  const rid = 'kw-upc-dup-1', T = 'Container FAST';
  const line = sq.prepare("SELECT id, part FROM reorder_pallet WHERE title = ? AND pallet = '7' LIMIT 1").get(T);
  const u1 = await post('/inventory/containers/upc-issue', { title: T, vendor: 'KW', pallet: '7', lineId: line && line.id, part: (line && line.part) || '61-1-1=5', code: '00999000111222', _requestId: rid });
  const u2 = await post('/inventory/containers/upc-issue', { title: T, vendor: 'KW', pallet: '7', lineId: line && line.id, part: (line && line.part) || '61-1-1=5', code: '00999000111222', _requestId: rid });
  const oc = await post('/inventory/outbox/check', { ids: [rid] });
  check('report sent twice (same id): saved once, who / when / scanned code kept; outbox check says "saved"', u1.ok && u2.ok && sq.prepare("SELECT COUNT(*) n FROM pallet_upc_issue WHERE code = '00999000111222'").get().n === 1 && oc.results[rid].state === 'saved', { u1, u2, oc });
  const cl = await get('/inventory/containers');
  const cp = await get('/inventory/containers/pallets?title=' + encodeURIComponent(T));
  check('shows on the container (⚠ count) and in its pallets list, with the item, pallet and scanned code', (cl.containers.find(c => c.title === T) || {}).upcIssues === 1
    && cp.upcIssues.length === 1 && cp.upcIssues[0].pallet === '7' && cp.upcIssues[0].code === '00999000111222' && cp.upcIssues[0].by, { c: cl.containers.find(c => c.title === T), u: cp.upcIssues });
  await post('/inventory/containers/upc-issue', { fix: u1.issueId });
  check('✓ Fixed → off the container, kept in the record', !(await get('/inventory/containers/pallets?title=' + encodeURIComponent(T))).upcIssues.length && sq.prepare('SELECT fixed_at FROM pallet_upc_issue WHERE id = ?').get(u1.issueId).fixed_at, null);
}

console.log('\nLocation Plan → 🖼 Photos: ✓ confirmed photos never change; the rest take the newest Pack & Ship photo daily');
{
  const ins = (t, items) => sq.prepare('INSERT INTO ship_manifest_log (date, tracking, line_items) VALUES (?,?,?)').run(nyToday, t, JSON.stringify(items));
  ins('1ZKWPH1', [{ s: '77-1-1=2', q: 1, b: '77-1-1', i: 'https://img.example/a1.jpg' }, { s: '77-1-2=2', q: 1, b: '77-1-2', i: 'https://img.example/b1.jpg' }]);
  await post('/inventory/photo-refresh', {});
  const c = await post('/inventory/photo-confirm', { base: '77-1-1', url: 'https://img.example/a1.jpg' });
  ins('1ZKWPH2', [{ s: '77-1-1=2', q: 1, b: '77-1-1', i: 'https://img.example/a2.jpg' }, { s: '77-1-2=2', q: 1, b: '77-1-2', i: 'https://img.example/b2.jpg' }]);
  await post('/inventory/photo-refresh', {});
  const ph = await get('/inventory/photos?bases=77-1-1,77-1-2');
  check('confirmed photo kept (a1), not confirmed takes the newer one (b1 → b2)', c.ok && ph.photos['77-1-1'] === 'https://img.example/a1.jpg' && ph.photos['77-1-2'] === 'https://img.example/b2.jpg', { c, ph });
  check('every change is in the record', sq.prepare("SELECT COUNT(*) n FROM product_photo_log WHERE base_sku = '77-1-2' AND old_url = 'https://img.example/b1.jpg' AND new_url = 'https://img.example/b2.jpg'").get().n === 1, null);
  const rv = await get('/inventory/photo-review');
  check('Photos list: confirmed by / when, and Not confirmed ones', rv.ok && rv.items.some(i => i.base === '77-1-1' && i.confirmedAt && i.confirmedBy) && rv.items.some(i => i.base === '77-1-2' && !i.confirmedAt), null);
  const pr = await call('/inventory/photo-confirm', { method: 'POST', headers: { 'X-Cred-Token': pk.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ base: '77-1-2', url: 'https://img.example/b2.jpg' }) });
  check('only management can confirm', pr.status === 403, pr.status);
}

console.log('\nContainer here: pallet stays open on "Show every item"; a box scanned again after all moved');
{
  const { readFileSync } = await import('node:fs');
  const ih = readFileSync(fileURLToPath(new URL('../inventory.html', import.meta.url)), 'utf8');
  check('a pallet stays open once opened (Show every item does not fold it); not done on top, moved at the bottom',
    /ontoggle="xfrContPalOpen\(this\)"/.test(ih) && /\(xfrCont\.palOpen \|\| \{\}\)\[pk\] \? ' open'/.test(ih) && /not done on top, all moved at the bottom/.test(ih), null);
  check('scanned again after all moved → where it went (boxes, pcs, who, when), ✓ Confirm move to that spot / ➕ Extra box found / Cancel, through the outbox',
    /function xfrAllMoved\(l\)/.test(ih) && /Already moved — all/.test(ih) && /Confirm — move this box to/.test(ih) && /invPost\(W \+ '\/inventory\/containers\/recheck'/.test(ih), null);
  const T = 'Container FAST', rid = 'kw-recheck-dup-1', cases0 = sq.prepare('SELECT SUM(cases) t FROM master_list').get().t;
  const r1 = await post('/inventory/containers/recheck', { title: T, vendor: 'KW', pallet: '7', part: '61-1-1=5', location: 'C1=6-1-9', _requestId: rid });
  const r2 = await post('/inventory/containers/recheck', { title: T, vendor: 'KW', pallet: '7', part: '61-1-1=5', location: 'C1=6-1-9', _requestId: rid });
  const oc = await post('/inventory/outbox/check', { ids: [rid] });
  check('✓ Confirm sent twice (same id): kept once (who / when / spot), outbox check "saved", no count changes', r1.ok && r2.ok && sq.prepare("SELECT COUNT(*) n FROM pallet_recheck WHERE location = 'C1=6-1-9'").get().n === 1
    && oc.results[rid].state === 'saved' && sq.prepare('SELECT SUM(cases) t FROM master_list').get().t === cases0, { r1, r2, oc });
}

console.log('\nContainer here: every issue next to the pallet · Transfer: a spot with nothing on record');
{
  const { readFileSync } = await import('node:fs');
  const ih = readFileSync(fileURLToPath(new URL('../inventory.html', import.meta.url)), 'utf8');
  check('each pallet shows its issues next to "not done" (too many moved, extra boxes, UPC not matching, scanned again) and a tap lists them',
    /xfrPalIssueBadges\(gp, allL\) \+ '<\/span><\/summary>'/.test(ih) && /too many moved/.test(ih) && /extra box\(es\) found/.test(ih) && /scanned again/.test(ih) && /window\.xfrPalIssueList = function/.test(ih), null);
  const cp = await get('/inventory/containers/pallets?title=' + encodeURIComponent('Container FAST'));
  check('the pallets list sends the extras and the "scanned again" records with who / when', Array.isArray(cp.extras) && cp.extras.some(e => e.pallet === '7' && e.by) && Array.isArray(cp.rechecks) && cp.rechecks.some(r => r.pallet === '7' && r.location === 'C1=6-1-9'), { e: cp.extras, r: cp.rechecks });
  check('Transfer: nothing on record at the scanned spot → a spot right next to it with the same part # is offered (Yes / No / Cancel)',
    /function xfrNear\(a, b\)/.test(ih) && /function xfrGrabNotHere\(loc\)/.test(ih) && /Nothing on record at /.test(ih) && /Double check the label/.test(ih), null);
  // Owner changed this (after #145): how many boxes, then pieces per box → into the cart; the
  // Stock In [FOUND ON SHELF] [TRANSFER] is made (approved, through the outbox) where it's put away.
  check('…No / nothing next to it → how many boxes, pieces per box (buttons) → cart; Stock In [FOUND ON SHELF] [TRANSFER] when put away, approved, through the outbox',
    /window\.xfrFoundPcs = function/.test(ih) && /xfrNumGrid\('xfrFoundBoxes', null\)/.test(ih) && /'\[FOUND ON SHELF\] \[TRANSFER\] '/.test(ih) && /invLogAndApprove\(body, function\(d\) \{\s*return \{ rowIndex: d\.rowIndex, action: 'Approved', verifiedBy: by,/.test(ih), null);
  check('…the move keeps a note when the spot used is not the one scanned', /'\[SCANNED ' \+ G\.scanned \+ ' — on record at '/.test(ih), null);
}

console.log('\nTransfer: scroll to the scan box · found box → cart first · scan bar in the cart');
{
  const { readFileSync } = await import('node:fs');
  const ih = readFileSync(fileURLToPath(new URL('../inventory.html', import.meta.url)), 'utf8');
  check('after a scan the screen scrolls to the scan box (mode buttons out of view)', /window\.xfrScrollWork = function/.test(ih) && /setTimeout\(xfrScrollWork, 60\)/.test(ih), null);
  check('found box: boxes first, then pieces; no "not on record / stocked in here first" note; into the cart, not SKU Mgr',
    /found: \{ step: 'boxes'/.test(ih) && !/It is stocked in here first/.test(ih) && /found: true, foundAt: G\.loc, pcs: F\.pcs/.test(ih) && /item\.found \? xfrFoundPost\(item, toLoc, n\)/.test(ih), null);
  check('scan bar in the 🛒 cart (no keyboard) → opens that box\'s cart item with a main spot + 1 more',
    /id="xfr-cart-scan" type="text" inputmode="none"/.test(ih) && /window\.xfrCartScan = function/.test(ih) && /📍 Main spot: /.test(ih), null);
}

console.log('\nTransfer: scan bar stays in view · put-away asks how many first · ✕ on the scanned item');
{
  const { readFileSync } = await import('node:fs');
  const ih = readFileSync(fileURLToPath(new URL('../inventory.html', import.meta.url)), 'utf8');
  check('the scroll stops below the bars at the top of the screen, so the scan bar still shows', /\['#inv-app \.itopbar', '#inv-ob-bar'\]\.forEach/.test(ih) && /- cover - 10/.test(ih), null);
  check('put-away pop-up: "How many boxes are you putting here?" first, then scan the spot label (saved by itself)',
    /P\.step === 'n' \? '<div style="font-size:16px;font-weight:800;margin:10px 0 6px">How many boxes are you putting here\?<\/div>' \+ xfrNumGrid\('xfrPutN', item\.cases\)/.test(ih) && /stepLine\('📷 Put them on the shelf, then scan the spot label'\)/.test(ih), null);
  check('✕ on the scanned item closes it, ready for the next box', /id="xfr-result-x"[^>]*onclick="xfrStartOver\(\)"/.test(ih), null);
}

console.log('\nVeeqo: keep stock up (at or below 88 → 888) so labels can print');
{
  const realFetch = globalThis.fetch, puts = [];
  const stock = { 11: { physical_stock_level: 90, allocated_stock_level: 2, available_stock_level: 88 }, 12: { physical_stock_level: 500, allocated_stock_level: 0, available_stock_level: 500 },
    13: { physical_stock_level: 0, allocated_stock_level: 0, available_stock_level: 0, infinite: true }, 14: { physical_stock_level: 3, allocated_stock_level: 3, available_stock_level: 0 } };
  const prods = () => [{ id: 1, title: 'Tee', sellables: [{ id: 11, sku_code: '23-2-3=2', stock_entries: [{ warehouse_id: 5, ...stock[11] }] }, { id: 12, sku_code: '40-1-1=1', stock_entries: [{ warehouse_id: 5, ...stock[12] }] }] },
    { id: 2, title: 'Plug', sellables: [{ id: 13, sku_code: '7-7-7=1', stock_entries: [{ warehouse_id: 5, ...stock[13] }] }, { id: 14, sku_code: '8-8-8=2', stock_entries: [{ warehouse_id: 5, ...stock[14] }] }] }];
  globalThis.fetch = async (u, o) => { u = String(u);
    if (u.includes('api.veeqo.com/products')) return new Response(JSON.stringify(/page=1&/.test(u) ? prods() : []), { headers: { 'Content-Type': 'application/json' } });
    const m = u.match(/api\.veeqo\.com\/sellables\/(\d+)\/warehouses\/(\d+)\/stock_entry/);
    if (m && o && o.method === 'PUT') { const b = JSON.parse(o.body).stock_entry; puts.push({ id: +m[1], wh: +m[2], to: b.physical_stock_level });
      const e = stock[m[1]]; e.physical_stock_level = b.physical_stock_level; e.available_stock_level = b.physical_stock_level - e.allocated_stock_level; return new Response('{}'); }
    return realFetch(u, o); };
  env.VEEQO_API_KEY = 'k';
  const r1 = await post('/veeqo/stock-topup', { run: true });
  check('at or below 88 → set so 888 are available (88 with 2 on orders → 890; 0 with 3 on orders → 891); 500 and infinite left alone',
    r1.ok && puts.length === 2 && puts.some(p => p.id === 11 && p.wh === 5 && p.to === 890) && puts.some(p => p.id === 14 && p.to === 891), { r1, puts });
  const lg = await get('/veeqo/stock-topup');
  check('every change is on record (item, old → new, who / when)', lg.log.filter(x => x.sku).length === 2 && lg.log.some(x => x.sku === '23-2-3=2' && x.old_available === 88 && x.new_physical === 890 && x.by_user && x.ts), lg.log);
  const r2 = await post('/veeqo/stock-topup', { run: true });
  check('checking again changes nothing (now 888 available)', r2.ok && r2.updated === 0 && puts.length === 2, r2);
  const bad = await call('/veeqo/stock-topup', { method: 'POST', headers: H, body: JSON.stringify({ below: 900, to: 888 }) });
  check('settings must make sense ("at or below" lower than "set to")', bad.status === 400, bad.status);
  await post('/veeqo/stock-topup', { on: false });
  stock[11].available_stock_level = 5;
  const cronTick = async (iso) => { const ps = []; await worker.scheduled({ scheduledTime: Date.parse(iso) }, env, { waitUntil(p) { ps.push(Promise.resolve(p).catch(() => {})); } }); await Promise.all(ps); };
  const n0 = puts.length; await cronTick('2026-10-04T07:00:00Z'); // 3 AM New York
  check('switched off → nothing, even at 3 AM', puts.length === n0, puts);
  await post('/veeqo/stock-topup', { on: true });
  await cronTick('2026-10-04T15:30:00Z'); // 11:30 AM New York
  check('on, but not 3 AM → waits (once a day, not every 30 min)', puts.length === n0, puts.slice(n0));
  await cronTick('2026-10-04T07:00:00Z'); // 3 AM New York (EDT)
  check('3 AM New York → checks every item and sets it back up by itself (5 available → 890, so 888 available)', puts.length === n0 + 1 && puts[puts.length - 1].id === 11 && puts[puts.length - 1].to === 890, puts.slice(n0));
  stock[14].available_stock_level = 1;
  await cronTick('2026-10-04T07:30:00Z');
  check('…only once that day (3:30 AM does not start another check)', puts.length === n0 + 1, puts.slice(n0));
  await cronTick('2026-10-05T07:00:00Z');
  check('…and again the next day at 3 AM', puts.length === n0 + 2 && puts[puts.length - 1].id === 14, puts.slice(n0));
  sq.prepare("DELETE FROM app_config WHERE key = 'veeqo_stock_topup'").run(); stock[12].available_stock_level = 10;
  await cronTick('2026-10-05T15:30:00Z');
  check('right after it is first turned on (deployed) → one check right away, any time of day', puts.some(p => p.id === 12), puts.slice(n0));
  const pkt = (await (await call('/auth/login', { method: 'POST', body: '{"username":"picker","password":"password1"}' })).json()).token;
  const pk2 = await call('/veeqo/stock-topup', { headers: { 'X-Cred-Token': pkt } });
  check('management only (a picker is refused)', pk2.status === 401 || pk2.status === 403, pk2.status);
  // Owner: "run one right now have 100 failed" — empty replies count as done, 429 waits, refusals stop + say why, nothing skipped.
  sq.prepare("DELETE FROM app_config WHERE key = 'veeqo_stock_topup'").run();
  const many = (n, wh) => Array.from({ length: n }, (_, i) => ({ id: 100 + i, title: 'P' + i, sellables: [{ id: 1000 + i, sku_code: 'X-' + i, stock_entries: [{ warehouse_id: wh === 'each' ? 50 + i : wh, physical_stock_level: 0, allocated_stock_level: 0, available_stock_level: 0 }] }] }));
  let mode = 'empty', puts2 = [], hits429 = 0;
  globalThis.fetch = async (u, o) => { u = String(u);
    if (u.includes('api.veeqo.com/products')) return new Response(JSON.stringify(/page=1&/.test(u) ? many(mode === 'empty' || mode === '429' ? 3 : 30, mode === 'refuse2' ? 'each' : 9) : []), { headers: { 'Content-Type': 'application/json' } });
    if (/stock_entry/.test(u) && o && o.method === 'PUT') {
      if (mode === 'refuse' || mode === 'refuse2') return new Response('{"error":"not allowed"}', { status: 403 });
      if (mode === '429' && hits429++ === 0) return new Response('slow down', { status: 429, headers: { 'retry-after': '1' } });
      puts2.push(u); return new Response(null, { status: 204 }); }
    return realFetch(u, o); };
  env.VEEQO_API_KEY = 'k';
  const runNow = () => post('/veeqo/stock-topup', { run: true });
  const e1 = await runNow();
  check('Veeqo saves but answers with an empty reply → counted as done, not "failed"', e1.ok && e1.updated === 3 && e1.failed === 0 && puts2.length === 3, e1);
  mode = '429'; puts2 = []; sq.prepare("DELETE FROM app_config WHERE key = 'veeqo_stock_topup'").run();
  const e2 = await runNow();
  check('Veeqo says "too many requests" → waits and tries again (not failed)', e2.ok && e2.updated === 3 && e2.failed === 0, e2);
  mode = 'refuse'; sq.prepare("DELETE FROM app_config WHERE key = 'veeqo_stock_topup'").run();
  const e3 = await runNow(), g3 = await get('/veeqo/stock-topup');
  check('Veeqo refuses every change → stops early (not 100 tries) and shows why', e3.ok && e3.failed <= 10 && e3.failed >= 5 && /403/.test(e3.firstError) && /403/.test(g3.lastRun.firstError || '') && (e3.skippedWarehouses || []).length === 1, e3);
  mode = 'refuse2'; sq.prepare("DELETE FROM app_config WHERE key = 'veeqo_stock_topup'").run();
  const e4 = await runNow(), g4 = await get('/veeqo/stock-topup');
  check('…refused everywhere → stops after 10 in a row, shows why, and checks that page again next time (no item skipped)', e4.ok && e4.failed === 10 && e4.stopped === 'errors' && /403/.test(g4.lastError) && g4.passActive === true && e4.nextPage === 1, { e4, lastError: g4.lastError, passActive: g4.passActive });
  globalThis.fetch = realFetch; delete env.VEEQO_API_KEY;
}

// Owner: "keep Veeqo stock up still gets 'Feature not available on your current plan' — I changed some to Infinity; show me which listing has the error and if it is set to Infinity or not".
console.log('\nVeeqo: 🔍 Check every item — Infinite or not, and which ones had an error (read-only)');
{
  const realFetch = globalThis.fetch; let writes = 0, prodCalls = 0;
  const page = n => Array.from({ length: n }, (_, i) => ({ id: 500 + i, title: 'Item ' + i, sellables: [{ id: 5000 + i, sku_code: 'S-' + i, stock_entries: [{ warehouse_id: 346371, physical_stock_level: i === 1 ? 5 : 900, allocated_stock_level: 0, available_stock_level: i === 1 ? 5 : 900, infinite: i === 0 }] }] }));
  globalThis.fetch = async (u, o) => { u = String(u);
    if (o && o.method && o.method !== 'GET') { writes++; return new Response('{}'); }
    if (u.includes('api.veeqo.com/warehouses')) return new Response(JSON.stringify([{ id: 346371, name: 'Main' }]));
    if (u.includes('api.veeqo.com/products')) { prodCalls++; const pg = +(u.match(/page=(\d+)/) || [])[1]; return new Response(JSON.stringify(pg <= 3 ? page(100) : pg === 4 ? page(2) : [])); }
    return realFetch(u, o); };
  env.VEEQO_API_KEY = 'k';
  const ins = sq.prepare('INSERT INTO veeqo_stock_log (ts, sku, sellable_id, warehouse_id, old_physical, old_available, new_physical, by_user, note) VALUES (?,?,?,?,?,?,?,?,?)');
  ins.run('2026-10-03T19:02:00Z', 'S-0', 5000, 346371, 0, 0, null, 'Chen', 'FAILED: HTTP 403: {"error_messages":"Feature not available on your current plan"} (warehouse 346371)');
  ins.run('2026-10-03T19:02:01Z', 'S-1', 5001, 346371, 5, 5, null, 'Chen', 'FAILED: HTTP 403: {"error_messages":"Feature not available on your current plan"} (warehouse 346371)');
  const a = await get('/veeqo/stock-topup/items?page=1'), b = await get('/veeqo/stock-topup/items?page=' + a.next);
  const items = a.items.concat(b.items), f = (sku) => items.find(x => x.sku === sku), last = Object.fromEntries((a.lastResult || []).map(x => [x.s + ':' + x.w, x]));
  check('reads every item, page by page (302 rows over 2 calls), with the warehouse name', a.ok && !a.done && a.next === 4 && b.done && items.length === 302 && a.warehouses['346371'] === 'Main', { n: items.length, a: a.done, b: b.done });
  check('shows Infinite yes/no and what is available (S-0 Infinite, S-1 5 left, not Infinite)', f('S-0').infinite === true && f('S-1').infinite === false && f('S-1').available === 5, [f('S-0'), f('S-1')]);
  check('shows the last error for each item (S-0 and S-1 failed with "current plan")', last['5000:346371'] && last['5000:346371'].failed && /current plan/.test(last['5001:346371'].note), a.lastResult);
  check('only looks — nothing is changed in Veeqo', writes === 0, writes);
  const pkt = (await (await call('/auth/login', { method: 'POST', body: '{"username":"picker","password":"password1"}' })).json()).token;
  const pk = await call('/veeqo/stock-topup/items?page=1', { headers: { 'X-Cred-Token': pkt } });
  check('management only (a picker is refused)', pk.status === 401 || pk.status === 403, pk.status);
  const { readFileSync } = await import('node:fs');
  const ps = readFileSync(fileURLToPath(new URL('../packship.html', import.meta.url)), 'utf8');
  const kindSrc = (ps.match(/function psVsiKind\(it\) \{[\s\S]*?\n\}/) || [''])[0], lastSrc = (ps.match(/function psVsiLast\(it\) \{[^\n]*\}/) || [''])[0];
  const kind = new Function('PS_VSI', lastSrc + kindSrc + '; return psVsiKind;')({ below: 88, last: last });
  check('screen: "🔍 Check every item" button; an item that failed but is now Infinite counts as fixed (♾), a failed one not Infinite stays ⚠',
    /onclick="psVsiLoad\(\)"/.test(ps) && /\/veeqo\/stock-topup\/items\?page=/.test(ps) && kind(f('S-0')) === 'inf' && kind(f('S-1')) === 'err' && kind(f('S-2')) === 'ok', null);
  globalThis.fetch = realFetch; delete env.VEEQO_API_KEY;
}

console.log('\nContainer here: ✅ This pallet is done — what is not moved, short on record, ➕ More / ✓ Finish all');
{
  const { readFileSync } = await import('node:fs');
  const ih = readFileSync(fileURLToPath(new URL('../inventory.html', import.meta.url)), 'utf8');
  check('pallet screen: "✅ This pallet is done" → not moved (where / who / when / how many), 📷 Found it / ✗ Not on the pallet; matched → ➕ More in the pallet / ✓ Finish all',
    /This pallet is done — check it/.test(ih) && /window\.xfrPalDone = function/.test(ih) && /Found it — move it/.test(ih) && /Not on the pallet/.test(ih)
      && /More in the pallet/.test(ih) && /Finish all — next pallet/.test(ih) && /xfrPalMore = function\(\) \{[^}]*xfrExtraStart\(\)/.test(ih) && /xfrPalFinish = function\(\) \{[\s\S]{0,300}?xfrGoBack\(\)/.test(ih), null);
  check('…pops up by itself at the last box moved', /if \(!xfrPalState\(\)\.unchecked\.length\) xfrPalDone\(\);/.test(ih), null);
  check('…short goes through the phone outbox (no WiFi → saved on the phone)', /invPost\(W \+ '\/inventory\/containers\/short'/.test(ih), null);
  const T = 'Container FAST', line = sq.prepare("SELECT id, cases FROM reorder_pallet WHERE title = ? AND pallet = '7'").get(T);
  const mv = sq.prepare("SELECT COALESCE(SUM(m.cases), 0) n FROM pallet_move m LEFT JOIN inventory_log l ON l.id = m.out_log_id WHERE m.pallet_id = ? AND COALESCE(l.status, '') != 'Rejected' AND l.cancelled_at IS NULL").get(line.id).n;
  const left = line.cases - mv;
  const cases0 = sq.prepare('SELECT SUM(cases) t FROM master_list').get().t, logs0 = sq.prepare('SELECT COUNT(*) n FROM inventory_log').get().n, rid = 'kw-short-dup-1';
  const pkH = { 'X-Cred-Token': (await (await call('/auth/login', { method: 'POST', body: '{"username":"picker","password":"password1"}' })).json()).token, 'Content-Type': 'application/json' };
  const sh = b => call('/inventory/containers/short', { method: 'POST', headers: pkH, body: JSON.stringify(b) }).then(r => r.json());
  const s1 = await sh({ title: T, vendor: 'KW', pallet: '7', lineId: line.id, short: 999, _requestId: rid });
  const s2 = await sh({ title: T, vendor: 'KW', pallet: '7', lineId: line.id, short: 999, _requestId: rid });
  const rows = sq.prepare('SELECT * FROM pallet_short WHERE line_id = ?').all(line.id), oc = await post('/inventory/outbox/check', { ids: [rid] });
  check('✗ Not on the pallet (a worker, sent twice): kept once — pallet list / moved / short worked out by the Worker (never more than is left), who / when; outbox check "saved"',
    left > 0 && s1.ok && s2.ok && rows.length === 1 && rows[0].cases === line.cases && rows[0].moved === mv && rows[0].short === left && rows[0].by_user === 'PK' && rows[0].at && oc.results[rid].state === 'saved', { left, s1, s2, rows, oc });
  check('…a short changes NO inventory number (SKU Mgr total and History unchanged)', sq.prepare('SELECT SUM(cases) t FROM master_list').get().t === cases0 && sq.prepare('SELECT COUNT(*) n FROM inventory_log').get().n === logs0, null);
  const cp = await get('/inventory/containers/pallets?title=' + encodeURIComponent(T)), pv = await get('/inventory/containers/pallet-view?title=' + encodeURIComponent(T) + '&vendor=KW&pallet=7');
  check('…shown on the container (next to the pallet) and on the pallet screen', cp.shorts.some(x => x.lineId === line.id && x.short === left && x.by === 'PK') && pv.shorts.some(x => x.lineId === line.id), { s: cp.shorts, v: pv.shorts });
  const bad = await sh({ title: T, vendor: 'KW', pallet: '9', lineId: line.id });
  check('…an item not on that pallet is refused', bad.ok === false, bad);
  const fixPk = await call('/inventory/containers/short', { method: 'POST', headers: pkH, body: JSON.stringify({ fix: rows[0].id }) });
  check('…only management marks it ✓ Fixed', fixPk.status === 403, fixPk.status);
  const fx = await post('/inventory/containers/short', { fix: rows[0].id });
  check('…✓ Fixed → off the container, kept in the record (who / when)', fx.ok && !(await get('/inventory/containers/pallets?title=' + encodeURIComponent(T))).shorts.length && !!sq.prepare('SELECT fixed_at FROM pallet_short WHERE id = ?').get(rows[0].id).fixed_at, fx);
  check('…needs a sign-in', (await call('/inventory/containers/short', { method: 'POST', body: '{}' })).status === 401, null);
}

console.log('\nHistory: the Cancel button stays on screen (pinned right, phones too)');
{
  const { readFileSync } = await import('node:fs');
  const ih = readFileSync(fileURLToPath(new URL('../inventory.html', import.meta.url)), 'utf8');
  check('Cancel is offered on a Verified Stock In / Out and its column is pinned to the right edge (not pushed off by the wide Part Total column)',
    /r\.status === 'Verified' && \(typ === 'IN' \|\| typ === 'OUT'\) && r\.id\) \{\s*cancelCell = '<button onclick="invCancelHistoryEntry\(/.test(ih)
      && /position:sticky;right:0;z-index:1[^']*>Cancel<\/th>'/.test(ih) && /white-space:nowrap;position:sticky;right:0;background:' \+ bg \+ '[^>]*>' \+ cancelCell \+ '<\/td>'/.test(ih), null);
}

// Owner: "one of my guys keeps getting logged out, the phone says 'approve step waiting for WiFi' — it might be after I reset his password;
// and passwords can be 4 numbers, not 8".
console.log('\nPhone outbox never signs a worker out · passwords of 4 numbers');
{
  const { readFileSync } = await import('node:fs');
  const ih = readFileSync(fileURLToPath(new URL('../inventory.html', import.meta.url)), 'utf8');
  const runAfter = (ih.match(/async function invObRunAfter\(ent, d\) \{[\s\S]*?\n\}/) || [''])[0], send = (ih.match(/async function invObSend\(ent, first\) \{[\s\S]*?\n\}/) || [''])[0];
  const obFetch = (ih.match(/async function invObFetch\(url, opts\) \{[\s\S]*?\n\}/) || [''])[0];
  check('the outbox sends with invObFetch (signs out only on 401 — a 403 "only a manager approves" never signs the worker out), not wFetch',
    /if \(r\.status === 401\) \{ invCredSignedOut\(\);/.test(obFetch) && !/403/.test(obFetch.replace(/\/\/[^\n]*/g, '')) && /invObFetch\(INV_OB_W \+ tpl\.path/.test(runAfter) && /r\.status === 403/.test(runAfter) && /invObFetch\(INV_OB_W \+ ent\.path/.test(send) && !/wFetch\(/.test(runAfter + send), null);
  const isLoc = (ih.match(/function xfrIsLoc\(code\) \{[\s\S]*?\n  \}/) || [''])[0];
  const L = new Function('INV_PREFIXES', isLoc + '; return xfrIsLoc;')(['BARN=', 'C1=', '2FL=']);
  check('a bare area prefix ("BARN=") is not a spot; BARN=2-2-2, C1=5-1-1 and GARAGE are', !L('BARN=') && !L('c1=') && L('BARN=2-2-2') && L('C1=5-1-1') && L('GARAGE'), null);
  sq.prepare("INSERT INTO cred_user_roles (user_id, role) SELECT id, 'admin' FROM cred_users WHERE username = 'owner1'").run();
  const own = await (await call('/auth/login', { method: 'POST', body: '{"username":"owner1","password":"password1"}' })).json();
  const OH = { 'X-Cred-Token': own.token, 'Content-Type': 'application/json' };
  const mk = async (u, pw) => { const r = await call('/admin/users/create', { method: 'POST', headers: OH, body: JSON.stringify({ username: u, password: pw, displayName: u.toUpperCase(), roles: ['ops'] }) }); return { st: r.status, d: await r.json() }; };
  const c3 = await mk('pin3', '123'), c4 = await mk('pin4', '1234');
  const li = await (await call('/auth/login', { method: 'POST', body: '{"username":"pin4","password":"1234"}' })).json();
  check('a password of 4 numbers works (create "1234" → can sign in); 3 is too short', c3.st === 400 && /at least 4/.test(c3.d.error) && c4.st === 200 && c4.d.ok && !!li.token, { c3, c4, li: !!li.token });
  const rs = await call('/admin/users/reset-password', { method: 'POST', headers: OH, body: JSON.stringify({ userId: c4.d.userId, newPassword: '5678' }) });
  const old = await call('/inventory/containers', { headers: { 'X-Cred-Token': li.token } });
  const li2 = await (await call('/auth/login', { method: 'POST', body: '{"username":"pin4","password":"5678"}' })).json();
  check('reset to 4 numbers ("5678"): the old sign-in stops (401 → the phone asks to sign in), the new one works', rs.status === 200 && old.status === 401 && !!li2.token, { rs: rs.status, old: old.status });
  // Owner: "reset Yola's password, why still not working?" — 10 wrong tries locked her out; the reset must unlock her.
  for (let i = 0; i < 10; i++) await call('/auth/login', { method: 'POST', body: '{"username":"pin4","password":"0000"}' });
  const locked = await call('/auth/login', { method: 'POST', body: '{"username":"pin4","password":"5678"}' });
  await call('/admin/users/reset-password', { method: 'POST', headers: OH, body: JSON.stringify({ userId: c4.d.userId, newPassword: '4321' }) });
  const li3 = await call('/auth/login', { method: 'POST', body: '{"username":"pin4","password":"4321"}' });
  check('locked after 10 wrong tries → Reset password unlocks: the new password works right away', locked.status === 429 && li3.status === 200 && !!(await li3.json()).token, { locked: locked.status, after: li3.status });
}

// Owner: "Pack & Ship — one more tab: scan the shipping label tracking number, show everything in that package".
console.log('\nPack & Ship → 🏷️ Label Check: scan a label → every item in the package');
{
  await get('/ship/print-log?date=' + nyToday);
  const cols = sq.prepare('PRAGMA table_info(ship_manifest_log)').all().map(c => c.name);
  const row = { date: '2026-09-20', tracking: '1Z999AA1LABELCHK01', order_num: 'LC-1', channel: 'Amazon', carrier: 'UPS', customer_name: 'Jane Doe', line_items: JSON.stringify([{ s: '61-1-1=5', q: 2, b: '61-1-1' }]) };
  const k = Object.keys(row).filter(x => cols.includes(x));
  sq.prepare('INSERT INTO ship_manifest_log (' + k.join(',') + ') VALUES (' + k.map(() => '?').join(',') + ')').run(...k.map(x => row[x]));
  const c0 = sq.prepare('SELECT SUM(cases) t FROM master_list').get().t, l0 = sq.prepare('SELECT COUNT(*) n FROM inventory_log').get().n;
  const pk = await get('/ship/package?tracking=1z999aa1labelchk01');
  const it = (pk.items || [])[0] || {}, have = sq.prepare("SELECT location, cases FROM master_list WHERE part_num = '61-1-1=5' AND cases > 0").all();
  check('label of any date → its order (LC-1 · Amazon · Jane Doe) and each item: part #, how many, pieces per box, shelf spots with cases (same as SKU Mgr)',
    pk.ok && pk.found && pk.order.orderNum === 'LC-1' && pk.order.customerName === 'Jane Doe' && it.partNum === '61-1-1=5' && it.qty === 2 && it.pcsPerCase > 0
      && have.length > 0 && have.every(h => it.spots.some(x => x.location === String(h.location).toUpperCase() && x.cases === h.cases)) && Array.isArray(pk.history), { pk, have });
  const nf = await get('/ship/package?tracking=1Z000000NOTALABEL0');
  check('…an unknown label → found: false (the screen says so)', nf.ok && nf.found === false, nf);
  check('…read-only: no inventory number or History row changes', sq.prepare('SELECT SUM(cases) t FROM master_list').get().t === c0 && sq.prepare('SELECT COUNT(*) n FROM inventory_log').get().n === l0, null);
  check('…needs a sign-in', (await call('/ship/package?tracking=1Z999AA1LABELCHK01')).status === 401, null);
}

// Owner: "under XFitting Admin → Users I can delete the user we don't use no more".
console.log('\nAdmin → Users: Remove a user who no longer works here (name stays on old records)');
{
  const own = await (await call('/auth/login', { method: 'POST', body: '{"username":"owner1","password":"password1"}' })).json();
  const OH = { 'X-Cred-Token': own.token, 'Content-Type': 'application/json' };
  const P = async (p, b, h) => { const r = await call(p, { method: 'POST', headers: h || OH, body: JSON.stringify(b) }); return { st: r.status, d: await r.json() }; };
  const mk = await P('/admin/users/create', { username: 'leftjob', password: '4321', displayName: 'LJ', roles: ['ops'] });
  const li = await (await call('/auth/login', { method: 'POST', body: '{"username":"leftjob","password":"4321"}' })).json();
  sq.prepare("INSERT INTO inventory_log (timestamp, type, part_num, cases, initials, status) VALUES ('2026-01-01','IN','23-2-3=2',1,'LJ','Verified')").run();
  const logsBefore = sq.prepare('SELECT COUNT(*) n FROM inventory_log').get().n;
  const rm = await P('/admin/users/remove', { userId: mk.d.userId });
  const old = await call('/inventory/containers', { headers: { 'X-Cred-Token': li.token } });
  const li2 = await (await call('/auth/login', { method: 'POST', body: '{"username":"leftjob","password":"4321"}' })).json();
  const list = await (await call('/admin/users/list', { headers: OH })).json();
  const lj = list.users.find(x => x.username === 'leftjob');
  check('Remove: signed out right away, can\'t sign in, marked removed (row kept, records untouched)',
    rm.st === 200 && old.status === 401 && !li2.token && !!lj && !!lj.removedAt && lj.removedBy === 'owner1' && !lj.active
      && sq.prepare('SELECT COUNT(*) n FROM inventory_log').get().n === logsBefore, { rm, old: old.status, lj });
  const again = await P('/admin/users/create', { username: 'leftjob', password: '4321', displayName: 'X', roles: [] });
  const en = await P('/admin/users/toggle-active', { userId: mk.d.userId, active: true });
  const self = await P('/admin/users/remove', { userId: own.userId || sq.prepare("SELECT id FROM cred_users WHERE username='owner1'").get().id });
  const logged = sq.prepare("SELECT COUNT(*) n FROM user_activity_log WHERE action_type='admin_user_removed'").get().n;
  check('a removed username can\'t be reused or Enabled until Restored; you can\'t remove yourself; the remove is logged',
    again.st === 409 && /Restore/.test(again.d.error) && en.st === 400 && self.st === 400 && logged >= 1, { again, en, self, logged });
  const rs = await P('/admin/users/restore', { userId: mk.d.userId });
  const en2 = await P('/admin/users/toggle-active', { userId: mk.d.userId, active: true });
  const li3 = await (await call('/auth/login', { method: 'POST', body: '{"username":"leftjob","password":"4321"}' })).json();
  check('Restore → back on the list (Disabled), Enable → can sign in again', rs.st === 200 && en2.st === 200 && !!li3.token, { rs, en2 });
  const { readFileSync } = await import('node:fs');
  const ah = readFileSync(fileURLToPath(new URL('../xfitting-admin.html', import.meta.url)), 'utf8');
  check('Users tab: 🗑 Remove button on each user, removed users hidden behind "Show removed users" with Restore',
    /onclick="adRemoveUser\(' \+ u\.id/.test(ah) && /removed users \('/.test(ah) && /adRestoreUser\(' \+ u\.id/.test(ah) && /AD\.users\.filter\(function\(u\)\{ return !u\.removedAt; \}\)/.test(ah), null);
}

// Owner: "Stock Out Shelving: merge Product name into SKU/Part#/UPC, take off Location · Transfer: only SKU/Part#/UPC (+ name) and
// Container here · new ✅ Checking tab: scan UPC / SKU / name / location → see everything; on a spot: change the number, None found,
// Something else found (scan box → boxes → pieces → scan spot → saves by itself → next)".
console.log('\nStock Out / Transfer: one search box (part # / UPC / name) · ✅ Checking tab');
{
  const { readFileSync } = await import('node:fs');
  const ih = readFileSync(fileURLToPath(new URL('../inventory.html', import.meta.url)), 'utf8');
  check('Stock Out: no "Product Name" / "Location" buttons — one box for part #, barcode or name (name searched when no part # / UPC matches)',
    !/id="inv-smode-name"/.test(ih) && !/id="inv-smode-loc"/.test(ih) && /id="inv-search-inp" type="text" placeholder="Part #, barcode or product name…"/.test(ih)
      && /else \{ invLookup\(val, true\); \}/.test(ih) && /if \(byName && invNameFallback\(code, d\)\) \{ invScanNameSearch\(code\); return; \}/.test(ih), null);
  check('Transfer: only "SKU / Part# / UPC / Name" and "🚢 Container here" (no Product Name / Location buttons); a name typed (⌨) is searched by name',
    /id="xfr-mode-code"[^>]*>SKU \/ Part# \/ UPC \/ Name</.test(ih) && /id="xfr-mode-cont"/.test(ih) && !/id="xfr-mode-name"/.test(ih) && !/id="xfr-mode-loc"/.test(ih)
      && /xfrLookup\(val, true\)/.test(ih) && /if \(byName && invNameFallback\(code, d\) && !xfrIsLoc\(/.test(ih), null);
  const fb = new Function('window', (ih.match(/window\.invNameFallback = function[^\n]*/) || [''])[0] + '; return window.invNameFallback;')({});
  check('…a part # / UPC always goes first; only "not found" text with letters is searched as a name', fb('elbow', {}) && fb('Tee 1/2', { partNum: null }) && !fb('30-3-4', {}) && !fb('012345678905', {}) && !fb('tee', { partNum: '23-2-3=2' }) && !fb('tee', { upcNotLinked: true }), null);
  check('✅ Checking tab sits right after Stock Out Big Company', /id="inv-tab-stockoutco"[^\n]*\n\s*<button class="itab" id="inv-tab-check" onclick="invSwitchTab\('check'\)">✅ Checking<\/button>/.test(ih) && /id="inv-panel-check"/.test(ih), null);

  // Run the page's own ✅ Checking code against the real Worker (fake screen, real saves).
  sq.prepare("INSERT INTO master_list (base_sku, name, part_num, location, cases, units_per_case) VALUES ('77-7-1','Cap 1/2','77-7-1=10','C2=1-1-1',5,10), ('77-7-1','Cap 1/2','77-7-1=10','BARN=2-1-1',3,10), ('77-7-1','Cap 1/2','77-7-1=2X','C2=1-1-1',4,2), ('77-7-1','Cap 1/2','77-7-1=10','C2=1-1-2',7,10), ('77-7-1','Cap 1/2','77-7-1=5','C1=9-9-9',2,5)").run();
  sq.prepare("INSERT INTO inventory_log (timestamp, type, part_num, location, cases, initials, notes, status, verified_by) VALUES ('2026-09-20T14:00:00Z','IN','77-7-1=10','C2=1-1-1',5,'Maria','','Verified','TS')").run();
  const ckNowT = l => (l.adjustedCases !== undefined && l.adjustedCases !== null ? parseFloat(l.adjustedCases) : parseFloat(l.cases)) || 0;
  const pcs = () => sq.prepare("SELECT SUM(cases * units_per_case) p FROM master_list WHERE base_sku = '77-7-1' OR part_num LIKE '77-7-1=%'").get().p;
  const cs = (part, loc) => sq.prepare('SELECT cases c, units_per_case u FROM master_list WHERE part_num = ? AND location = ? ORDER BY id').all(part, loc).map(x => x.c + '×' + x.u).join(',');
  const pcs0 = pcs(); // 5×10 + 3×10 + 4×2 + 7×10 + 2×5 = 168
  await post('/inventory/review-mode', { mode: 'manual' });
  const els = {}, el = id => els[id] || (els[id] = { id, value: '', innerHTML: '', style: {}, focus() {}, set textContent(v) {}, className: '' });
  const xIsLoc = (ih.match(/function xfrIsLoc\(code\) \{[\s\S]*?\n  \}/) || [''])[0], xParent = (ih.match(/function invParent\(p\) \{[^\n]*/) || [''])[0];
  const xEsc = (ih.match(/function xfrEsc\(v\) \{[^\n]*/) || [''])[0], xN = (ih.match(/function xfrN\(v\) \{[^\n]*/) || [''])[0], xT = (ih.match(/function xfrFmtT\(iso\) \{[^\n]*/) || [''])[0];
  const ckSrc = (ih.match(/  \/\/ ══ ✅ Checking ═+[\s\S]*?(?=\n  \/\/ 📷 camera)/) || [''])[0];
  const flashes = [], popups = [], pads = [];
  // the phone: storage (survives a reload) and the outbox (no WiFi → kept, sent later with the same id)
  const mem = {}, phoneStore = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } };
  let wifi = true; const outboxQ = [];
  const phoneOutbox = async (url, opts) => {
    const body = JSON.parse(opts.body || '{}'); body._requestId = 'rq-' + Math.random().toString(36).slice(2); const ent = { path: url, body };
    if (!wifi) { outboxQ.push(ent); return new Response(JSON.stringify({ ok: true, queued: true })); }
    return call(url, { method: 'POST', headers: H, body: JSON.stringify(body) });
  };
  const sendOutbox = async () => { while (outboxQ.length) { const e = outboxQ.shift();
    if (e.log) { const d = await post('/inventory/log', e.body); if (e.verifyFor && d && d.ok !== false) await post('/inventory/verify', e.verifyFor(d)); continue; }
    await call(e.path, { method: 'POST', headers: H, body: JSON.stringify(e.body) }); await call(e.path, { method: 'POST', headers: H, body: JSON.stringify(e.body) }); } };
  const wFetch = (u, o) => wifi ? call(u, { ...(o || {}), headers: { ...H, ...((o && o.headers) || {}) } }) : Promise.reject(new Error('Failed to fetch'));
  const logAndApprove = async (body, verifyFor) => { if (!wifi) { outboxQ.push({ log: true, body, verifyFor }); return { ok: true, queued: true }; } const d = await post('/inventory/log', body); if (verifyFor && d && d.ok !== false) d._after = await post('/inventory/verify', verifyFor(d)); return d; };
  const mk = auto => new Function('window', 'g', 'W', 'wFetch', 'invLogAndApprove', 'invFlash', 'INV_CRED_USER', 'invAuditAutoMode', 'DB', 'INV_PREFIXES', 'invPullWalkCompare', 'setTimeout', 'xfrPopup', 'xfrPopupClose', 'xfrKeypad', 'invUnlocked', 'invPost', 'localStorage',
    xIsLoc + '\n' + xParent + '\n' + xEsc + '\n' + xN + '\n' + xT + '\n' + ckSrc + '\nreturn { CK: CK };')(
    (globalThis.__ckWin = globalThis), el, '', wFetch, logAndApprove, (m, t) => flashes.push(m), { displayName: 'Ana' }, auto, { master: [], products: [] },
    ['BARN=', 'C1=', 'C2=', '2FL='], (a, b) => String(a).localeCompare(String(b)), () => 0, h => { popups.push(h); }, () => {}, (t, v, cb) => { pads.push(t); }, false, phoneOutbox, phoneStore);
  const settle = () => new Promise(r => setTimeout(r, 60));
  let ck = mk(true), w = globalThis.__ckWin;
  check('the Checking code is found and loads', ckSrc.length > 2000 && typeof w.ckGo === 'function', ckSrc.length);

  // a spot → what is there now, who put it there and when
  w.ckGo('C2=1-1'); await settle(); await settle();
  const rowsRow = ck.CK.rows.length;
  w.ckGo('C2=1-1-1'); await settle(); await settle();
  const rowsAt = ck.CK.rows.map(r => r.partNum + '@' + r.location).sort();
  check('scan a spot → what is there now + who put it there and when; scan a row (C2=1-1) → every spot in it', rowsRow === 3 && rowsAt.join() === '77-7-1=10@C2=1-1-1,77-7-1=2X@C2=1-1-1'
    && /Put here by <b>Maria<\/b>/.test(el('ck-out').innerHTML) && /✗ None found/.test(el('ck-out').innerHTML) && /Something else found on this spot/.test(el('ck-out').innerHTML), { rowsAt, html: el('ck-out').innerHTML.slice(0, 300) });
  // change the number: 5 → 3 (auto mode: approved right away, History keeps Before → After)
  const iA = ck.CK.rows.findIndex(r => r.partNum === '77-7-1=10' && r.location === 'C2=1-1-1');
  w.ckPick(iA, 3); await settle(); await settle(); // tap "3" on our own number buttons
  const outRow = sq.prepare("SELECT type, cases, notes, status, total_before b, total_after a FROM inventory_log WHERE part_num='77-7-1=10' AND notes LIKE '%Checking%' ORDER BY id DESC").get();
  check('count 5 → 3: an [AUDIT] Stock Out of 2, approved, shelf now 3, History 15 → 13 cases', cs('77-7-1=10', 'C2=1-1-1') === '3×10' && outRow && outRow.type === 'OUT' && outRow.cases === 2
    && /^\[AUDIT\] System: 5 → Actual: 3/.test(outRow.notes) && outRow.status === 'Verified' && outRow.b === 15 && outRow.a === 13, outRow);
  // None found on =2X → 0
  const iB = ck.CK.rows.findIndex(r => r.partNum === '77-7-1=2X');
  w.ckNoneFound(iB); await settle(); await settle();
  const nf = sq.prepare("SELECT type, cases, notes FROM inventory_log WHERE part_num='77-7-1=2X' ORDER BY id DESC").get();
  check('✗ None found → that item at that spot goes to 0 (an [AUDIT] [NONE FOUND] Stock Out of all 4)', !sq.prepare("SELECT SUM(cases) c FROM master_list WHERE part_num='77-7-1=2X'").get().c && nf.type === 'OUT' && nf.cases === 4 && /\[NONE FOUND\]/.test(nf.notes), nf);
  // ➕ Something else found: scan box → 2 boxes × 25 pcs (new box size) → scan the spot → saved → next box
  w.ckOtherStart(); w.ckGo('77-7-1=10'); await settle(); await settle();
  check('➕ Something else found → scan the box → asks boxes + pieces (pieces pre-filled from the part #)', ck.CK.other.step === 'count' && ck.CK.other.part === '77-7-1=10' && Number(ck.CK.other.pcs) === 10, ck.CK.other);
  w.ckOtherPcsSet(25); w.ckOtherN(2); w.ckGo('C2=1-1-1'); await settle(); await settle(); // ✏️ pieces 25 (our keypad), tap "2" boxes, scan the spot
  check('…scan the spot → saves by itself (2 boxes × 25 pcs = a new 25-pc row at C2=1-1-1, the 10-pc row unchanged) and starts over at "scan the box"',
    cs('77-7-1=10', 'C2=1-1-1') === '3×10,2×25' && ck.CK.other && ck.CK.other.step === 'box' && ck.CK.saved.length === 1, { c: cs('77-7-1=10', 'C2=1-1-1'), o: ck.CK.other });
  w.ckGo('77-7-1=10'); await settle(); await settle(); w.ckOtherN(1); w.ckGo('BARN=2-1-1'); await settle(); await settle(); // pieces pre-filled 10
  check('…next box: 1 × 10 pcs scanned at BARN=2-1-1 → added to the 10-pc row there (3 → 4), not a new row', cs('77-7-1=10', 'BARN=2-1-1') === '4×10' && ck.CK.saved.length === 2, cs('77-7-1=10', 'BARN=2-1-1'));
  // numbers add up: 158 pcs − 2 boxes×10 − 4 boxes×2 + 2×25 + 1×10 = 190
  const pcs1 = pcs();
  check('numbers add up: 168 pcs − 20 (count 5→3) − 8 (None found) + 50 (2×25) + 10 (1×10) = 200 pcs', pcs0 === 168 && pcs1 === 200, { pcs0, pcs1 });
  // a part # / UPC → every spot; exact part # shows only that one, with a family button
  w.ckOtherStop(); await settle(); await settle();
  w.ckGo('77-7-1=10'); await settle(); await settle();
  const h1 = el('ck-out').innerHTML;
  w.ckShowAll(true); const h2 = el('ck-out').innerHTML;
  w.ckGo('77-7-1'); await settle(); await settle(); const h3 = el('ck-out').innerHTML;
  // Owner: "All the family → show the total cases and total pieces of the whole family; take the ✏️ pcs/case box off the part # search".
  const famCases = sq.prepare("SELECT SUM(cases) c FROM master_list WHERE part_num LIKE '77-7-1=%'").get().c;
  check('👪 All the family → FAMILY TOTAL at the top = every shelf row: 18 case(s) · 200 pcs (=10: 3×10 + 2×25 + 4×10 + 7×10, =5: 2×5) — same as the database',
    /👪 FAMILY TOTAL · \d+ part #s<\/div><div[^>]*>18 case\(s\) · 200 pcs<\/div>/.test(h2) && famCases === 18 && pcs() === 200 && !/FAMILY TOTAL/.test(h1), { famCases, p: pcs() });
  check('…each part # adds its own spots\' pieces (77-7-1=10: 16 case(s) · 190 pcs — not 16 × 10 = 160)', /77-7-1=10<\/span><span>16 case\(s\) · 190 pcs<\/span>/.test(h2), null);
  check('no ✏️ pcs/case button on the part # view (it stays on a spot)', !/ckPackAsk\(\\'part\\'/.test(ckSrc) && !/✏️ pcs \/ case/.test(h1 + h2) && /ckPackAsk\(\\'loc\\',/.test(ckSrc), null);
  check('scan 77-7-1=10 → only that part # (every spot, cases, pcs, who / when) + "👪 Show all the family"; the button / the parent 77-7-1 → all part #s',
    /BARN=2-1-1/.test(h1) && !/77-7-1=5</.test(h1) && /Show all the family \(3 part #s\)/.test(h1) && /Put here by/.test(h1) && /77-7-1=5</.test(h2) && /C1=9-9-9/.test(h2) && /all part #s/.test(h3), { h1: h1.slice(0, 200) });
  // manual Audit mode → a count change waits for a manager (nothing changes until approved)
  ck = mk(false); w = globalThis.__ckWin;
  w.ckGo('BARN=2-1-1'); await settle(); await settle();
  const iC = ck.CK.rows.findIndex(r => r.partNum === '77-7-1=10');
  w.ckPick(iC, 1); await settle(); await settle();
  const pend2 = sq.prepare("SELECT status FROM inventory_log WHERE part_num='77-7-1=10' AND location='BARN=2-1-1' ORDER BY id DESC").get();
  check('Audit mode Manual → a count change goes to Review (Pending); the shelf is not changed until a manager approves', pend2.status === 'Pending' && cs('77-7-1=10', 'BARN=2-1-1') === '4×10' && pcs() === 200, pend2);
  // Owner: "the count needs our own number box 1–9 + More… (our number pad) — we always try to hide the phone keyboard".
  check('Checking: counts and boxes use our own buttons 1–9 + More… (our number pad), never the phone keyboard (no number inputs)',
    !/id="ck-cnt-/.test(ckSrc) && !/id="ck-o-n"/.test(ckSrc) && !/id="ck-o-pcs"/.test(ckSrc) && !/type="number"/.test(ckSrc)
      && /\[1,2,3,4,5,6,7,8,9\]\.map/.test(ckSrc) && /if \(n === 'more'\) \{ xfrKeypad\(/.test(ckSrc) && /ckGrid\('ckPick\(' \+ i \+ ',', now, true\)/.test(ckSrc) && /ckGrid\('ckOtherN\(', null\)/.test(ckSrc), null);
  // Owner: "under Checking show how many pieces in that case also".
  ck = mk(true); w = globalThis.__ckWin;
  w.ckGo('C2=1-1-1'); await settle(); await settle(); const hp = el('ck-out').innerHTML;
  w.ckGo('77-7-1=10'); await settle(); await settle(); const hq = el('ck-out').innerHTML;
  // Owner (later): on a spot, no "System: … × … pcs = … pcs" line and no spot label on each row (it's at the top) —
  // the system's number stands out in the 1–9 buttons (big, green, ✓ SYSTEM); tapping it = correct.
  check('Checking shows pieces per case: a spot → "77-7-1=10 · 10 pcs / case" (the 25-pc row too); a part # → "× 10 pcs/case = 30 pcs"',
    /77-7-1=10 <span[^>]*>· 10 pcs \/ case/.test(hp) && /· 25 pcs \/ case/.test(hp) && /× 10 pcs\/case = 30 pcs/.test(hq) && /× 25 pcs\/case = 50 pcs/.test(hq), { hp: hp.slice(0, 600) });
  const sysBtns = hp.match(/<button type="button" data-sys="1" onclick="ckPick\((\d+),(\d+(?:\.\d+)?)\)"[^>]*>(?:<div[^>]*>✓ SYSTEM<\/div>)?/g) || [];
  check('a spot: no "System: … pcs" line, no ✓ Correct button, no spot label repeated on each row; the system number is the big green "✓ SYSTEM" button (3 and 2 here)',
    !/System: <b/.test(hp) && !/✓ Correct/.test(hp) && !/📍 <span>C2=1-1-1<\/span>/.test(hp) && sysBtns.length === 2 && /ckPick\(\d+,3\)/.test(sysBtns.join()) && /ckPick\(\d+,2\)/.test(sysBtns.join()) && /✗ None found/.test(hp), { sysBtns, hp: hp.slice(0, 900) });
  w.ckGo('C2=1-1'); await settle(); await settle(); const hr = el('ck-out').innerHTML;
  check('…a whole row (C2=1-1) still shows the spot on rows that are not C2=1-1 itself', /📍 <span>C2=1-1-1<\/span>/.test(hr) && /📍 <span>C2=1-1-2<\/span>/.test(hr), null);
  w.ckGo('C2=1-1-1'); await settle(); await settle();
  const pc0 = pcs(), nRows = ck.CK.rows.length;
  ck.CK.rows.forEach((r, i) => w.ckPick(i, ckNowT(r))); await settle(); await settle(); await settle();
  const hd = el('ck-out').innerHTML;
  check('tap the green (system) number on each item = correct (nothing changes); when every item is counted → "✅ All counted — scan the next spot"',
    nRows === 2 && pcs() === pc0 && /✅ All counted at C2=1-1-1 — scan the next spot/.test(hd) && (hd.match(/Count matches — confirmed/g) || []).length === 2, { nRows, hd: hd.slice(0, 500) });
  check('product photo on each item (tap = big), on the part # view and on Something else found', /function ckPic\(part, px\)/.test(ckSrc) && /ckPic\(r\.partNum\)/.test(ckSrc) && /ckPic\(d\.partNum, 84\)/.test(ckSrc) && /ckPic\(o\.part\)/.test(ckSrc) && /onclick="invPhotoBig\(this\.src\)"/.test(ckSrc), null);

  // Owner: "able to edit the case pieces — the case quantities we have most as set numbers, then More… to type (our own pad, no phone keyboard)".
  const sz = await get('/inventory/pack-sizes');
  check('✏️ pieces per case: the quick buttons are the sizes we have most (from the shelf rows)', sz.ok && sz.sizes.length >= 3 && sz.sizes.length <= 9 && sz.sizes.includes(10) && sz.sizes.every((x, i, a) => i === 0 || a[i - 1] < x), sz);
  ck = mk(true); w = globalThis.__ckWin;
  w.ckGo('C2=1-1-2'); await settle(); await settle();
  const iP = ck.CK.rows.findIndex(r => r.partNum === '77-7-1=10');
  popups.length = 0; w.ckPackAsk('loc', iP);
  check('…tap ✏️ → our own buttons (common sizes + More…), no phone keyboard', popups.length === 1 && /More…/.test(popups[0]) && /ckPackPick\('loc',/.test(popups[0]) && !/<input/.test(popups[0]), popups[0] && popups[0].slice(0, 300));
  w.ckPackPick('loc', iP, 'more');
  check('…More… opens our number pad', pads.length >= 1 && /Pieces in each case of 77-7-1=10 at C2=1-1-2/.test(pads[pads.length - 1]), pads);
  popups.length = 0; w.ckPackPick('loc', iP, 12);
  check('…a size asks to confirm with the pieces before → after (7 cases: 70 → 84 pcs)', /10 → <b>12<\/b> pcs per case/.test(popups[0] || '') && /70 → <b>84<\/b> pcs/.test(popups[0] || ''), popups[0]);
  const pB = pcs();
  await w.ckPackSave('loc', iP, 12); await settle();
  const pl = sq.prepare("SELECT master_id, part_num, location, cases, from_pcs, to_pcs, by_user FROM pack_change_log ORDER BY id DESC").get();
  check('✓ Yes → only that shelf row changes (C2=1-1-2: 7 cases × 10 → 12), cases stay, kept on record (who / old → new)', cs('77-7-1=10', 'C2=1-1-2') === '7×12' && cs('77-7-1=10', 'C2=1-1-1') === '3×10,2×25'
    && pl && pl.part_num === '77-7-1=10' && pl.location === 'C2=1-1-2' && pl.cases === 7 && pl.from_pcs === 10 && pl.to_pcs === 12 && pl.by_user === 'TS', pl);
  check('numbers add up: pieces change by exactly cases × (new − old) = 7 × 2 = +14 (200 → 214)', pB === 200 && pcs() === 214, { pB, now: pcs() });
  check('…the row shows the new size and who changed it', /· 12 pcs \/ case/.test(el('ck-out').innerHTML) && /Pieces per case 10 → 12 by/.test(el('ck-out').innerHTML), null);
  const stale = await post('/inventory/pack-change', { masterId: pl.master_id, partNum: '77-7-1=10', location: 'C2=1-1-2', from: 10, to: 20 });
  check('a stale change (someone else already changed it) is refused — nothing changes', stale.ok === false && /now 12/.test(stale.error) && cs('77-7-1=10', 'C2=1-1-2') === '7×12' && pcs() === 214, stale);
  // Owner: "Checking a part #: in order =old, =1, 1x, 1xx, 1xxx, =2, 2x … =10, =10x, =10xx, =11 … then 20, 21 … 30, 31…".
  const cmpSrc = (ckSrc.match(/  function ckPackKey\(p\) \{[\s\S]*?\n  function ckPartCompare\(a, b\) \{[\s\S]*?\n  \}/) || [''])[0];
  const ckCmp = new Function(cmpSrc + '; return ckPartCompare;')();
  const mixed = ['9-9-9=20', '9-9-9=10X', '9-9-9=2', '9-9-9=1XXX', '9-9-9=OLD', '9-9-9=11', '9-9-9=1', '9-9-9=10', '9-9-9=3XX', '9-9-9=1X', '9-9-9=10XX', '9-9-9=2X', '9-9-9=31', '9-9-9=1XX', '9-9-9=21', '9-9-9=30', '9-9-9=3', '9-9-9=3X'];
  const want = ['OLD', '1', '1X', '1XX', '1XXX', '2', '2X', '3', '3X', '3XX', '10', '10X', '10XX', '11', '20', '21', '30', '31'];
  const got = mixed.slice().sort(ckCmp).map(p => p.split('=')[1]);
  check('part #s in pack order: =OLD, =1, =1X, =1XX, =1XXX, =2, =2X, =3 … =10, =10X, =10XX, =11, =20, =21, =30, =31', got.join() === want.join() && /order\.sort\(ckPartCompare\)/.test(ckSrc), got);
  // Owner: "🔍 Audit → full recount (about once a year), column by column: scan the column → see it like Checking (photos);
  // scan each box at least once, confirm cases + pieces per box (the same part # can have different pieces per box);
  // not on record → cases + pieces (tap the pieces = saved); ✅ Done → anything not scanned: Found / None found (→ 0);
  // finish the column before the next one."
  console.log('\n🔍 Audit → 📋 Full recount, column by column');
  sq.prepare(`INSERT INTO master_list (base_sku, name, part_num, location, cases, units_per_case) VALUES
    ('88-8-1','Nipple','88-8-1=10','C3=4-1-1',5,10), ('88-8-1','Nipple','88-8-1=10','C3=4-1-1',3,25), ('88-8-1','Nipple','88-8-1=20','C3=4-1-1',2,20),
    ('88-8-1','Nipple','88-8-1=5','C3=4-1-1',4,5), ('88-8-1','Nipple','88-8-1=50','C3=4-1-1',1,50), ('88-8-1','Nipple','88-8-1=2','C5=9-9-9',1,2)`).run();
  sq.prepare("INSERT INTO locations (location, prefix, active, created_at) VALUES ('C3=4-1-2','C3=',1,'2026-01-01')").run();
  const rpcs = () => sq.prepare("SELECT SUM(cases * units_per_case) p FROM master_list WHERE part_num LIKE '88-8-1=%'").get().p;
  const rrows = loc => sq.prepare("SELECT part_num p, cases c, units_per_case u FROM master_list WHERE location = ? AND part_num LIKE '88-8-1=%' ORDER BY part_num, units_per_case").all(loc).map(x => x.p.split('=')[1] + ':' + x.c + '×' + x.u).join(' ');
  const r0 = rpcs(); // 50 + 75 + 40 + 20 + 50 + 2 = 237
  ck = mk(true); w = globalThis.__ckWin;
  w.rcGo('C3=4-1-1'); await settle(); await settle(); await settle();
  let ho = el('rc-out').innerHTML;
  check('scan the column → everything on record there with photo, pcs / box and system cases (the =10 part # twice: ×10 and ×25), all "not scanned yet"; the aisle shows its columns',
    (ho.match(/⬜ not scanned yet/g) || []).length === 5 && /88-8-1=10 <span[^>]*>· 10 pcs \/ box/.test(ho) && /88-8-1=10 <span[^>]*>· 25 pcs \/ box/.test(ho) && /Aisle C3=4: <b>0 of 2<\/b> done/.test(ho) && /📷 Scan a box on this column/.test(ho), ho.slice(0, 700));
  // Owner: "Audit — move the location to the bottom and minimize; click to open when we want to see".
  check('…the aisle\'s column list is at the bottom (after ✅ Done with this column), folded — tap to open', !/"\s+open[\s>]/.test((ho.match(/<details id="rc-aisle"[^>]*>/) || ['" open>'])[0]) && ho.indexOf('id="rc-aisle"') > ho.indexOf('Done with this column') && ho.indexOf('id="rc-aisle"') > ho.lastIndexOf('not scanned yet'), ho.slice(-600));
  // scan a box → cases → pieces (tap = saved)
  w.rcGo('88-8-1=10'); await settle(); await settle(); ho = el('rc-out').innerHTML;
  check('scan a box → 1️⃣ How many cases? (our buttons)', /1️⃣ How many cases\?/.test(ho) && /rcCases\('more'\)/.test(ho) && !/<input/.test(ho), null);
  w.rcCases(6); ho = el('rc-out').innerHTML;
  check('…then 2️⃣ Pieces per box: both sizes on record here first (✓ 10 pcs, ✓ 25 pcs), then common sizes + More…', /rcPcs\(10\)[^>]*>✓ 10 pcs/.test(ho) && /rcPcs\(25\)[^>]*>✓ 25 pcs/.test(ho) && /rcPcs\('more'\)/.test(ho), ho.slice(0, 400));
  w.rcPcs(10); await settle(); await settle();
  w.rcGo('88-8-1=10'); await settle(); await settle(); w.rcCases(3); w.rcPcs(25); await settle(); await settle();
  w.rcGo('88-8-1=10'); await settle(); await settle(); w.rcCases(9); w.rcPcs(10); await settle(); await settle();
  check('=10 ×10: 5 → 6 counted; =10 ×25: 3 confirmed; scanning ×10 again → "Already counted" (no double count)',
    /10:6×10 10:3×25/.test(rrows('C3=4-1-1')) && flashes.some(f => /Already counted here: 6 case\(s\) of 88-8-1=10 × 10 pcs/.test(f)), rrows('C3=4-1-1'));
  w.rcGo('88-8-1=2'); await settle(); await settle(); w.rcCases(6); w.rcPcs(2); await settle(); await settle();
  w.rcGo('88-8-1=20'); await settle(); await settle(); w.rcCases(2); w.rcPcs(20); await settle(); await settle();
  check('a box not on record at this column (88-8-1=2) → cases + pieces → saved as a new line (6 × 2 pcs)', /2:6×2/.test(rrows('C3=4-1-1')) && /➕ 88-8-1=2 · 2 pcs \/ box/.test(el('rc-out').innerHTML), rrows('C3=4-1-1'));
  w.rcGo('C3=4-1-2'); await settle();
  check('scanning the next column before this one is done → "Finish C3=4-1-1 first"', flashes.some(f => /Finish C3=4-1-1 first/.test(f)) && /📍 C3=4-1-1/.test(el('rc-out').innerHTML), null);
  w.rcCheck(); ho = el('rc-out').innerHTML;
  check('✅ Done → the ones not scanned (=5, =50) come up with ✓ Found / ✗ None found', /These were not scanned/.test(ho) && (ho.match(/rcFound\(\d+\)/g) || []).length === 2 && (ho.match(/rcNone\(\d+\)/g) || []).length === 2 && /88-8-1=5 /.test(ho) && /88-8-1=50 /.test(ho), ho.slice(0, 500));
  const iNone = ho.match(/<div[^>]*>88-8-1=5 [\s\S]*?rcNone\((\d+)\)/)[1], iFound = ho.match(/<div[^>]*>88-8-1=50 [\s\S]*?rcFound\((\d+)\)/)[1];
  w.rcNone(+iNone); await settle(); await settle();
  check('✗ None found → 0', /5:0×5/.test(rrows('C3=4-1-1')) || !/5:/.test(rrows('C3=4-1-1')), rrows('C3=4-1-1'));
  w.rcFound(+iFound); w.rcCases(1); w.rcPcs(40); await settle(); await settle(); await settle(); await settle();
  check('✓ Found with a different box size (system ×50, boxes are ×40) → the ×50 line → 0 and a new ×40 line (1 case)', !/50:[1-9][0-9.]*×50/.test(rrows('C3=4-1-1')) && /50:1×40/.test(rrows('C3=4-1-1')), rrows('C3=4-1-1'));
  const r1 = rpcs(), col = sq.prepare("SELECT location, by_user, items FROM recount_columns ORDER BY id DESC").get();
  ho = el('rc-out').innerHTML;
  check('the last one resolved → the column is done by itself (who / when kept), "✅ C3=4-1-1 done — scan the next column"', col && col.location === 'C3=4-1-1' && col.by_user === 'TS' && col.items === 7 && /✅ C3=4-1-1 done — scan the next column/.test(ho), col);
  check('numbers add up: 237 pcs + 10 (5→6 ×10) + 12 (new 6×2) − 20 (None found 4×5) − 50 (×50 → 0) + 40 (new 1×40) = 229 pcs', r0 === 237 && r1 === 229, { r0, r1 });
  const st = await get('/inventory/recount/status?aisle=C3=4');
  check('aisle C3=4: C3=4-1-1 done (who / when), C3=4-1-2 not yet; the next column can start now', st.ok && st.spots.length === 2 && st.spots.find(x => x.location === 'C3=4-1-1').done.by === 'TS' && !st.spots.find(x => x.location === 'C3=4-1-2').done && st.doneCount >= 1, st);
  w.rcGo('C3=4-1-2'); await settle(); await settle(); await settle();
  check('…scan the next column → it opens', /📍 C3=4-1-2/.test(el('rc-out').innerHTML) && /Aisle C3=4: <b>1 of 2<\/b> done/.test(el('rc-out').innerHTML), null);
  // Owner: "Audit: when there's no WiFi, save it on the phone and send it when WiFi is back — never lose what they counted, or inventory won't match".
  sq.prepare("INSERT INTO master_list (base_sku, name, part_num, location, cases, units_per_case) VALUES ('88-8-2','Tee','88-8-2=10','C3=4-2-1',4,10), ('88-8-2','Tee','88-8-2=20','C3=4-2-1',2,20)").run();
  const p2 = () => sq.prepare("SELECT SUM(cases * units_per_case) p FROM master_list WHERE part_num LIKE '88-8-2=%'").get().p;
  const q0 = p2(); // 4×10 + 2×20 = 80
  globalThis.confirm = () => true; w.rcStop(); delete globalThis.confirm; // ✕ Stop the open column C3=4-1-2 first (a new one can't start while one is open)
  w.rcGo('C3=4-2-1'); await settle(); await settle(); await settle(); await settle(); // opened with WiFi: the column + its boxes are kept on the phone
  wifi = false;
  w.rcGo('88-8-2=10'); await settle(); await settle(); w.rcCases(5); w.rcPcs(10); await settle();
  check('📶 no WiFi: a box still scans (from what this phone saw) and the count is saved on the phone — nothing on the shelf yet', outboxQ.length === 1 && outboxQ[0].log && outboxQ[0].body.cases === 1 && p2() === q0, outboxQ.map(x => x.body));
  // the phone reloads in the middle of the column (screen died, page refreshed…)
  ck = mk(true); w = globalThis.__ckWin; w.rcRestore(); await settle();
  let hr2 = el('rc-out').innerHTML;
  check('…the page reloads mid-column → it comes back to C3=4-2-1 with what was counted (✓ counted 5) — nothing lost', /📍 C3=4-2-1/.test(hr2) && /✓ counted 5 case\(s\)/.test(hr2) && flashes.some(f => /Back to C3=4-2-1/.test(f)), hr2.slice(0, 400));
  w.rcGo('88-8-2=10'); await settle(); await settle(); w.rcCases(9); w.rcPcs(10); await settle();
  check('…the same box scanned again after the reload → "Already counted" (never counted twice)', outboxQ.length === 1 && flashes.some(f => /Already counted here: 5 case\(s\) of 88-8-2=10/.test(f)), outboxQ.length);
  w.rcCheck(); hr2 = el('rc-out').innerHTML;
  const iN2 = hr2.match(/<div[^>]*>88-8-2=20 [\s\S]*?rcNone\((\d+)\)/)[1];
  w.rcNone(+iN2); await settle(); await settle(); await settle();
  const colQ = outboxQ.find(x => !x.log);
  check('…None found + the column done, still with no WiFi → both saved on the phone ("📶 sends when WiFi is back"), the screen says done', outboxQ.length === 3 && colQ && colQ.body.location === 'C3=4-2-1'
    && /✅ C3=4-2-1 done/.test(el('rc-out').innerHTML) && flashes.some(f => /📶 saved on the phone, it sends when WiFi is back/.test(f)) && p2() === q0, outboxQ.map(x => x.path || 'log'));
  const ridCol = colQ.body._requestId;
  globalThis.invObRead = () => outboxQ.filter(x => x.log).map(x => ({ state: 'waiting', body: x.body }));
  w.rcGo('C3=4-2-1'); await settle();
  check('…scanning C3=4-2-1 again while its counts still wait on the phone → refused (it would count them twice)', flashes.some(f => /C3=4-2-1 has 2 count\(s\) still waiting on this phone/.test(f)) && /✅ C3=4-2-1 done/.test(el('rc-out').innerHTML), flashes.slice(-2));
  delete globalThis.invObRead;
  wifi = true; await sendOutbox(); await settle();
  const cols = sq.prepare("SELECT COUNT(*) n FROM recount_columns WHERE location = 'C3=4-2-1'").get().n;
  const chk = await post('/inventory/outbox/check', { ids: [ridCol] });
  check('WiFi back → everything sends: shelf 4×10 → 5×10, 2×20 → 0; numbers add up 80 + 10 − 40 = 50 pcs; the column is done once (sent twice, saved once) and the outbox check says "saved"',
    q0 === 80 && p2() === 50 && cols === 1 && chk.results[ridCol] && chk.results[ridCol].state === 'saved', { q0, now: p2(), cols, chk: chk.results[ridCol] });
  const { readFileSync: rfs2 } = await import('node:fs');
  check('✕ next to the recount scan box: empties it, keeps the phone keyboard hidden, closes the box being counted', /onclick="rcClear\(\)"/.test(rfs2(fileURLToPath(new URL('../inventory.html', import.meta.url)), 'utf8'))
    && /window\.rcClear = function\(\) \{[\s\S]*?x\.setAttribute\('inputmode', 'none'\);[\s\S]*?if \(RC\.cur\) \{ RC\.cur = null; rcRender\(\); \}/.test(ckSrc), null);
  const pkt3 = (await (await call('/auth/login', { method: 'POST', body: '{"username":"picker","password":"password1"}' })).json()).token;
  const nrW = await call('/inventory/recount/new-round', { method: 'POST', headers: { 'X-Cred-Token': pkt3, 'Content-Type': 'application/json' }, body: '{}' });
  const nrM = await post('/inventory/recount/new-round', {}), st2 = await get('/inventory/recount/status?aisle=C3=4');
  check('only a manager can start a new recount; after it every column shows "not done" again', nrW.status === 403 && nrM.ok && st2.spots.every(x => !x.done), { w: nrW.status, nrM });
  const { readFileSync: rfs } = await import('node:fs');
  const ihA = rfs(fileURLToPath(new URL('../inventory.html', import.meta.url)), 'utf8');
  check('Audit tab: the recount card first; the old part # / location audit tools kept, folded under "🔧 Other audit tools"',
    /id="rc-card"[\s\S]*?<details id="inv-audit-old"[\s\S]*?id="inv-audit-search-card"[\s\S]*?id="inv-audit-loc-list"><\/div>\s*<\/div>\s*<\/details>/.test(ihA) && /id="rc-inp" type="text" inputmode="none"/.test(ihA), null);
  const sp = await post('/inventory/check-spots', { pairs: [{ part: '77-7-1=10', location: 'c2=1-1-1' }] });
  check('who put it there (read-only route): last Stock In at the spot', sp.ok && sp.spots['77-7-1=10|C2=1-1-1'] && sp.spots['77-7-1=10|C2=1-1-1'].put.by && sp.spots['77-7-1=10|C2=1-1-1'].last.length === 3, sp);
  const sp2 = await post('/inventory/check-spots', { pairs: [{ part: '77-7-1=10', location: 'C2=1-1-2' }] });
  check('…and the last ✏️ pieces-per-case change at the spot (who / when / old → new)', sp2.spots['77-7-1=10|C2=1-1-2'] && sp2.spots['77-7-1=10|C2=1-1-2'].pack && sp2.spots['77-7-1=10|C2=1-1-2'].pack.to === 12 && sp2.spots['77-7-1=10|C2=1-1-2'].pack.by === 'TS', sp2);
  delete globalThis.__ckWin; Object.keys(globalThis).filter(k => /^ck[A-Z]/.test(k)).forEach(k => delete globalThis[k]);
}

// Owner: "Stock In / Found on Shelf: Location → 'spot where you put it'; QTY Case = our own 1–9 + More…; QTY per Case = the
// recommended size, then the box sizes we use a lot, then More… (type it on our own pad) — no phone keyboard".
console.log('\nStock In / Found on Shelf: our own buttons for QTY Case / QTY per Case (no phone keyboard)');
{
  const { readFileSync } = await import('node:fs');
  const ih = readFileSync(fileURLToPath(new URL('../inventory.html', import.meta.url)), 'utf8');
  check('labels + no phone keyboard: "Spot where you put it", part # and spot are scan boxes (⌨ to type), QTY fields are hidden (filled by our buttons)',
    /<label>Spot where you put it<\/label>/.test(ih) && /id="inv-qa-shelf" type="text" inputmode="none" placeholder="📷 Scan the spot where you are putting it"/.test(ih)
      && /id="inv-qa-partnum" type="text" inputmode="none"/.test(ih) && /<input id="inv-qa-cases" type="hidden" value=""><input id="inv-qa-upc" type="hidden" value="">/.test(ih)
      && !/id="inv-qa-cases" type="number"/.test(ih) && !/id="inv-qa-upc" type="number"/.test(ih), null);
  check('saving is unchanged: Submit still reads QTY Case / QTY per Case from the same fields',
    /var cases    = parseFloat\(g\("inv-qa-cases"\) && g\("inv-qa-cases"\)\.value\);/.test(ih) && /var upc      = \(g\("inv-qa-upc"\) && g\("inv-qa-upc"\)\.value\) \? parseFloat\(g\("inv-qa-upc"\)\.value\) : 0;/.test(ih) && /isNew: true, isPlaceholder: false, unitsPerCase: upc \|\| 0/.test(ih), null);
  const src = (ih.match(/  var invQaRec = 0;[\s\S]*?\n  window\.invQaUpc = function\(n\) \{[\s\S]*?\n  \};/) || [''])[0];
  const els = {}, el = id => els[id] || (els[id] = { value: '', innerHTML: '', textContent: '' }), pads = [];
  const qaFlash = [];
  const api = new Function('window', 'g', 'CK', 'xfrN', 'xfrKeypad', 'invFlash', src + '\nreturn { setRec: v => { invQaRec = v; }, render: invQaPadsRender };')(
    globalThis, el, { sizes: [1, 2, 5, 10, 20, 25, 50, 100, 200] }, v => Math.round((parseFloat(v) || 0) * 100) / 100, (t, v, cb) => pads.push({ t, cb }), m => qaFlash.push(m));
  api.setRec(25); api.render();
  const up0 = el('inv-qa-upc-pad').innerHTML, cp0 = el('inv-qa-cases-pad').innerHTML;
  check('QTY Case: 1–9 + More…; QTY per Case: this item\'s size first (✓ 25 pcs — this item), then the common sizes (not 25 again) + More…',
    (cp0.match(/onclick="invQaCases\(\d\)"/g) || []).length === 9 && /invQaCases\('more'\)/.test(cp0) && /✓ 25 pcs — this item/.test(up0)
      && (up0.match(/onclick="invQaUpc\(25\)"/g) || []).length === 1 && /invQaUpc\(200\)/.test(up0) && /invQaUpc\('more'\)/.test(up0), { up0 });
  globalThis.invQaCases(3); globalThis.invQaUpc(25);
  check('tap 3 cases + "✓ 25 this item" → the fields hold 3 and 25 (shows "= 25 pcs · 75 pcs in all")', el('inv-qa-cases').value === 3 && el('inv-qa-upc').value === 25 && /75 pcs in all/.test(el('inv-qa-upc-show').textContent), { c: el('inv-qa-cases').value, u: el('inv-qa-upc').value });
  globalThis.invQaUpc('more'); pads[pads.length - 1].cb(36); globalThis.invQaCases('more'); pads[pads.length - 1].cb(12);
  check('More… opens our number pad (36 pcs / 12 cases typed there)', pads.length === 2 && el('inv-qa-upc').value === 36 && el('inv-qa-cases').value === 12 && /36 pcs \(More…\)/.test(el('inv-qa-upc-pad').innerHTML), null);
  // Owner: "when we select the pieces (last step) it saves by itself" — only when the part #, the spot and the cases are in.
  let submits = 0; globalThis.invQuickAddSubmit = () => { submits++; };
  el('inv-qa-partnum').value = ''; el('inv-qa-shelf').value = ''; globalThis.invQaUpc(10);
  check('tap the pieces with no box scanned yet → not saved, says what is missing', submits === 0 && /Scan the box first/.test(qaFlash[qaFlash.length - 1] || ''), qaFlash);
  el('inv-qa-partnum').value = '23-2-3=2'; el('inv-qa-shelf').value = 'A1=1-1-1'; globalThis.invQaCases(3); globalThis.invQaUpc(10);
  check('box + spot + cases in → tapping the pieces saves (Submit runs by itself)', submits === 1 && el('inv-qa-upc').value === 10, submits);
  ['invQaCases', 'invQaUpc', 'invQaPadsRender', 'invQuickAddSubmit'].forEach(k => delete globalThis[k]);
  // Owner: "Stock In must scan in with the UPC code (got '… is a UPC barcode, not part #') — do both, always save it as the part #".
  check('Stock In: a scanned box UPC is turned into its part # (in the box, and again on Submit) — never saved as a UPC',
    /if \(d && d\.partNum && String\(d\.partNum\)\.toUpperCase\(\) !== partNum\) \{ partNum = String\(d\.partNum\)\.toUpperCase\(\);/.test(ih)
      && /A box UPC was scanned → put its part # in the box/.test(ih) && /invAskUpcPart\(partNum, function\(part\) \{ var pi = g\("inv-qa-partnum"\); if \(pi\) pi\.value = part;/.test(ih) && /Barcode ' \+ partNum \+ ' is not linked to a part # yet/.test(ih), null);
  const lkUpc = await get('/inventory/lookup?code=012345678905');
  check('…the lookup Stock In uses gives the part # for a UPC (or says it is not linked)', lkUpc && (lkUpc.partNum || lkUpc.upcNotLinked), lkUpc);
}

// Owner: "Stock In: tap the pieces = saved; a history under it so a mistake can be cancelled".
console.log('\nStock In: My Stock In today → ✕ Cancel my own mistake');
{
  await post('/inventory/review-mode', { mode: 'manual' });
  sq.prepare("INSERT INTO master_list (base_sku, name, part_num, location, cases, units_per_case) VALUES ('66-1-1','Bushing','66-1-1=10','C4=2-2-2',4,10)").run();
  const upcL = await post('/inventory/upc-link', { upc: '076543210987', part: '66-1-1=10' });
  const lk = await get('/inventory/lookup?code=076543210987');
  check('a box UPC linked to its part # → the lookup gives the part # (Stock In saves 66-1-1=10, not the UPC)', lk.partNum && String(lk.partNum).toUpperCase() === '66-1-1=10', { upcL, lk: lk.partNum });
  const bad = await call('/inventory/log', { method: 'POST', headers: H, body: JSON.stringify({ type: 'IN', partNum: '076543210987', location: 'C4=2-2-2', cases: 1, initials: 'TS' }) });
  check('…a UPC is never saved as a part # (the Worker still refuses it)', bad.status === 400, bad.status);
  const shelf = () => sq.prepare("SELECT SUM(cases) c FROM master_list WHERE part_num = '66-1-1=10'").get().c;
  const s0 = shelf();
  const a = await post('/inventory/log', { type: 'IN', partNum: '66-1-1=10', sku: '66-1-1', location: 'C4=2-2-2', cases: 2, initials: 'TS', isNew: true, unitsPerCase: 10 });
  const ca = await post('/inventory/cancel-own', { id: a.d1Id });
  const ra = sq.prepare('SELECT status, cancelled_by FROM inventory_log WHERE id = ?').get(a.d1Id);
  check('✕ Cancel before approval → the entry is cancelled (Rejected, who kept), the shelf never changed', ca.ok && ca.cancelled === 'pending' && ra.status === 'Rejected' && /own mistake/.test(ra.cancelled_by) && shelf() === s0, { ca, ra });
  const b = await post('/inventory/log', { type: 'IN', partNum: '66-1-1=10', sku: '66-1-1', location: 'C4=2-2-2', cases: 3, initials: 'TS', isNew: true, unitsPerCase: 10 });
  const pendB = (await get('/inventory/pending')).items.find(x => x.d1Id === b.d1Id);
  await post('/inventory/verify', { rowIndex: pendB.rowIndex, action: 'Approved', item: pendB });
  const s1 = shelf();
  const cb = await post('/inventory/cancel-own', { id: b.d1Id });
  const rc = sq.prepare("SELECT type, cases, total_before tb, total_after ta FROM inventory_log WHERE notes LIKE '%' || ? || '%' ORDER BY id DESC").get('#' + b.d1Id);
  check('✕ Cancel after approval (within 30 min) → reversed by the same Cancel managers use: shelf 4 → 7 → 4, History keeps Before → After',
    s0 === 4 && s1 === 7 && cb.ok && shelf() === 4 && (!rc || (rc.type === 'OUT' && rc.cases === 3)), { s0, s1, cb, now: shelf(), rc });
  const c2 = await post('/inventory/log', { type: 'IN', partNum: '66-1-1=10', location: 'C4=2-2-2', cases: 1, initials: 'SOMEONE' });
  const cx = await post('/inventory/cancel-own', { id: c2.d1Id });
  check('someone else\'s Stock In can\'t be cancelled here (ask a manager)', cx.ok === false && /Only the person who saved it/.test(cx.error), cx);
  const again = await post('/inventory/cancel-own', { id: a.d1Id });
  check('…and one already cancelled can\'t be cancelled twice', again.ok === false, again);
  const { readFileSync } = await import('node:fs');
  const ih = readFileSync(fileURLToPath(new URL('../inventory.html', import.meta.url)), 'utf8');
  check('screen: "My Stock In today" under Stock In with ✕ Cancel (saved on this phone, today, New York time)',
    /<div id="inv-qa-mine"/.test(ih) && /My Stock In today — made a mistake\? tap ✕ Cancel/.test(ih) && /wFetch\(W \+ '\/inventory\/cancel-own'/.test(ih) && /invQaMineAdd\(\{ id: d\.d1Id \|\| null, part: partNum/.test(ih), null);
}

// Owner: "Audit tab: take off Approval Mode, Other audit tools, Location Prefixes, Product Photos, Export Location List, Rename Locations".
console.log('\nAudit tab: only the 📋 Full recount on screen');
{
  const { readFileSync } = await import('node:fs');
  const ih = readFileSync(fileURLToPath(new URL('../inventory.html', import.meta.url)), 'utf8');
  const panel = (ih.match(/<div class="ipanel" id="inv-panel-audit">[\s\S]*?\n<\/div>\n/) || [''])[0];
  const hidden = (panel.match(/<div id="inv-audit-hidden" style="display:none">[\s\S]*?<\/div><!-- \/inv-audit-hidden -->/) || [''])[0];
  check('Approval Mode, Other audit tools, Location Prefixes, Product Photos, Export Location List, Rename Locations are off the screen; the 📋 Full recount card shows',
    /<div class="icard" id="inv-audit-mode-card" style="display:none">\s*<div class="icard-label">Approval Mode/.test(panel) && /<details id="inv-audit-old" style="display:none;/.test(panel)
      && /id="inv-prefix-card"/.test(hidden) && /Product Photos/.test(hidden) && /Export Location List/.test(hidden) && /Rename Locations/.test(hidden)
      && /<div class="icard" id="rc-card" style="border:2px solid var\(--accent\)">/.test(panel), null);
}

// Owner: "Stock In: put an ✕ on each scan bar so we can delete it and start again (no phone keyboard)".
console.log('\nStock In: ✕ on each scan box');
{
  const { readFileSync } = await import('node:fs');
  const ih = readFileSync(fileURLToPath(new URL('../inventory.html', import.meta.url)), 'utf8');
  check('✕ next to Part # / Barcode and next to the spot; it empties the box, keeps the phone keyboard hidden (inputmode none) and is ready to scan again',
    /onclick="invQaClear\('part'\)"/.test(ih) && /onclick="invQaClear\('spot'\)"/.test(ih)
      && /window\.invQaClear = function\(which\) \{[\s\S]*?x\.value = ''; x\.removeAttribute\('data-kb-typing'\); x\.setAttribute\('inputmode', 'none'\);[\s\S]*?x\.focus\(\);/.test(ih), null);
}

// Owner: "1) test mode bar all the way at the bottom, not blocking anything; 2) Audit: 🏷 Barcode designer — type a part # (8-8-8=8) → 1 × 2 thermal label".
console.log('\nTest mode bar at the bottom · 🏷 Barcode designer');
{
  const { readFileSync } = await import('node:fs');
  const xa = readFileSync(fileURLToPath(new URL('../xf-access.js', import.meta.url)), 'utf8');
  check('test mode: a thin bar at the very bottom (full width), the page gets room for it, no orange frame over the screen, clicks go through',
    /el\.style\.cssText = 'position:fixed;left:0;right:0;bottom:0;height:22px;[^']*pointer-events:none'/.test(xa) && /document\.body\.style\.paddingBottom = '26px'/.test(xa)
      && !/border:5px solid #f59e0b/.test(xa) && /fr0\.remove\(\)/.test(xa), null);
  const ih = readFileSync(fileURLToPath(new URL('../inventory.html', import.meta.url)), 'utf8');
  const src = (ih.match(/  function bdLabelHtml\(sku, copies\) \{[\s\S]*?\n  \}/) || [''])[0];
  const lab = new Function('xfrEsc', src + '; return bdLabelHtml;')(v => String(v).replace(/</g, '&lt;'))('8-8-8=8', 3);
  check('🏷 Barcode designer at the bottom of the Audit tab; the label is 2" × 1" (one per page, no margins), Code 128, part # printed under the bars; 3 copies → 3 labels',
    /id="rc-out"><\/div>\s*<!-- 🏷 Barcode designer[\s\S]*?onclick="bdOpen\(\)"[^>]*>🏷 Barcode designer<\/button>/.test(ih) && /@page\{size:2in 1in;margin:0\}/.test(lab)
      && (lab.match(/<div class="l"><svg class="b"><\/svg><div class="t">8-8-8=8<\/div><\/div>/g) || []).length === 3 && /format: 'CODE128'/.test(ih), lab.slice(0, 200));
  // Owner: "barcode designer: our own keypad with the numbers, '-', '=', 'X', '=OLD', 1 to 9 and more (no phone keyboard)".
  const padSrc = (ih.match(/  function bdPad\(\) \{[\s\S]*?\n  \}/) || [''])[0], keySrc = (ih.match(/  window\.bdKey = function\(k\) \{[\s\S]*?\n  \};/) || [''])[0];
  const pad = new Function(padSrc + '; return bdPad();')();
  const bx = { value: '' }, bwin = {}; new Function('window', 'g', 'bdPreview', keySrc)(bwin, () => bx, () => {});
  ['8', '-', '8', '-', '8', '=', '8', 'X', 'X'].forEach(k => bwin.bdKey(k)); const typed1 = bx.value;
  bwin.bdKey('⌫'); bwin.bdKey('⌫'); bwin.bdKey('⌫'); bwin.bdKey('=OLD'); const typed2 = bx.value;
  check('Barcode designer: our own keypad (1–9, 0, -, =, X, =OLD, ⌫, C) + ⌨ More; the box keeps the phone keyboard hidden; taps type 8-8-8=8XX, ⌫ ⌫ ⌫ + =OLD → 8-8-8=OLD',
    ['1','2','3','4','5','6','7','8','9','0','-','=','X','=OLD','⌫','CLR'].every(k => pad.includes(`onclick="bdKey('${k}')"`)) && /⌨ More/.test(pad)
      && /id="bd-sku" type="text" inputmode="none"/.test(ih) && typed1 === '8-8-8=8XX' && typed2 === '8-8-8=OLD', { typed1, typed2 });
  // Owner: "add all that to our keypad" — the other characters our part #s use (vendor list): & C K W W.1C W.2C J N; Clear is its own key (C is a letter now).
  bwin.bdKey('CLR'); ['2','8','-','2','-','1','&','2','=','1','0','W.1C'].forEach(k => bwin.bdKey(k)); const t3 = bx.value;
  bwin.bdKey('CLR'); ['6','1','8','5','3','-','K','=','5','X'].forEach(k => bwin.bdKey(k)); const t4 = bx.value;
  bwin.bdKey('CLR'); ['2','8','-','4','-','1','C','=','2','W.2C'].forEach(k => bwin.bdKey(k)); const t5 = bx.value;
  check('keypad also has & C K W W.1C W.2C J N (+ Clear): taps type 28-2-1&2=10W.1C, 61853-K=5X, 28-4-1C=2W.2C',
    ['&','C','K','W','W.1C','W.2C','J','N'].every(k => pad.includes(`onclick="bdKey('${k}')"`)) && />Clear<\/button>/.test(pad)
      && t3 === '28-2-1&2=10W.1C' && t4 === '61853-K=5X' && t5 === '28-4-1C=2W.2C', { t3, t4, t5 });
  // Owner: "also including info of who and when print the label".
  const labF = new Function('xfrEsc', src + '; return bdLabelHtml;')(v => String(v))('8-8-8=8', 1, 'Plug', 'Printed by Ana · Oct 4, 2026');
  const bl = await post('/inventory/barcode-label', { sku: '8-8-8=8', name: 'Plug', copies: 3 });
  const blRow = sq.prepare('SELECT sku, copies, by_user, ts FROM barcode_label_log ORDER BY id DESC').get();
  check('who / when on the label ("Printed by Ana · Oct 4, 2026", tiny at the bottom) and every print kept on record (who / when / part # / how many)',
    /<div class="n">Plug<\/div><div class="f">Printed by Ana · Oct 4, 2026<\/div>/.test(labF) && bl.ok && blRow.sku === '8-8-8=8' && blRow.copies === 3 && blRow.by_user === 'TS' && !!blRow.ts
      && /wFetch\(W \+ '\/inventory\/barcode-label'/.test(ih) && /var foot = 'Printed' \+ \(who \? ' by ' \+ who : ''\)/.test(ih), { blRow });
  // Owner: "can it also match up the product name too?"
  const labN = new Function('xfrEsc', src + '; return bdLabelHtml;')(v => String(v).replace(/</g, '&lt;'))('30-3-4=10X', 1, 'Tee 3/4" (10 pcs)');
  check('…the part # is matched to its product name (SKU Mgr) as you type ("⚠ not in SKU Mgr" if not), and the name prints small under the part #',
    /<div class="t">30-3-4=10X<\/div><div class="n">Tee 3\/4(?:"|&quot;) \(10 pcs\)<\/div>/.test(labN) && /wFetch\(W \+ '\/inventory\/lookup\?code=' \+ encodeURIComponent\(sku\)\)/.test(ih)
      && /is not in SKU Mgr — check the part #/.test(ih) && /var nm = BD\.nameFor === sku \? BD\.name : '';/.test(ih) && /bdLabelHtml\(sku, BD\.copies, nm, foot, bdPicFor\(sku\)\)/.test(ih), labN.slice(-200));
}

// Owner: "Warehouse Lookup → Item Locator / Item Search: searching a part # shows the exact match first, then the rest;
// each item with its product photo (the same photo as Inventory — change it in Location Plan and it changes here too)".
console.log('\nWarehouse Lookup: exact part # first · product photos');
{
  const { readFileSync } = await import('node:fs');
  const wh = readFileSync(fileURLToPath(new URL('../warehouse.html', import.meta.url)), 'utf8');
  const src = ['whParent', 'whRank', 'whPackKey', 'whCompare'].map(n => (wh.match(new RegExp('function ' + n + '\\([^)]*\\) \\{[\\s\\S]*?\\n\\}')) || [''])[0]).join('\n');
  const cmp = new Function(src + '; return whCompare;')();
  const rows = ['30-3-4=2', '30-3-4=10XX', '30-3-4=10X', '30-3-45=10X', '130-3-4=10X', 'TEE 30-3-4', '30-3-4=1', '30-3-4=10', '30-3-4=OLD'].map(p => ({ p }));
  const o1 = rows.slice().sort(cmp('30-3-4=10X', r => r.p, () => '')).map(r => r.p);
  const o2 = rows.slice().sort(cmp('30-3-4', r => r.p, () => '')).map(r => r.p);
  check('search 30-3-4=10X → 30-3-4=10X first, then its family in pack order (=OLD, =1, =2, =10, =10XX), then the rest',
    o1[0] === '30-3-4=10X' && o1.slice(1, 6).join() === '30-3-4=OLD,30-3-4=1,30-3-4=2,30-3-4=10,30-3-4=10XX' && o1.indexOf('30-3-45=10X') > 5, o1);
  check('search 30-3-4 → the 30-3-4 family first, in pack order (=OLD, =1, =2, =10, =10X, =10XX), not 30-3-45 / 130-3-4',
    o2.slice(0, 6).join() === '30-3-4=OLD,30-3-4=1,30-3-4=2,30-3-4=10,30-3-4=10X,30-3-4=10XX' && o2.indexOf('30-3-45=10X') > 5 && o2.indexOf('130-3-4=10X') > 5, o2);
  check('Item Locator and Item Search are sorted that way, and every card has the product photo (same /inventory/photos as Inventory; tap = big)',
    /results\.sort\(whCompare\(raw, r => r\.partNum, r => r\.location\)\)/.test(wh) && /results\.sort\(whCompare\(raw, r => r\.sku, \(\) => ''\)\)/.test(wh)
      && /\$\{whPhotoHtml\(r\.partNum\)\}/.test(wh) && /\$\{whPhotoHtml\(r\.sku\)\}/.test(wh) && /wFetch\(W \+ '\/inventory\/photos\?bases='/.test(wh), null);
}

// Owner: "SKU Mgr has a lot of weird part #s (like EFFMM-04-LF, 2490) — I'll clean them up when I have time".
console.log('\nSKU Mgr: 🧹 Check part #s (read-only)');
{
  sq.prepare(`INSERT INTO master_list (base_sku, name, part_num, location, cases, units_per_case) VALUES
    ('EFFMM','x','EFFMM-04-LF','C5=1-1-1',2,1), ('2490','x','2490','C5=1-1-2',1,1), ('x','x','012345678905','C5=1-1-3',1,1), ('30-9-9','x','30-9-9 =10x','C5=1-1-4',1,10),
    ('30-9-9','x','30-9-9=10X','C5=1-1-5',3,10), ('30-9-8','x','30-9-8','C5=1-1-6',1,1), ('30-9-7','x','30-9-7==10','C5=1-1-7',1,1), ('30-9-6','x','30-9-6=10Q','C5=1-1-8',1,1),
    ('27-3-1','x','27-3-1=10W.1C','C5=1-1-9',1,10), ('28-2-1&2C','x','28-2-1&2C=10','C5=1-2-1',1,10), ('61853-K','x','61853-K=5X','C5=1-2-2',1,5), ('8-8-8','x','8-8-8=OLD','C5=1-2-3',1,1),
    ('30-4','x','30-4=10','C5=1-2-4',1,10), ('30-3-4-2','x','30-3-4-2=10','C5=1-2-5',1,10)`).run();
  const before = sq.prepare('SELECT COUNT(*) n, SUM(cases) c FROM master_list').get();
  const pc = await get('/inventory/partnum-check');
  const has = (c, p) => pc.cats[c].rows.some(r => r.partNum === p);
  const normal = ['30-9-9=10X', '27-3-1=10W.1C', '28-2-1&2C=10', '8-8-8=OLD'].filter(p => Object.keys(pc.cats).some(c => c !== 'dupes' && has(c, p)));
  check('flags odd part #s by why: EFFMM-04-LF (vendor code), 2490 (just a number), a UPC, "30-9-9 =10x" (spaces / lowercase) + same part # written two ways, no "=", "==", odd ending',
    pc.ok && has('letters', 'EFFMM-04-LF') && has('numonly', '2490') && has('upc', '012345678905') && has('chars', '30-9-9 =10x') && has('dupes', '30-9-9 =10x') && has('dupes', '30-9-9=10X')
      && has('noeq', '30-9-8') && has('twoeq', '30-9-7==10') && has('suffix', '30-9-6=10Q') && normal.length === 0
      && has('base', '30-4=10') && has('base', '30-3-4-2=10') && has('base', '61853-K=5X'), { normal, cats: Object.fromEntries(Object.entries(pc.cats).map(([k, v]) => [k, v.rows.map(r => r.partNum)])) });
  // Owner: "I want columns so I can see all the weird part #s and go there to check".
  const L = pc.list || [], li = p => L.find(r => r.partNum === p);
  const { readFileSync: rfs3 } = await import('node:fs');
  const ih3 = rfs3(fileURLToPath(new URL('../inventory.html', import.meta.url)), 'utf8');
  check('table view: every odd row once, with all its reasons (spaces + written two ways), spot, cases, pcs/case; columns Spot · Part # · Name · Cases · Pcs/case · What looks wrong; walking order; filter, 🖨 print, ⬇ Excel',
    li('EFFMM-04-LF') && li('EFFMM-04-LF').location === 'C5=1-1-1' && li('EFFMM-04-LF').cases === 2 && li('30-9-9 =10x') && li('30-9-9 =10x').why.join() === 'chars,dupes' && li('30-9-9 =10x').each === 10
      && L.filter(r => r.partNum === '30-9-9 =10x').length === 1 && !li('8-8-8=OLD')
      && />Spot<\/th><th[^>]*>Part #<\/th><th[^>]*>Name<\/th><th[^>]*;text-align:right">Cases<\/th><th[^>]*;text-align:right">Pcs\/case<\/th><th[^>]*>What looks wrong<\/th>/.test(ih3)
      && /invPullWalkCompare\(wk\(a\.location\), wk\(b\.location\)\)/.test(ih3) && /l === 'GARAGE' \? 'GARAGE=' : l/.test(ih3) && /onclick="skumgrPnPrint\(\)"/.test(ih3) && /onclick="skumgrPnCsv\(\)"/.test(ih3) && /skumgrPnFilter\(/.test(ih3), L.slice(0, 4));
  const after = sq.prepare('SELECT COUNT(*) n, SUM(cases) c FROM master_list').get();
  const pkt5 = (await (await call('/auth/login', { method: 'POST', body: '{"username":"picker","password":"password1"}' })).json()).token;
  const pw = await call('/inventory/partnum-check', { headers: { 'X-Cred-Token': pkt5 } });
  check('…our part #s are #-#-#=#: 30-4=10, 30-3-4-2=10, 61853-K=5X → "not #-#-# before ="; normal ones (W.1C, &2C, =OLD) are not flagged; it changes nothing (same rows, same cases); managers only', before.n === after.n && before.c === after.c && pw.status === 403, { before, after, w: pw.status });
}

console.log('\n🌐 English / Español switch (xf-lang.js + xf-lang-es.js)');
{
  const { readFileSync, readdirSync } = await import('node:fs');
  const vm = await import('node:vm');
  const rf = f => readFileSync(fileURLToPath(new URL('../' + f, import.meta.url)), 'utf8');
  const engine = rf('xf-lang.js'), dict = rf('xf-lang-es.js');
  // A tiny fake browser: records whatever the engine does to the page.
  const boot = (store, path = '/xf-tools-3829/inventory.html') => {
    const did = { write: [], observers: 0, alert: null };
    const alert0 = function () {};
    const ctx = { localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
      location: { pathname: path, reload() { did.reload = true; } },
      document: { readyState: 'loading', write: h => did.write.push(h), addEventListener() {}, querySelectorAll: () => [],
        createElement: () => ({}), head: { appendChild() {} }, documentElement: { lang: 'en' }, createTreeWalker: () => ({ nextNode: () => null }) },
      MutationObserver: function () { did.observers++; this.observe = () => {}; }, alert: alert0, confirm: alert0, prompt: alert0, Map, WeakMap };
    ctx.window = ctx; vm.createContext(ctx); vm.runInContext(engine, ctx);
    did.alertWrapped = ctx.alert !== alert0;
    return { ctx, did };
  };
  const pages = readdirSync(fileURLToPath(new URL('../', import.meta.url))).filter(f => f.endsWith('.html'));
  const v = (rf('index.html').match(/xf-lang\.js\?v=(\w+)/) || [])[1];
  check('every page loads xf-lang.js (same version) in <head>, before the page draws', !!v && pages.length >= 15 && pages.every(f => { const h = rf(f); const i = h.indexOf('xf-lang.js?v=' + v); return i > 0 && i < h.indexOf('</head>'); }), pages.filter(f => !rf(f).includes('xf-lang.js?v=' + v)));
  const ix = rf('index.html');
  const pin = ix.slice(ix.indexOf('id="pin-screen"'), ix.indexOf('<!-- ═══ LAUNCHER'));
  const lau = ix.slice(ix.indexOf('<div id="launcher"'), ix.indexOf('launcher-section-label', ix.indexOf('<div id="launcher"')));
  const sw = h => /data-xf-lang="en"[^>]*onclick="XFLang\.set\('en'\)"[^>]*>English</.test(h) && /data-xf-lang="es"[^>]*onclick="XFLang\.set\('es'\)"[^>]*>Español</.test(h);
  check('front page: English / Español switch on the Sign In card AND on the launcher (switch before signing in)', sw(pin) && sw(lau), null);
  // English = the page exactly as before: nothing loaded, watched or wrapped.
  for (const store of [{}, { xf_lang: 'en' }]) {
    const { ctx, did } = boot(store);
    check('English (' + (store.xf_lang ? 'chosen' : 'default') + '): no dictionary loaded, page not watched, pop-ups untouched, text unchanged',
      ctx.XFLang.lang === 'en' && did.write.length === 0 && did.observers === 0 && !did.alertWrapped && ctx.XFLang.t('Sign In') === 'Sign In', { did, lang: ctx.XFLang.lang });
  }
  // Spanish: the dictionary is loaded on every page that has xf-lang.js.
  const es = boot({ xf_lang: 'es' });
  check('Español: the dictionary (xf-lang-es.js) loads', es.did.write.length === 1 && /src="xf-lang-es\.js\?v=\w+"/.test(es.did.write[0]), es.did.write);
  vm.runInContext(dict, es.ctx);
  const t = es.ctx.XFLang.t;
  check('Español: words are swapped (Sign In → Entrar) and the page is watched for new text', t('Sign In') === 'Entrar' && es.did.observers === 1 && t('📤 Stock Out') !== '📤 Stock Out', [t('Sign In'), t('📤 Stock Out')]);
  // Data must never be translated — part #s, UPCs, locations, names, numbers.
  const data = ['30-3-4=10X', '30-3-4', '27-3-4C=2X', '30-3-4=5XX', '23-2-3=2', 'C1=11-2-10', 'BARN=1-1-2-1', 'GARAGE=2-1-1', 'BSMT=1-1-1', '2FL=3-2-1', 'FRONT', 'BO', '2FL', 'MIDDLE', 'BSMT', 'PR', 'GARAGE', 'BACK', 'C1', 'C2', 'BARN', 'C3', 'C4', 'C5',
    'Front', 'Middle', 'Back', 'Barn', 'Garage', '012345678905', '0012345678905', 'X001ABC123', 'B0C1234567', 'MR', 'TS', 'Maria', 'Jose', '100', '3.5', '12/25'];
  const changed = data.filter(s => t(s) !== s);
  check('Español: part #s, UPCs, location codes, names and numbers are never translated', changed.length === 0, changed);
  const keys = []; vm.runInContext('XFLang.add = (function (add) { return function (d) { __keys.push.apply(__keys, Object.keys(d)); return add(d); }; })(XFLang.add);', Object.assign(es.ctx, { __keys: keys })); vm.runInContext(dict, es.ctx);
  const bad = keys.filter(k => /^(front|middle|back|barn|garage|basement|bsmt|bo|2fl|pr|c[1-5])$/i.test(k.trim()) || /\d+-\d+(-\d+)?(=|$)|[A-Z0-9]+=\d|\b\d{8,14}\b/.test(k));
  check('the dictionary has no part #, UPC or location as a word to translate', keys.length > 500 && bad.length === 0, { n: keys.length, bad });
  check('Español: mixed text keeps the data (only the words change)', /30-3-4=10X/.test(t('Stock Out 30-3-4=10X')) && /C1=11-2-10/.test(t('Location: C1=11-2-10')), [t('Stock Out 30-3-4=10X'), t('Location: C1=11-2-10')]);
  check('people\'s own words (chat messages, customer drafts) are marked never-translate', (ix.match(/data-no-xl/g) || []).length >= 7 && /cs-draft-box/.test(engine) && /em-thread-bubble/.test(engine), null);
  // Training keeps its own English/Spanish and follows the switch both ways.
  const tr0 = { xf_lang: 'es', 'picker-lang': 'en' }; boot(tr0, '/xf-tools-3829/training.html');
  const tr1 = boot({ xf_lang: 'es' }, '/xf-tools-3829/training.html');
  check('Training follows the switch (picker-lang kept in sync) and translates itself (no dictionary load there)', tr0['picker-lang'] === 'es' && tr1.did.write.length === 0 && tr1.did.observers === 0 && /window\.setLang = function \(l\) \{ orig\(l\); put\(KEY/.test(engine), tr0);
  const sw1 = { xf_lang: 'en' }; const b = boot(sw1); b.ctx.XFLang.set('es');
  check('switching sets both xf_lang and picker-lang; back to English reloads the page (exact original English)', sw1.xf_lang === 'es' && sw1['picker-lang'] === 'es' && (() => { const st = { xf_lang: 'es' }; const x = boot(st); x.ctx.XFLang.set('en'); return st.xf_lang === 'en' && x.did.reload; })(), sw1);
  check('on-screen keyboard Enter still finds the Sign In / Confirm button in Spanish', /entrar\|iniciar\|confirmar/.test(rf('xf-access.js')), null);
  check('an <option> with no value keeps its English value when its text is translated', /nodeName === 'OPTION' && !el\.hasAttribute\('value'\)/.test(engine), null);
}

// Owner: "move Label Check right next to Packing; add a button for the picker to grab, like Picking → No Inventory".
console.log('\nPack & Ship → 🏷️ Label Check next to 📦 Packing, with "⚠ Shelf empty — need to grab"');
{
  const { readFileSync } = await import('node:fs');
  const ph = readFileSync(fileURLToPath(new URL('../packship.html', import.meta.url)), 'utf8');
  check('Label Check tab sits right after Packing', /id="ps-tab-scan"[^\n]*\n\s*<div class="ps-tabitem"\s+id="ps-tab-labelcheck"/.test(ph), null);
  const sub = (ph.match(/window\.psLcGrabSubmit = function\(\) \{[\s\S]*?\n\};/) || [''])[0];
  check('"⚠ Shelf empty — need to grab" uses the same stock check + confirm screen as Picking → No Inventory (then POST /ship/stockout)',
    /Shelf empty — need to grab/.test(ph) && /\/ship\/stock-check/.test(sub) && /_psShowNostockConfirmModal\(selected, real, none, btn, wrap\)/.test(sub), null);
  check('Picking → No Inventory itself is unchanged (still hides the Picking card after sending)', /var wrap = document\.getElementById\('ps-pick-product-wrap'\);\s*if \(wrap\) wrap\.style\.display = 'none';/.test(ph), null);
}

// Owner: "install a light — any kind — our app turns it on when we want" (💡 Lights page).
console.log('\n💡 Lights: turn warehouse lights on / off from the app');
{
  const realFetch = globalThis.fetch, calls = [];
  globalThis.fetch = async (u, o) => { u = String(u);
    if (u.includes('openapi.api.govee.com') || u.includes('api.lifx.com') || u.includes('plug.example.com')) {
      calls.push({ u, method: (o && o.method) || 'GET', body: o && o.body, h: (o && o.headers) || {} });
      if (u.endsWith('/user/devices')) return new Response(JSON.stringify({ code: 200, data: [{ sku: 'H6008', device: 'AA:BB', deviceName: 'Bulb C1' }] }));
      if (u.endsWith('/lights/all')) return new Response(JSON.stringify([{ id: 'd073', label: 'Barn strip', power: 'off', product: { name: 'LIFX Z' } }]));
      if (u.includes('/device/control')) return new Response(JSON.stringify({ code: 200, msg: 'success' }));
      if (u.includes('api.lifx.com') && o && o.method === 'PUT') return new Response(JSON.stringify({ results: [{ id: 'd073', status: 'ok' }] }), { status: 207 });
      if (u.includes('plug.example.com/broken')) return new Response('nope', { status: 500 });
      return new Response('ok');
    }
    return realFetch(u, o); };
  env.GOVEE_API_KEY = 'gk'; env.LIFX_TOKEN = 'lt';
  const pk = (await (await call('/auth/login', { method: 'POST', body: '{"username":"picker","password":"password1"}' })).json()).token;
  const PH = { 'X-Cred-Token': pk, 'Content-Type': 'application/json' };
  const asWorker = async (p, b) => (await call(p, b ? { method: 'POST', headers: PH, body: JSON.stringify(b) } : { headers: PH })).json();
  const disc = await get('/lights/discover');
  check('manager: "Find my lights" lists the Govee and LIFX lights on the account', disc.ok && disc.found.some(x => x.provider === 'govee' && x.device === 'AA:BB') && disc.found.some(x => x.provider === 'lifx' && x.device === 'd073'), disc);
  const a1 = await post('/lights/save', { provider: 'govee', name: 'Aisle C1', area: 'C1', device: 'AA:BB', sku: 'H6008' });
  const a2 = await post('/lights/save', { provider: 'lifx', name: 'Barn strip', area: 'BARN', device: 'd073' });
  const a3 = await post('/lights/save', { provider: 'webhook', name: 'Packing lamp', onUrl: 'https://plug.example.com/on?k=SECRET', offUrl: 'https://plug.example.com/off?k=SECRET', method: 'POST', onBody: 'turn=on', offBody: 'turn=off' });
  const bad = await post('/lights/save', { provider: 'webhook', name: 'x', onUrl: 'https://plug.example.com/on' });
  const wAdd = await asWorker('/lights/save', { provider: 'webhook', name: 'mine', onUrl: 'https://a', offUrl: 'https://b' });
  check('manager adds Govee / LIFX / any plug (ON + OFF link); a link missing → refused; a worker can\'t add lights', a1.ok && a2.ok && a3.ok && bad.ok === false && wAdd.ok === false, { a1, a2, a3, bad, wAdd });
  calls.length = 0;
  const on1 = await asWorker('/lights/set', { id: a1.id, on: true });
  const gv = calls.find(c => c.u.includes('/device/control')), gb = gv && JSON.parse(gv.body);
  check('a worker taps ON → Govee is told powerSwitch 1 for that bulb (with the Govee key)', on1.ok && gv && gv.h['Govee-API-Key'] === 'gk' && gb.payload.device === 'AA:BB' && gb.payload.sku === 'H6008' && gb.payload.capability.value === 1, { on1, gb });
  calls.length = 0;
  const off2 = await asWorker('/lights/set', { id: a2.id, on: false });
  const lx = calls.find(c => c.u.includes('/lights/id:d073/state'));
  check('OFF on a LIFX light → PUT power "off" (with the LIFX token)', off2.ok && lx && lx.method === 'PUT' && JSON.parse(lx.body).power === 'off' && lx.h.Authorization === 'Bearer lt', { off2, lx });
  calls.length = 0;
  const all = await asWorker('/lights/set', { all: true, on: true });
  check('All ON → every light (Govee, LIFX and the plug link with its ON body)', all.ok && all.results.length === 3 && calls.some(c => c.u === 'https://plug.example.com/on?k=SECRET' && c.body === 'turn=on'), all);
  await post('/lights/save', { id: a3.id, provider: 'webhook', name: 'Packing lamp', onUrl: 'https://plug.example.com/broken', offUrl: 'https://plug.example.com/off?k=SECRET' });
  const brk = await asWorker('/lights/set', { id: a3.id, on: true });
  const listW = await asWorker('/lights/list'), listM = await get('/lights/list');
  const lg = await asWorker('/lights/log');
  check('a light that does not answer → says why (not saved as ON); the list shows ON / OFF + who / when; plug links (they can hold a key) only for managers',
    brk.ok === false && /HTTP 500/.test(brk.results[0].detail) && listW.lights.find(x => x.id === a1.id).on === true && listW.lights.find(x => x.id === a2.id).on === true
      && !('onUrl' in listW.lights[0]) && listM.lights.some(x => x.onUrl) && !JSON.stringify(listW).includes('SECRET'), { listW: listW.lights });
  check('every switch is kept: who / when / which light / on-off / worked or not', lg.ok && lg.log.length >= 6 && lg.log.some(x => x.name === 'Aisle C1' && x.action === 'on' && x.by_user && x.ok === 1) && lg.log.some(x => x.ok === 0 && /HTTP 500/.test(x.detail)), lg.log.slice(0, 4));
  const no = await call('/lights/list');
  const rm = await post('/lights/remove', { id: a2.id });
  check('no sign-in → refused; a manager can remove a light', no.status === 401 && rm.ok && !(await get('/lights/list')).lights.some(x => x.id === a2.id), no.status);
  const { readFileSync } = await import('node:fs');
  const ix = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8'), lh = readFileSync(fileURLToPath(new URL('../lights.html', import.meta.url)), 'utf8');
  check('💡 Lights box on the front page; the page has ON / OFF per light and All ON / All OFF', /onclick="window\.location\.href='lights\.html'"/.test(ix) && /ltSet\(null, true\)/.test(lh) && /ltSet\(null, false\)/.test(lh) && /\/lights\/set/.test(lh), null);
  globalThis.fetch = realFetch; delete env.GOVEE_API_KEY; delete env.LIFX_TOKEN;
}

// Owner: Auto Label → Test buy one label: Veeqo HTTP 400 "Rate not found for shipmentId: prb11408d5b, rateId: USPS_PTP_GAH"
// (order 114-8029574-6577065, Amazon Shipping USPS Ground Advantage $8.17).
console.log('\nAuto Label: buying sends the rate\'s id (its name) as service_type');
{
  const { readFileSync } = await import('node:fs');
  const ws = readFileSync(workerPath, 'utf8');
  const fn = (ws.match(/async function autolabelBuy\(env, order, allocationId, quote\) \{[\s\S]*?\n\}/) || [''])[0];
  const rate = { carrier: 'amazon_shipping_v2', name: 'amazon_shipping_v2-79c189a3-eb0d-4be3-9bc4-735815421402', title: 'USPS Ground Advantage (1 - 70 lb)',
    total_net_charge: '8.17', base_rate: '8.17', remote_shipment_id: 'prb11408d5b', sub_carrier_id: 'USPS', service_carrier: 'usps', service_id: 'USPS_PTP_GAH' };
  const mk = (answer) => { const sent = []; const buy = new Function('veeqoFetch', fn + '; return autolabelBuy;')(async (env, path, o) => { const b = JSON.parse(o.body); sent.push(b); return answer(b, sent.length); }); return { buy, sent }; };
  const a = mk(() => ({ tracking_number: { tracking_number: '9400111' } }));
  const r1 = await a.buy({}, {}, 555, { raw: rate });
  check('the buy asks Veeqo for the rate by its id (service_type = "amazon_shipping_v2-…"), not the USPS_PTP_GAH service code',
    a.sent.length === 1 && a.sent[0].carrier === 'amazon_shipping_v2' && a.sent[0].shipment.service_type === rate.name && a.sent[0].shipment.remote_shipment_id === 'prb11408d5b' && a.sent[0].shipment.allocation_id === 555 && r1.tracking === '9400111', a.sent);
  const b = mk((body, n) => { if (n === 1) throw new Error('Veeqo /shipping/shipments → HTTP 400: {"error_messages":["Rate not found for shipmentId: prb11408d5b, rateId: x"]}'); return { tracking_number: '1Z9' }; });
  const r2 = await b.buy({}, {}, 555, { raw: rate });
  check('…"Rate not found" → tries once more without service_id (a refused buy buys nothing, so never twice)', b.sent.length === 2 && b.sent[1].shipment.service_id === undefined && r2.tracking === '1Z9', b.sent);
  const c = mk(() => { throw new Error('Veeqo /shipping/shipments → HTTP 422: {"error_messages":["Address invalid"]}'); });
  let err = null; try { await c.buy({}, {}, 555, { raw: rate }); } catch (e) { err = e; }
  // Owner, 2nd test buy (order 111-5929074-3731428, $5.72): HTTP 400 INVALID_VALUE_ADDED_SERVICES — the rate's "Confirmation" choice wasn't picked.
  const vasRate = { ...rate, name: 'amazon_shipping_v2-d528156e-cf83-47ea-b303-cc5192bd7200', service_id: 'USPS_PTP_GAL', remote_shipment_id: 'prb6fa420e0',
    shipping_service_options: [{ key: 'value_added_service__VAS_GROUP_ID_CONFIRMATION', type: 'select', values: [{ value: 'DELIVERY_CONFIRMATION', price: 0 }, { value: 'SIGNATURE_CONFIRMATION', price: 4.15 }] },
      { key: 'liability_amount', type: 'number', values: [] }] };
  const v = mk(() => ({ tracking_number: '9400222' }));
  await v.buy({}, {}, 1612650312, { raw: vasRate });
  check('the rate\'s "Confirmation" choice is picked: the FREE one (Delivery confirmation), never the $4.15 Signature, no insurance',
    v.sent.length === 1 && v.sent[0].shipment.value_added_service__VAS_GROUP_ID_CONFIRMATION === 'DELIVERY_CONFIRMATION' && !JSON.stringify(v.sent[0]).includes('SIGNATURE') && v.sent[0].shipment.liability_amount === undefined, v.sent);
  const w = mk((body, n) => { if (n === 1) throw new Error('Veeqo /shipping/shipments → HTTP 400: {"error_messages":["InvalidRequestException, errorCode: INVALID_VALUE_ADDED_SERVICES, errorMessage: The requested value added services are invalid."]}'); return { tracking_number: '9400333' }; });
  const r4 = await w.buy({}, {}, 1612650312, { raw: vasRate });
  check('…value added services refused → one more try with them as a list (skips the "Rate not found" try); bought once', w.sent.length === 2 && JSON.stringify(w.sent[1].shipment.value_added_services) === '[{"id":"DELIVERY_CONFIRMATION"}]' && w.sent[1].shipment.service_id === 'USPS_PTP_GAL' && r4.tracking === '9400333', w.sent);
  check('…any other refusal: no second try, and what was sent is kept to show on the screen', c.sent.length === 1 && err && (err.tries || []).length === 1 && /Address invalid/.test(err.tries[0].error), { sent: c.sent.length, err: err && err.tries });
}

// Owner: "label already purchased (Veeqo shows it) but no label got printed" — Veeqo DirectPrint doesn't print labels bought through the app.
console.log('\nAuto Label: every bought label goes on the 🖨 Printer station list and prints from there');
{
  const { readFileSync } = await import('node:fs');
  const ws = readFileSync(workerPath, 'utf8');
  check('both ways of buying (auto run and Test buy) put the label on the print list', (ws.match(/await autolabelQueueLabel\(env, o, /g) || []).length >= 2, null);
  const realFetch = globalThis.fetch; let mode = 'url'; const asked = [];
  // The allocation also carries its items with their product photos (owner: "Reprint only printed the product photos").
  const order = { id: 77, number: '111-5929074-3731428', channel: { name: 'Amazon' }, allocations: [{ id: 1612650312,
    line_items: [{ quantity: 1, sellable: { sku_code: '5-3-2=2', image_url: 'https://photos.example/elbow.jpg', product: { main_image_src: 'https://photos.example/elbow-big.jpg' } } }],
    shipment: { id: 555, tracking_number: { tracking_number: '9400111' }, label_url: 'https://labels.example/l/1612650312.pdf',
      tracking_url: 'https://tools.usps.com/go/TrackConfirmAction?tRef=fullpage&tLc=2&tLabels=9400111%2C' } }] };
  globalThis.fetch = async (u, o) => { u = String(u); asked.push(u);
    if (u.includes('api.veeqo.com/orders')) return new Response(JSON.stringify([order]), { headers: { 'Content-Type': 'application/json' } });
    if (u.startsWith('https://photos.example/')) return new Response('JPEGDATA', { headers: { 'Content-Type': 'image/jpeg' } });
    if (u.startsWith('https://labels.example/')) return mode === 'url' ? new Response('%PDF-1.4 fake label', { headers: { 'Content-Type': 'application/pdf' } }) : new Response('gone', { status: 404 });
    if (u.startsWith('https://tools.usps.com/')) return new Response('Access Denied', { status: 403, headers: { 'Content-Type': 'text/html' } });
    if (u.includes('api.veeqo.com/shipping/labels/555') && mode === 'ship') return new Response('%PDF-1.4 label by shipment', { headers: { 'Content-Type': 'application/pdf' } });
    // Real Veeqo (owner): /shipping/labels?shipment_ids[]=<shipment> → {"labels_count":1} as JSON; the PDF when the PDF is asked for.
    if (/api\.veeqo\.com\/shipping\/labels(\.pdf)?\?shipment_ids\[\]=555/.test(u) && mode === 'list') return (o && o.headers && /^application\/pdf$/.test(o.headers.Accept || '')) && /labels\.pdf/.test(u)
      ? new Response('%PDF-1.4 label from the label list', { headers: { 'Content-Type': 'application/pdf' } }) : new Response('{"labels_count":1}', { headers: { 'Content-Type': 'application/json' } });
    if (u.includes('api.veeqo.com/shipping/')) return mode === 'none' || mode === 'ship' ? new Response('{"error":"not found"}', { status: 404, headers: { 'Content-Type': 'application/json' } }) : new Response('{}', { headers: { 'Content-Type': 'application/json' } });
    return realFetch(u, o); };
  env.VEEQO_API_KEY = 'k';
  const add = await post('/veeqo/autolabel/label-add', { order: '111-5929074-3731428' });
  const lst = await get('/veeqo/autolabel/labels?status=new');
  const L = (lst.labels || []).find(x => x.tracking === '9400111') || {};
  check('+ Add label for an order (bought earlier): it goes on the list, ⏳ waiting, with order # and tracking', add.ok && add.added === 1 && L.id && L.order_number === '111-5929074-3731428' && !L.printed_at, { add, lst });
  // Owner: "bin location, quantities, SKU under the shipping label" — kept with the label, printed on a sticker after it.
  check('…the label keeps what is in that box (SKU, qty) for the sticker printed after it', Array.isArray(L.items) && L.items.some(i => i.sku === '5-3-2=2' && i.qty === 1), L.items);
  sq.prepare("UPDATE label_print_queue SET items = NULL WHERE id = ?").run(L.id);
  const li = await get('/veeqo/autolabel/label-items?id=' + L.id);
  check('…a label queued before that was kept gets its items from Veeqo once (then saved)', li.ok && li.items.some(i => i.sku === '5-3-2=2') && /5-3-2=2/.test(sq.prepare('SELECT items FROM label_print_queue WHERE id = ?').get(L.id).items || ''), li);
  const ph = readFileSync(fileURLToPath(new URL('../packship.html', import.meta.url)), 'utf8');
  // Owner, later: "save labels — put it on the same label, at the bottom (like USPS)". The sticker stays for when it doesn't fit.
  check('…bin · SKU · ×qty is written in the blank strip at the bottom of the label (only all-white rows, a 4×6 label, every line fits)', /if \(_psAlStampLabel\(cv, items\)\) \{ await _psAlPrintCanvas\(cv\); stamped = true; \}/.test(ph) && /function _psAlBlankBand\(cv, minH\)/.test(ph) && /Math\.abs\(W \/ H - 4 \/ 6\) > 0\.04\) return no\('not a 4×6 label'\)/.test(ph), null);
  // Owner, later: "more than 3, print the packing slip with the order" — the sticker is only for ≤3 items (the slip lists the rest).
  // Owner, later: "1–4 items: no packing slip; 5 or more, or when the USPS label has no spot for all the info → print the packing slip with it" (no sticker any more).
  check('…when it doesn\'t fit there: the label as it is, then ITS packing slip right after it (no separate sticker), then marked printed', /if \(!stamped\) \{\s*await _psAlPrintLabelBlob\(f\);\s*\}[\s\S]{0,200}labels-printed/.test(ph) && !/await _psAlPrintHtml\(_psAlBoxStripHtml\(l, items\)\)/.test(ph), null);
  // Owner: "24-5-5, 2,5=3/4x1/2X PO C on the same line … smaller words to fit 3 lines … 3 items → no packing slip, more than 3 → packing slip with the order".
  // Owner, later: "put x2 before the 5=3/4x1/2X PO C … quantities easy to see … the more lines under the label the better (saves the packing slip)".
  // …then: "put it at the back — they grab the item first, then see how many"; then: "4 lines; with the black-and-white quantity no ',' after the SKU; more than 4 → packing slip".
  check('…one line per item: bin, SKU, then the quantity at the back (x2) white on a black box (no "," before it) — bins / SKUs / quantities lined up', /bin: \(it\.bin \|\| '—'\) \+ ',', sku: String\(it\.sku \|\| ''\), qty: 'x' \+ \(it\.qty \|\| 0\) \}/.test(ph) && /ctx\.fillText\(r\.bin, x, yc\); ctx\.fillText\(r\.sku, xs, yc\);/.test(ph) && /ctx\.fillRect\(xq, [^;]+\); \/\/ black box, white quantity\s*ctx\.fillStyle = '#fff'; ctx\.fillText\(r\.qty/.test(ph), null);
  check('…up to 4 lines, as big as fits (not smaller than 2% of the label width); more than 4 → not written on the label', /var _PS_AL_LABEL_MAX_LINES = 4;/.test(ph) && /if \(items\.length > _PS_AL_LABEL_MAX_LINES\) return no\(/.test(ph) && /minFs = Math\.round\(W \* 0\.02\)/.test(ph), null);
  check('…written on the label (1–4 items) → no packing slip; not written on it (5+ items, or no room / no blank spot) → the packing slip prints with it', /var many = items\.length > _PS_AL_LABEL_MAX_LINES, needSlip = !stamped \|\| isUps, skipSlip = stamped && !isUps;/.test(ph) && /skipSlip: skipSlip, needSlip: needSlip, withSlips: true/.test(ph), null);
  const f = await call('/veeqo/autolabel/label-file?id=' + L.id, { headers: H });
  check('…the Printer station gets the label file itself (PDF) from what Veeqo gave', f.status === 200 && /application\/pdf/.test(f.headers.get('content-type')) && (await f.text()).startsWith('%PDF'), f.status);
  const pr = await post('/veeqo/autolabel/labels-printed', { ids: [L.id] });
  const row = sq.prepare('SELECT printed_at, printed_by, print_count FROM label_print_queue WHERE id = ?').get(L.id);
  check('…printed → on record (who / when / how many times), off the waiting list', pr.ok && row.printed_at && row.printed_by && row.print_count === 1 && !(await get('/veeqo/autolabel/labels?status=new')).labels.some(x => x.id === L.id), row);
  mode = 'none'; await post('/veeqo/autolabel/label-add', { order: '111-5929074-3731428' });
  const L2 = (await get('/veeqo/autolabel/labels?status=new')).labels.find(x => x.tracking === '9400111');
  const f2 = await call('/veeqo/autolabel/label-file?id=' + L2.id, { headers: H }); const j2 = await f2.json();
  check('…never the product photo: no label file from Veeqo → nothing printed (not the item\'s photo)', !asked.some(u => u.startsWith('https://photos.example/')), asked.filter(u => /photos\.example/.test(u)));
  check('…never a carrier tracking page (tools.usps.com … tLabels=…) taken for the label', !asked.some(u => u.startsWith('https://tools.usps.com/')), asked.filter(u => /usps\.com/.test(u)));
  check('…asks Veeqo by the SHIPMENT id (owner: /shipping/labels/<allocation> → 404)', asked.some(u => u.includes('/shipping/labels/555')), asked.filter(u => /shipping\//.test(u)));
  mode = 'list'; const f4 = await call('/veeqo/autolabel/label-file?id=' + L2.id, { headers: H });
  check('…Veeqo\'s label list for the shipment (it said labels_count: 1) → asked for the PDF, the label prints', f4.status === 200 && (await f4.text()).includes('label from the label list'), f4.status);
  mode = 'ship'; const f3 = await call('/veeqo/autolabel/label-file?id=' + L2.id, { headers: H });
  check('…Veeqo has it under the shipment → the label PDF prints', f3.status === 200 && (await f3.text()).includes('label by shipment'), f3.status);
  mode = 'none';
  check('…Veeqo gives no label file → it stays on the list in red with what each place said (never lost)', f2.status === 502 && j2.tried.length >= 2 && !!sq.prepare('SELECT last_error FROM label_print_queue WHERE id = ?').get(L2.id).last_error && (await get('/veeqo/autolabel/labels?status=new')).labels.some(x => x.id === L2.id), j2);
  // Up to 3 items written on the label → that box's packing slip is marked "on the label" (record kept, not printed).
  await post('/veeqo/autolabel/slip-add', { order: '111-5929074-3731428' });
  const slipQ = () => sq.prepare("SELECT * FROM packing_slip_queue WHERE order_id = '77' ORDER BY id").all();
  check('(a packing slip is waiting for that box)', slipQ().length === 1 && !slipQ()[0].printed_at, slipQ());
  const sk = await post('/veeqo/autolabel/labels-printed', { ids: [L2.id], skipSlip: true });
  check('…items written on the label → its packing slip is not printed, kept on record as "on the label"', sk.ok && sk.slipsSkipped === 1 && slipQ()[0].printed_at && slipQ()[0].printed_by === 'on the label' && !(await get('/veeqo/autolabel/slips?status=new')).slips?.some(x => x.order_id === '77'), { sk, q: slipQ() });
  // More than 3 items → the slip prints with the order: queued if it wasn't.
  sq.prepare("DELETE FROM packing_slip_queue WHERE order_id = '77'").run();
  const ns = await post('/veeqo/autolabel/labels-printed', { ids: [L2.id], needSlip: true });
  check('…more than 3 items → a packing slip is queued for that box (prints right after the label)', ns.ok && ns.slipsQueued === 1 && slipQ().length === 1 && !slipQ()[0].printed_at && slipQ()[0].tracking === '9400111', { ns, q: slipQ() });
  const ns2 = await post('/veeqo/autolabel/labels-printed', { ids: [L2.id], needSlip: true });
  check('…reprinting that label doesn\'t queue a second slip', ns2.slipsQueued === 0 && slipQ().length === 1, slipQ());
  const pl = await post('/veeqo/autolabel/labels-printed', { ids: [L2.id] });
  check('…a plain "printed" (no slip info) leaves the slips alone', pl.ok && slipQ().length === 1 && !slipQ()[0].printed_at, slipQ());
  globalThis.fetch = realFetch; delete env.VEEQO_API_KEY;
}

// Owner: "Last run — see the product name, photo, customer, bin, SKU, items, package size + weight (live in Veeqo), and change the photo, bin, SKU, package — it changes in Veeqo too".
console.log('\nAuto Label → Last run → 🔎 an order: live Veeqo info, changes saved in Veeqo and kept on record');
{
  const realFetch = globalThis.fetch; const writes = []; let refuse = false;
  const V = { sku: '24-5-5=2', loc: '24-5-5', img: 'https://photos.example/old.jpg', pkg: { weight: 8, weight_unit: 'oz', depth: 6, width: 4, height: 2, dimensions_unit: 'inches' } };
  const ord = () => ({ id: 901, number: '114-1111111-2222222', channel: { name: 'Amazon' }, deliver_to: { first_name: 'Ana', last_name: 'Lopez', city: 'Naples', state: 'FL', zip: '34117' },
    allocations: [{ id: 7001, allocation_package: { ...V.pkg }, warehouse: { id: 55 },
      line_items: [{ quantity: 2, sellable: { id: 3001, product_id: 4001, sku_code: V.sku, product_title: 'Brass elbow 1/2"', image_url: V.img, weight_grams: 113.4, stock_entries: [{ warehouse_id: 55, location: V.loc }] } }] }] });
  globalThis.fetch = async (u, o) => { u = String(u); const m = (o && o.method) || 'GET';
    if (u.includes('api.veeqo.com/orders?')) return new Response(JSON.stringify([ord()]), { headers: { 'Content-Type': 'application/json' } });
    if (u.startsWith('https://api.veeqo.com/') && m === 'PUT') { const b = JSON.parse(o.body || '{}'); writes.push({ u, b });
      if (refuse) return new Response('{"error":"nope"}', { status: 422 });
      if (/\/sellables\/3001\/warehouses\/55\/stock_entry$/.test(u)) { V.loc = b.stock_entry.location; return new Response('{}'); }
      if (/\/products\/4001$/.test(u) && b.product.product_variants_attributes) { V.sku = b.product.product_variants_attributes[0].sku_code; return new Response('{}'); }
      if (/\/products\/4001$/.test(u) && b.product.images_attributes) { V.img = 'https://veeqo-cdn.example/' + encodeURIComponent(b.product.images_attributes[0].src); return new Response('{}'); }
      if (/\/allocations\/7001\/allocation_package$/.test(u)) return new Response('not found', { status: 404 }); // first shape refused → the next is tried
      if (/\/orders\/901\/allocations\/7001$/.test(u)) { V.pkg = { ...b.allocation.allocation_package_attributes }; return new Response('{}'); }
      return new Response('not found', { status: 404 }); }
    return realFetch(u, o); };
  env.VEEQO_API_KEY = 'k';
  const lv = await get('/veeqo/autolabel/order-live?order=114-1111111-2222222');
  const it = (lv.boxes || [])[0] && lv.boxes[0].items[0] || {};
  check('🔎 shows the live order: customer, the item (name, photo, SKU, bin, qty) and the box\'s package size + weight from Veeqo',
    lv.ok && /Ana/.test(lv.customer) && it.title === 'Brass elbow 1/2"' && it.sku === '24-5-5=2' && it.bin === '24-5-5' && it.qty === 2 && it.img === 'https://photos.example/old.jpg'
    && lv.boxes[0].package.lengthIn === 6 && lv.boxes[0].package.weightLb === 0.5, lv);
  const ids = { order: '114-1111111-2222222', sellableId: it.sellableId, productId: it.productId, warehouseId: it.warehouseId, allocId: 7001 };
  const eb = await post('/veeqo/autolabel/order-edit', { ...ids, kind: 'bin', value: '24-5-6' });
  check('…change the bin → saved in Veeqo (its stock entry), checked by reading the order again', eb.ok && V.loc === '24-5-6' && eb.before === '24-5-5' && eb.after === '24-5-6', eb);
  const es = await post('/veeqo/autolabel/order-edit', { ...ids, kind: 'sku', value: '24-5-5=2X' });
  check('…change the SKU → saved in Veeqo', es.ok && V.sku === '24-5-5=2X' && es.after === '24-5-5=2X', es);
  const ep = await post('/veeqo/autolabel/order-edit', { ...ids, kind: 'photo', value: 'https://photos.example/new.jpg' });
  check('…change the photo → saved in Veeqo (a photo link must be https://)', ep.ok && /new\.jpg/.test(V.img) && !(await post('/veeqo/autolabel/order-edit', { ...ids, kind: 'photo', value: 'javascript:alert(1)' })).ok, ep);
  const ek = await post('/veeqo/autolabel/order-edit', { ...ids, kind: 'package', lengthIn: 10, widthIn: 8, heightIn: 4, weightLb: 1.25 });
  check('…change the package size + weight → saved in Veeqo (20 oz = 1.25 lb, 10×8×4 in); a refused way is skipped for the next', ek.ok && V.pkg.weight === 20 && V.pkg.depth === 10 && ek.tries.length === 2 && ek.tries[0].status === 404, ek);
  refuse = true;
  const ef = await post('/veeqo/autolabel/order-edit', { ...ids, kind: 'bin', value: '99-9-9' });
  check('…Veeqo refuses → "not saved" with what Veeqo said, nothing changed there', ef.ok === false && /did not take/.test(ef.error) && V.loc === '24-5-6', ef);
  const log = sq.prepare("SELECT kind, before_val, after_val, ok, by_user, detail FROM veeqo_edit_log WHERE order_id = '901' ORDER BY id").all();
  check('…every change on record: who / when / before → after, and the refused one marked not saved with why', log.length === 5 && log[0].kind === 'bin' && log[0].before_val === '24-5-5' && log[0].after_val === '24-5-6' && log[0].ok === 1 && log[0].by_user
    && log[4].ok === 0 && /NOT saved/.test(log[4].detail), log);
  const lv2 = await get('/veeqo/autolabel/order-live?order=114-1111111-2222222');
  check('…🔎 shows those changes in its history', (lv2.history || []).length === 5, lv2.history);
  check('…bad input is refused before anything goes to Veeqo', !(await post('/veeqo/autolabel/order-edit', { ...ids, kind: 'package', lengthIn: 0, widthIn: 8, heightIn: 4, weightLb: 1 })).ok
    && !(await post('/veeqo/autolabel/order-edit', { ...ids, kind: 'sku', value: '' })).ok && !(await post('/veeqo/autolabel/order-edit', { ...ids, kind: 'title', value: 'x' })).ok, null);
  const { readFileSync } = await import('node:fs');
  const ws = readFileSync(workerPath, 'utf8'), ph2 = readFileSync(fileURLToPath(new URL('../packship.html', import.meta.url)), 'utf8');
  check('…changing things in Veeqo is blocked while the test switch is on, like buying a label', /'\/veeqo\/autolabel\/test-buy', '\/veeqo\/autolabel\/order-edit'/.test(ws), null);
  check('…Last run: each order has 🔎 that opens it; a SKU change warns it renames it for every order and listing', /onclick="psAlLive\(this, /.test(ph2) && /renames the SKU in Veeqo for EVERY order and listing/.test(ph2), null);
  globalThis.fetch = realFetch; delete env.VEEQO_API_KEY;
}

// Owner: "Last run — select which ones to print, or all; tap Would buy → all the would buy show; Print → prints all;
// more than 4 items → the packing slip prints right under that label" + "would buy only shows 10 — show all".
console.log('\nAuto Label → Last run: 🖨 Buy & print selected; a box\'s packing slip prints right under its label');
{
  const realFetch = globalThis.fetch; const bought = [];
  const items = ['1-1-1=2', '1-1-2=2', '1-1-3=2', '1-1-4=2', '1-1-5=2'].map((sku, i) => ({ quantity: 1, sellable: { id: 600 + i, sku_code: sku, weight_grams: 50, stock_entries: [{ warehouse_id: 55, location: 'B' + i }] } }));
  let hasLabel = false;
  const ord = () => ({ id: 950, number: 'E-77', channel: { name: 'eBay', type_code: 'ebay' }, total_price: 60, created_at: new Date(Date.now() - 864e5).toISOString(),
    deliver_to: { first_name: 'Bo', last_name: 'Li', city: 'Austin', state: 'TX', zip: '78701' }, line_items: items,
    allocations: [{ id: 8001, line_items: items, shipment: hasLabel ? { id: 1, tracking_number: { tracking_number: '9400777' } } : null }] });
  globalThis.fetch = async (u, o) => { u = String(u); const m = (o && o.method) || 'GET'; const J = x => new Response(JSON.stringify(x), { headers: { 'Content-Type': 'application/json' } });
    if (u.includes('api.veeqo.com/orders?')) return J(/status=cancelled/.test(u) ? [] : [ord()]);
    if (u.includes('api.veeqo.com/shipping/quotes/amazon_shipping_v2')) return J([{ title: 'USPS Ground Advantage', name: 'usps-ga', carrier: 'usps', total_net_charge: 5.1, transit_days: 3 }]);
    if (u.includes('api.veeqo.com/shipping/shipments') && m === 'POST') { bought.push(JSON.parse(o.body)); hasLabel = true; return J({ id: 1, tracking_number: { tracking_number: '9400777' } }); }
    if (u.includes('api.veeqo.com/')) return J([]);
    return new Response('{}', { status: 401 }); };
  env.VEEQO_API_KEY = 'k';
  const r1 = await post('/veeqo/autolabel/buy-one', { order: 'E-77' });
  check('🖨 Buy & print selected → that order\'s label is bought (by hand, every check again) and goes on the print list', r1.ok && bought.length === 1 && r1.labels[0].tracking === '9400777'
    && sq.prepare("SELECT COUNT(*) n FROM label_print_queue WHERE order_number = 'E-77' AND printed_at IS NULL").get().n === 1
    && /Bought by hand from Last run/.test(sq.prepare("SELECT reason FROM autolabel_log WHERE order_number = 'E-77' AND action = 'bought'").get()?.reason || ''), { r1, bought: bought.length });
  const r2 = await post('/veeqo/autolabel/buy-one', { order: 'E-77' });
  check('…the same order again → not bought twice ("already has a label")', r2.ok === false && /already has a label/.test(r2.error) && bought.length === 1, r2);
  const L = sq.prepare("SELECT id FROM label_print_queue WHERE order_number = 'E-77'").get();
  const lp = await post('/veeqo/autolabel/labels-printed', { ids: [L.id], needSlip: true, withSlips: true });
  check('…5 items (more than 4): the label comes back with ITS packing slip, to print right under it', lp.ok && lp.slips.length === 1 && lp.slips[0].orderNumber === 'E-77' && lp.slips[0].items.length === 5 && lp.slips[0].tracking === '9400777', lp);
  const { readFileSync } = await import('node:fs');
  const ws = readFileSync(workerPath, 'utf8'), ph3 = readFileSync(fileURLToPath(new URL('../packship.html', import.meta.url)), 'utf8');
  check('…the station prints that slip right after its label (not at the end), then marks it printed', /withSlips: true, reprint: !!reprint \} \}\);[\s\S]{0,400}if \(own\.length\) \{\s*await _psAlPrintSlips\(own\);\s*await _psAlMarkPrinted\(/.test(ph3), null);
  check('…Last run: tap a chip (👀 Would buy) → only those; ☑ Select all; 🖨 Buy & print selected; buying blocked while the test switch is on',
    /onclick="psAlRunFilter\(/.test(ph3) && /id="ps-al-sel-all"/.test(ph3) && /psAlBuyPrint\(\)/.test(ph3) && /'\/veeqo\/autolabel\/order-edit', '\/veeqo\/autolabel\/buy-one'/.test(ws), null);
  check('…"would buy only 10": a preview run keeps rates 1 hour, so each run rate-checks the NEXT orders and all of them show',
    /else if \(!buy && \(cached = await autolabelRateCacheGet\(env, o, open\)\)\)/.test(ws) && /await autolabelRateCachePut\(env, o, open, row\);/.test(ws), null);
  globalThis.fetch = realFetch; delete env.VEEQO_API_KEY;
}

// Owner: "merge — our own merge: under 20 lb together, just combine the shipment; over 20 lb put it on the
// side first so I can merge it myself (we split heavy ones into 2 or more boxes)".
console.log('\nAuto Label → 🧩 same name + address: ≤ 20 lb together → one box, one label; over 20 lb → put aside');
{
  const realFetch = globalThis.fetch;
  const it = (id, sku, q, g, bin) => ({ quantity: q, sellable: { id, sku_code: sku, product_title: 'T ' + sku, weight_grams: g, stock_entries: [{ warehouse_id: 55, location: bin }] } });
  const old = new Date(Date.now() - 864e5).toISOString(), older = new Date(Date.now() - 2 * 864e5).toISOString();
  const to = (f, l, a1) => ({ first_name: f, last_name: l, address1: a1, city: 'Austin', state: 'TX', zip: '78701' });
  const mk = (id, number, created, deliver, items, aid) => ({ id, number, channel: { name: 'eBay', type_code: 'ebay' }, total_price: 40, created_at: created, deliver_to: deliver, line_items: items,
    allocations: [{ id: aid, line_items: items, shipment: null, allocation_package: { weight: 8, weight_unit: 'oz', depth: 8, width: 6, height: 4, dimensions_unit: 'inches' } }] });
  // Light pair (Mo Ng): M-1 = 2× 30-3-4=10 + 1× 24-5-5=2 ; M-2 = 3× 30-3-4=10 (same bin) + 1× 40-1-1=1  → 7 pieces of Veeqo qty in one box
  const orders = [
    mk(1001, 'M-1', older, to('Mo', 'Ng', '1 Main St'), [it(1, '30-3-4=10', 2, 400, '30-3-4'), it(2, '24-5-5=2', 1, 300, '24-5-5')], 9001),
    mk(1002, 'M-2', old, to('Mo', 'Ng', '1 Main St'), [it(1, '30-3-4=10', 3, 400, '30-3-4'), it(3, '40-1-1=1', 1, 500, '40-1-1')], 9002),
    // Heavy pair (Al Bo): 6 kg + 5 kg ≈ 24 lb together
    mk(1003, 'H-1', older, to('Al', 'Bo', '9 Oak Rd'), [it(4, '50-1-1=1', 2, 3000, '50-1-1')], 9003),
    mk(1004, 'H-2', old, to('Al', 'Bo', '9 Oak Rd'), [it(5, '50-1-2=1', 1, 5000, '50-1-2')], 9004),
    // Light pair where Veeqo won't mark the 2nd shipped (Cy Do)
    mk(1005, 'F-1', older, to('Cy', 'Do', '5 Elm St'), [it(6, '60-1-1=1', 1, 200, '60-1-1')], 9005),
    mk(1006, 'F-2', old, to('Cy', 'Do', '5 Elm St'), [it(7, '60-1-2=1', 1, 200, '60-1-2')], 9006),
  ];
  const allocOf = id => orders.flatMap(o => o.allocations).find(a => String(a.id) === String(id));
  const bought = [], marks = [];
  globalThis.fetch = async (u, o) => { u = String(u); const m = (o && o.method) || 'GET'; const J = (x, st) => new Response(JSON.stringify(x), { status: st || 200, headers: { 'Content-Type': 'application/json' } });
    const body = o && o.body ? JSON.parse(o.body) : null;
    if (u.includes('api.veeqo.com/orders?')) {
      if (/status=cancelled/.test(u)) return J([]);
      const q = decodeURIComponent((u.match(/query=([^&]+)/) || [])[1] || '');
      const open = x => !(x.allocations || []).every(a => a.shipment);
      const list = q ? orders.filter(x => x.number === q) : orders;
      return J(/status=awaiting_fulfillment/.test(u) ? list.filter(open) : list);
    }
    let mm;
    if ((mm = u.match(/api\.veeqo\.com\/allocations\/(\d+)\/allocation_package$/)) && m === 'PUT') { Object.assign(allocOf(mm[1]).allocation_package, body.allocation_package); return J({}); }
    if ((mm = u.match(/shipping\/quotes\/amazon_shipping_v2\?allocation_id=(\d+)/))) { const w = parseFloat(allocOf(mm[1]).allocation_package.weight) / 16; return J([{ title: 'USPS Ground Advantage', name: 'usps-ga', carrier: 'usps', total_net_charge: Math.round((4 + w) * 100) / 100, transit_days: 3 }]); }
    if (u.includes('api.veeqo.com/shipping/shipments') && m === 'POST') { const a = allocOf(body.shipment.allocation_id); const tn = 'MRG' + a.id; a.shipment = { id: 77, carrier_id: 3, tracking_number: { tracking_number: tn } }; bought.push({ alloc: a.id, w: a.allocation_package.weight }); return J({ id: 77, carrier_id: 3, tracking_number: { tracking_number: tn } }); }
    if (u.endsWith('api.veeqo.com/shipments') && m === 'POST') { const sh = body.shipment || {}; const aid = sh.allocation_id || body.allocation_id; marks.push(aid);
      if (String(aid) === '9006') return J({ error: 'not allowed' }, 422);
      if (aid) allocOf(aid).shipment = { id: 78, tracking_number: { tracking_number: sh.tracking_number_attributes.tracking_number } }; return J({ id: 78 }); }
    if (u.includes('api.veeqo.com/')) return J([]);
    return new Response('{}', { status: 401 }); };
  env.VEEQO_API_KEY = 'k';
  await post('/veeqo/autolabel/config', { config: { mode: 'preview' } });
  const run = await post('/veeqo/autolabel/run', {});
  const R = n => run.orders.find(x => x.number === n) || {};
  check('preview: same name + address, 6.18 lb together → 🧩 Would merge (one box, one label), both orders together, nothing bought',
    R('M-1').decision === 'would_merge' && R('M-2').decision === 'would_merge' && R('M-1').mergeKey === 'M-1' && R('M-2').mergeKey === 'M-1' && R('M-1').mergeLb === 6.18
    && /One box, one label: M-1 \+ M-2/.test(R('M-1').reason) && bought.length === 0, [R('M-1'), R('M-2')]);
  check('…over 20 lb together → 🔗 Merge by hand, put aside for the owner (never bought)', R('H-1').decision === 'merge' && R('H-2').decision === 'merge'
    && /over 20 lb: put aside for you to merge \/ split by hand/.test(R('H-1').reason), [R('H-1').reason, R('H-1').mergeLb]);
  const r1 = await post('/veeqo/autolabel/merge-buy', { orders: ['M-1', 'M-2'] });
  const lq = sq.prepare("SELECT order_number, tracking, items FROM label_print_queue WHERE tracking = 'MRG9001'").get();
  const li = JSON.parse(lq?.items || '[]'), qty = sku => (li.find(x => x.sku === sku) || {}).qty || 0;
  check('🧩 Merge & buy → box weight in Veeqo set to everything together (6.18 lb = 98.88 oz), ONE label bought on the oldest order',
    r1.ok && r1.allMarked && bought.length === 1 && bought[0].alloc === 9001 && bought[0].w === 98.88 && r1.tracking === 'MRG9001', { r1, bought });
  check('…the other order is marked shipped in Veeqo with the SAME tracking #', String(allocOf(9002).shipment?.tracking_number?.tracking_number) === 'MRG9001', allocOf(9002).shipment);
  // Inventory check: M-1 (2 + 1 = 3) + M-2 (3 + 1 = 4) = 7 in the box; 30-3-4=10: 2 + 3 = 5, nothing twice, nothing dropped.
  check('…the label lists every item of both orders, counts add up exactly (30-3-4=10: 2 + 3 = 5 · 24-5-5=2: 1 · 40-1-1=1: 1 · total 3 + 4 = 7)',
    lq && lq.order_number === 'M-1 + M-2' && qty('30-3-4=10') === 5 && qty('24-5-5=2') === 1 && qty('40-1-1=1') === 1 && li.reduce((n, x) => n + x.qty, 0) === 7 && li.length === 3, li);
  const mf = sq.prepare("SELECT order_num, line_items FROM ship_manifest_log WHERE tracking = 'MRG9001'").get();
  check('…Picking / Packing see the whole box when they scan the label (manifest has both orders\' items)', mf && mf.order_num === 'M-1 + M-2' && JSON.parse(mf.line_items).reduce((n, x) => n + x.q, 0) === 7, mf);
  const lg = sq.prepare("SELECT order_number, action, tracking FROM autolabel_log WHERE tracking = 'MRG9001' ORDER BY id").all().map(x => x.order_number + ':' + x.action);
  check('…on record: who / when / which orders / the one tracking # (autolabel_log + autolabel_merge)', lg.join(',') === 'M-1:bought,M-2:merged'
    && sq.prepare("SELECT status FROM autolabel_merge WHERE tracking = 'MRG9001'").get()?.status === 'done', lg);
  check('…the first merge that worked unlocks merging in auto runs', sq.prepare("SELECT value FROM app_config WHERE key = 'autolabel_merge_verified'").get()?.value === 'yes', null);
  const r2 = await post('/veeqo/autolabel/merge-buy', { orders: ['M-1', 'M-2'] });
  check('…never bought twice (merging the same orders again is refused)', r2.ok === false && bought.length === 1, r2);
  const r3 = await post('/veeqo/autolabel/merge-buy', { orders: ['H-1', 'H-2'] });
  check('…over 20 lb can\'t be merged by the button either (put aside, merge / split by hand)', r3.ok === false && /over 20 lb/.test(r3.error) && bought.length === 1, r3);
  const r4 = await post('/veeqo/autolabel/merge-buy', { orders: ['F-1', 'F-2'] });
  check('…Veeqo won\'t mark the other order shipped → said plainly (mark it by hand with the tracking #), kept on record', r4.ok && r4.allMarked === false && /did not mark F-2 shipped/.test(r4.error)
    && sq.prepare("SELECT status FROM autolabel_merge WHERE tracking = 'MRG9005'").get()?.status === 'mark_failed', r4);
  const b2 = await post('/veeqo/autolabel/buy-one', { order: 'F-2' });
  check('…and that order is never bought on its own afterwards (it is in the merged box)', b2.ok === false && /merged box with F-1/.test(b2.error) && bought.length === 2, b2);
  const run2 = await post('/veeqo/autolabel/run', {});
  const F2 = run2.orders.find(x => x.number === 'F-2') || {};
  check('…the next run shows it as ⚠️ mark shipped in Veeqo with that tracking (tries Veeqo again, never buys)', F2.decision === 'merge_fix' && /mark it shipped by hand in Veeqo with tracking MRG9005/.test(F2.reason) && bought.length === 2, F2);
  const { readFileSync } = await import('node:fs');
  const ws = readFileSync(workerPath, 'utf8'), ph = readFileSync(fileURLToPath(new URL('../packship.html', import.meta.url)), 'utf8');
  check('…a scan of a merged label looks up every order\'s items (not just the first order)', /const mergedBox = await autolabelMergedBox\(env, clean\);/.test(ws) && /'\/veeqo\/autolabel\/buy-one', '\/veeqo\/autolabel\/merge-buy'/.test(ws), null);
  check('…Last run: 🧩 Merge & buy on the first order of a group; the group\'s orders sit together; rules say it in plain words',
    /onclick="psAlMergeBuy\(this, /.test(ph) && /a\.o\.mergeKey \|\| b\.o\.mergeKey/.test(ph) && /data-k="autoMerge"/.test(ph) && /data-k="mergeMaxLb"/.test(ph) && /one box, one label<\/b>/.test(ph), null);
  await post('/veeqo/autolabel/config', { config: { mode: 'off' } });
  globalThis.fetch = realFetch; delete env.VEEQO_API_KEY;
}

// Owner: "low value on Auto Label — let me still select all and print like would buy, but keep the record;
// later we go back to each listing to check and change the price".
const { readFileSync: readFileSync0 } = await import('node:fs');
console.log('\nAuto Label → 💸 Low value: can be ticked and printed like Would buy, kept on the Low value list');
{
  const realFetch = globalThis.fetch; const bought = [];
  const items = [{ quantity: 1, sellable: { id: 801, sku_code: '9-9-9=1', product_title: 'Cheap cap', weight_grams: 40, stock_entries: [{ warehouse_id: 55, location: '9-9-9' }] } }];
  let hasLabel = false;
  const ord = () => ({ id: 990, number: 'LV-1', channel: { name: 'eBay', type_code: 'ebay' }, total_price: 5, created_at: new Date(Date.now() - 864e5).toISOString(),
    deliver_to: { first_name: 'Lo', last_name: 'Va', address1: '7 Low St', zip: '10001' }, line_items: items,
    allocations: [{ id: 8901, line_items: items, shipment: hasLabel ? { id: 1, tracking_number: { tracking_number: '9400LV1' } } : null }] });
  globalThis.fetch = async (u, o) => { u = String(u); const m = (o && o.method) || 'GET'; const J = x => new Response(JSON.stringify(x), { headers: { 'Content-Type': 'application/json' } });
    if (u.includes('api.veeqo.com/orders?')) return J(/status=cancelled/.test(u) ? [] : (/query=LV-1|status=awaiting/.test(u) ? [ord()] : []));
    if (u.includes('api.veeqo.com/shipping/quotes/amazon_shipping_v2')) return J([{ title: 'USPS Ground Advantage', name: 'usps-ga', carrier: 'usps', total_net_charge: 4.8, transit_days: 3 }]);
    if (u.includes('api.veeqo.com/shipping/shipments') && m === 'POST') { bought.push(1); hasLabel = true; return J({ id: 1, tracking_number: { tracking_number: '9400LV1' } }); }
    if (u.includes('api.veeqo.com/')) return J([]);
    return new Response('{}', { status: 401 }); };
  env.VEEQO_API_KEY = 'k';
  const lvRow = () => sq.prepare("SELECT * FROM low_value_log WHERE order_number = 'LV-1'").get();
  const r0 = await post('/veeqo/autolabel/buy-one', { order: 'LV-1' });
  check('💸 $4.80 label on a $5 order, not ticked as low value → not bought (as before), but kept on the Low value list',
    r0.ok === false && r0.lowValue && bought.length === 0 && lvRow()?.label_cost === 4.8 && lvRow()?.order_total === 5 && lvRow()?.pct === 96 && /9-9-9=1/.test(lvRow()?.items) && !lvRow()?.bought_at, { r0, row: lvRow() });
  const r1 = await post('/veeqo/autolabel/buy-one', { order: 'LV-1', allowLow: true });
  check('…ticked in Last run (💸 Low value) → bought and printed like Would buy', r1.ok && r1.lowValue && bought.length === 1 && r1.labels[0].tracking === '9400LV1'
    && sq.prepare("SELECT COUNT(*) n FROM label_print_queue WHERE order_number = 'LV-1'").get().n === 1, r1);
  check('…on record: the Low value list says printed (who / when / tracking), and the log says "low value, bought anyway"',
    !!lvRow()?.bought_at && lvRow()?.tracking === '9400LV1' && lvRow()?.status === 'open'
    && /low value, bought anyway/.test(sq.prepare("SELECT reason FROM autolabel_log WHERE order_number = 'LV-1' AND action = 'bought'").get()?.reason || ''), lvRow());
  const cf = await get('/veeqo/autolabel/config');
  const needs = +((ph0 => (ph0.match(/var _PS_AL_SERVER_NEEDS = (\d+);/) || [])[1])(readFileSync0(fileURLToPath(new URL('../packship.html', import.meta.url)), 'utf8')));
  check('…the page warns in red when the server is older than it (Cloudflare build failed): server version ≥ what the page needs, and the warning is there',
    cf.serverVersion >= needs && needs >= 3 && /id = 'ps-al-server-old'/.test(readFileSync0(fileURLToPath(new URL('../packship.html', import.meta.url)), 'utf8')), { server: cf.serverVersion, needs });
  const pageV = +((readFileSync0(fileURLToPath(new URL('../packship.html', import.meta.url)), 'utf8').match(/var _PS_AL_PAGE_VERSION = (\d+);/) || [])[1]);
  check('…and the other way: a stuck website update (old page, new server) → "This page is an OLD version — refresh"; this page is new enough for this server',
    cf.pageNeeds >= 4 && pageV >= cf.pageNeeds && /This page is an OLD version/.test(readFileSync0(fileURLToPath(new URL('../packship.html', import.meta.url)), 'utf8')), { pageNeeds: cf.pageNeeds, pageV });
  const l1 = await get('/veeqo/autolabel/low-value?status=open');
  const c1 = await post('/veeqo/autolabel/low-value-checked', { orderId: '990', note: 'raised to $7.99' });
  const l2 = await get('/veeqo/autolabel/low-value?status=open'), l3 = await get('/veeqo/autolabel/low-value?status=checked');
  check('…💸 Low value list: shows it to check; ✓ Price checked → who / when / what was done, moves to Checked',
    l1.rows.some(x => x.order_number === 'LV-1' && x.items[0].sku === '9-9-9=1') && c1.ok && !l2.rows.some(x => x.order_number === 'LV-1')
    && l3.rows.some(x => x.order_number === 'LV-1' && x.note === 'raised to $7.99' && x.checked_by && x.checked_at), { c1, l3: l3.rows });
  const { readFileSync } = await import('node:fs');
  const ph = readFileSync(fileURLToPath(new URL('../packship.html', import.meta.url)), 'utf8');
  check('…Last run: 💸 Low value rows have a ☐ (Select all includes them) and are sent as "low value, OK to buy"',
    /var _PS_AL_BUYABLE = \{ would_buy: 1, ready: 1, low_value: 1 \};/.test(ph) && /allowLow: !!c\.dataset\.low/.test(ph) && /id="ps-al-lowvalue"/.test(ph), null);
  globalThis.fetch = realFetch; delete env.VEEQO_API_KEY;
}

// Owner: "Packing and Picking somehow don't show the whole order now — with more than 1 item it sometimes shows only 1,
// I have to scan a second time to see all" + "the Label Printer box — make sure everyone can use it".
console.log('\nPicking / Packing: a scan shows the WHOLE order (never just part of it); Label Printer for everyone');
{
  const realFetch = globalThis.fetch;
  const sell = (id, sku, bin) => ({ id, sku_code: sku, stock_entries: [{ location: bin }] });
  const full = [{ id: 1, quantity: 2, sellable: sell(1, '1=ELBOW', '24-5-5') }, { id: 2, quantity: 3, sellable: sell(2, '2=TEE', '23-2-3') }];
  // Veeqo's package view lists only the first item (one box for the whole order).
  const ord = t => ({ id: 77001, number: 'W-1', channel: { name: 'eBay' }, deliver_to: { first_name: 'A', last_name: 'B' }, line_items: full,
    allocations: [{ id: 5001, line_items: [{ id: 1, quantity: 2, sellable: sell(1, '1=ELBOW', '24-5-5'), warehouse_sublocation: { location: '24-5-5' } }],
      shipment: { id: 9, tracking_number: { tracking_number: t } } }] });
  globalThis.fetch = async (u) => { u = String(u); const J = x => new Response(JSON.stringify(x), { headers: { 'Content-Type': 'application/json' } });
    if (u.includes('api.veeqo.com/orders?')) { const q = decodeURIComponent((u.match(/query=([^&]+)/) || [])[1] || ''); return J(/^9400WHOLE/.test(q) ? [ord(q)] : []); }
    if (u.includes('api.veeqo.com/')) return J([]);
    return realFetch(u); };
  env.VEEQO_API_KEY = 'k';
  const qty = items => (items || []).reduce((n, i) => n + (+i.q || 0), 0);
  // 1) No saved copy yet → Veeqo look-up: the whole order (2 + 3 = 5), not just the 1 item in the package view.
  const s1 = await post('/ship/pick', { tracking: '9400WHOLE0001', initials: 'TS' });
  check('first scan (nothing saved yet): all items of the order show — ELBOW ×2 + TEE ×3 = 5, not just 1 item', s1.lineItems?.length === 2 && qty(s1.lineItems) === 5, s1.lineItems);
  // 2) A copy saved earlier with only part of the order → the scan's look-up upgrades it; a re-check shows all.
  sq.prepare('INSERT INTO ship_manifest_log (date, tracking, line_items, uploaded_by) VALUES (?,?,?,?)').run(nyToday, '9400WHOLE0002', JSON.stringify([{ s: '1=ELBOW', q: 2, b: '24-5-5' }]), 'veeqo-sync');
  await post('/ship/scan', { tracking: '9400WHOLE0002', initials: 'TS' });
  await new Promise(r => setTimeout(r, 300));
  const saved = JSON.parse(sq.prepare("SELECT line_items FROM ship_manifest_log WHERE tracking = '9400WHOLE0002'").get().line_items);
  const lk = await get('/ship/order-lookup?q=9400WHOLE0002&days=7');
  check('…a copy saved with only part of the order is upgraded to the whole order (2 + 3 = 5), so the re-check shows all', qty(saved) === 5 && saved.length === 2 && qty(lk.results?.[0]?.lineItems) === 5
    && saved.find(i => i.s === '1=ELBOW')?.b === '24-5-5', saved);
  // 3) Never downgraded: a fuller saved copy stays.
  sq.prepare('INSERT INTO ship_manifest_log (date, tracking, line_items, uploaded_by) VALUES (?,?,?,?)').run(nyToday, '9400WHOLE0003', JSON.stringify([{ s: '1=ELBOW', q: 2, b: '24-5-5' }, { s: '2=TEE', q: 3, b: '23-2-3' }, { s: '5=CAP', q: 1, b: '9-9-9' }]), 'autolabel-merge');
  const s3 = await post('/ship/scan', { tracking: '9400WHOLE0003', initials: 'TS' });
  await new Promise(r => setTimeout(r, 300));
  check('…a fuller saved list (e.g. a 🧩 merged box) is never cut down to a shorter one', qty(s3.lineItems) === 6 && qty(JSON.parse(sq.prepare("SELECT line_items FROM ship_manifest_log WHERE tracking = '9400WHOLE0003'").get().line_items)) === 6, s3.lineItems);
  globalThis.fetch = realFetch; delete env.VEEQO_API_KEY;
  const { readFileSync } = await import('node:fs');
  const rd = f => readFileSync(fileURLToPath(new URL('../' + f, import.meta.url)), 'utf8');
  const ph = rd('packship.html');
  check('…Picking and Packing look again a few seconds after a scan and show the extra items (same label still on screen)',
    /_psRenderScanProduct\(tracking, data\.lineItems\);\s*_psRecheckItems\(tracking, data\.lineItems, 'pack'\);/.test(ph)
    && /_psRenderPickProduct\(tracking, data\.lineItems, data\.orderNum\);\s*_psRecheckItems\(tracking, data\.lineItems, 'pick', data\.orderNum\);/.test(ph), null);
  const ix = rd('index.html'), lp = rd('labelprint.html'), xa = rd('xf-access.js');
  const wh = ix.slice(ix.indexOf('🏭 Warehouse</div>'), ix.indexOf('⚡ Operator</div>'));
  check('Label Printer: its card is in the 🏭 Warehouse group everyone sees (not the managers-only row), and any signed-in account can open it',
    /labelprint\.html/.test(wh) && !/labelprint\.html/.test(ix.slice(ix.indexOf('⚡ Operator</div>'))) && !/does not have access to Label Printer/.test(lp)
    && /key: 'labelprint', file: 'labelprint\.html', name: '🏷️ Label Printer', needs: 'any sign-in'/.test(xa), null);
}

// Owner: "Print Label — the barcode comes out to the left, put it in the center; and let us pick how many labels to print".
console.log('\nLabel Printer: barcode in the center of the label; pick how many to print');
{
  const { readFileSync } = await import('node:fs');
  const lp = readFileSync(fileURLToPath(new URL('../labelprint.html', import.meta.url)), 'utf8');
  const grab = re => (lp.match(re) || [''])[0];
  const src = grab(/function lpBarcodeLayout\(val, s\) \{[\s\S]*?\n  \}/) + '\n' + grab(/function lpGenZPL\(loc, copies\) \{[\s\S]*?\n  \}/);
  const S = { width: 406, height: 203, textSize: 24, textY: 6, barHeight: 100, barY: 36, barShift: 0, darkness: 10 };
  const gen = new Function('lpGetSettings', src + '; return { lpGenZPL, lpBarcodeLayout };')(() => S);
  const z = gen.lpGenZPL('BARN=1-1-2-1', 3);
  const fo = z.match(/\^FO(\d+),\d+\^BY(\d)/), w = (11 * 'BARN=1-1-2-1'.length + 35) * 2;
  check('a location barcode sits in the middle: same space left and right (406-dot label, 334-dot barcode → starts at 36)',
    fo && +fo[1] === 36 && +fo[2] === 2 && Math.abs(+fo[1] - (406 - (+fo[1] + w))) <= 1, { fo, w });
  const long = 'BACKROOM=12-34-56-78';
  const z2 = gen.lpGenZPL(long, 1), fo2 = z2.match(/\^FO(\d+),\d+\^BY(\d)/), w2 = (11 * long.length + 35) * +fo2[2];
  check('…a long location still fits on the label, centered (thinner bars instead of running off the edge)', +fo2[1] + w2 <= 406 && Math.abs(+fo2[1] - (406 - (+fo2[1] + w2))) <= 1, { fo2, w2 });
  check('…"How many": 3 → the printer makes 3 of that label (^PQ3); default 1', /\^PQ3\n\^XZ/.test(z) && /\^PQ1\n\^XZ/.test(gen.lpGenZPL('A=1-1-1')), z);
  check('…a How many box (− / + / 1·2·5·10) on Print Single Label and on Print Selected Labels',
    /id="lp-single-copies"/.test(lp) && /id="lp-print-copies"/.test(lp) && /var n = lpCopies\('lp-single-copies'\);\s*var zpl = lpGenZPL\(loc, n\);/.test(lp) && /var n = lpCopies\('lp-print-copies'\);/.test(lp), null);
}

// Owner: "Last run — as soon as we purchase it shows purchased, but after a refresh it goes back to Would buy / Low value and
// looks like I can buy it again, until Run preview now. Once purchased it should stay purchased, except one that wasn't purchased".
console.log('\nAuto Label → Last run: a purchased label stays "Purchased" after a refresh; a failed one stays to buy');
{
  const t0 = new Date(Date.now() - 3600e3).toISOString();
  sq.prepare("INSERT INTO app_config (key, value) VALUES ('autolabel_last_run', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(JSON.stringify({ startedAt: t0, counts: { would_buy: 2, low_value: 1 }, orders: [
      { number: 'P-1', decision: 'would_buy', price: 5.1, reason: 'USPS preferred' },
      { number: 'P-2', decision: 'low_value', price: 4.8, reason: 'Label $4.80 vs order $5.00' },
      { number: 'P-3', decision: 'would_buy', price: 6.2, reason: 'USPS preferred' }] }));
  const lg = (num, action, tracking, ts) => sq.prepare("INSERT INTO autolabel_log (ts, date, order_number, action, carrier, service, price, tracking) VALUES (?,?,?,?,?,?,?,?)")
    .run(ts || new Date().toISOString(), nyToday, num, action, 'USPS', 'Ground Advantage', action === 'bought' ? 5.1 : null, tracking || '');
  lg('P-1', 'bought', '9400P1'); lg('P-2', 'bought', '9400P2'); lg('P-3', 'buy_failed');
  lg('P-3', 'bought', 'OLD', new Date(Date.now() - 2 * 3600e3).toISOString()); // bought before this run → not counted for it
  const c = await get('/veeqo/autolabel/config');
  const R = n => c.lastRun.orders.find(o => o.number === n);
  check('bought by hand (Would buy and Low value) → still ✅ Bought with its tracking after a refresh, no tick box to buy again',
    R('P-1').decision === 'bought' && R('P-1').tracking === '9400P1' && R('P-2').decision === 'bought' && R('P-2').tracking === '9400P2' && /Purchased/.test(R('P-1').reason), [R('P-1'), R('P-2')]);
  check('…a buy that failed stays as it was (Would buy), and the chips count right (Bought 2, Would buy 1, Low value 0)',
    R('P-3').decision === 'would_buy' && c.lastRun.counts.bought === 2 && c.lastRun.counts.would_buy === 1 && !c.lastRun.counts.low_value, c.lastRun.counts);
}

// Owner: "order over 20 lb — 100 pcs ½ pex ball valve = 26 lb, we split it into 2 boxes of 50 (13 lb each), sometimes 3 boxes
// (33 + 33 + 34 pieces), 3 × 100 angle valve → 3 boxes, a label for each box; the pieces must match the customer's order".
console.log('\nAuto Label → ✂️ over 20 lb: split into boxes in Veeqo (pieces add up), a label for each box');
{
  const realFetch = globalThis.fetch; const shipments = [];
  let nextAlloc = 9100, refuseNew = false;
  const pkg = () => ({ weight: 16, weight_unit: 'oz', depth: 12, width: 10, height: 8, dimensions_unit: 'inches' });
  const sell = (id, sku, g) => ({ id, sku_code: sku, weight_grams: g, product_title: 'T ' + sku, stock_entries: [{ warehouse_id: 55, location: '30-3-4' }] });
  const mk = (id, number, s, qty, aid) => ({ id, number, channel: { name: 'eBay', type_code: 'ebay' }, total_price: 400, created_at: new Date(Date.now() - 864e5).toISOString(),
    deliver_to: { first_name: 'S', last_name: number, address1: number + ' Rd', zip: '10001' }, line_items: [{ quantity: qty, sellable: s }],
    allocations: [{ id: aid, warehouse: { id: 55 }, line_items: [{ quantity: qty, sellable: s }], allocation_package: pkg(), shipment: null }] });
  const orders = [
    mk(8101, 'SP-2', sell(901, '50=1/2XB(make sure)', 5896.7), 2, 7101),   // 2 × 50 pcs, 13 lb each = 26 lb → 2 boxes
    mk(8103, 'SP-3', sell(903, '1=1/2 BALL(match)', 186), 100, 7103),       // 100 × 0.41 lb = 41 lb → 3 boxes 33/33/34
    mk(8104, 'SP-A', sell(904, '100=ANGLE', 6804), 3, 7104),                // 3 × 100 pcs, 15 lb each = 45 lb → 3 boxes
    mk(8105, 'SP-X', sell(905, '100=BIG', 11793), 1, 7105),                 // 1 × 100 pcs = 26 lb in ONE unit → can't split in Veeqo
  ];
  const ordOf = id => orders.find(o => String(o.id) === String(id));
  globalThis.fetch = async (u, o) => { u = String(u); const m = (o && o.method) || 'GET'; const J = (x, st) => new Response(JSON.stringify(x), { status: st || 200, headers: { 'Content-Type': 'application/json' } });
    const body = o && o.body ? JSON.parse(o.body) : null; let mm;
    if (u.includes('api.veeqo.com/orders?')) { if (/status=cancelled/.test(u)) return J([]); const q = decodeURIComponent((u.match(/query=([^&]+)/) || [])[1] || '');
      const open = x => !(x.allocations || []).every(a => a.shipment); const list = q ? orders.filter(x => x.number === q) : orders; return J(/status=awaiting/.test(u) ? list.filter(open) : list); }
    if ((mm = u.match(/api\.veeqo\.com\/orders\/(\d+)\/allocations\/(\d+)$/))) { const od = ordOf(mm[1]); const a = od.allocations.find(x => String(x.id) === mm[2]);
      if (m === 'DELETE') { od.allocations = od.allocations.filter(x => x !== a); return J({}); }
      const li = body.line_items_attributes; if (!li) return J({ error: 'line_items_attributes missing' }, 422);
      a.line_items = li.filter(x => x.quantity > 0).map(x => ({ quantity: x.quantity, sellable: od.line_items[0].sellable })); return J({ id: a.id }); }
    if ((mm = u.match(/api\.veeqo\.com\/orders\/(\d+)\/allocations$/)) && m === 'POST' && refuseNew) return J({ error: 'refused' }, 422);
    if ((mm = u.match(/api\.veeqo\.com\/orders\/(\d+)\/allocations$/)) && m === 'POST') { const od = ordOf(mm[1]);
      const a = { id: nextAlloc++, warehouse: { id: body.allocation.warehouse_id }, line_items: body.allocation.line_items_attributes.map(x => ({ quantity: x.quantity, sellable: od.line_items[0].sellable })), allocation_package: {}, shipment: null };
      od.allocations.push(a); return J(a, 201); }
    if ((mm = u.match(/api\.veeqo\.com\/allocations\/(\d+)\/allocation_package$/))) { for (const od of orders) for (const a of od.allocations) if (String(a.id) === mm[1]) Object.assign(a.allocation_package, body.allocation_package); return J({}); }
    if (u.includes('/shipping/quotes/amazon_shipping_v2')) return J([{ title: 'USPS Ground Advantage', name: 'usps-ga', carrier: 'usps', total_net_charge: 9.5, transit_days: 3 }]);
    if (u.includes('api.veeqo.com/shipping/shipments') && m === 'POST') { const aid = body.shipment.allocation_id; shipments.push(aid);
      for (const od of orders) for (const a of od.allocations) if (a.id === aid) a.shipment = { id: aid, tracking_number: { tracking_number: 'SPL' + aid } }; return J({ id: aid, tracking_number: { tracking_number: 'SPL' + aid } }); }
    if (u.includes('api.veeqo.com/')) return J([]);
    return new Response('{}', { status: 401 }); };
  env.VEEQO_API_KEY = 'k';
  await post('/veeqo/autolabel/config', { config: { mode: 'preview', maxBoxLb: 20 } });
  const run = await post('/veeqo/autolabel/run', {});
  const R = n => run.orders.find(x => x.number === n) || {};
  const pcs = b => b.lines.reduce((n, l) => n + l.pieces, 0);
  check('26 lb (2 × "50=1/2XB(make sure)") → ✂️ split into 2 boxes: 50 + 50 pcs, 13 lb each',
    R('SP-2').decision === 'split' && R('SP-2').splitBoxes.length === 2 && R('SP-2').splitBoxes.map(pcs).join('+') === '50+50' && R('SP-2').splitBoxes.every(b => b.lb === 13), R('SP-2'));
  check('…41 lb (100 × "1=…(match)") → 3 boxes: 33 + 33 + 34 pcs, each under 20 lb', R('SP-3').splitBoxes?.map(pcs).join('+') === '33+33+34' && R('SP-3').splitBoxes.every(b => b.lb <= 20), R('SP-3').splitBoxes);
  check('…3 × 100 angle valve (45 lb) → 3 boxes of 100 pcs', R('SP-A').splitBoxes?.map(pcs).join('+') === '100+100+100', R('SP-A').splitBoxes);
  check('…one 100-pc unit of 26 lb can\'t be split in Veeqo → stays ⚖️ by hand, says why', R('SP-X').decision === 'weigh' && /can't split: one 100=BIG alone weighs/.test(R('SP-X').reason), R('SP-X').reason);
  const s3 = await post('/veeqo/autolabel/split', { order: 'SP-3' });
  const al = ordOf(8103).allocations, qs = al.map(a => a.line_items.reduce((n, li) => n + li.quantity, 0));
  // Inventory check: the 3 boxes in Veeqo hold exactly the 100 ordered — nothing twice, nothing dropped.
  check('✂️ Split → Veeqo now has 3 boxes of 33 + 33 + 34 = 100 pcs (exactly the order), each box weighed (under 20 lb), on record',
    s3.ok && al.length === 3 && qs.join('+') === '33+33+34' && qs.reduce((a, b) => a + b, 0) === 100 && al.every(a => parseFloat(a.allocation_package.weight) / 16 <= 20 && parseFloat(a.allocation_package.weight) > 0)
    && sq.prepare("SELECT status FROM autolabel_split WHERE order_number = 'SP-3'").get()?.status === 'done' && sq.prepare("SELECT value FROM app_config WHERE key = 'autolabel_split_verified'").get()?.value === 'yes', { s3, qs });
  const b3 = await post('/veeqo/autolabel/buy-one', { order: 'SP-3' });
  check('…then 🖨 Buy & print → a label for EACH box (3 labels, 3 tracking #s), each box\'s own items on its label',
    b3.ok && b3.labels.length === 3 && new Set(b3.labels.map(l => l.tracking)).size === 3
    && sq.prepare("SELECT items FROM label_print_queue WHERE order_number = 'SP-3'").all().map(r => JSON.parse(r.items)[0].qty).sort().join('+') === '33+33+34', b3);
  refuseNew = true;
  const f2 = await post('/veeqo/autolabel/split', { order: 'SP-2' });
  const al2 = ordOf(8101).allocations;
  check('…Veeqo refuses box 2 → put back as ONE box with all 2 × 50 (nothing lost), said plainly, on record', f2.ok === false && al2.length === 1
    && al2[0].line_items.reduce((n, li) => n + li.quantity, 0) === 2 && /put back as one box/.test(f2.error) && sq.prepare("SELECT status FROM autolabel_split WHERE order_number = 'SP-2'").get()?.status === 'failed', { f2, al2 });
  refuseNew = false;
  const again = await post('/veeqo/autolabel/split', { order: 'SP-3' });
  check('…never split twice (already in 3 boxes)', again.ok === false, again);
  const { readFileSync } = await import('node:fs');
  const ph = readFileSync(fileURLToPath(new URL('../packship.html', import.meta.url)), 'utf8');
  check('…Last run: ✂️ Split into N boxes button with each box\'s pieces; ❓ No rate rows have 💲 Why? (every rate Veeqo gave)',
    /onclick="psAlSplit\(this, /.test(ph) && /_psAlSplitBoxesHtml\(o\.splitBoxes, o\.number\)/.test(ph) && /onclick="psAlRateWhy\(this, /.test(ph), null);
  await post('/veeqo/autolabel/config', { config: { mode: 'off' } });
  globalThis.fetch = realFetch; delete env.VEEQO_API_KEY;
}

// Owner: "Monday–Friday after 3:50 pm, no more half-hour waiting — print as soon as an order comes in, until 5 pm;
// Saturday 1 pm to 2:15 pm; after that back to the half-hour wait".
console.log('\nAuto Label → no-wait times: Mon–Fri 3:50–5 pm, Sat 1–2:15 pm (New York) print right away');
{
  const { readFileSync } = await import('node:fs');
  const ws = readFileSync(workerPath, 'utf8');
  const grab = n => (ws.match(new RegExp('function ' + n + '\\([\\s\\S]*?\\n}')) || [''])[0];
  const f = new Function("const AUTOLABEL_DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];" + ['autolabelNoWaitParse', 'autolabelNoWaitText', 'autolabelNoWaitClean', 'autolabelNoWaitNow'].map(grab).join('\n') + '; return { autolabelNoWaitNow, autolabelNoWaitClean };')();
  const cfg = { noWaitTimes: 'Mon-Fri 15:50-17:00; Sat 13:00-14:15' };
  const at = t => !!f.autolabelNoWaitNow(cfg, new Date(t));
  check('Mon 3:50 pm → no wait; 3:49 pm → wait; 4:59 pm → no wait; 5:00 pm → wait (New York, summer time)',
    at('2026-10-05T19:50:00Z') && !at('2026-10-05T19:49:00Z') && at('2026-10-05T20:59:00Z') && !at('2026-10-05T21:00:00Z'), null);
  check('…Fri 4 pm no wait; Sat 1:00–2:14 pm no wait, 2:15 pm and 12:59 pm wait; Sunday always waits; winter time too (Dec Mon 3:55 pm)',
    at('2026-10-09T20:00:00Z') && at('2026-10-10T17:00:00Z') && at('2026-10-10T18:14:00Z') && !at('2026-10-10T18:15:00Z') && !at('2026-10-10T16:59:00Z')
    && !at('2026-10-11T20:00:00Z') && at('2026-12-07T20:55:00Z'), null);
  check('…the default is the owner\'s times, written the same way after a save', /noWaitTimes: 'Mon-Fri 15:50-17:00; Sat 13:00-14:15'/.test(ws) && f.autolabelNoWaitClean(' mon-fri 15:50-17:00 ;sat 13:00-14:15') === 'Mon-Fri 15:50-17:00; Sat 13:00-14:15', null);
  // A run inside a no-wait time: a 5-minute-old order is not held back; outside it, it waits.
  const realFetch = globalThis.fetch;
  const items = [{ quantity: 1, sellable: { id: 1201, sku_code: '1=NW', weight_grams: 100, stock_entries: [{ warehouse_id: 55, location: '1-1-1' }] } }];
  const ord = { id: 1201, number: 'NW-1', channel: { name: 'eBay', type_code: 'ebay' }, total_price: 50, created_at: new Date(Date.now() - 5 * 60e3).toISOString(),
    deliver_to: { first_name: 'N', last_name: 'W', address1: '1 NW St', zip: '10001' }, line_items: items, allocations: [{ id: 9201, line_items: items, shipment: null }] };
  globalThis.fetch = async (u) => { u = String(u); const J = x => new Response(JSON.stringify(x), { headers: { 'Content-Type': 'application/json' } });
    if (u.includes('api.veeqo.com/orders?')) return J(/status=cancelled/.test(u) ? [] : [ord]);
    if (u.includes('/shipping/quotes/amazon_shipping_v2')) return J([{ title: 'USPS Ground Advantage', name: 'usps-ga', carrier: 'usps', total_net_charge: 4.4, transit_days: 3 }]);
    if (u.includes('api.veeqo.com/')) return J([]);
    return new Response('{}', { status: 401 }); };
  env.VEEQO_API_KEY = 'k';
  await post('/veeqo/autolabel/config', { config: { mode: 'preview', noWaitTimes: 'Sun-Sat 0:00-24:00' } });
  const r1 = await post('/veeqo/autolabel/run', {});
  await post('/veeqo/autolabel/config', { config: { noWaitTimes: '' } });
  const r2 = await post('/veeqo/autolabel/run', {});
  const d = r => (r.orders.find(o => o.number === 'NW-1') || {}).decision;
  check('…a run in a no-wait time: a 5-min-old order is rate-checked right away (not ⏳ Waiting) and the run says so; outside it: ⏳ Waiting',
    d(r1) === 'would_buy' && (r1.notes || []).some(n => /No-wait time/.test(n)) && d(r2) === 'waiting', { r1: d(r1), r2: d(r2), notes: r1.notes });
  await post('/veeqo/autolabel/config', { config: { mode: 'off', noWaitTimes: 'Mon-Fri 15:50-17:00; Sat 13:00-14:15' } });
  globalThis.fetch = realFetch; delete env.VEEQO_API_KEY;
  const ph = readFileSync(fileURLToPath(new URL('../packship.html', import.meta.url)), 'utf8');
  check('…Rules: "No wait at these times (New York)" box, and the rules line says it in plain words', /data-k="noWaitTimes"/.test(ph) && /prints as soon as an order comes in/.test(ph), null);
}

// Owner: "click each box to fix its size and weight — Veeqo's weight is sometimes wrong. 100 pcs 3/8 pex angle: system 20 lb,
// we weighed 19.98 lb. Once confirmed, the next 100 pcs 3/8 pex angle always uses 19.98 lb, whatever Veeqo says, until we edit it".
console.log('\nAuto Label → 📦 confirmed box weight + size: same SKU × quantity always uses it, whatever Veeqo says');
{
  const realFetch = globalThis.fetch; const quotedAt = [];
  const sell = (id, sku, g) => ({ id, sku_code: sku, weight_grams: g, product_title: 'T ' + sku, stock_entries: [{ warehouse_id: 55, location: '41-1-1' }] });
  const mk = (id, number, s, qty, aid) => ({ id, number, channel: { name: 'eBay', type_code: 'ebay' }, total_price: 300, created_at: new Date(Date.now() - 864e5).toISOString(),
    deliver_to: { first_name: 'C', last_name: number, address1: number + ' Ave', zip: '10001' }, line_items: [{ quantity: qty, sellable: s }],
    allocations: [{ id: aid, warehouse: { id: 55 }, line_items: [{ quantity: qty, sellable: s }], allocation_package: { weight: 328, weight_unit: 'oz', depth: 14, width: 12, height: 10, dimensions_unit: 'inches' }, shipment: null }] });
  const ANG = sell(1301, '100=3/8 ANGLE', 9298.6);   // system: 20.5 lb for 100 pcs (one unit — can't split)
  const orders = [mk(8301, 'CB-1', ANG, 1, 7301), mk(8302, 'CB-2', ANG, 1, 7302), mk(8303, 'CB-3', ANG, 2, 7303)];
  const allocOf = id => orders.flatMap(o => o.allocations).find(a => String(a.id) === String(id));
  globalThis.fetch = async (u, o) => { u = String(u); const m = (o && o.method) || 'GET'; const J = (x, st) => new Response(JSON.stringify(x), { status: st || 200, headers: { 'Content-Type': 'application/json' } });
    const body = o && o.body ? JSON.parse(o.body) : null; let mm;
    if (u.includes('api.veeqo.com/orders?')) { if (/status=cancelled/.test(u)) return J([]); const q = decodeURIComponent((u.match(/query=([^&]+)/) || [])[1] || ''); return J(q ? orders.filter(x => x.number === q) : orders); }
    if ((mm = u.match(/api\.veeqo\.com\/allocations\/(\d+)\/allocation_package$/)) && m === 'PUT') { Object.assign(allocOf(mm[1]).allocation_package, body.allocation_package); return J({}); }
    if ((mm = u.match(/shipping\/quotes\/amazon_shipping_v2\?allocation_id=(\d+)/))) { const p = allocOf(mm[1]).allocation_package; quotedAt.push({ alloc: +mm[1], oz: +p.weight, dims: [p.depth, p.width, p.height].join('x') });
      return J([{ title: 'USPS Ground Advantage', name: 'usps-ga', carrier: 'usps', total_net_charge: Math.round((5 + p.weight / 16) * 100) / 100, transit_days: 3 }]); }
    if (u.includes('api.veeqo.com/')) return J([]);
    return new Response('{}', { status: 401 }); };
  env.VEEQO_API_KEY = 'k';
  await post('/veeqo/autolabel/config', { config: { mode: 'preview', maxBoxLb: 20, noWaitTimes: '' } });
  const run1 = await post('/veeqo/autolabel/run', {});
  const D = (r, n) => r.orders.find(x => x.number === n) || {};
  check('before: Veeqo/system says 20.5 lb for 100 pcs 3/8 pex angle → over 20 lb, held', D(run1, 'CB-1').decision === 'weigh', D(run1, 'CB-1').reason);
  const c1 = await post('/veeqo/autolabel/box-confirm', { order: 'CB-1', lines: [{ sku: '100=3/8 ANGLE', qty: 1 }], weightLb: 19.98, lengthIn: 12, widthIn: 10, heightIn: 8, systemLb: 20.5 });
  const r1 = await post('/veeqo/autolabel/rate-one', { order: 'CB-1' });
  check('✏️ weighed 19.98 lb, 12×10×8 in, saved → the order is 👀 Would buy, rated at 19.98 lb (Veeqo box set to 319.68 oz, 12×10×8 before the rate)',
    c1.ok && r1.decision === 'would_buy' && r1.confirmed?.lb === 19.98 && quotedAt.some(q => q.alloc === 7301 && q.oz === 319.68 && q.dims === '12x10x8'), { r1, quotedAt });
  quotedAt.length = 0;
  const run2 = await post('/veeqo/autolabel/run', {});
  check('…the NEXT order of 100 pcs 3/8 pex angle uses 19.98 lb too, whatever Veeqo says (its box is set before the rate)',
    D(run2, 'CB-2').decision === 'would_buy' && D(run2, 'CB-2').confirmed?.lb === 19.98 && quotedAt.some(q => q.alloc === 7302 && q.oz === 319.68), { d: D(run2, 'CB-2'), quotedAt });
  check('…a different quantity (2 × 100 pcs) is not that box — the system weight is used for it', !D(run2, 'CB-3').confirmed && D(run2, 'CB-3').decision !== 'would_buy', D(run2, 'CB-3'));
  const lg = sq.prepare("SELECT before_val, after_val, order_number, by_user FROM box_weight_log WHERE box_key = '100=3/8 ANGLE×1' ORDER BY id").all();
  check('…on record: who, when, before → after (system 20.5 lb → 19.98 lb · 12×10×8 in), from which order', lg.length === 1 && /20\.5/.test(lg[0].before_val) && /19\.98 lb · 12×10×8 in/.test(lg[0].after_val) && lg[0].order_number === 'CB-1' && !!lg[0].by_user, lg);
  // A split box: 2 × 50 pcs → each box "50=… × 1"; weighed 12.5 lb → the plan uses 12.5 lb.
  orders.push(mk(8304, 'CB-S', sell(1302, '50=1/2XB(make sure)', 5896.7), 2, 7304));
  await post('/veeqo/autolabel/box-confirm', { order: 'CB-S', lines: [{ sku: '50=1/2XB(make sure)', qty: 1 }], weightLb: 12.5 });
  const rs = await post('/veeqo/autolabel/rate-one', { order: 'CB-S' });
  check('…✂️ split boxes use their confirmed weight too (box of 1 × 50=… weighed 12.5 lb → both boxes 12.5 lb ✅)',
    rs.decision === 'split' && rs.splitBoxes.length === 2 && rs.splitBoxes.every(b => b.lb === 12.5 && b.confirmed && b.systemLb === 13), rs.splitBoxes);
  const rm = await post('/veeqo/autolabel/box-confirm', { order: 'CB-1', lines: [{ sku: '100=3/8 ANGLE', qty: 1 }], remove: true });
  const r3 = await post('/veeqo/autolabel/rate-one', { order: 'CB-2' });
  check('…"Stop using it" → back to the system weight (held again), and that is on record too', rm.ok && r3.decision === 'weigh' && !r3.confirmed
    && sq.prepare("SELECT after_val FROM box_weight_log WHERE box_key = '100=3/8 ANGLE×1' ORDER BY id DESC").get()?.after_val === 'removed', r3);
  check('…bad input refused: no weight, or only part of the size', !(await post('/veeqo/autolabel/box-confirm', { lines: [{ sku: 'X', qty: 1 }], weightLb: 0 })).ok
    && !(await post('/veeqo/autolabel/box-confirm', { lines: [{ sku: 'X', qty: 1 }], weightLb: 3, lengthIn: 5 })).ok, null);
  await post('/veeqo/autolabel/config', { config: { mode: 'off', noWaitTimes: 'Mon-Fri 15:50-17:00; Sat 13:00-14:15' } });
  globalThis.fetch = realFetch; delete env.VEEQO_API_KEY;
  const { readFileSync } = await import('node:fs');
  const ph = readFileSync(fileURLToPath(new URL('../packship.html', import.meta.url)), 'utf8');
  check('…Last run: ✏️ on each ✂️ box and ✏️ Box on a one-box order; a confirmed box shows ✅; list of confirmed boxes in the Re-weigh card',
    /onclick="psAlBoxEdit\(\\'' \+ n \+ '\\',' \+ i \+ '\)"/.test(ph) && /psAlBoxEdit\(\\'' \+ e\(String\(o\.number/.test(ph) && /lb confirmed/.test(ph) && /id="ps-al-boxes"/.test(ph), null);
}

// Owner: "purchase time, and able to click or search on the order to reprint the label or packing slip".
console.log('\nAuto Label → purchase time on bought rows; find an order (order # / tracking / customer) → reprint label or slip');
{
  const lf = await get('/veeqo/autolabel/labels?q=E-77'), lt = await get('/veeqo/autolabel/labels?q=9400777');
  const sf = await get('/veeqo/autolabel/slips?q=E-77'), sc = await get('/veeqo/autolabel/slips?q=bo li');
  check('🔎 find by order # or by tracking (scanned label) → that order\'s labels, printed or not, any day',
    lf.labels.length >= 1 && lf.labels.every(l => l.order_number === 'E-77') && lt.labels.some(l => l.tracking === '9400777' && l.order_number === 'E-77') && !!lf.labels[0].printed_at, { lf: lf.labels.length, lt: lt.labels.length });
  check('…its packing slips too, also by the customer\'s name', sf.slips.some(x => x.orderNumber === 'E-77') && sc.slips.some(x => x.orderNumber === 'E-77'), { sf: sf.slips.length, sc: sc.slips.length });
  const t0 = new Date(Date.now() - 3600e3).toISOString(), bt = new Date(Date.now() - 600e3).toISOString();
  sq.prepare("INSERT INTO app_config (key, value) VALUES ('autolabel_last_run', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(JSON.stringify({ startedAt: t0, counts: { would_buy: 1 }, orders: [{ number: 'T-9', decision: 'would_buy', price: 5 }] }));
  sq.prepare("INSERT INTO autolabel_log (ts, date, order_number, action, carrier, service, price, tracking) VALUES (?,?,?,?,?,?,?,?)").run(bt, nyToday, 'T-9', 'bought', 'USPS', 'GA', 5, '9400T9');
  const c = await get('/veeqo/autolabel/config'), r = c.lastRun.orders.find(o => o.number === 'T-9');
  check('…a bought row carries its purchase time (from the label record)', r.decision === 'bought' && r.boughtAt === bt, r);
  const { readFileSync } = await import('node:fs');
  const ph = readFileSync(fileURLToPath(new URL('../packship.html', import.meta.url)), 'utf8');
  check('…Last run: bought rows show 🕘 Bought time + 🖨 Label / 🧾 Slip; Shipping labels has the 🔎 find box with Reprint label / Reprint slip',
    /_psAlEsc\(label\) \+ _psAlBoughtTag\(o\)/.test(ph) && /🕘 Bought/.test(ph) && /onclick="psAlReprintFor\(this, \\'' \+ n \+ '\\', \\'slip\\'\)"/.test(ph)
    && /id="ps-al-find"[^>]*oninput="psAlFind\(this\.value\)"/.test(ph) && /🧾 Reprint slip/.test(ph), null);
}

// Owner: "auto print the Veeqo scan form for USPS Monday–Friday at 4:30 pm and Saturday at 1:45 pm, and check every night
// that we printed the scan form before the cut-off".
console.log('\nAuto Label → 📄 USPS scan form: Mon–Fri 4:30 pm, Sat 1:45 pm, night check before 9 pm; printed + on record');
{
  const realFetch = globalThis.fetch; let made = 0, refuse = false; env.TEST_CLOCK = true;
  globalThis.fetch = async (u, o) => { u = String(u); const m = (o && o.method) || 'GET'; const J = (x, st) => new Response(JSON.stringify(x), { status: st || 200, headers: { 'Content-Type': 'application/json' } });
    if (u.endsWith('api.veeqo.com/shipping/api/v1/scan_forms') && m === 'POST') { if (refuse) return J({ error: 'nope' }, 404);
      if (JSON.parse(o.body).carrier !== 'usps') return J({ error: 'No shipments to manifest for this carrier' }, 422); made++; return J({ id: 550 + made, shipments: [1, 2, 3], document_url: 'https://forms.example/sf' + made + '.pdf' }); }
    if (u.startsWith('https://forms.example/')) return new Response('%PDF-1.4 scan form', { headers: { 'Content-Type': 'application/pdf' } });
    if (u.includes('api.veeqo.com/')) return J({ error: 'not found' }, 404);
    return new Response('{}', { status: 401 }); };
  env.VEEQO_API_KEY = 'k';
  await post('/veeqo/autolabel/config', { config: { scanFormOn: true, scanFormTimes: 'Mon-Fri 16:30; Sat 13:45', scanFormCheckAt: '20:30' } });
  const tick = at => post('/veeqo/autolabel/scanform-tick', { at });
  const rows = () => sq.prepare('SELECT * FROM scan_form_log ORDER BY id').all();
  // Tue Oct 6 2026, 4:31 pm New York — not unlocked yet → nothing goes to Veeqo, on record why.
  await tick('2026-10-06T20:31:00Z'); await tick('2026-10-06T20:40:00Z');
  check('4:30 pm on a weekday, not unlocked yet → no form, a 🔒 line says to make one by hand first (once, not every minute)',
    made === 0 && rows().filter(r => r.slot === '2026-10-06 16:30').length === 1 && rows().find(r => r.slot === '2026-10-06 16:30').kind === 'locked', rows());
  const h = await post('/veeqo/autolabel/scanform-make', {});
  check('📄 Make scan form now (by hand) → Veeqo makes it (3 packages), on record, and that unlocks the times', h.ok && made === 1 && h.shipments === 3
    && sq.prepare("SELECT value FROM app_config WHERE key = 'autolabel_scanform_verified'").get()?.value === 'yes', h);
  await tick('2026-10-07T20:15:00Z');
  const before = made; await tick('2026-10-07T20:31:00Z'); await tick('2026-10-07T20:50:00Z');
  check('…Wed 4:15 pm nothing; 4:31 pm → the scan form is made by itself, once (not again at 4:50)', made === before + 1 && rows().filter(r => r.slot === '2026-10-07 16:30' && r.ok === 1 && r.kind === 'scheduled').length === 1, rows().slice(-2));
  const b2 = made; await tick('2026-10-10T17:46:00Z'); await tick('2026-10-11T20:31:00Z');
  // Owner, later: Sunday has one scan form at 8:50 pm (not in this test's times) — Sunday 4:31 pm: nothing.
  check('…Saturday 1:46 pm → made; Sunday 4:31 pm nothing (not a set time on Sunday)', made === b2 + 1 && rows().some(r => r.slot === '2026-10-10 13:45' && r.ok === 1) && !rows().some(r => r.day === '2026-10-11' && r.kind === 'scheduled'), rows().slice(-2));
  // Night check, Thu Oct 8: a USPS label bought at 5:10 pm (after the 4:30 form) → one more form before 9 pm.
  await tick('2026-10-08T20:31:00Z');
  sq.prepare("INSERT INTO autolabel_log (ts, date, order_number, action, carrier, service, price, tracking) VALUES (?,?,?,?,?,?,?,?)").run('2026-10-08T21:10:00.000Z', '2026-10-08', 'LATE-1', 'bought', 'USPS', 'GA', 5, '9400LATE');
  const b3 = made; await tick('2026-10-09T00:20:00Z'); await tick('2026-10-09T00:35:00Z'); await tick('2026-10-09T00:50:00Z');
  check('🌙 night check 8:30 pm: a USPS label came after the 4:30 form → one more form made (once), before the 9 pm cut-off',
    made === b3 + 1 && rows().filter(r => r.slot === '2026-10-08 night' && r.kind === 'night' && r.ok === 1).length === 1, rows().slice(-2));
  await tick('2026-10-07T00:35:00Z'); // Tue Oct 6, 8:35 pm: the only labels were before the hand-made form → nothing missing
  check('…a night with every USPS label on a form → "✅ all on a form" on record, no extra form', rows().some(r => r.slot === '2026-10-06 night' && r.kind === 'night_ok'), rows().filter(r => /night/.test(r.slot)));
  const id = rows().find(r => r.slot === '2026-10-07 16:30').id;
  const f = await call('/veeqo/autolabel/scanform-file?id=' + id, { headers: H });
  const pr = await post('/veeqo/autolabel/scanform-printed', { id });
  check('…the 📄 Scan form station gets the PDF and prints it — printed (who / when) on record', f.status === 200 && /pdf/.test(f.headers.get('content-type')) && /%PDF/.test(await f.text())
    && pr.ok && !!sq.prepare('SELECT printed_at FROM scan_form_log WHERE id = ?').get(id).printed_at, f.status);
  refuse = true; const bad = await post('/veeqo/autolabel/scanform-make', {});
  check('…Veeqo won\'t make it → said plainly (make it in Veeqo: Settings → USPS Scan Forms) with what each address answered, on record', bad.ok === false && /Settings → USPS Scan Forms/.test(bad.error) && bad.tried.length >= 2 && rows().slice(-1)[0].ok === 0, bad);
  const lst = await get('/veeqo/autolabel/scanforms');
  check('…the list says the times and night check, and how many USPS labels are not on a form yet', lst.ok && lst.times === 'Mon-Fri 16:30; Sat 13:45' && lst.checkAt === '20:30' && Array.isArray(lst.missing.labels), lst.times);
  globalThis.fetch = realFetch; delete env.VEEQO_API_KEY; delete env.TEST_CLOCK;
  const { readFileSync } = await import('node:fs');
  const ph = readFileSync(fileURLToPath(new URL('../packship.html', import.meta.url)), 'utf8');
  check('…Auto Label tab: 📄 Make scan form now, 📄 Scan form station, times in Rules; the label Printer station also keeps the times',
    /onclick="psAlScanFormMake\(this\)"/.test(ph) && /id="ps-al-sf-station"/.test(ph) && /data-k="scanFormTimes"/.test(ph) && /data-k="scanFormCheckAt"/.test(ph) && /scanform-tick[\s\S]{0,200}psAlPrintNewLabels\(true\)/.test(ph), null);
}

// Owner: "Mon–Fri after 4:30 pm stop the auto print until 5:30 pm, then print again; at 8:30 pm stop, 8:50 pm the second
// scan form, start again at 12:05 am; Saturday 1:30 pm done, 1:45 pm the scan form; Sunday one scan form at 8:50 pm".
console.log('\nAuto Label → ⏸ no auto buying around the scan forms; scan forms Mon–Fri 4:30 + 8:50 pm, Sat 1:45 pm, Sun 8:50 pm');
{
  const c = (await get('/veeqo/autolabel/config')).config;
  const { readFileSync: rf0 } = await import('node:fs'); const ws0 = rf0(workerPath, 'utf8');
  check('the owner\'s schedule is the rule now (saved rules too, once): scan forms Mon-Fri 16:30 + 20:50, Sat 13:45, Sun 20:50; no auto buying Mon-Fri 16:30-17:30 + 20:30-24:00, Sat 13:30-24:00, Sun 20:30-24:00, every day 0:00-0:05',
    /scanFormTimes: 'Mon-Fri 16:30, 20:50; Sat 13:45; Sun 20:50'/.test(ws0) && /scanFormCheckAt: '20:55'/.test(ws0) && c.pauseTimes === 'Mon-Fri 16:30-17:30; Mon-Fri 20:30-24:00; Sat 13:30-24:00; Sun 20:30-24:00; Mon-Sun 0:00-0:05'
    && sq.prepare("SELECT value FROM app_config WHERE key = 'autolabel_rules_scanform_pause_1006'").get()?.value === 'done', c);
  const { readFileSync } = await import('node:fs');
  const ws = readFileSync(workerPath, 'utf8');
  const grab = n => (ws.match(new RegExp('function ' + n + '\\([\\s\\S]*?\\n}')) || [''])[0];
  const f = new Function("const AUTOLABEL_DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];" + ['autolabelNoWaitParse', 'autolabelNoWaitText', 'autolabelNoWaitClean', 'autolabelNoWaitNow'].map(grab).join('\n') + '; return { autolabelNoWaitNow };')();
  const P = t => !!f.autolabelNoWaitNow({ noWaitTimes: c.pauseTimes }, new Date(t));
  // New York summer time = UTC − 4. Tue Oct 6 2026.
  check('Tue 4:29 pm buys · 4:30 pm stops · 5:29 pm stopped · 5:30 pm buys again · 8:29 pm buys · 8:30 pm stops · 11:59 pm stopped · 12:04 am stopped · 12:05 am buys',
    !P('2026-10-06T20:29:00Z') && P('2026-10-06T20:30:00Z') && P('2026-10-06T21:29:00Z') && !P('2026-10-06T21:30:00Z') && !P('2026-10-07T00:29:00Z') && P('2026-10-07T00:30:00Z')
    && P('2026-10-07T03:59:00Z') && P('2026-10-07T04:04:00Z') && !P('2026-10-07T04:05:00Z'), null);
  check('…Sat 1:29 pm buys · 1:30 pm stops for the rest of Saturday · Sun 10 am buys · Sun 8:30 pm stops · Mon 12:05 am buys',
    !P('2026-10-10T17:29:00Z') && P('2026-10-10T17:30:00Z') && P('2026-10-11T03:00:00Z') && !P('2026-10-11T14:00:00Z') && P('2026-10-12T00:30:00Z') && !P('2026-10-12T04:05:00Z'), null);
  await post('/veeqo/autolabel/config', { config: { pauseTimes: 'Sun-Sat 0:00-24:00' } });
  const realFetch = globalThis.fetch; env.VEEQO_API_KEY = 'k';
  globalThis.fetch = async (u) => { u = String(u); return u.includes('api.veeqo.com/') ? new Response('[]', { headers: { 'Content-Type': 'application/json' } }) : new Response('{}', { status: 401 }); };
  const r = await post('/veeqo/autolabel/run', {});
  globalThis.fetch = realFetch; delete env.VEEQO_API_KEY;
  check('…a run in a no-auto-buying time says so ("labels can still be bought by hand")', (r.notes || []).some(n => /No auto buying now/.test(n)), r.notes);
  await post('/veeqo/autolabel/config', { config: { pauseTimes: 'Mon-Fri 16:30-17:30; Mon-Fri 20:30-24:00; Sat 13:30-24:00; Sun 20:30-24:00; Sun-Sat 0:00-0:05' } });
  check('…the auto run never buys in a no-auto-buying time (by-hand buying is not blocked)', /const buy = !!opts\.buy && cfg\.mode === 'auto' && buyVerified && !paused;/.test(ws) && !/paused/.test(grab('autolabelBuyByHand')), null);
  const ph = readFileSync(fileURLToPath(new URL('../packship.html', import.meta.url)), 'utf8');
  check('…Rules: "⏸ No auto buying at these times (New York)" box, said in plain words', /data-k="pauseTimes"/.test(ph) && /⏸ No auto buying:/.test(ph), null);
}

// Owner: "set from what time to what time each person can sign in (Admin, next to each person); if they work late I change
// it for them; outside that time they can't sign in even with the right password — and notice me when someone signs in".
console.log('\nAdmin → 🕘 sign-in hours per person; 🔔 every sign-in on record for the owner');
{
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  const g = t => (p.find(x => x.type === t) || {}).value; const today = DAYS.indexOf(g('weekday')), mins = +g('hour') * 60 + +g('minute');
  const other = DAYS[(today + 3) % 7];
  // a worker account
  const salt2 = crypto.getRandomValues(new Uint8Array(16));
  const km2 = await crypto.subtle.importKey('raw', new TextEncoder().encode('work1pass'), 'PBKDF2', false, ['deriveBits']);
  const bits2 = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: salt2, iterations: 100000, hash: 'SHA-256' }, km2, 256);
  const w = sq.prepare('INSERT INTO cred_users (username, password_hash, display_name, active, created_at) VALUES (?,?,?,1,?)').run('worker1', hex(salt2) + ':' + hex(new Uint8Array(bits2)), 'Wk One', new Date().toISOString());
  const wid = Number(w.lastInsertRowid);
  sq.prepare('INSERT INTO cred_user_roles (user_id, role) VALUES (?,?)').run(wid, 'mobile');
  const login = async () => { const r = await call('/auth/login', { method: 'POST', body: JSON.stringify({ username: 'worker1', password: 'work1pass' }) }); return { status: r.status, body: await r.json() }; };
  const h1 = await post('/admin/users/hours', { userId: wid, hours: other + ' 1:00-2:00' });
  const l1 = await login();
  check('🕘 hours set to another day → right password, still refused ("Not your sign-in time …"), on record as ⛔', h1.ok && l1.status === 403 && l1.body.outsideHours && /Not your sign-in time/.test(l1.body.error)
    && !!sq.prepare("SELECT 1 x FROM cred_login_log WHERE kind = 'denied' AND user_id = ?").get(wid), { h1, l1 });
  await post('/admin/users/hours', { userId: wid, hours: 'Sun-Sat 0:00-24:00' });
  const l2 = await login();
  const lg = sq.prepare("SELECT * FROM cred_login_log WHERE kind = 'signin' AND user_id = ? ORDER BY id DESC").get(wid);
  check('…inside their hours → signs in, and the sign-in is on record (who, when, device) for the owner\'s 🔔', l2.status === 200 && !!l2.body.token && lg && lg.username === 'worker1' && !!lg.at, { l2: l2.status, lg });
  // already signed in, then their time is over (another day only) → the next request is refused
  await post('/admin/users/hours', { userId: wid, hours: other + ' 1:00-2:00' });
  const r3 = await call('/auth/access', { headers: { 'X-Cred-Token': l2.body.token } });
  check('…already signed in but their time is over (30 min to finish) → the app stops working for them', r3.status === 401, r3.status);
  if (mins < 23 * 60 + 45) {
    const until = `${String(Math.floor((mins + 10) / 60)).padStart(2, '0')}:${String((mins + 10) % 60).padStart(2, '0')}`;
    const lt = await post('/admin/users/hours', { userId: wid, lateUntil: until });
    const l4 = await login();
    check('…🌙 "working late today until …" → they can sign in again until then, without changing their hours', lt.ok && l4.status === 200, { lt, l4: l4.status });
    await post('/admin/users/hours', { userId: wid, lateUntil: '' });
  } else check('…🌙 working late (skipped: too close to midnight to test)', true, null);
  const l5 = await login();
  check('…"Clear" working late → outside their hours again', l5.status === 403, l5.status);
  const bad = await post('/admin/users/hours', { userId: wid, hours: 'whenever' });
  check('…hours it can\'t read are refused (nothing changed)', bad.ok === false && /Could not read the hours/.test(bad.error), bad);
  const ow = sq.prepare("INSERT INTO cred_users (username, password_hash, display_name, active, created_at, level) VALUES (?,?,?,1,?,'owner')").run('own1', 'x:y', 'Own', new Date().toISOString());
  const oh = await post('/admin/users/hours', { userId: Number(ow.lastInsertRowid), hours: 'Mon 1:00-2:00' });
  check('…an Owner never gets hours (can always sign in)', oh.ok === false && /Owner can always sign in/.test(oh.error), oh);
  sq.prepare('DELETE FROM cred_users WHERE id = ?').run(Number(ow.lastInsertRowid));
  const si = await get('/admin/signins?limit=50');
  check('…🔔 Sign-ins list: sign-ins, refused sign-ins and every hours change (with who changed it)', si.ok && si.rows.some(x => x.kind === 'signin' && x.user_id === wid) && si.rows.some(x => x.kind === 'denied' && x.user_id === wid)
    && si.rows.some(x => x.kind === 'hours' && /by TS/.test(x.detail)), si.rows.slice(0, 3));
  await post('/admin/users/hours', { userId: wid, hours: '' });
  const { readFileSync } = await import('node:fs');
  const rd = f => readFileSync(fileURLToPath(new URL('../' + f, import.meta.url)), 'utf8');
  const ad = rd('xfitting-admin.html'), xa = rd('xf-access.js');
  check('…Admin → Users: "Sign-in hours" next to each person with 🕘 Hours (hours + working late today); 🔔 Sign-ins card; the Owner gets a pop-up / notification on any open app page',
    /<th>Sign-in hours<\/th>/.test(ad) && /onclick="adOpenHours\(' \+ u\.id \+ '\)"/.test(ad) && /id="ad-h-late"/.test(ad) && /id="ad-signins"/.test(ad)
    && /if \(d\.level === 'owner'\) signinWatch\(\);/.test(xa) && /new Notification\('XFitting — sign-in'/.test(xa), null);
}

// Owner: "Audit — after scanning the column or a box, scroll down to the scan bar (see more info below); on the phone the
// Inventory / Refresh / Sign out / Apps bar stays at the top but small — tap to show all".
console.log('\nInventory: Audit scrolls to the scan bar after a scan; slim top bar on the phone');
{
  const { readFileSync } = await import('node:fs');
  const ih = readFileSync(fileURLToPath(new URL('../inventory.html', import.meta.url)), 'utf8');
  check('Audit: every scan (column or box) puts the scan bar at the top of the screen', /window\.rcGo = function\(v\) \{[\s\S]{0,400}setTimeout\(function\(\) \{ invScrollToScan\(inp, 'inv-panel-audit'\); \}, 60\);/.test(ih) && /window\.invScrollToScan = function\(inp, panelId\)/.test(ih), null);
  check('phone: the top bar stays at the top, slim; Refresh / Sign Out / Apps fold into ☰ (tap to show them)', /class="iback itop-more"[^>]*onclick="this\.parentNode\.classList\.toggle\('open'\)"/.test(ih)
    && /@media \(max-width:700px\)\{[\s\S]{0,400}#inv-app \.itopbar:not\(\.open\) \.iback:not\(\.itop-more\)\{display:none\}/.test(ih) && /#inv-app \.itopbar\{[^}]*position:sticky;top:0/.test(ih)
    && /id="inv-refresh-btn"/.test(ih) && /id="inv-signout-btn"/.test(ih), null);
}

// Owner: "why do I still see ⏭ Ready (next run)? it should move to Would buy" + "show product names, photo, SKU, bin,
// weight and package size right on Last run, would buy arranged by SKU".
console.log('\nAuto Label → Last run: ⏭ Ready orders checked right away → 👀 Would buy; items + package on each row');
{
  const realFetch = globalThis.fetch;
  const items = [{ quantity: 2, sellable: { id: 701, sku_code: '24-5-5=2', product_title: 'Brass elbow', image_url: 'https://photos.example/e.jpg', weight_grams: 60, stock_entries: [{ warehouse_id: 55, location: '24-5-5' }] } }];
  const ord = { id: 970, number: 'R-1', channel: { name: 'eBay' }, total_price: 40, deliver_to: { first_name: 'Di', last_name: 'Wu' }, line_items: items,
    allocations: [{ id: 8101, line_items: items, allocation_package: { weight: 12, weight_unit: 'oz', depth: 8, width: 6, height: 4, dimensions_unit: 'inches' } }] };
  globalThis.fetch = async (u, o) => { u = String(u); const J = x => new Response(JSON.stringify(x), { headers: { 'Content-Type': 'application/json' } });
    if (u.includes('api.veeqo.com/orders?')) return J(/status=cancelled/.test(u) ? [] : [ord]);
    if (u.includes('/shipping/quotes/amazon_shipping_v2')) return J([{ title: 'USPS Ground Advantage', name: 'usps-ga', carrier: 'usps', total_net_charge: 4.4, transit_days: 3 }]);
    if (u.includes('api.veeqo.com/')) return J([]);
    return new Response('{}', { status: 401 }); };
  env.VEEQO_API_KEY = 'k';
  sq.prepare("INSERT INTO app_config (key, value) VALUES ('autolabel_last_run', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(JSON.stringify({ counts: { ready: 1 }, orders: [{ number: 'R-1', decision: 'ready', reason: 'Ready — rates checked on a later run' }] }));
  const r = await post('/veeqo/autolabel/rate-one', { order: 'R-1' });
  check('⏭ Ready order checked now → 👀 Would buy with its rate (nothing bought)', r.ok && r.decision === 'would_buy' && r.price === 4.4 && r.carrier === 'USPS', r);
  check('…with its items (photo, name, SKU, bin, qty) and its box from Veeqo (8×6×4 in, 0.75 lb)', r.items.length === 1 && r.items[0].sku === '24-5-5=2' && r.items[0].bin === '24-5-5' && r.items[0].qty === 2 && r.items[0].title === 'Brass elbow' && /e\.jpg/.test(r.items[0].img)
    && r.pkg.l === 8 && r.pkg.w === 6 && r.pkg.h === 4 && r.pkg.lb === 0.75, r);
  const lr = JSON.parse(sq.prepare("SELECT value FROM app_config WHERE key = 'autolabel_last_run'").get().value);
  check('…the saved Last run moves it too (Would buy 1, Ready 0), so it stays after a reload', lr.orders[0].decision === 'would_buy' && lr.counts.would_buy === 1 && !lr.counts.ready, lr.counts);
  check('…and the next preview run reuses that rate (no "Ready" for it)', !!sq.prepare("SELECT 1 x FROM autolabel_rate_cache WHERE order_id = '970'").get(), null);
  const { readFileSync } = await import('node:fs');
  const ws = readFileSync(workerPath, 'utf8'), ph4 = readFileSync(fileURLToPath(new URL('../packship.html', import.meta.url)), 'utf8');
  check('…every run row carries its items + package (from the order Veeqo already sent)', /mergeWith: \[\],\s*\.\.\.autolabelRowDetail\(o\),/.test(ws), null);
  check('…Last run checks the ⏭ Ready ones by itself, and shows items + package on each row, sorted by SKU inside each result',
    /_psAlCheckReady\(\);\s*\}/.test(ph4) && /'\/veeqo\/autolabel\/rate-one'/.test(ph4) && /_psAlItemsHtml\(o\)/.test(ph4) && /_psAlPkgHtml\(o\)/.test(ph4) && /var rows = _psAlSortRows\(/.test(ph4), null);
  globalThis.fetch = realFetch; delete env.VEEQO_API_KEY;
}

// Owner: "barcode designer — after they design the barcode, save it to our system; they print it on the computer later (like the
// Sold Out labels); ask how many labels, then scan each column it goes to; then on the designer a tab to scan the sticker →
// where it goes and how many boxes need it at that spot".
console.log('\n🏷 Barcode designer: 💾 save on the phone → 🖨 print on the computer → 📍 scan the sticker → where it goes');
{
  const noSpot = await post('/inventory/barcode-job', { sku: '8-8-8=8', copies: 3, spots: [] });
  check('💾 Save needs the column(s) the stickers go to', noSpot.ok === false && /column/.test(noSpot.error), noSpot);
  const sv = await post('/inventory/barcode-job', { sku: '8-8-8=8', name: 'Plug', copies: 5, spots: [{ loc: 'c1=5-2-3', boxes: 3 }, { loc: 'C2=1-1-1', boxes: 2 }], _requestId: 'bd-req-1' });
  const sv2 = await post('/inventory/barcode-job', { sku: '8-8-8=8', name: 'Plug', copies: 5, spots: [{ loc: 'C1=5-2-3', boxes: 3 }], _requestId: 'bd-req-1' });
  const q = await get('/inventory/barcode-job/queue');
  const job = (q.jobs || []).find(j => j.id === sv.id) || {};
  check('…saved on record (part #, how many, each column + boxes, who / when); sent twice (WiFi) → kept once', sv.ok && sv2.duplicate && sv2.id === sv.id
    && (q.jobs || []).filter(j => j.sku === '8-8-8=8').length === 1 && job.copies === 5 && job.spots.length === 2 && job.spots[0].loc === 'C1=5-2-3' && job.spots[0].boxes === 3 && job.by_user && job.ts, q);
  const before = sq.prepare("SELECT COUNT(*) n FROM barcode_label_log WHERE sku = '8-8-8=8'").get().n;
  const pr = await post('/inventory/barcode-job/printed', { ids: [sv.id] });
  const after = sq.prepare("SELECT COUNT(*) n FROM barcode_label_log WHERE sku = '8-8-8=8'").get().n;
  check('…🖨 printed on the computer → off the "to print" list, who / when kept, and in the label print record', pr.printed === 1 && !(await get('/inventory/barcode-job/queue')).jobs.some(j => j.id === sv.id)
    && after === before + 1 && !!sq.prepare('SELECT printed_by FROM barcode_label_job WHERE id = ?').get(sv.id).printed_by, { pr, before, after });
  const f = await get('/inventory/barcode-job/find?sku=8-8-8%3D8');
  check('…📍 scan the sticker → its columns and how many boxes each (and printed by whom)', f.ok && f.jobs[0].spots.map(x => x.loc + ':' + x.boxes).join(',') === 'C1=5-2-3:3,C2=1-1-1:2' && !!f.jobs[0].printed_at, f);
  const st = await post('/inventory/barcode-job/stuck', { id: sv.id, loc: 'C1=5-2-3' });
  const f2 = await get('/inventory/barcode-job/find?sku=8-8-8%3D8');
  check('…✓ Done at a column → on record (who / when), the other column still to do', st.ok && f2.jobs[0].spots[0].doneAt && f2.jobs[0].spots[0].doneBy && !f2.jobs[0].spots[1].doneAt, f2.jobs[0].spots);
  const { readFileSync } = await import('node:fs');
  const ih2 = readFileSync(fileURLToPath(new URL('../inventory.html', import.meta.url)), 'utf8');
  check('…the designer: tabs ✏️ Design / 🖨 To print / 📍 Where does it go?; scan each column → how many boxes (number pad); 💾 Save (WiFi-safe); 🖨 Print here still there; the office PC sees "🏷 Barcode labels to print"',
    /t\('design', '✏️ Design'\)/.test(ih2) && /t\('where', '📍 Where does it go\?'\)/.test(ih2) && /onkeydown="if\(event\.key===\\'Enter\\'\)bdColScan\(\)"/.test(ih2)
    && /xfrKeypad\('How many boxes at ' \+ loc/.test(ih2) && /invPost\(W \+ '\/inventory\/barcode-job'/.test(ih2) && /onclick="bdPrint\(\)"[^>]*>🖨 Print label here/.test(ih2) && /id="bd-queue-card"/.test(ih2), null);
}

// Owner: "Last run wider on the PC, each column smaller / wider" + "product photo on the shipping label" + "photo on the barcode label".
console.log('\nLast run full width with resizable columns · product photo on the shipping label and the barcode sticker');
{
  const realFetch = globalThis.fetch;
  await get('/inventory/photos?bases=77-7-7');
  sq.prepare("INSERT OR REPLACE INTO product_photo (base_sku, url, source, updated_at) VALUES ('77-7-7', 'https://photos.example/77.jpg', 'test', '')").run();
  globalThis.fetch = async (u, o) => { u = String(u); if (u === 'https://photos.example/77.jpg') return new Response(new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]), { headers: { 'Content-Type': 'image/jpeg' } }); return realFetch(u, o); };
  const pf = await call('/inventory/photo-file?base=77-7-7%3D10X', { headers: H });
  const pf2 = await call('/inventory/photo-file?base=99-9-9', { headers: H });
  check('photo route: a part # (any pack size) → our saved product photo itself (the image), signed-in only; none saved → 404', pf.status === 200 && /image\/jpeg/.test(pf.headers.get('content-type')) && (await pf.arrayBuffer()).byteLength === 6 && pf2.status === 404
    && (await call('/inventory/photo-file?base=77-7-7')).status === 401, { s: pf.status, s2: pf2.status });
  globalThis.fetch = realFetch;
  const { readFileSync } = await import('node:fs');
  const ph5 = readFileSync(fileURLToPath(new URL('../packship.html', import.meta.url)), 'utf8'), ih3 = readFileSync(fileURLToPath(new URL('../inventory.html', import.meta.url)), 'utf8');
  check('shipping label: the items\' photos (black-and-white dots) in a square left of the lines; lines first — no room → no photo', /await _psAlLoadPics\(items, l\.id\);\s*try \{ var cv = await _psAlLabelCanvas\(f\);/.test(ph5)
    && /if \(plan\.pic\) \{ _psAlDrawPics\(ctx, pics, x0, y0, picW\); x0 \+= picW \+ picGap; \}/.test(ph5) && /for \(var tryPic = picW \? 1 : 0; tryPic >= 0 && !plan; tryPic--\)/.test(ph5) && /\/veeqo\/autolabel\/label-photo\?id=/.test(ph5), null);
  check('Last run: the whole screen width on the PC; drag a column edge to make it wider / smaller (kept on this PC, double-click = normal)', /\.ps-content:has\(#ps-panel-autolabel\.active\) \{ max-width:none; \}/.test(ph5)
    && /onmousedown="psAlColDrag\(event, ' \+ i \+ '\)"/.test(ph5) && /localStorage\.setItem\('ps_al_colw'/.test(ph5) && /table-layout:fixed/.test(ph5), null);
  const src = (ih3.match(/  function bdLabelHtml\(sku, copies, name, foot, pic\) \{[\s\S]*?\n  \}/) || [''])[0];
  const mk = new Function('xfrEsc', src + '; return bdLabelHtml;')(v => String(v));
  const withPic = mk('8-8-8=8', 2, 'Plug', 'Printed by Ana', 'https://photos.example/88.jpg'), noPic = mk('8-8-8=8', 1, 'Plug', 'Printed by Ana');
  check('barcode sticker: 📷 product photo on the left (black-and-white), barcode + part # on the right; photo off → the label as before', (withPic.match(/<div class="l lp"><img class="ph" src="https:\/\/photos\.example\/88\.jpg"/g) || []).length === 2
    && /filter:grayscale\(1\)/.test(withPic) && !/class="ph"/.test(noPic) && /<div class="l"><svg class="b"><\/svg><div class="t">8-8-8=8<\/div>/.test(noPic) && /id="bd-pic"[^>]*onchange="bdPicToggle\(this\.checked\)"/.test(ih3) && /bdImgsReady\(d\)\.then/.test(ih3), withPic.slice(-400));
}

// Owner: "select more than one → save it into the same PDF (they showed up one by one)" + "shipping label still not showing the product photo".
console.log('\nAuto Label: one print (one PDF) for all the labels; the label photo = our photo, else Veeqo\'s');
{
  const realFetch = globalThis.fetch;
  const items = [{ quantity: 1, sellable: { id: 801, sku_code: '66-6-6=2', image_url: 'https://veeqo-img.example/66.jpg', stock_entries: [{ location: '6-6-6' }] } }];
  const ord = { id: 990, number: 'P-1', channel: { name: 'eBay' }, line_items: items, allocations: [{ id: 9901, line_items: items, shipment: { id: 1, tracking_number: { tracking_number: 'TP1' } } }] };
  globalThis.fetch = async (u, o) => { u = String(u);
    if (u.includes('api.veeqo.com/orders?')) return new Response(JSON.stringify([ord]), { headers: { 'Content-Type': 'application/json' } });
    if (u === 'https://veeqo-img.example/66.jpg') return new Response(new Uint8Array([0xff, 0xd8, 0xff, 9]), { headers: { 'Content-Type': 'image/jpeg' } });
    if (u === 'https://photos.example/77.jpg') return new Response(new Uint8Array([0xff, 0xd8, 0xff, 7, 7]), { headers: { 'Content-Type': 'image/jpeg' } });
    if (u.includes('api.veeqo.com/')) return new Response('[]', { headers: { 'Content-Type': 'application/json' } });
    return realFetch(u, o); };
  env.VEEQO_API_KEY = 'k';
  await post('/veeqo/autolabel/label-add', { order: 'P-1' });
  const L = sq.prepare("SELECT id, items FROM label_print_queue WHERE order_number = 'P-1'").get();
  check('a label keeps each item\'s Veeqo photo with it', /veeqo-img\.example\/66\.jpg/.test(L.items), L.items);
  const ph = await call('/veeqo/autolabel/label-photo?id=' + L.id + '&i=0', { headers: H });
  check('…no photo of ours for 66-6-6 → the label uses the Veeqo photo (the image itself)', ph.status === 200 && /image\/jpeg/.test(ph.headers.get('content-type')) && (await ph.arrayBuffer()).byteLength === 4, ph.status);
  sq.prepare("UPDATE label_print_queue SET items = ? WHERE id = ?").run(JSON.stringify([{ sku: '77-7-7=1', qty: 1, bin: '7-7-7' }]), L.id);
  const ph2 = await call('/veeqo/autolabel/label-photo?id=' + L.id + '&i=0', { headers: H });
  check('…our saved photo (Location Plan) comes first', ph2.status === 200 && (await ph2.arrayBuffer()).byteLength === 5, ph2.status);
  sq.prepare("UPDATE label_print_queue SET items = ? WHERE id = ?").run(JSON.stringify([{ sku: '55-5-5=1', qty: 1, bin: '5-5-5' }]), L.id);
  const ph3 = await (await call('/veeqo/autolabel/label-photo?id=' + L.id + '&i=0', { headers: H })).json();
  check('…no photo anywhere → says why (shown on the screen next to the label)', ph3.ok === false && /No photo saved for 55-5-5/.test(ph3.error), ph3);
  globalThis.fetch = realFetch; delete env.VEEQO_API_KEY;
  const { readFileSync } = await import('node:fs');
  const ph6 = readFileSync(fileURLToPath(new URL('../packship.html', import.meta.url)), 'utf8');
  const scope = new Function(ph6.match(/function _psAlScopeCss\(css, sc\) \{[\s\S]*?\n\}/)[0] + '; ' + ph6.match(/function _psAlCombineHtml\(list\) \{[\s\S]*?\n\}/)[0] + '; return _psAlCombineHtml;')();
  const one = scope(['<html><head><style>@page{size:4in 6in;margin:0}html,body{margin:0}img{width:4in;height:6in;display:block}</style></head><body><img src="data:a"></body></html>',
    '<html><head><style>@page{margin:0.3in}body{font-family:Arial}table{width:100%}</style></head><body><div class="pg">SLIP A-1</div></body></html>',
    '<html><head><style>@page{size:4in 6in;margin:0}html,body{margin:0}img{width:4in}</style></head><body><img src="data:b"></body></html>']);
  check('…all the labels (+ each one\'s slip right after it) go in ONE document, in order, one page each (one PDF / one print)', (one.match(/class="pk\d pkp"/g) || []).length === 3
    && one.indexOf('data:a') < one.indexOf('SLIP A-1') && one.indexOf('SLIP A-1') < one.indexOf('data:b') && /\.pk1 table\{width:100%\}/.test(one) && /\.pk0 img\{/.test(one) && (one.match(/@page/g) || []).length === 1
    && /_psAlBatch = \[\]; \/\/ every label/.test(ph6) && /window\._psAlLastBatchPages = await _psAlBatchFlush\(\);/.test(ph6), one.slice(0, 400));
}

// Owner: "Last run arranged by the Veeqo bin location; would buy separated by bin location — same aisle stays together
// (28-1-1 with 28-3-3), mixed aisles → 'would buy mix'; and USPS apart from UPS (test UPS first)".
console.log('\nAuto Label → Last run: sorted by Veeqo bin; 👀 Would buy grouped by carrier + aisle (mix apart)');
{
  const { readFileSync } = await import('node:fs');
  const ph7 = readFileSync(fileURLToPath(new URL('../packship.html', import.meta.url)), 'utf8');
  const fn = n => (ph7.match(new RegExp('function ' + n + '\\([^)]*\\) \\{[\\s\\S]*?\\n\\}')) || [''])[0];
  const lib = new Function(['_psAlSkuKey', '_psAlSkuCmp', '_psAlBinOf', '_psAlAisleOf', '_psAlBinKey', '_psAlGroupOf', '_psAlGroupCmp', '_psAlSortRows'].map(fn).join('\n')
    + '; return { g: _psAlGroupOf, sort: _psAlSortRows };')();
  const o = (n, carrier, bins, d) => ({ number: n, decision: d || 'would_buy', carrier, items: bins.map((b, i) => ({ sku: 'S' + i, bin: b })) });
  const A = o('A', 'USPS', ['28-3-3', '28-1-1']), B = o('B', 'USPS', ['28-1-1']), C = o('C', 'USPS', ['5-3-2', '28-1-1']), D = o('D', 'UPS', ['28-2-2']), E = o('E', 'USPS', ['5-1-1']), H = o('H', 'USPS', ['1-1-1'], 'hold');
  check('28-1-1 and 28-3-3 → the same group (USPS · aisle 28); 5-3-2 + 28-1-1 → USPS · mix; UPS apart (UPS · aisle 28)',
    lib.g(A).key === 'USPS|28' && lib.g(B).key === 'USPS|28' && lib.g(C).key === 'USPS|mix' && lib.g(D).key === 'UPS|28' && lib.g(E).key === 'USPS|5', [A, B, C, D, E].map(x => lib.g(x).key));
  const sorted = lib.sort([D, C, A, H, B, E]).map(x => x.number).join('');
  check('…order on the screen: USPS aisle 5, USPS aisle 28 (by bin), USPS mix, then UPS; other results after, by bin', sorted === 'EABCDH', sorted);
  // Owner, later: "tap Would buy → all USPS not in mix in one small group; tap it → the USPS aisles; USPS mix one group; UPS one group".
  const lib2 = new Function(['_psAlSkuKey', '_psAlSkuCmp', '_psAlBinOf', '_psAlAisleOf', '_psAlBinKey', '_psAlGroupOf', '_psAlTopOf'].map(fn).join('\n') + '; return _psAlTopOf;')();
  check('…tap 👀 Would buy → 3 groups: USPS · by aisle (A, B, E) · USPS · 🔀 mix (C) · UPS (D); tap "USPS · by aisle" → a chip per aisle (5, 28) → only that aisle',
    [A, B, E].every(x => lib2(x) === 'USPS|aisles') && lib2(C) === 'USPS|mix' && lib2(D) === 'UPS'
    && /window\.psAlRunAislePick = function\(k\)/.test(ph7) && /\(!grpK \|\| _psAlTopOf\(o\) === grpK\) && \(!aisleK \|\| _psAlGroupOf\(o\)\.aisle === aisleK\)/.test(ph7) && /'USPS · by aisle'/.test(ph7), [A, B, C, D, E].map(lib2));
}

// Owner: "how come I don't see any package ship with UPS?" — the screen must say what UPS offered and why it lost.
console.log('\nAuto Label: when USPS is picked, Why says what UPS offered and why it lost');
{
  const { readFileSync } = await import('node:fs');
  const ws = readFileSync(workerPath, 'utf8'), ph8 = readFileSync(fileURLToPath(new URL('../packship.html', import.meta.url)), 'utf8');
  const fn = (ws.match(/function autolabelChooseRate\(order, quotes, cfg\) \{[\s\S]*?\n\}/) || [''])[0];
  const choose = new Function('autolabelChannelMatches', 'autolabelLowValue', fn + '; return autolabelChooseRate;')((o, l) => (l || []).some(x => /walmart/i.test(o.ch) && /walmart/i.test(x)), () => null);
  const cfg = { upsMinSavings: 0.8, upsMaxDays: 3, uspsOnlyChannels: ['walmart'] };
  const U = (price, days) => ({ carrier: 'USPS', price, days, service: 'GA' }), P = (price, days) => ({ carrier: 'UPS', price, days, service: 'Ground' });
  const r = (q, ch) => choose({ ch: ch || 'ebay' }, q, cfg);
  const a = r([U(6), P(4, 2)]), b = r([U(6)]), c = r([U(6), P(4, 5)]), d = r([U(6), P(4, null)]), e = r([U(6), P(5.5, 2)]), f = r([U(6), P(4, 2)], 'Walmart');
  check('UPS picked when ≥ $0.80 cheaper and ≤ 3 days; otherwise Why says: no UPS rate / too slow / no delivery days / only $x cheaper / USPS-only channel',
    a.pick.carrier === 'UPS' && /no UPS rate from Veeqo/.test(b.reason) && /UPS \$4\.00 but 5 days \(needs 3 or less\)/.test(c.reason)
    && /UPS \$4\.00 but Veeqo gave no delivery days/.test(d.reason) && /UPS only \$0\.50 cheaper — needs \$0\.80/.test(e.reason) && /USPS only for this channel/.test(f.reason),
    [a.reason, b.reason, c.reason, d.reason, e.reason, f.reason]);
  check('…Last run shows one line: UPS picked N · not picked — no UPS rate / too slow / no delivery days / not cheap enough / USPS-only channel (+ the rule)', /id = 'ps-al-ups-why'/.test(ph8) && /not picked — no UPS rate/.test(ph8), null);
}

// Owner: "change 3 days to 2 days, 0.80 to 0.70; the rules above Test → the rules right now; UPS → print the packing slip too;
// the packing slip must include the product photos".
console.log('\nAuto Label: UPS rule 2 days / $0.70 (saved rules too); UPS → packing slip; slips show product photos; rules shown in plain words');
{
  sq.prepare("INSERT INTO app_config (key, value) VALUES ('autolabel_config', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify({ mode: 'preview', upsMinSavings: 0.8, upsMaxDays: 3, waitMinutes: 30 }));
  sq.prepare("DELETE FROM app_config WHERE key = 'autolabel_rules_ups_2d_070'").run();
  const c1 = await get('/veeqo/autolabel/config');
  check('the saved rules move to UPS ≥ $0.70 cheaper and ≤ 2 days (once — on record), the rest kept', c1.config.upsMinSavings === 0.7 && c1.config.upsMaxDays === 2 && c1.config.waitMinutes === 30 && c1.config.mode === 'preview'
    && !!sq.prepare("SELECT 1 x FROM autolabel_log WHERE action = 'rules_changed'").get() && c1.defaults.upsMinSavings === 0.7 && c1.defaults.upsMaxDays === 2, c1.config);
  await post('/veeqo/autolabel/config', { config: { ...c1.config, upsMaxDays: 4 } });
  const c2 = await get('/veeqo/autolabel/config');
  check('…changed again on the page afterwards → kept (the one-time change does not come back)', c2.config.upsMaxDays === 4, c2.config.upsMaxDays);
  await post('/veeqo/autolabel/config', { config: { ...c2.config, upsMaxDays: 2 } });
  const { readFileSync } = await import('node:fs');
  const ph9 = readFileSync(fileURLToPath(new URL('../packship.html', import.meta.url)), 'utf8');
  const li = sq.prepare("INSERT INTO label_print_queue (order_id, alloc_id, order_number, tracking, carrier, created_at) VALUES ('U1','UA1','U-1','1ZUPS1','UPS',?)").run(new Date().toISOString()).lastInsertRowid;
  sq.prepare("INSERT INTO packing_slip_queue (order_id, alloc_id, order_number, tracking, items, created_at, printed_at, printed_by) VALUES ('U1','UA1','U-1','1ZUPS1','[]',?,?,'on the label')").run(new Date().toISOString(), new Date().toISOString());
  const up = await post('/veeqo/autolabel/labels-printed', { ids: [Number(li)], needSlip: true, withSlips: true });
  check('…a slip marked "on the label" before is printed after all when its label needs it (UPS / no room)', up.ok && up.slips.length === 1 && up.slips[0].orderNumber === 'U-1', up);
  check('UPS label → its packing slip always prints with it (even when the items are written on the label)', /var isUps = \/UPS\/i\.test\(l\.carrier \|\| ''\) && !\/USPS\/i\.test\(l\.carrier \|\| ''\);/.test(ph9), null);
  const slipFn = new Function('_psAlEsc', (ph9.match(/function _psAlSlipHtml\(slips\) \{[\s\S]*?\n\}/) || [''])[0] + '; return _psAlSlipHtml;')(v => String(v == null ? '' : v));
  const sh = slipFn([{ orderNumber: 'Z-1', channel: 'eBay', createdAt: new Date().toISOString(), shipTo: {}, items: [{ sku: '5-3-2=2', qty: 1, bin: '5-3-2', pieces: 2, photo: 'https://photos.example/5.jpg' }, { sku: '9-9-9=1', qty: 1, bin: '9-9-9', pieces: 1, photo: '' }] }]);
  check('packing slip: a Photo column with each item\'s product photo (black-and-white); the print waits for the photos', /<th class="phh">Photo<\/th>/.test(sh) && /<img class="ph" src="https:\/\/photos\.example\/5\.jpg"/.test(sh) && /filter:grayscale\(1\)/.test(sh)
    && /photos on the page \(packing slip\) load first/.test(ph9), sh.slice(-600));
  check('…the Rules box says the rules right now in plain words (carrier rule from the saved $ / days, 1–4 items on the label → no slip, slip for 5+ / no room / UPS)', /<b>📌 The rules right now<\/b>/.test(ph9) && /no room on the label, or the label is <b>UPS<\/b>/.test(ph9), null);
}

// Owner: "Transfer → Container here: when we scan the box it should bring you to the pallet — not any more". After a pallet
// was emptied, the "✅ everything matched" pop-up took the cursor (a scan went nowhere), and a box of the same item matched the
// finished pallet ("Already moved") instead of opening the next pallet.
console.log('\nContainer here: scanning a box brings you to its pallet (also right after a pallet is finished)');
{
  const { readFileSync } = await import('node:fs');
  const ih4 = readFileSync(fileURLToPath(new URL('../inventory.html', import.meta.url)), 'utf8');
  check('the "✅ Pallet — everything matched" pop-up keeps the scan box ready, and a scan closes it and carries on', /dm\.setAttribute\('data-scan-closes', '1'\);\s*setTimeout\(xfrGoBox, 60\);/.test(ih4)
    && /var dm = g\('xfr-modal'\); if \(dm && dm\.getAttribute\('data-scan-closes'\)\) dm\.remove\(\);/.test(ih4), null);
  check('…pallet finished → a box scanned goes to the pallet that still has boxes of it (1 → opens it; more → "which one")', /if \(xfrGo\.focus && !finished\) \{ var hit = xfrGoLocalMatch\(code\);/.test(ih4)
    && /if \(oth\.length === 1\) \{ invFlash\('🧱 ' \+ part \+ ' → Pallet ' \+ oth\[0\]\.pallet, 'success'\); xfrGoOpen\(/.test(ih4), null);
  check('…a box not on the open pallet (it still has boxes) → "🧱 Go to Pallet N — X box(es)" first in the pop-up (one tap)', /">🧱 Go to Pallet ' \+ xfrE\(l\.pallet\) \+ ' — ' \+ xfrN\(l\.left\) \+ ' box\(es\)<\/button>'/.test(ih4), null);
}

// Owner, again: "Container here: scan the box at the new pallet — still nothing, nothing changes". The cursor was on a tapped
// button, so the scanner's typing went nowhere. Now a scan is caught anywhere on Container here, and each scan shows it arrived.
console.log('\nContainer here: a scan is never lost (caught even when the cursor is not in the scan box); "📷 Last scan" line');
{
  const { readFileSync } = await import('node:fs');
  const ih5 = readFileSync(fileURLToPath(new URL('../inventory.html', import.meta.url)), 'utf8');
  check('a scanner scan while the cursor is on a button (not a text box) still goes to the box scan on Container here', /if \(typeof xfrSearchMode === 'undefined' \|\| xfrSearchMode !== 'cont'\) return;/.test(ih5)
    && /if \(e\.key === 'Enter' \|\| e\.keyCode === 13\) \{ if \(buf\) \{ e\.preventDefault\(\); var c = buf; buf = ''; clearTimeout\(t\); if \(m\) m\.remove\(\); xfrBoxScan\(c\); \} return; \}/.test(ih5), null);
  check('…every scan shows under the scan box ("📷 Last scan: … — looking…" → the part #), and a slow answer says "still looking…" after 6 s', /id="xfr-cont-last"/.test(ih5)
    && /xfrScanNote\('📷 Last scan: ' \+ code/.test(ih5) && /still looking… \(slow WiFi\?\)/.test(ih5), null);
  const fnNames = [...ih5.matchAll(/\bfunction (xfr\w+)\(/g)].map(m => m[1]), varNames = new Set([...ih5.matchAll(/\bvar (xfr\w+)\s*=/g)].map(m => m[1]));
  const clash = fnNames.filter(n => varNames.has(n) && !/^xfr(Go|Cont|Put|Cart|Kp)$/.test(n));
  check('…no Transfer function shares its name with a Transfer variable (that would stop every scan)', clash.length === 0, clash);
}

// Owner (photo): "scan the box — still nothing": the scanned number stayed in the box — that phone's scanner sends no Enter.
console.log('\nContainer here: a scan works without Enter (the scanner burst ending = the scan); typing by hand still waits for Enter');
{
  const { readFileSync } = await import('node:fs');
  const ih6 = readFileSync(fileURLToPath(new URL('../inventory.html', import.meta.url)), 'utf8');
  check('the box scan goes when the scanner stops typing (no Enter needed); Enter / keyCode 13 / a line break also work; ⌨ typing waits for Enter',
    /id="xfr-cont-box"[^>]*oninput="xfrBoxAuto\(this\)"/.test(ih6) && /if\(event\.key==='Enter'\|\|event\.keyCode===13\)\{event\.preventDefault\(\);xfrBoxScanNow\(this\)\}/.test(ih6)
    && /if \(x\.hasAttribute\('data-kb-typing'\) \|\| v\.trim\(\)\.length < 4\) return;/.test(ih6) && /_xfrAutoT = setTimeout\(function\(\) \{ if \(x\.value === v\) xfrBoxScanNow\(x\); \}, 350\);/.test(ih6), null);
}

// Owner (Farset R20H scanner, photo of its Scan Tool): the outside box UPC 810097207059 came in as 10097207059 (first digit
// dropped), so no box was found; and "hide all the keyboard on all scanner and phones".
console.log('\nScanner sends a UPC without its first digit → the full UPC is put back; keyboard hidden by default on touch screens');
{
  const { readFileSync } = await import('node:fs');
  const vm = await import('node:vm');
  const xa = readFileSync(fileURLToPath(new URL('../xf-access.js', import.meta.url)), 'utf8');
  const a = xa.indexOf('// ── 📷 UPC with its first digit dropped'), b = xa.indexOf('// ── 🔇 Scanner phone: no pop-up keyboard');
  const win = { addEventListener() {} };
  vm.runInNewContext(xa.slice(a, b), { window: win });
  const f = win.xfFixUpc || (() => null);
  check('R20H scans 10097207059 / 10097206892 / 10139932307 → 810097207059 / 810097206892 / 810139932307 (the real box UPCs)',
    f('10097207059') === '810097207059' && f('10097206892') === '810097206892' && f('10139932307') === '810139932307', [f('10097207059'), f('10097206892'), f('10139932307')]);
  check('…a UPC with only its leading 0 dropped (12345678905), full UPCs, part #s and short numbers are left as they are',
    f('12345678905') === '12345678905' && f('810097207059') === '810097207059' && f('5-3-2') === '5-3-2' && f('1234') === '1234' && f('') === '', null);
  check('…a trailing Enter / line break from the scanner is kept', f('10097207059\n') === '810097207059\n', f('10097207059\n'));
  const ih = readFileSync(fileURLToPath(new URL('../inventory.html', import.meta.url)), 'utf8');
  check('…fixed on Enter and when the scan lands in a box (all pages), and in the Container here box scan', /window\.addEventListener\('keydown', function \(e\) \{ if \(e\.key === 'Enter' \|\| e\.keyCode === 13\) mend\(e\.target\); \}, true\);/.test(xa)
    && /code = String\(window\.xfFixUpc \? xfFixUpc\(code \|\| ''\) : code \|\| ''\)\.trim\(\);/.test(ih), null);
  const wk = readFileSync(fileURLToPath(new URL('../worker/src/index.js', import.meta.url)), 'utf8');
  check('…the Worker UPC → part # lookup also tries the full UPC for 11 digits', /const full = upcAddFirstDigit\(z\);/.test(wk), null);
  // Owner, next day: "even I set it at always hiding keyboard, it still pops up — get away of the keyboard forever".
  check('phone keyboard never opens on a touch screen (no setting to turn it back on, sign-in boxes too); ⌨️ opens OUR keyboard instead',
    /function on\(\) \{ return true; \}/.test(xa) && !/Always show the keyboard on this phone/.test(xa) && !/'input\[autocomplete="username"\], input\[type="password"\], #xf-nokb-pop \*/.test(xa)
      && /if \(v === undefined && TOUCH\) return true;/.test(xa) && /B\('⌨️ Type in this box \(our keyboard\)'/.test(xa) && /if \(window\.xfOskOpen\) window\.xfOskOpen\(el\);/.test(xa), null);
  check('…a page\'s ⌨ "type it" button (data-kb-typing / data-typing) opens OUR keyboard on that box; ⏎ on it = Enter (search / save)',
    /attributeFilter: \['data-kb-typing', 'data-typing'\]/.test(xa) && /if \(!signIn\(target\)\) \{ \/\/ any other box: ⏎ = the Enter key/.test(xa), null);
  check('…a scan with no box selected goes to the last scan box (never a sign-in box, not behind a pop-up, not taken twice); slow typing is not a scan',
    /if \(!e\.isTrusted \|\| e\.defaultPrevented/.test(xa) && /if \(now - sAt > 120\) sBuf = '';/.test(xa) && /function scanOk\(el\)[^\n]*input\[autocomplete="username"\], input\[type="password"\]/.test(xa)
      && /if \(popupOver\(el\)\)/.test(xa) && /var c = sBuf; sBuf = ''; if \(c\.length >= 3\) \{ e\.preventDefault\(\); deliver\(c\); \}/.test(xa), null);
  // Owner's 🔍 Scanner test photo (R20H, outside box): the trigger sends F10 (keyCode 121), then only an Enter — the number goes
  // only into a box that has the cursor, and F10 opened Chrome's menu. The trigger must put the cursor in the scan box first.
  check('R20H scan trigger (F10 / keyCode 121): Chrome menu blocked, cursor put in the scan box (keyboard stays off) when no box has it',
    /if \(!e\.isTrusted \|\| !\(e\.keyCode === 121 \|\| \/\^F\(9\|1\[0-2\]\)\$\/\.test\(e\.key \|\| ''\)\)\) return;\s*e\.preventDefault\(\);/.test(xa)
      && /var el = scanBox\(\); if \(el && !popupOver\(el\)\) el\.focus\(\{ preventScroll: true \}\);/.test(xa), null);
  // Owner's Scanner test photo, Svantto MC002: its scan button sends key "Unidentified", code F21, keyCode 0.
  check('…the Svantto MC002 scan button (code F21, keyCode 0) counts as a scan trigger too', /if \(!e\.isTrusted \|\| !\/\^F\(1\[3-9\]\|2\[0-4\]\)\$\/\.test\(e\.code \|\| ''\)\) return;\s*e\.preventDefault\(\);/.test(xa), null);
  check('…⌨️ → 🔍 Test the scanner shows every key / text a scanner sends (starts with nothing selected)', /B\('🔍 Test the scanner', scanTest\);/.test(xa) && /keydown key=' \+ q\(e\.key\)/.test(xa) && /start with nothing selected/.test(xa), null);
  const sc = readFileSync(fileURLToPath(new URL('../docs/SCANNERS.md', import.meta.url)), 'utf8');
  check('docs/SCANNERS.md keeps the N77, Zebra DS2278 and Farset R20H fixes', /N77/.test(sc) && /DS2278/.test(sc) && /R20H/.test(sc), null);
  check('…and the Svantto MC002 fix (iScanPlus → sending mode HID) and the R20H EMUKEY setting', /Svantto MC002/.test(sc) && /sending mode = HID/.test(sc) && /Send Mode = EMUKEY/.test(sc), null);
}

// Owner: "when we in that app, can we hide that address bar on the top". manifest.json existed but no page linked it, and its
// start_url was a page that no longer exists — so the home-screen shortcut opened as a normal Chrome tab.
console.log('\nInstalled app opens without the address bar (manifest linked on every page, start page exists)');
{
  const { readFileSync, existsSync, readdirSync } = await import('node:fs');
  const root = fileURLToPath(new URL('../', import.meta.url));
  let man = {}; try { man = JSON.parse(readFileSync(root + 'manifest.json', 'utf8')); } catch (e) {}
  // Owner (Svantto MC002): "auto-rotate is off, but in our app it still rotates" — orientation "any" makes the installed app
  // follow the sensor and ignore the phone's auto-rotate lock. The app stays upright.
  check('installed app stays upright (orientation portrait — "any" ignored the phone\'s auto-rotate off)', man.orientation === 'portrait', man.orientation);
  check('manifest.json: display standalone, start page index.html exists, 192 and 512 icons exist', man.display === 'standalone' && man.start_url === './index.html' && existsSync(root + 'index.html')
    && ['192x192', '512x512'].every(sz => (man.icons || []).some(i => i.sizes === sz && existsSync(root + i.src))), man.start_url);
  const pages = readdirSync(root).filter(f => f.endsWith('.html')), missing = pages.filter(f => !readFileSync(root + f, 'utf8').includes('<link rel="manifest" href="manifest.json">'));
  check('…every page links the manifest', missing.length === 0, missing);
}

// Owner: "a button to click like 'using scanner as station' … turn all app upside down" and keep the scanner always scanning.
console.log('\nStation mode: every app upside down + screen on; Pack & Ship ignores the same label read again and again');
{
  const { readFileSync } = await import('node:fs');
  const xa = readFileSync(fileURLToPath(new URL('../xf-access.js', import.meta.url)), 'utf8');
  check('⌨️ menu has 🔄 Use as a station (on / off, per phone)', /Use as a station \(upside down, screen stays on\)/.test(xa) && /Station mode: ON — tap to turn off/.test(xa) && /localStorage\.setItem\(KEY, on \? '1' : '0'\)/.test(xa), null);
  check('…turns the whole app 180° (page scrolls inside it) and keeps the screen on (Wake Lock, taken again after the app is hidden)',
    /html\.xf-station\{transform:rotate\(180deg\)/.test(xa) && /navigator\.wakeLock\.request\('screen'\)/.test(xa) && /addEventListener\('visibilitychange', wake\)/.test(xa), null);
  const ps = readFileSync(fileURLToPath(new URL('../packship.html', import.meta.url)), 'utf8');
  const src = ps.slice(ps.indexOf('var _psStationLast'), ps.indexOf('function _psProcessScan('));
  let st = false, now = 1000000; const realNow = Date.now; Date.now = () => now;
  const rep = new Function('window', src + '; return _psStationRepeat;')({ xfStation: () => st });
  const off = rep('pack', 'T1') || rep('pack', 'T1');
  st = true; const a = rep('pack', 'T1'), b = rep('pack', 'T1'); now += 25000; const c = rep('pack', 'T1'); now += 25000; const d = rep('pack', 'T1');
  const e = rep('pack', 'T2'), f = rep('pick', 'T2'); now += 31000; const g = rep('pack', 'T2');
  Date.now = realNow;
  check('…station on: same label again ignored while it stays under (keeps sliding), new label / other tab / 30 s away counts; station off: nothing ignored',
    !off && !a && b && c && d && !e && !f && !g, { off, a, b, c, d, e, f, g });
  check('…Packing and Picking both use it', /if \(_psStationRepeat\('pack', tracking\)\)/.test(ps) && /if \(_psStationRepeat\('pick', tracking\)\)/.test(ps), null);
}

// Owner: "I selected all 81 would buy — only 50 came out, and the packing slips printed separately; I want each slip under its label".
console.log('\nAuto Label printing: every waiting label prints (not only 50); a slip waits for its label and prints right under it');
{
  const { readFileSync } = await import('node:fs');
  sq.prepare("DELETE FROM label_print_queue").run(); sq.prepare("DELETE FROM packing_slip_queue").run();
  const now = new Date().toISOString();
  for (let i = 1; i <= 81; i++) sq.prepare("INSERT INTO label_print_queue (order_id, alloc_id, order_number, channel, tracking, carrier, service, source, created_at, items) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run('O' + i, 'A' + i, 'N' + i, 'Amazon', 'T' + i, 'USPS', 'Ground', '{}', now, '[]');
  for (const i of [3, 60, 77]) sq.prepare("INSERT INTO packing_slip_queue (order_id, alloc_id, order_number, channel, tracking, carrier, ship_to, items, box_no, box_count, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .run('O' + i, 'A' + i, 'N' + i, 'Amazon', 'T' + i, 'USPS', '{}', '[]', 1, 1, now);
  sq.prepare("INSERT INTO packing_slip_queue (order_id, alloc_id, order_number, channel, tracking, carrier, ship_to, items, box_no, box_count, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .run('V9', 'B9', 'VEEQO-9', 'eBay', 'X9', 'UPS', '{}', '[]', 1, 1, now); // a slip with no label of ours (bought in Veeqo)
  const r1 = (await get('/veeqo/autolabel/labels?status=new&limit=50')).labels || [];
  const r2 = (await get('/veeqo/autolabel/labels?status=new&limit=50&after=' + Math.max(...r1.map(l => l.id)))).labels || [];
  const r3 = (await get('/veeqo/autolabel/labels?status=new&limit=50&after=' + Math.max(...r2.map(l => l.id)))).labels || [];
  check('81 labels waiting → round 1 = 50, round 2 = the other 31, round 3 = none (50 + 31 = 81, none twice)', r1.length === 50 && r2.length === 31 && r3.length === 0
    && new Set(r1.concat(r2).map(l => l.id)).size === 81, [r1.length, r2.length, r3.length]);
  const alone = (await get('/veeqo/autolabel/slips?status=new&alone=1')).slips || [];
  check('…the station\'s "print slips" leaves out the 3 slips whose labels are still waiting (they print under their labels); the Veeqo-bought one still prints', alone.length === 1 && alone[0].orderNumber === 'VEEQO-9', alone.map(x => x.orderNumber));
  const all = (await get('/veeqo/autolabel/slips?status=new')).slips || [];
  check('…the slip list on screen still shows all 4 waiting', all.length === 4, all.length);
  const L60 = r2.find(l => l.order_number === 'N60');
  const pr = await post('/veeqo/autolabel/labels-printed', { ids: [L60.id], needSlip: true, withSlips: true });
  check('…label N60 printed → its own slip comes back with it (printed right under it)', pr.ok && (pr.slips || []).length === 1 && pr.slips[0].orderNumber === 'N60', pr.slips);
  const ph = readFileSync(fileURLToPath(new URL('../packship.html', import.meta.url)), 'utf8');
  check('…the station prints round after round (50 at a time) until no label is waiting, and asks only for slips with no waiting label',
    /while \(rounds\+\+ < 40\) \{\s*var d = await _psAlFetch\('\/veeqo\/autolabel\/labels\?status=new&limit=50&after=' \+ after\);/.test(ph)
      && /_psAlFetch\('\/veeqo\/autolabel\/slips\?status=new&limit=50&alone=1'\)/.test(ph), null);
  sq.prepare("DELETE FROM label_print_queue").run(); sq.prepare("DELETE FROM packing_slip_queue").run();
}

// Owner: "the scan form is not working — it gave me a code but I can't copy it" (the message was in a pop-up alert).
console.log('\nScan form: a "not made / not printed" message stays on the page with 📋 Copy (no pop-up)');
{
  const { readFileSync } = await import('node:fs');
  const ph = readFileSync(fileURLToPath(new URL('../packship.html', import.meta.url)), 'utf8');
  check('scan form not made / not printed → shown on the page in a box with 📋 Copy, not in a pop-up alert; each failed row in the list has 📋 Copy too',
    /_psAlSfErr\('Scan form not made',/.test(ph) && /_psAlSfErr\('Scan form made, but not printed', e\.message\)/.test(ph) && !/alert\('Not made:\\n'/.test(ph) && !/alert\('Scan form not printed:\\n'/.test(ph)
      && /id="ps-al-sf-err"/.test(ph) && /onclick="_psAlCopy\(this\.getAttribute\(\\'data-t\\'\), this\)">📋 Copy<\/button><\/details>/.test(ph), null);
}

// Owner: Image Maker (imagemaker.html) — its own worker (images-worker/, xfitting-images) so the main worker doesn't grow.
console.log('\nImage Maker: own worker, sign-in, saved designs and the record');
{
  const { readFileSync } = await import('node:fs');
  const img = (await import(fileURLToPath(new URL('../images-worker/src/index.js', import.meta.url)))).default;
  const icall = (u, o = {}) => img.fetch(new Request('https://img' + u, o), env);
  const iget = async p => (await (await icall(p, { headers: H })).json());
  const ipost = async (p, b) => (await (await icall(p, { method: 'POST', headers: H, body: JSON.stringify(b) })).json());
  check('no sign-in → 401 (nobody can see the designs without a password)', (await icall('/images/designs')).status === 401 && (await icall('/images/designs', { headers: { 'X-Cred-Token': 'nope' } })).status === 401, null);
  const PH = 'data:image/png;base64,iVBORw0KGgo=';
  const s1 = await ipost('/images/design', { name: 'Hex nipple', partNum: '30-3-4=10X', qty: 10, design: { items: [] }, photo: PH, thumb: PH });
  check('save a design', s1.ok && s1.id > 0, s1);
  const l1 = await iget('/images/designs');
  check('…it is in the saved list, with who saved it, without the big photo', l1.ok && l1.designs.length === 1 && l1.designs[0].updated_by === 'TS' && !('photo' in l1.designs[0]), l1.designs);
  const c1 = await ipost('/images/design', { id: s1.id, name: 'Hex nipple', partNum: '30-3-4=10X', qty: 9, design: { items: [] } });
  const g1 = await iget('/images/design?id=' + s1.id);
  check('…change it without a new photo → the saved photo stays', c1.ok && g1.design.photo === PH && g1.design.qty === 9, g1.design && g1.design.qty);
  await ipost('/images/use', { action: 'downloaded', id: s1.id, name: 'Hex nipple', partNum: '30-3-4=10X', detail: '9 pieces' });
  const d1 = await ipost('/images/design/delete', { id: s1.id });
  const l2 = await iget('/images/designs');
  check('…delete → gone from the list, but kept in the table (marked deleted, not erased)', d1.ok && l2.designs.length === 0 && sq.prepare('SELECT COUNT(*) n FROM img_designs WHERE deleted_at IS NOT NULL').get().n === 1, l2.designs);
  const lg = (await iget('/images/log')).rows || [];
  check('…the record shows saved → changed (qty 10 → 9) → downloaded → deleted, each with who', lg.map(r => r.action).reverse().join(',') === 'saved,changed,downloaded,deleted'
    && lg.every(r => r.by_user === 'TS') && /qty 10 → 9/.test(lg.find(r => r.action === 'changed').detail), lg.map(r => r.action + ':' + r.detail));
  const src = readFileSync(fileURLToPath(new URL('../images-worker/src/index.js', import.meta.url)), 'utf8');
  check('…the image worker only writes its own img_* tables (never inventory, never the sign-in tables)',
    !/(INSERT INTO|UPDATE|DELETE FROM)\s+(?!img_)\w+/i.test(src.replace(/ON CONFLICT[^`']*/g, '')), null);
  const page = readFileSync(fileURLToPath(new URL('../imagemaker.html', import.meta.url)), 'utf8');
  const home = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');
  check('…the page talks to its own worker with the sign-in token, and the Apps screen has its card',
    /var IMAGES_URL = 'https:\/\/xfitting-images\.alfixedinc88\.workers\.dev'/.test(page) && /'X-Cred-Token': TOKEN/.test(page) && /onclick="window\.location\.href='imagemaker\.html'"/.test(home), null);
}

console.log('\n' + (failed ? '❌ ' + failed + ' check(s) FAILED' : '✅ all ' + passed + ' checks passed') + '\n');
process.exit(failed ? 1 : 0);
