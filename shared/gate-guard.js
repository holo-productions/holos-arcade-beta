/* GATE-GUARD-2026-11-24: standalone game pages are signed-in-only (beta).
   The hub gate (games-hub) already blocks signed-out visitors, but a
   direct game URL (beta.holosarcade.ca/<game>/) used to open and play
   with no sign-in at all (audit A1-1). Every standalone game page loads
   this script first thing in <head>; it checks for the same signed-in
   session marker the hub itself uses, and sends anyone without one to
   the hub gate page. Signed-in hub sessions pass straight through —
   the hub only sets an iframe src after its own session check passes,
   and the iframe shares localStorage with the hub (same origin).

   GATE-NAV-2026-11-24: a signed-in visitor opening a game directly
   used to get NO nav at all — no Back, no Report. So once the guard
   passes on a TOP-LEVEL page (not inside the hub iframe — the hub has
   its own nav), this script also injects two small floating pills:
   "‹ Back to Arcade" (top-left, back to the hub) and "Report"
   (top-right, opens the hub's report/feedback form for this game via
   ?report=<slug>). Corner pills only, ~34px tall, fixed at the top
   edge: they never shrink the play area (no layout shift, no
   padding added) and they stay out of the centre where game titles
   and controls live. They are real links with inline styles only, so
   no game stylesheet can restyle or break them. Phones included —
   the pills shrink slightly under 380px wide.

   What counts as signed in (mirrors the hub's own getTester() test,
   plus the Firebase credential the hub stores on the Firebase path):
   - localStorage or sessionStorage 'holos-arcade-tester-login' parses
     to an object with a truthy name AND code, OR
   - localStorage 'holos-firebase-auth' parses to an object with a
     truthy uid or email.
   Sign-out clears both markers (hub signOutTester), so a signed-out
   visitor cannot pass on a stale record. Local-only accounts pass
   this check today — exactly as they pass the hub's own gate — until
   the hub removes local-only sign-in; when that lands, the Firebase
   marker is what admits a player.

   Free-to-play override (for launch, e.g. Game of the Day free without
   an account): a game page can set window.HOLO_GATE_FREE = true in an
   inline script BEFORE this file loads, and the guard stands down for
   that page only. Nothing else can set it — it is page code, not a
   URL parameter, so a visitor cannot turn it on from the address bar.

   Honest limits: this is a client-side check. It stops casual
   browsing to a direct URL and every honest tester path. It cannot
   stop a determined person who edits localStorage in their own
   browser or calls the Firebase APIs directly — that needs
   server-side enforcement (Cloud Functions), which is a separate
   build Holo has not approved yet. It also fails open if this file
   itself cannot load (e.g. a deploy hiccup): no redirect happens.
   If this file 404s, fix the deploy — do not work around it. */
(function () {
  'use strict';
  if (window.__holoGateGuard) return;
  window.__holoGateGuard = true;

  /* Free-to-play override for a page that opts in (see header). */
  try { if (window.HOLO_GATE_FREE) return; } catch (e) {}

  function testerSession() {
    var stores = [];
    try { stores.push(localStorage); } catch (e) {}
    try { stores.push(sessionStorage); } catch (e) {}
    for (var s = 0; s < stores.length; s++) {
      try {
        var raw = stores[s].getItem('holos-arcade-tester-login');
        if (!raw) continue;
        var v = JSON.parse(raw);
        /* Same bar as the hub's getTester(): a name AND a code. */
        if (v && typeof v === 'object' && v.name && v.code) return v;
      } catch (e) { /* bad JSON or blocked storage: not a session */ }
    }
    return null;
  }

  function firebaseSession() {
    try {
      var raw = localStorage.getItem('holos-firebase-auth');
      if (!raw) return null;
      var v = JSON.parse(raw);
      if (v && typeof v === 'object' && (v.uid || v.email)) return v;
    } catch (e) { /* bad JSON or blocked storage: not a session */ }
    return null;
  }

  if (testerSession() || firebaseSession()) {
    injectNav();
    return;
  }

  var GATE = 'https://beta.holosarcade.ca/games-hub/';
  try {
    /* Hub-framed play: send the whole hub to the gate, not just the frame. */
    if (window.top && window.top !== window) { window.top.location.replace(GATE); return; }
  } catch (e) { /* cross-origin frame: fall through to a self-redirect */ }
  try { window.location.replace(GATE); } catch (e) {}

  /* GATE-NAV-2026-11-24: minimal Back + Report pills on a standalone
     game page. Only when this page is the top window (never inside the
     hub iframe — the hub already has its own nav and player bar). */
  function injectNav() {
    if (window.__holoGateNav) return;
    try {
      if (window.top && window.top !== window) return; /* framed: hub nav owns it */
    } catch (e) { return; /* cross-origin frame: do not inject */ }
    window.__holoGateNav = true;
    function slugOf() {
      try {
        var p = String(window.location.pathname || '').replace(/^\/+|\/+$/g, '');
        var first = p.split('/')[0] || '';
        return first || 'games-hub';
      } catch (e) { return 'games-hub'; }
    }
    function build() {
      if (!document.body || document.getElementById('holo-gate-nav')) return;
      var slug = slugOf();
      var css = document.createElement('style');
      css.id = 'holo-gate-nav-css';
      css.textContent = '.holo-gate-nav{position:fixed;top:8px;left:8px;right:8px;z-index:9999;'
        + 'display:flex;justify-content:space-between;align-items:flex-start;pointer-events:none;'
        + 'font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}'
        + '.holo-gate-nav a{pointer-events:auto;display:inline-flex;align-items:center;gap:6px;'
        + 'height:34px;padding:0 12px;border-radius:999px;background:rgba(26,16,51,.88) !important;'
        + 'color:#fff !important;border:2px solid #7c5cff !important;text-decoration:none !important;'
        + 'font-weight:700 !important;font-size:13px !important;line-height:1 !important;'
        + 'box-shadow:0 2px 10px rgba(0,0,0,.35);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px)}'
        + '.holo-gate-nav a:hover{background:rgba(60,30,110,.95) !important}'
        + '@media (max-width:380px){.holo-gate-nav a{font-size:12px !important;padding:0 9px !important;height:32px !important}}';
      (document.head || document.documentElement).appendChild(css);
      var nav = document.createElement('div');
      nav.id = 'holo-gate-nav';
      nav.className = 'holo-gate-nav';
      var back = document.createElement('a');
      back.href = 'https://beta.holosarcade.ca/games-hub/';
      back.textContent = '\u2039 Back to Arcade';
      back.setAttribute('aria-label', 'Back to Holo\'s Arcade');
      var report = document.createElement('a');
      report.href = 'https://beta.holosarcade.ca/games-hub/?report=' + encodeURIComponent(slug);
      report.textContent = 'Report';
      report.setAttribute('aria-label', 'Report a problem with this game');
      nav.appendChild(back);
      nav.appendChild(report);
      document.body.appendChild(nav);
    }
    if (document.body) build();
    else if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', build);
    } else {
      /* Body not parsed yet but document already interactive: retry shortly. */
      setTimeout(build, 50);
    }
  }
})();
