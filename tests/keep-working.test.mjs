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

console.log('\n' + (failed ? '❌ ' + failed + ' check(s) FAILED' : '✅ all ' + passed + ' checks passed') + '\n');
process.exit(failed ? 1 : 0);
