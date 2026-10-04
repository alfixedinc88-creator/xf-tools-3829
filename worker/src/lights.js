// 💡 Warehouse lights (owner: "install a light — any kind — our app turns it on
// when we want"). Lights page (lights.html) → /lights/* (any sign-in to switch,
// management to add / rename / remove). Every switch is kept in lights_log
// (who / when / on-off / result) — never a silent change.
//
// Kinds of light:
//   govee   — Govee Wi-Fi bulbs / strips / plugs. Worker secret GOVEE_API_KEY
//             (Govee Home app → Profile → Settings → Apply for API Key).
//   lifx    — LIFX Wi-Fi bulbs / strips. Worker secret LIFX_TOKEN
//             (cloud.lifx.com → Personal access tokens).
//   webhook — anything that turns on / off with a web link: a Shelly plug or
//             relay (any lamp or fixture), Home Assistant, IFTTT… The on / off
//             links (they can hold a key) are kept in D1, shown to managers only.

const GOVEE = 'https://openapi.api.govee.com/router/api/v1';
const LIFX = 'https://api.lifx.com/v1';

async function tables(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS lights_devices (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, area TEXT, provider TEXT,
    device TEXT, sku TEXT, on_url TEXT, off_url TEXT, method TEXT, on_body TEXT, off_body TEXT,
    last_on INTEGER, last_at TEXT, last_by TEXT, created_at TEXT, created_by TEXT)`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS lights_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, light_id INTEGER, name TEXT,
    action TEXT, by_user TEXT, ok INTEGER, detail TEXT)`).run();
}

function who(s) { return (s && (s.displayName || s.username)) || '?'; }
function isMgr(s) { return !!(s && s.roles && (s.roles.includes('mgmt') || s.roles.includes('admin'))); }

// Turn one light on / off. Returns { ok, detail }.
async function switchLight(env, L, on) {
  try {
    if (L.provider === 'govee') {
      if (!env.GOVEE_API_KEY) return { ok: false, detail: 'GOVEE_API_KEY is not set in the Worker' };
      const r = await fetch(GOVEE + '/device/control', { method: 'POST',
        headers: { 'Govee-API-Key': env.GOVEE_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: String(Date.now()), payload: { sku: L.sku, device: L.device,
          capability: { type: 'devices.capabilities.on_off', instance: 'powerSwitch', value: on ? 1 : 0 } } }) });
      const d = await r.json().catch(() => ({}));
      const ok = r.ok && (d.code == null || d.code === 200);
      return { ok, detail: ok ? 'Govee OK' : 'Govee: ' + (d.msg || d.message || 'HTTP ' + r.status) };
    }
    if (L.provider === 'lifx') {
      if (!env.LIFX_TOKEN) return { ok: false, detail: 'LIFX_TOKEN is not set in the Worker' };
      const r = await fetch(LIFX + '/lights/id:' + encodeURIComponent(L.device) + '/state', { method: 'PUT',
        headers: { 'Authorization': 'Bearer ' + env.LIFX_TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify({ power: on ? 'on' : 'off', duration: 0.5 }) });
      const d = await r.json().catch(() => ({}));
      const res = (d.results || [])[0];
      const ok = r.ok && (!res || res.status === 'ok');
      return { ok, detail: ok ? 'LIFX OK' : 'LIFX: ' + ((res && res.status) || d.error || 'HTTP ' + r.status) };
    }
    if (L.provider === 'webhook') {
      const url = on ? L.on_url : L.off_url;
      if (!url) return { ok: false, detail: 'No ' + (on ? 'on' : 'off') + ' link saved' };
      const method = (L.method || 'POST').toUpperCase(), body = on ? L.on_body : L.off_body;
      const opt = { method };
      if (method !== 'GET' && body) {
        const json = /^\s*[{[]/.test(body);
        opt.headers = { 'Content-Type': json ? 'application/json' : 'application/x-www-form-urlencoded' };
        opt.body = body;
      }
      const r = await fetch(url, opt);
      return { ok: r.ok, detail: r.ok ? 'Link OK' : 'Link answered HTTP ' + r.status };
    }
    return { ok: false, detail: 'Unknown kind of light' };
  } catch (e) {
    return { ok: false, detail: 'Could not reach it: ' + String(e.message || e).slice(0, 120) };
  }
}

// Lights on the Govee / LIFX account that can be added.
async function discover(env) {
  const out = [], errors = [];
  if (env.GOVEE_API_KEY) {
    try {
      const r = await fetch(GOVEE + '/user/devices', { headers: { 'Govee-API-Key': env.GOVEE_API_KEY } });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || (d.code != null && d.code !== 200)) errors.push('Govee: ' + (d.msg || d.message || 'HTTP ' + r.status));
      for (const x of (d.data || [])) out.push({ provider: 'govee', device: x.device, sku: x.sku, name: x.deviceName || x.sku || x.device });
    } catch (e) { errors.push('Govee: ' + e.message); }
  }
  if (env.LIFX_TOKEN) {
    try {
      const r = await fetch(LIFX + '/lights/all', { headers: { 'Authorization': 'Bearer ' + env.LIFX_TOKEN } });
      const d = await r.json().catch(() => []);
      if (!r.ok) errors.push('LIFX: ' + ((d && d.error) || 'HTTP ' + r.status));
      for (const x of (Array.isArray(d) ? d : [])) out.push({ provider: 'lifx', device: x.id, sku: (x.product && x.product.name) || '', name: x.label || x.id, power: x.power });
    } catch (e) { errors.push('LIFX: ' + e.message); }
  }
  return { found: out, errors };
}

export async function handleLights(url, method, request, env, session, h) {
  const { cors, logUserActivity } = h;
  const J = (o, st) => cors(new Response(JSON.stringify(o), { status: st || 200, headers: { 'Content-Type': 'application/json' } }));
  const path = url.pathname;
  await tables(env);
  const body = method === 'POST' ? await request.json().catch(() => ({})) : {};
  const mgr = isMgr(session);
  const log = async (L, action, ok, detail) => {
    await env.DB.prepare('INSERT INTO lights_log (ts, light_id, name, action, by_user, ok, detail) VALUES (?,?,?,?,?,?,?)')
      .bind(new Date().toISOString(), L ? L.id : null, L ? L.name : '', action, who(session), ok ? 1 : 0, String(detail || '').slice(0, 200)).run();
  };

  if (path === '/lights/list' && method === 'GET') {
    const rows = (await env.DB.prepare('SELECT * FROM lights_devices ORDER BY area, name').all()).results || [];
    return J({ ok: true, manager: mgr, kinds: { govee: !!env.GOVEE_API_KEY, lifx: !!env.LIFX_TOKEN },
      lights: rows.map(r => ({ id: r.id, name: r.name, area: r.area || '', provider: r.provider, on: r.last_on == null ? null : !!r.last_on,
        lastAt: r.last_at, lastBy: r.last_by,
        // the links can hold a key — managers only
        ...(mgr ? { device: r.device, sku: r.sku, onUrl: r.on_url, offUrl: r.off_url, method: r.method, onBody: r.on_body, offBody: r.off_body } : {}) })) });
  }

  if (path === '/lights/set' && method === 'POST') {
    const on = !!body.on;
    const rows = body.all
      ? ((await env.DB.prepare('SELECT * FROM lights_devices').all()).results || [])
      : [await env.DB.prepare('SELECT * FROM lights_devices WHERE id = ?').bind(parseInt(body.id, 10) || 0).first()].filter(Boolean);
    if (!rows.length) return J({ ok: false, error: body.all ? 'No lights added yet' : 'Light not found' }, 404);
    const results = [];
    for (const L of rows) {
      const r = await switchLight(env, L, on);
      if (r.ok) await env.DB.prepare('UPDATE lights_devices SET last_on = ?, last_at = ?, last_by = ? WHERE id = ?').bind(on ? 1 : 0, new Date().toISOString(), who(session), L.id).run();
      await log(L, on ? 'on' : 'off', r.ok, r.detail);
      results.push({ id: L.id, name: L.name, ok: r.ok, detail: r.detail });
    }
    if (session && session.userId) await logUserActivity(env, session.userId, 'lights', { on, ids: rows.map(r => r.id) });
    return J({ ok: results.every(r => r.ok), results });
  }

  if (path === '/lights/log' && method === 'GET') {
    const rows = (await env.DB.prepare('SELECT ts, name, action, by_user, ok, detail FROM lights_log ORDER BY id DESC LIMIT 100').all()).results || [];
    return J({ ok: true, log: rows });
  }

  // ── managers: find / add / change / remove ──
  if (!mgr) return J({ ok: false, error: 'Management access required' }, 403);

  if (path === '/lights/discover' && method === 'GET') {
    const d = await discover(env);
    const have = new Set(((await env.DB.prepare('SELECT provider, device FROM lights_devices').all()).results || []).map(r => r.provider + '|' + r.device));
    return J({ ok: true, kinds: { govee: !!env.GOVEE_API_KEY, lifx: !!env.LIFX_TOKEN }, found: d.found.map(x => ({ ...x, added: have.has(x.provider + '|' + x.device) })), errors: d.errors });
  }

  if (path === '/lights/save' && method === 'POST') {
    const p = String(body.provider || '');
    if (!['govee', 'lifx', 'webhook'].includes(p)) return J({ ok: false, error: 'Pick the kind of light' }, 400);
    const name = String(body.name || '').trim().slice(0, 60);
    if (!name) return J({ ok: false, error: 'Give the light a name (e.g. "Aisle C1 light")' }, 400);
    if (p === 'webhook' && !(String(body.onUrl || '').startsWith('https://') && String(body.offUrl || '').startsWith('https://')))
      return J({ ok: false, error: 'Both the ON and the OFF link are needed (https://…)' }, 400);
    if (p !== 'webhook' && !body.device) return J({ ok: false, error: 'Pick the light from "Find my lights"' }, 400);
    const v = [name, String(body.area || '').trim().slice(0, 40), p, String(body.device || ''), String(body.sku || ''),
      String(body.onUrl || ''), String(body.offUrl || ''), String(body.method || 'POST').toUpperCase() === 'GET' ? 'GET' : 'POST',
      String(body.onBody || '').slice(0, 1000), String(body.offBody || '').slice(0, 1000)];
    let L;
    if (body.id) {
      await env.DB.prepare('UPDATE lights_devices SET name=?, area=?, provider=?, device=?, sku=?, on_url=?, off_url=?, method=?, on_body=?, off_body=? WHERE id=?').bind(...v, parseInt(body.id, 10)).run();
      L = { id: parseInt(body.id, 10), name };
      await log(L, 'changed', true, 'by ' + who(session));
    } else {
      const ins = await env.DB.prepare('INSERT INTO lights_devices (name, area, provider, device, sku, on_url, off_url, method, on_body, off_body, created_at, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
        .bind(...v, new Date().toISOString(), who(session)).run();
      L = { id: ins.meta.last_row_id, name };
      await log(L, 'added', true, p);
    }
    return J({ ok: true, id: L.id });
  }

  if (path === '/lights/remove' && method === 'POST') {
    const L = await env.DB.prepare('SELECT id, name FROM lights_devices WHERE id = ?').bind(parseInt(body.id, 10) || 0).first();
    if (!L) return J({ ok: false, error: 'Light not found' }, 404);
    await env.DB.prepare('DELETE FROM lights_devices WHERE id = ?').bind(L.id).run();
    await log(L, 'removed', true, '');
    return J({ ok: true });
  }

  return J({ ok: false, error: 'Not found' }, 404);
}
