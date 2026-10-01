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

console.log('\n' + (failed ? '❌ ' + failed + ' check(s) FAILED' : '✅ all ' + passed + ' checks passed') + '\n');
process.exit(failed ? 1 : 0);
