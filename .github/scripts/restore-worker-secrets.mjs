// One-time repair for the xfitting-lookup worker.
//
// Creates a new worker version with the code from worker/src/index.js and
// every binding (secrets, variables, D1) inherited from the newest version,
// after checking that version holds all the secrets of SOURCE_VERSION. Secret values stay inside Cloudflare and are never read or
// printed here. The new version is then deployed at 100% and checked; if the
// check fails, the previously active deployment is restored.
//
// Needs: CLOUDFLARE_API_TOKEN (Edit Cloudflare Workers), SOURCE_VERSION
// (full id or prefix, e.g. 8c85f1f7).

import { readFile } from 'node:fs/promises';

const ACCOUNT_ID = 'f8a9e038e8c1248d16fc922966e3c6ee';
const SCRIPT     = 'xfitting-lookup';
const CHECK_URL  = 'https://xfitting-lookup.alfixedinc88.workers.dev/veeqo/status';
const API        = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/workers/scripts/${SCRIPT}`;

const token  = process.env.CLOUDFLARE_API_TOKEN;
const source = (process.env.SOURCE_VERSION || '').trim().toLowerCase();
if (!token)  throw new Error('CLOUDFLARE_API_TOKEN secret is not set in GitHub');
if (!source) throw new Error('SOURCE_VERSION is empty');

async function cf(path, init = {}) {
  const res = await fetch(API + path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false) {
    throw new Error(`${init.method || 'GET'} ${path} -> HTTP ${res.status}: ${JSON.stringify(body.errors || body).slice(0, 800)}`);
  }
  return body.result;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function listVersions() {
  const all = [];
  for (let page = 1; page <= 20; page++) {
    const result = await cf(`/versions?page=${page}&per_page=50`);
    const items = (result && result.items) || [];
    all.push(...items);
    if (items.length < 50) break;
  }
  // Newest first, whatever order the API returns
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

// 1. Newest versions, and which ones carry the secrets (names only)
const versions = await listVersions();
const hit = versions.find(v => String(v.id).toLowerCase().startsWith(source));
if (!hit) throw new Error(`No version starting with "${source}" found for ${SCRIPT}`);
const src = await cf(`/versions/${hit.id}`);
const srcBindings = (src.resources && src.resources.bindings) || [];
const srcSecrets = secretNames(src);
const runtime = (src.resources && src.resources.script_runtime) || {};
console.log(`Source version ${hit.id}: ${srcBindings.length} bindings, ${srcSecrets.length} secrets`);
if (srcSecrets.length === 0) throw new Error('Source version has no secrets. Stopping so nothing gets worse.');

console.log('Newest versions:');
for (const v of versions.slice(0, 6)) {
  const full = await cf(`/versions/${v.id}`);
  const n = secretNames(full).length;
  console.log(`  ${v.id}  ${v.metadata && v.metadata.created_on}  source=${v.metadata && v.metadata.source}  secrets=${n}`);
}

// The API can only inherit from the newest ("latest") version, so that one
// must already hold every secret the source version has.
const latest = await cf(`/versions/${versions[0].id}`);
const latestSecrets = new Set(secretNames(latest));
const notOnLatest = srcSecrets.filter(n => !latestSecrets.has(n));
if (notOnLatest.length) {
  throw new Error(`The newest version (${versions[0].id}) is missing ${notOnLatest.length} secrets (${notOnLatest.join(', ')}). ` +
    'Inheriting from it would not restore them, so nothing was changed. Send this log to Claude.');
}
console.log(`Newest version ${versions[0].id} has all ${srcSecrets.length} secrets. Inheriting from it.`);
const latestBindings = (latest.resources && latest.resources.bindings) || [];

const compatDate = String(runtime.compatibility_date || '2024-01-01').slice(0, 10);
console.log(`Compatibility date: ${compatDate}, flags: ${JSON.stringify(runtime.compatibility_flags || [])}`);

// 2. Currently active deployment, for automatic restore
const deps = await cf('/deployments');
const active = deps && deps.deployments && deps.deployments[0];
const previous = active ? active.versions.map(v => ({ version_id: v.version_id, percentage: v.percentage })) : null;
console.log(`Currently active: ${JSON.stringify(previous)}`);

// 3. Upload new version: current code + all bindings inherited from source
const code = await readFile('worker/src/index.js', 'utf8');
const metadata = {
  main_module: 'index.js',
  compatibility_date: compatDate,
  compatibility_flags: runtime.compatibility_flags || [],
  bindings: latestBindings.map(b => ({ type: 'inherit', name: b.name })),
  annotations: { 'workers/message': `Code from GitHub + bindings inherited from ${versions[0].id.slice(0, 8)}` },
};
const form = new FormData();
form.append('metadata', JSON.stringify(metadata));
form.append('index.js', new Blob([code], { type: 'application/javascript+module' }), 'index.js');
const created = await cf('/versions', { method: 'POST', body: form });
const newId = created.id || (created.version && created.version.id);
if (!newId) throw new Error('Upload returned no version id: ' + JSON.stringify(created).slice(0, 500));
console.log(`New version uploaded: ${newId}`);

// 4. Make sure every secret actually came across before going live
const check = await cf(`/versions/${newId}`);
const newNames = new Set(((check.resources && check.resources.bindings) || []).map(b => b.name));
const missing = srcSecrets.filter(n => !newNames.has(n));
if (missing.length) throw new Error(`New version is missing secrets (${missing.join(', ')}). Not deploying it; the live site is unchanged.`);
console.log(`All ${srcSecrets.length} secrets present on the new version.`);

// 5. Deploy, verify, restore on failure
await deploy([{ version_id: newId, percentage: 100 }], 'Restore secrets onto GitHub code');
console.log('Deployed new version at 100%. Checking the live worker...');
if (await checkLive()) {
  console.log('SUCCESS: /veeqo/status reports connected: true. Future GitHub deploys will keep these secrets.');
} else {
  console.log('Live check failed. Restoring the previous deployment...');
  if (previous) await deploy(previous, 'Automatic restore after failed secret repair');
  throw new Error('Repair did not pass the live check. The previous version was restored.');
}
