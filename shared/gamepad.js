/* HOLO-GAMEPAD-2026-11-23 — shared gamepad helper for Holo's Arcade.
 *
 * One file, used by every game that has movement/action controls.
 * A game wires itself in with two lines at the end of <body>:
 *   <script src="../shared/gamepad.js"></script>
 *   <script>if (window.HoloGamepad) HoloGamepad.bind({ keys: { ... } });</script>
 *
 * HOW IT WORKS: the helper polls the browser Gamepad API and turns
 * controller input into the SAME synthetic KeyboardEvents the game
 * already listens for. Games need no logic changes — keyboard, touch
 * and mouse keep working exactly as before. If no controller is
 * connected, or the browser has no Gamepad API, the helper does
 * nothing at all (bind() is a safe no-op).
 *
 * STANDARD MAPPING (controller side — same in every game):
 *   Left stick / D-pad .... move (up / down / left / right)
 *   A (bottom button) ...... action      (per-game: fire, launch, use item…)
 *   B (right button) ....... back        (only if the game maps it)
 *   X (left button) ........ action2     (only if the game maps it)
 *   RB / RT ................ boost       (only if the game maps it)
 *   Start .................. pause       (only if the game maps it)
 * The keyboard side is per-game: bind({ keys: { up:'ArrowUp', ... } })
 * maps each controller action to the key that game already uses.
 *
 * MULTIPLE GAMEPADS: bind() takes a `player` (gamepad index, default 0).
 * Call bind() twice with different players and different key maps for
 * pass-and-play two-player games. Each binding is independent.
 *
 * WEB + APP — SAME CODE PATH: the helper uses only standard web APIs
 * (navigator.getGamepads, requestAnimationFrame, KeyboardEvent). No
 * hub/parent-frame access, no desktop-only APIs, so it runs unchanged
 * in the web beta and in the Capacitor app wrap (the app IS the web
 * hub in a WebView). Platform notes (verified 2026-11-23):
 *   - Chrome (desktop + Android) requires a SECURE context (HTTPS)
 *     for the Gamepad API since Chrome 86. The beta is HTTP, so the
 *     helper sits dormant there in Chrome until the beta moves to
 *     HTTPS. Safari does not require a secure context.
 *   - Android: Chrome for Android supports the API; the Capacitor app
 *     runs in the system (Chromium) WebView and serves over
 *     https://localhost (secure), so it is expected to work with
 *     Bluetooth/USB controllers — MUST still be verified on a real
 *     Android device with a real controller when the app exists.
 *   - iOS: Safari on iOS supports the API since 10.3, but WKWebView
 *     gamepad support is uncertain (WebKit bug 269292: the WKWebView
 *     must be the firstResponder; Capacitor's WKWebView may or may
 *     not expose it). NEEDS a real-iPhone check when the app exists.
 *     Do not claim iPhone gamepad works until that check is done.
 *   - Real-console testing happens during live testing (decided
 *     2026-11-23). This file is the BUILD, not the hardware test.
 *
 * EXTENDING: new controller types and per-game needs plug into the
 * same helper — add a button index to `buttons` in bind(), or a new
 * action name to ACTIONS. Do not copy this file into games.
 *
 * SERVER-READY-2026-11-23 — future one-server-for-all-games (deferred,
 * NOT built): the helper is designed so it plugs into the server
 * without a rewrite. What is ready NOW:
 *   - Inputs as data: every mapped action change also emits a
 *     structured event via HoloGamepad.onInput(fn) —
 *     { player, action, pressed, t } (t = performance.now() ms).
 *     The future network layer subscribes to the same feed and sends
 *     it over the wire; the local keyboard dispatch stays untouched.
 *   - Snapshots: HoloGamepad.snapshot(player) returns a
 *     JSON-serializable pad state (player, t, buttons, axes, dpad)
 *     for future state sync.
 *   - Player slots: bind({ player: 0 }) is slot 0 (player 1),
 *     player 1 is slot 1 (player 2). Slots map to network players
 *     later — the slot model does not change.
 * What the server still has to provide (NOT in this file, no
 * networking built here): the transport, room assignment (one room
 * per game), authoritative game state, latency handling, and
 * leaderboard writes. No fetch/WebSocket/leaderboard code lives here.
 */
(function () {
  'use strict';
  if (window.HoloGamepad) return; // already loaded (never load twice)

  var SUPPORTED = (typeof navigator !== 'undefined' &&
    typeof navigator.getGamepads === 'function');

  // Standard Gamepad API button indices (mapping === 'standard').
  var BTN = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7,
              BACK: 8, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };

  // Default controller-side mapping: action name -> gamepad button indices.
  var DEFAULT_BUTTONS = {
    action:  [BTN.A],
    back:    [BTN.B],
    action2: [BTN.X],
    boost:   [BTN.RB, BTN.RT],
    pause:   [BTN.START]
  };

  // Actions the helper knows. Directions come from D-pad + left stick.
  var ACTIONS = ['up', 'down', 'left', 'right',
                 'action', 'back', 'action2', 'boost', 'pause'];

  var DEADZONE_DEFAULT = 0.25;

  // Key (KeyboardEvent.key) for a code when the game only gives a code.
  function deriveKey(code) {
    if (code === 'Space') return ' ';
    if (code === 'ShiftLeft' || code === 'ShiftRight') return 'Shift';
    if (code === 'Escape') return 'Escape';
    if (code === 'Enter') return 'Enter';
    if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
    if (/^Arrow/.test(code)) return code;
    if (/^Digit[0-9]$/.test(code)) return code.slice(5);
    return code;
  }

  function toKeySpec(spec) {
    if (typeof spec === 'string') return { code: spec, key: deriveKey(spec) };
    if (spec && typeof spec.code === 'string') {
      return { code: spec.code, key: spec.key || deriveKey(spec.code) };
    }
    return null;
  }

  var bindings = [];      // { player, keys, buttons, axes, dpad, deadzone, prev }
  var loopStarted = false;
  var badgeEl = null;
  var badgeWanted = false;
  var connectHandlers = [];
  var disconnectHandlers = [];
  // SERVER-READY-2026-11-23: structured input-event subscribers.
  // Each event: { player, action, pressed, t } — the wire format the
  // future server layer will send; the local game still gets the
  // synthetic KeyboardEvent. No networking here.
  var inputHandlers = [];

  function nowMs() {
    try {
      return (typeof performance !== 'undefined' && performance.now)
        ? performance.now() : Date.now();
    } catch (e) { return Date.now(); }
  }

  function emitInput(player, action, pressed) {
    var ev = { player: player, action: action, pressed: pressed, t: nowMs() };
    for (var i = 0; i < inputHandlers.length; i++) {
      try { inputHandlers[i](ev); } catch (e) {}
    }
  }

  function getPad(index) {
    try {
      var pads = navigator.getGamepads ? navigator.getGamepads() : [];
      if (!pads) return null;
      var pad = pads[index];
      return (pad && pad.connected) ? pad : null;
    } catch (e) { return null; }
  }

  function buttonPressed(pad, idx) {
    var b = pad.buttons && pad.buttons[idx];
    if (!b) return false;
    return (typeof b === 'object') ? !!b.pressed || (b.value || 0) > 0.5 : !!b;
  }

  function anyPressed(pad, indices) {
    for (var i = 0; i < indices.length; i++) {
      if (buttonPressed(pad, indices[i])) return true;
    }
    return false;
  }

  function axisValue(pad, idx) {
    var v = pad.axes && pad.axes[idx];
    return (typeof v === 'number' && isFinite(v)) ? v : 0;
  }

  // Desired pressed state for one action on one pad, given a binding.
  function actionPressed(b, action, pad) {
    var dz = b.deadzone;
    if (b.dpad) {
      if (action === 'up' && buttonPressed(pad, BTN.UP)) return true;
      if (action === 'down' && buttonPressed(pad, BTN.DOWN)) return true;
      if (action === 'left' && buttonPressed(pad, BTN.LEFT)) return true;
      if (action === 'right' && buttonPressed(pad, BTN.RIGHT)) return true;
    }
    if (b.axes) {
      var ax = axisValue(pad, 0), ay = axisValue(pad, 1);
      if (action === 'up' && ay < -dz) return true;
      if (action === 'down' && ay > dz) return true;
      if (action === 'left' && ax < -dz) return true;
      if (action === 'right' && ax > dz) return true;
    }
    var btns = b.buttons[action];
    if (btns && anyPressed(pad, btns)) return true;
    return false;
  }

  function dispatchKey(type, spec) {
    try {
      var ev;
      if (typeof KeyboardEvent === 'function') {
        ev = new KeyboardEvent(type, {
          key: spec.key, code: spec.code,
          bubbles: true, cancelable: true, composed: true
        });
      } else {
        ev = document.createEvent('KeyboardEvent');
        ev.initKeyboardEvent(type, true, true, window,
          spec.key, 0, '', false, '');
      }
      // Dispatch on document: reaches document listeners directly and
      // window listeners by bubbling (games listen on either).
      document.dispatchEvent(ev);
    } catch (e) { /* never break the game for a controller */ }
  }

  function ensureBadge() {
    if (badgeEl || !badgeWanted || !document.body) return;
    badgeEl = document.createElement('div');
    badgeEl.id = 'holo-gamepad-badge';
    badgeEl.setAttribute('aria-hidden', 'true');
    badgeEl.textContent = '\uD83C\uDFAE Controller connected';
    badgeEl.style.cssText = [
      'position:fixed', 'left:12px', 'bottom:12px', 'z-index:9999',
      'padding:6px 12px', 'border-radius:999px', 'font-size:12px',
      'font-family:inherit', 'line-height:1.4', 'pointer-events:none',
      'background:#0a0620', 'color:#e9e4ff',
      'border:2px solid #7c4dff', 'box-shadow:0 0 12px rgba(124,77,255,.55)',
      'display:none'
    ].join(';');
    document.body.appendChild(badgeEl);
  }

  function updateBadge() {
    if (!badgeWanted) return;
    ensureBadge();
    if (!badgeEl) return;
    var any = false;
    for (var i = 0; i < bindings.length; i++) {
      if (getPad(bindings[i].player)) { any = true; break; }
    }
    badgeEl.style.display = any ? 'block' : 'none';
  }

  function poll() {
    for (var i = 0; i < bindings.length; i++) {
      var b = bindings[i];
      var pad = getPad(b.player);
      for (var a = 0; a < ACTIONS.length; a++) {
        var name = ACTIONS[a];
        var spec = b.keys[name];
        if (!spec) continue;
        var want = pad ? actionPressed(b, name, pad) : false;
        if (want !== b.prev[name]) {
          b.prev[name] = want;
          dispatchKey(want ? 'keydown' : 'keyup', spec);
          // SERVER-READY-2026-11-23: same moment, structured data.
          emitInput(b.player, name, want);
        }
      }
    }
    updateBadge();
    if (bindings.length) {
      if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(poll);
      } else {
        setTimeout(poll, 16);
      }
    } else {
      loopStarted = false;
    }
  }

  function startLoop() {
    if (loopStarted || !bindings.length) return;
    loopStarted = true;
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(poll);
    } else {
      setTimeout(poll, 16);
    }
  }

  function onGamepadEvent(type, e) {
    updateBadge();
    var list = (type === 'connect') ? connectHandlers : disconnectHandlers;
    for (var i = 0; i < list.length; i++) {
      try { list[i](e && e.gamepad ? e.gamepad : null); } catch (err) {}
    }
  }

  if (typeof window.addEventListener === 'function') {
    window.addEventListener('gamepadconnected', function (e) {
      onGamepadEvent('connect', e);
    });
    window.addEventListener('gamepaddisconnected', function (e) {
      onGamepadEvent('disconnect', e);
    });
  }

  window.HoloGamepad = {
    VERSION: '1.0.0 (HOLO-GAMEPAD-2026-11-23)',

    supported: function () { return SUPPORTED; },

    // Bind one player. config: { player, keys, buttons, axes, dpad,
    // deadzone, badge, onConnect, onDisconnect }
    // keys: { up:'ArrowUp', down, left, right, action:'Space',
    //         action2:'KeyX', boost:'ShiftLeft', pause:'KeyP', back:'Escape' }
    //   — only the actions a game lists are dispatched.
    // buttons: optional override of the controller-side mapping,
    //   e.g. { action:[0], pause:[9] } (button indices, standard layout).
    bind: function (config) {
      if (!SUPPORTED) return false;
      config = config || {};
      var keys = {};
      var src = config.keys || {};
      for (var i = 0; i < ACTIONS.length; i++) {
        var spec = toKeySpec(src[ACTIONS[i]]);
        if (spec) keys[ACTIONS[i]] = spec;
      }
      var buttons = {};
      for (var j = 0; j < ACTIONS.length; j++) {
        var name = ACTIONS[j];
        if (config.buttons && config.buttons[name]) {
          buttons[name] = config.buttons[name];
        } else if (DEFAULT_BUTTONS[name]) {
          buttons[name] = DEFAULT_BUTTONS[name];
        } else {
          buttons[name] = [];
        }
      }
      var b = {
        player: (typeof config.player === 'number') ? config.player : 0,
        keys: keys,
        buttons: buttons,
        axes: config.axes !== false,
        dpad: config.dpad !== false,
        deadzone: (typeof config.deadzone === 'number') ? config.deadzone : DEADZONE_DEFAULT,
        prev: {}
      };
      bindings.push(b);
      if (config.badge !== false) badgeWanted = true;
      if (typeof config.onConnect === 'function') connectHandlers.push(config.onConnect);
      if (typeof config.onDisconnect === 'function') disconnectHandlers.push(config.onDisconnect);
      startLoop();
      updateBadge();
      return true;
    },

    unbindAll: function () {
      bindings = [];
      connectHandlers = [];
      disconnectHandlers = [];
      inputHandlers = [];
      if (badgeEl && badgeEl.parentNode) badgeEl.parentNode.removeChild(badgeEl);
      badgeEl = null;
      badgeWanted = false;
    },

    // Connected pads, for debugging / future menus.
    // [{ index, id, mapping, buttons, axes }]
    pads: function () {
      var out = [];
      if (!SUPPORTED) return out;
      try {
        var list = navigator.getGamepads() || [];
        for (var i = 0; i < list.length; i++) {
          var p = list[i];
          if (p && p.connected) {
            out.push({ index: p.index, id: p.id || '',
                       mapping: p.mapping || '',
                       buttons: (p.buttons || []).length,
                       axes: (p.axes || []).length });
          }
        }
      } catch (e) {}
      return out;
    },

    isConnected: function (player) {
      return !!getPad(typeof player === 'number' ? player : 0);
    },

    onConnect: function (fn) { if (typeof fn === 'function') connectHandlers.push(fn); },
    onDisconnect: function (fn) { if (typeof fn === 'function') disconnectHandlers.push(fn); },

    // SERVER-READY-2026-11-23: subscribe to structured input events.
    // fn receives { player, action, pressed, t } on every mapped
    // action change. The future server transport subscribes here.
    onInput: function (fn) { if (typeof fn === 'function') inputHandlers.push(fn); },
    offInput: function (fn) {
      var i = inputHandlers.indexOf(fn);
      if (i >= 0) inputHandlers.splice(i, 1);
    },

    // SERVER-READY-2026-11-23: JSON-serializable pad snapshot for
    // future state sync. { player, t, connected, id, buttons, axes, dpad }
    snapshot: function (player) {
      var idx = (typeof player === 'number') ? player : 0;
      var pad = getPad(idx);
      var snap = { player: idx, t: nowMs(), connected: !!pad, id: '',
                   buttons: {}, axes: [0, 0], dpad: {} };
      if (!pad) return snap;
      snap.id = pad.id || '';
      var names = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'BACK', 'START'];
      for (var i = 0; i < names.length; i++) {
        snap.buttons[names[i]] = buttonPressed(pad, BTN[names[i]]);
      }
      snap.axes = [axisValue(pad, 0), axisValue(pad, 1)];
      snap.dpad = { up: buttonPressed(pad, BTN.UP), down: buttonPressed(pad, BTN.DOWN),
                    left: buttonPressed(pad, BTN.LEFT), right: buttonPressed(pad, BTN.RIGHT) };
      return snap;
    }
  };
})();
