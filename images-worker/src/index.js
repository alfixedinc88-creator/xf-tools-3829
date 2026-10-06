// ═══════════════════════════════════════════════════════════════════════════
// xfitting-images — backend for Image Maker (imagemaker.html)
//
// A separate Cloudflare Worker (own wrangler.toml in this folder) so the
// main worker (worker/src/index.js, xfitting-lookup) doesn't grow, and an
// edit here can never change anything else. Same D1 database:
//   • READS the sign-in tables: cred_sessions / cred_users / cred_levels /
//     cred_user_roles. It never writes them (the main worker owns them).
//   • WRITES only its own tables, all named img_*:
//       img_designs — saved designs (the layout, the cut-out photo, a small
//                     preview). Deleting only marks a design deleted.
//       img_log     — the record: who saved / changed / deleted / downloaded
//                     which design, and when.
// It never touches inventory, listings or Veeqo.
//
// The picture work itself (background removal, layout, text) runs in the
// browser; this worker only keeps the designs and the record.
// ═══════════════════════════════════════════════════════════════════════════

const CRED_SESSION_ROLLING_MINUTES = 60; // same as the main worker
const CRED_PERMS = ['mobile', 'ops', 'mgmt', 'price', 'admin'];
const CRED_LEVEL_DEFAULTS = {
  worker: ['mobile', 'ops'], pro: ['mobile', 'ops', 'mgmt'],
  admin: ['mobile', 'ops', 'mgmt', 'price', 'admin'], owner: ['mobile', 'ops', 'mgmt', 'price', 'admin'],
};
// D1 keeps a row up to 2 MB; stay well under it.
const MAX_PHOTO = 1500000, MAX_THUMB = 250000, MAX_DESIGN = 200000;

// ── HTTP helpers ─────────────────────────────────────────────────────────
function cors(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,X-Cred-Token',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}
const json = (body, status, origin) => new Response(JSON.stringify(body), { status: status || 200, headers: { 'Content-Type': 'application/json', ...cors(origin) } });
const all = async (env, sql, binds) => ((await env.DB.prepare(sql).bind(...(binds || [])).all()).results) || [];
const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const now = () => new Date().toISOString();

// ── Sign-in: the same server-checked X-Cred-Token as every other page ────
// Copy of verifyCredSession() in worker/src/index.js, READ-ONLY: it doesn't
// extend or delete the session (the main worker still owns cred_sessions).
async function verifyCredSession(token, env) {
  if (!token) return null;
  const session = await env.DB.prepare('SELECT * FROM cred_sessions WHERE token = ?').bind(token).first().catch(() => null);
  if (!session) return null;
  if ((Date.now() - new Date(session.last_active).getTime()) / 60000 > CRED_SESSION_ROLLING_MINUTES) return null;
  const user = await env.DB.prepare('SELECT * FROM cred_users WHERE id = ? AND active = 1').bind(session.user_id).first().catch(() => null);
  if (!user) return null;
  const levels = { ...CRED_LEVEL_DEFAULTS };
  for (const r of await all(env, 'SELECT key, roles FROM cred_levels').catch(() => [])) {
    try { levels[r.key] = JSON.parse(r.roles || '[]').filter(x => CRED_PERMS.includes(x)); } catch (_) {}
  }
  const own = (await all(env, 'SELECT role FROM cred_user_roles WHERE user_id = ?', [user.id]).catch(() => [])).map(r => r.role);
  const roles = new Set([...((user.level && levels[user.level]) || []), ...own]);
  if (user.level === 'owner') { roles.add('admin'); roles.add('owner'); }
  return { userId: user.id, username: user.username, displayName: user.display_name, roles: [...roles], level: user.level || null };
}
const who = s => String((s && (s.displayName || s.username || s.userId)) || '?').slice(0, 40);

// ── Own tables (img_*) ───────────────────────────────────────────────────
let _ready = false;
async function ensureTables(env) {
  if (_ready) return;
  const q = s => env.DB.prepare(s).run();
  await q(`CREATE TABLE IF NOT EXISTS img_designs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, part_num TEXT, qty INTEGER,
    design TEXT, photo TEXT, thumb TEXT,
    created_by TEXT, created_at TEXT, updated_by TEXT, updated_at TEXT,
    deleted_by TEXT, deleted_at TEXT)`);
  await q('CREATE INDEX IF NOT EXISTS idx_img_designs_updated ON img_designs(updated_at)');
  await q(`CREATE TABLE IF NOT EXISTS img_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, by_user TEXT, action TEXT,
    design_id INTEGER, name TEXT, part_num TEXT, detail TEXT)`);
  await q('CREATE INDEX IF NOT EXISTS idx_img_log_ts ON img_log(ts)');
  _ready = true;
}
async function log(env, by, action, d, detail) {
  await env.DB.prepare('INSERT INTO img_log (ts, by_user, action, design_id, name, part_num, detail) VALUES (?,?,?,?,?,?,?)')
    .bind(now(), by, action, (d && d.id) || null, (d && d.name) || null, (d && d.part_num) || null,
      detail == null ? null : (typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 2000)).run();
}

// ── Routes ───────────────────────────────────────────────────────────────
async function listDesigns(url, env) {
  const q = str(url.searchParams.get('q'), 80).toLowerCase();
  const binds = [];
  let where = 'deleted_at IS NULL';
  if (q) { where += ' AND (LOWER(name) LIKE ? OR LOWER(part_num) LIKE ?)'; binds.push('%' + q + '%', '%' + q + '%'); }
  const rows = await all(env, `SELECT id, name, part_num, qty, thumb, created_by, created_at, updated_by, updated_at
    FROM img_designs WHERE ${where} ORDER BY updated_at DESC LIMIT 200`, binds);
  return { ok: true, designs: rows };
}

async function getDesign(url, env) {
  const id = parseInt(url.searchParams.get('id'), 10);
  const d = await env.DB.prepare('SELECT * FROM img_designs WHERE id = ? AND deleted_at IS NULL').bind(id || 0).first();
  if (!d) return { ok: false, error: 'Design not found (it may have been deleted)', status: 404 };
  try { d.design = JSON.parse(d.design || '{}'); } catch (_) { d.design = {}; }
  return { ok: true, design: d };
}

async function saveDesign(body, env, s) {
  const name = str(body.name, 120), partNum = str(body.partNum, 60);
  if (!name) return { ok: false, error: 'Give the design a name', status: 400 };
  const design = JSON.stringify(body.design || {});
  if (design.length > MAX_DESIGN) return { ok: false, error: 'Design is too big to save', status: 413 };
  const photo = body.photo == null ? null : String(body.photo);
  const thumb = body.thumb == null ? null : String(body.thumb);
  if (photo && (!/^data:image\/(png|webp|jpeg);base64,/.test(photo) || photo.length > MAX_PHOTO)) return { ok: false, error: 'Photo is not a picture or is too big to save', status: 413 };
  if (thumb && (!/^data:image\/(png|webp|jpeg);base64,/.test(thumb) || thumb.length > MAX_THUMB)) return { ok: false, error: 'Preview is too big to save', status: 413 };
  const qty = Math.max(0, Math.min(999, parseInt(body.qty, 10) || 0));
  const by = who(s), ts = now();
  const id = parseInt(body.id, 10) || 0;
  if (id) {
    const old = await env.DB.prepare('SELECT id, name, part_num, qty FROM img_designs WHERE id = ? AND deleted_at IS NULL').bind(id).first();
    if (!old) return { ok: false, error: 'Design not found (it may have been deleted). Save it as new.', status: 404 };
    // A save without a new photo keeps the photo already saved.
    await env.DB.prepare(`UPDATE img_designs SET name=?, part_num=?, qty=?, design=?, photo=COALESCE(?, photo), thumb=COALESCE(?, thumb),
      updated_by=?, updated_at=? WHERE id=?`).bind(name, partNum || null, qty, design, photo, thumb, by, ts, id).run();
    const changes = [];
    if (old.name !== name) changes.push('name ' + old.name + ' → ' + name);
    if ((old.part_num || '') !== partNum) changes.push('part # ' + (old.part_num || '—') + ' → ' + (partNum || '—'));
    if ((old.qty || 0) !== qty) changes.push('qty ' + (old.qty || 0) + ' → ' + qty);
    if (photo) changes.push('new photo');
    await log(env, by, 'changed', { id, name, part_num: partNum }, changes.join('; ') || 'layout');
    return { ok: true, id };
  }
  if (!photo) return { ok: false, error: 'No photo to save', status: 400 };
  const r = await env.DB.prepare(`INSERT INTO img_designs (name, part_num, qty, design, photo, thumb, created_by, created_at, updated_by, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(name, partNum || null, qty, design, photo, thumb, by, ts, by, ts).run();
  const newId = r.meta && r.meta.last_row_id;
  await log(env, by, 'saved', { id: newId, name, part_num: partNum }, 'qty ' + qty);
  return { ok: true, id: newId };
}

async function deleteDesign(body, env, s) {
  const id = parseInt(body.id, 10) || 0;
  const d = await env.DB.prepare('SELECT id, name, part_num FROM img_designs WHERE id = ? AND deleted_at IS NULL').bind(id).first();
  if (!d) return { ok: false, error: 'Design not found', status: 404 };
  await env.DB.prepare('UPDATE img_designs SET deleted_by=?, deleted_at=? WHERE id=?').bind(who(s), now(), id).run();
  await log(env, who(s), 'deleted', d, null);
  return { ok: true };
}

// The page reports each download so there is a record of who made which picture.
async function recordUse(body, env, s) {
  const action = ['downloaded'].includes(body.action) ? body.action : null;
  if (!action) return { ok: false, error: 'Unknown action', status: 400 };
  const id = parseInt(body.id, 10) || null;
  await log(env, who(s), action, { id, name: str(body.name, 120) || null, part_num: str(body.partNum, 60) || null }, str(body.detail, 500));
  return { ok: true };
}

async function listLog(url, env) {
  const limit = Math.max(1, Math.min(500, parseInt(url.searchParams.get('limit'), 10) || 100));
  return { ok: true, rows: await all(env, 'SELECT * FROM img_log ORDER BY id DESC LIMIT ?', [limit]) };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '*';
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    try {
      // Every request needs a real sign-in.
      const s = await verifyCredSession(request.headers.get('X-Cred-Token'), env);
      if (!s) return json({ ok: false, error: 'Not signed in' }, 401, origin);
      await ensureTables(env);
      const p = url.pathname.replace(/\/+$/, '');
      const body = request.method === 'POST' ? await request.json().catch(() => ({})) : null;
      let r = null;
      if (p === '/images/designs' && request.method === 'GET') r = await listDesigns(url, env);
      else if (p === '/images/design' && request.method === 'GET') r = await getDesign(url, env);
      else if (p === '/images/design' && request.method === 'POST') r = await saveDesign(body, env, s);
      else if (p === '/images/design/delete' && request.method === 'POST') r = await deleteDesign(body, env, s);
      else if (p === '/images/use' && request.method === 'POST') r = await recordUse(body, env, s);
      else if (p === '/images/log' && request.method === 'GET') r = await listLog(url, env);
      else return json({ ok: false, error: 'Not found' }, 404, origin);
      const status = r.status || 200; delete r.status;
      return json(r, status, origin);
    } catch (e) {
      return json({ ok: false, error: e.message || String(e) }, 500, origin);
    }
  },
};
