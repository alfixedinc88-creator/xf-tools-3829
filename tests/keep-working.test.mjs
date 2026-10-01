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
check('container Received: History has Before → After (8 → 48, 0 → 10)', rl.length === 2 && rl.every(r => r.status === 'Verified') && rl[0].b === 8 && rl[0].a === 48 && rl[1].b === 0 && rl[1].a === 10, rl);
const pr2 = await get('/inventory/pallets/received');
const kwp = (pr2.lines || pr2.pallets || pr2.rows || []).filter(x => x.title === CT);
check('container Received: every pallet line is still listed, at GARAGE', kwp.length === 3 && kwp.every(x => x.location === 'GARAGE'), pr2);
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

console.log('\n' + (failed ? '❌ ' + failed + ' check(s) FAILED' : '✅ all ' + passed + ' checks passed') + '\n');
process.exit(failed ? 1 : 0);
