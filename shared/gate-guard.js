/* GATE-GUARD-2026-11-24: standalone game pages are signed-in-only (beta).
   The hub gate (games-hub) already blocks signed-out visitors, but a
   direct game URL (beta.holosarcade.ca/<game>/) used to open and play
   with no sign-in at all (audit A1-1). Every standalone game page loads
   this script first thing in <head>; it checks for the same signed-in
   session marker the hub itself uses, and sends anyone without one to
   the hub gate page. Signed-in hub sessions pass straight through —
   the hub only sets an iframe src after its own session check passes,
   and the iframe shares localStorage with the hub (same origin).

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

  if (testerSession() || firebaseSession()) return;

  var GATE = 'https://beta.holosarcade.ca/games-hub/';
  try {
    /* Hub-framed play: send the whole hub to the gate, not just the frame. */
    if (window.top && window.top !== window) { window.top.location.replace(GATE); return; }
  } catch (e) { /* cross-origin frame: fall through to a self-redirect */ }
  try { window.location.replace(GATE); } catch (e) {}
})();
