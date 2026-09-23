// Shared "Sign out" button for every XFitting page.
//
// All pages share one sign-in (localStorage xf_cred_token / xf_cred_user),
// so signing out anywhere signs out everywhere: the session is ended on the
// worker (POST /auth/logout), the saved sign-in is cleared, and the browser
// goes back to the front page's login. Other open tabs follow along.
// The button only shows while someone is signed in, and never prints.
(function () {
  var WORKER = 'https://xfitting-lookup.alfixedinc88.workers.dev';
  var HOME = 'index.html';

  function token() { try { return localStorage.getItem('xf_cred_token'); } catch (e) { return null; } }
  function userName() {
    try { var u = JSON.parse(localStorage.getItem('xf_cred_user') || 'null'); return (u && u.displayName) || ''; }
    catch (e) { return ''; }
  }
  function clearSignIn() {
    try { localStorage.removeItem('xf_cred_token'); localStorage.removeItem('xf_cred_user'); } catch (e) {}
    try { sessionStorage.removeItem('xf_session'); } catch (e) {}
  }
  function goHome() {
    if (/(^|\/)(index\.html)?$/.test(location.pathname)) location.reload();
    else location.href = HOME;
  }

  var style = document.createElement('style');
  style.textContent =
    '#xf-signout-btn{position:fixed;left:12px;bottom:12px;z-index:2147483000;display:none;align-items:center;gap:6px;' +
    'padding:7px 12px;border-radius:100px;border:1px solid rgba(0,0,0,.15);background:rgba(255,255,255,.95);color:#333;' +
    'font:600 12px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;cursor:pointer;' +
    'box-shadow:0 2px 8px rgba(0,0,0,.15)}' +
    '#xf-signout-btn:hover{background:#fff;border-color:#c52a1a;color:#c52a1a}' +
    '@media print{#xf-signout-btn{display:none!important}}';

  var btn = document.createElement('button');
  btn.id = 'xf-signout-btn';
  btn.type = 'button';
  btn.title = 'Sign out of every XFitting page on this device';

  function refresh() {
    var t = token();
    if (!t) { btn.style.display = 'none'; return; }
    var n = userName();
    btn.textContent = '🚪 Sign out' + (n ? ' (' + n + ')' : '');
    btn.style.display = 'flex';
  }

  btn.onclick = async function () {
    var n = userName();
    if (!confirm('Sign out' + (n ? ' ' + n : '') + '?\n\nThis signs you out of every XFitting page on this device.')) return;
    var t = token();
    btn.disabled = true; btn.textContent = 'Signing out…';
    clearSignIn();
    try {
      if (t) await fetch(WORKER + '/auth/logout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: t })
      });
    } catch (e) { /* signed out on this device either way */ }
    goHome();
  };

  function mount() {
    document.head.appendChild(style);
    document.body.appendChild(btn);
    refresh();
    // A page's own login sets the token without reloading — pick that up.
    setInterval(refresh, 2000);
  }
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);

  // Signed out in another tab -> this tab follows.
  window.addEventListener('storage', function (e) {
    if (e.key === 'xf_cred_token' && e.oldValue && !e.newValue) goHome();
    else if (e.key === 'xf_cred_token' || e.key === 'xf_cred_user') refresh();
  });
})();
