// One-time repair for the xfitting-lookup worker.
//
// Goal: a new worker version with the code from worker/src/index.js and every
// binding (secrets, variables, D1) copied from SOURCE_VERSION, which still has
// them. Secret values stay inside Cloudflare and are never read or printed.
//
// The classic Versions API, wrangler and Workers Builds can only copy
// ("inherit") bindings from the newest version. So:
//   A. Try the newer Workers API, which may accept a specific version_id.
//   B. Otherwise, if SOURCE_VERSION is live, delete the newer versions that have
//      no secrets (failed builds, not live) so SOURCE_VERSION is the newest
//      again, then inherit from "latest".
// The new version is checked for every secret before going live, deployed at
// 100%, and verified on /veeqo/status. On failure the previous deployment is
// restored.

import { readFile } from 'node:fs/promises';

const ACCOUNT_ID = 'f8a9e038e8c1248d16fc922966e3c6ee';
const SCRIPT     = 'xfitting-lookup';
const CHECK_URL  = 'https://xfitting-lookup.alfixedinc88.workers.dev/veeqo/status';
const ACCT       = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}`;
const API        = `${ACCT}/workers/scripts/${SCRIPT}`;

const token  = process.env.CLOUDFLARE_API_TOKEN;
const source = (process.env.SOURCE_VERSION || '').trim().toLowerCase();
if (!token)  throw new Error('CLOUDFLARE_API_TOKEN secret is not set in GitHub');
if (!source) throw new Error('SOURCE_VERSION is empty');

async function call(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false) {
    throw new Error(`${init.method || 'GET'} ${url.replace(ACCT, '')} -> HTTP ${res.status}: ${JSON.stringify(body.errors || body).slice(0, 600)}`);
  }
  return body.result;
}
const cf = (path, init) => call(API + path, init);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function listVersions() {
  const all = [];
  for (let page = 1; page <= 20; page++) {
    const result = await cf(`/versions?page=${page}&per_page=50`);
    const items = (result && result.items) || [];
    all.push(...items);
    if (items.length < 50) break;
  }
  return all.sort((a, b) => String(b.metadata && b.metadata.created_on).localeCompare(String(a.metadata && a.metadata.created_on)));
}

function secretNames(version) {
  return ((version.resources && version.resources.bindings) || [])
    .filter(b => b.type === 'secret_text' || b.type === 'secret_key').map(b => b.name).sort();
}

async function deploy(versions, message) {
  return cf('/deployments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ strategy: 'percentage', versions, annotations: { 'workers/message': message } }),
  });
}

async function checkLive() {
  for (let i = 0; i < 12; i++) {
    await sleep(5000);
    try {
      const res = await fetch(CHECK_URL, { headers: { 'Cache-Control': 'no-cache' } });
      const body = await res.json().catch(() => ({}));
      console.log(`  check ${i + 1}: HTTP ${res.status} ${JSON.stringify(body).slice(0, 200)}`);
      if (body.connected === true) return true;
    } catch (e) {
      console.log(`  check ${i + 1}: ${e.message}`);
    }
  }
  return false;
}

// ── 1. Source version and current state ─────────────────────────────────────
let versions = await listVersions();
const hit = versions.find(v => String(v.id).toLowerCase().startsWith(source));
if (!hit) throw new Error(`No version starting with "${source}" found for ${SCRIPT}`);
const sourceId = hit.id;
const src = await cf(`/versions/${sourceId}`);
const srcBindings = (src.resources && src.resources.bindings) || [];
const srcSecrets = secretNames(src);
const runtime = (src.resources && src.resources.script_runtime) || {};
const compatDate = String(runtime.compatibility_date || '2024-01-01').slice(0, 10);
const compatFlags = runtime.compatibility_flags || [];
console.log(`Source ${sourceId}: ${srcBindings.length} bindings, ${srcSecrets.length} secrets, compat ${compatDate}`);
if (srcSecrets.length === 0) throw new Error('Source version has no secrets. Stopping so nothing gets worse.');

const deps = await cf('/deployments');
const active = deps && deps.deployments && deps.deployments[0];
const previous = active ? active.versions.map(v => ({ version_id: v.version_id, percentage: v.percentage })) : null;
console.log(`Currently active: ${JSON.stringify(previous)}`);

const code = await readFile('worker/src/index.js', 'utf8');
const message = `Code from GitHub + bindings copied from ${sourceId.slice(0, 8)}`;
let newId = null;

// ── A. Newer Workers API with a specific version_id (not deployed yet) ──────
try {
  const created = await call(`${ACCT}/workers/workers/${SCRIPT}/versions?deploy=false`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      main_module: 'index.js',
      compatibility_date: compatDate,
      compatibility_flags: compatFlags,
      bindings: srcBindings.map(b => ({ type: 'inherit', name: b.name, version_id: sourceId })),
      modules: [{ name: 'index.js', content_type: 'application/javascript+module', content_base64: Buffer.from(code).toString('base64') }],
      annotations: { 'workers/message': message },
    }),
  });
  newId = created && created.id;
  console.log(`Route A created version ${newId}`);
  const got = new Set(secretNames(await cf(`/versions/${newId}`)));
  if (!srcSecrets.every(n => got.has(n))) {
    console.log('Route A version did not get the secrets; deleting it and trying route B.');
    await call(`${ACCT}/workers/workers/${SCRIPT}/versions/${newId}`, { method: 'DELETE' });
    newId = null;
  }
} catch (e) {
  console.log(`Route A not available: ${e.message}`);
}

// ── B. Remove newer secret-less versions, then inherit from "latest" ────────
if (!newId) {
  const liveIsSource = previous && previous.length === 1 && previous[0].version_id === sourceId && previous[0].percentage === 100;
  if (!liveIsSource) throw new Error(`Route B needs ${sourceId} to be the live version at 100%. Roll back to it in the dashboard, then run this again.`);

  const srcTime = String(hit.metadata && hit.metadata.created_on);
  const newer = versions.filter(v => String(v.metadata && v.metadata.created_on) > srcTime);
  for (const v of newer) {
    const n = secretNames(await cf(`/versions/${v.id}`)).length;
    if (n > 0) throw new Error(`Newer version ${v.id} has ${n} secrets. Not deleting anything; send this log to Claude.`);
  }
  console.log(`Deleting ${newer.length} newer version(s) with no secrets (failed builds, not live):`);
  for (const v of newer) {
    console.log(`  ${v.id}  ${v.metadata && v.metadata.created_on}  source=${v.metadata && v.metadata.source}`);
    await call(`${ACCT}/workers/workers/${SCRIPT}/versions/${v.id}`, { method: 'DELETE' });
  }

  versions = await listVersions();
  if (versions[0].id !== sourceId) throw new Error(`After cleanup the newest version is ${versions[0].id}, not ${sourceId}. Send this log to Claude.`);
  console.log(`${sourceId} is the newest version again.`);

  const form = new FormData();
  form.append('metadata', JSON.stringify({
    main_module: 'index.js',
    compatibility_date: compatDate,
    compatibility_flags: compatFlags,
    bindings: srcBindings.map(b => ({ type: 'inherit', name: b.name })),
    annotations: { 'workers/message': message },
  }));
  form.append('index.js', new Blob([code], { type: 'application/javascript+module' }), 'index.js');
  const created = await cf('/versions', { method: 'POST', body: form });
  newId = created.id || (created.version && created.version.id);
  if (!newId) throw new Error('Upload returned no version id: ' + JSON.stringify(created).slice(0, 500));
  console.log(`Route B worked: new version ${newId}`);
}

// ── Verify every secret came across, then go live ───────────────────────────
const newSecrets = new Set(secretNames(await cf(`/versions/${newId}`)));
const missing = srcSecrets.filter(n => !newSecrets.has(n));
if (missing.length) throw new Error(`New version ${newId} is missing secrets (${missing.join(', ')}). Not deploying it; the live site is unchanged.`);
console.log(`All ${srcSecrets.length} secrets present on ${newId}.`);

await deploy([{ version_id: newId, percentage: 100 }], 'Restore secrets onto GitHub code');
console.log('Deployed new version at 100%. Checking the live worker...');
if (await checkLive()) {
  console.log(`SUCCESS: ${newId} is live with all secrets and /veeqo/status reports connected: true.`);
  console.log('It is now the newest version, so future GitHub deploys will keep these secrets.');
} else {
  console.log('Live check failed. Restoring the previous deployment...');
  if (previous) await deploy(previous, 'Automatic restore after failed secret repair');
  throw new Error('Repair did not pass the live check. The previous version was restored.');
}
