/* ============================================================
   DIFFICULTY-SCALE-2026-11-25 — shared difficulty scale v1
   Holo 2026-11-25 22:57 "Worth a try": ONE 0-10 difficulty scale
   for ALL Arcade games. Kid range 0-5, adult range 4-10, the 4-5
   band is the shared zone (older kids + adults).
   Kid:    Duckling 0-1, Explorer 2-3, Super Star 4-5.
   Adult:  Warm-Up 4-5, Showdown 6-8, Boss Mode 9-10.
   A game offers 3 slots. The slots are the same shape as today's
   Easy / Normal / Hard — the NAMES and BANDS change with the
   audience, the game's own difficulty keys do not. Per-game
   tuning of each slot to its band happens at finalize time;
   this module is the picker + labels, not a retune.

   CANONICAL COPY: this file (shared/difficulty-scale.js).
   A game uses it with:
     <script src="../shared/difficulty-scale.js"></script>
   then, once, after its own difficulty buttons exist:
     HoloDifficulty.relabelButtons(document, ['easy','normal','hard']);
   or for a <select>:
     HoloDifficulty.relabelSelect(document.getElementById('diffSel'), ['easy','normal','hard']);
   or to build a fresh picker:
     HoloDifficulty.renderPicker(el, {keys:['easy','normal','hard'], selected:1, onPick:function(slot,key){...}});
   Tutorial text can name a level with:
     <span data-hd-name="0">Easy</span>  (filled with the level name
     for the current audience; data-hd-band="0" fills the band).

   AUDIENCE — how the game knows kid vs adult (in order):
   0. KIDS' AREA: if the game runs inside the kids' area
      (pathname starts with /kids/, or window.HOLO_KIDS_AREA is
      true, or ?kids=1), the audience is ALWAYS 'kid' — no
      override, no adult levels, ever. 18+ games NEVER enter the
      kids' area (standing rule, no exceptions).
   1. ?aud=kid|adult on the page URL (explicit; testable).
   2. localStorage 'holos-arcade-audience' = 'kid'|'adult'
      (the hub writes this on sign-in / DOB change — see the
      hub follow-up snippet in the scheme doc).
   3. window.parent.holoAge18.isAdultByDob() — same-origin hub,
      live DOB check. Works because games run in same-origin
      iframes on beta.holosarcade.ca.
   4. postMessage {type:'holo-audience', audience:'kid'|'adult'}
      (hub broadcast; re-renders labels live).
   5. Default 'kid' — the gentler range. FAIL-CLOSED on purpose:
      no DOB on file = kid audience, same as the 18+ rule.

   KID PROGRESSION (Holo 2026-11-25 23:07): every kid starts on
   Duckling (slot 0). Winning moves them up: WINS_TO_UNLOCK wins
   at the current level unlocks the next level and moves the kid
   onto it. A parent can set the level directly with the parent
   PIN — the game/kids' page verifies the PIN through the hub's
   existing parent-PIN flow first, then calls setKidLevel with
   pinVerified=true. The module never sees or stores the PIN.
   Progress is per game, stored in localStorage for now
   (holos-arcade-kid-level-<slug>, holos-arcade-kid-wins-<slug>);
   it follows the account when cloud progress lands.
   What counts as a "win" is the game's own call — a match win,
   a level clear, a score goal — made by calling recordWin(slug)
   when it happens. WINS_TO_UNLOCK = 3 is the proposed default;
   Holo can change the number.
   ============================================================ */
(function () {
  'use strict';
  if (window.HoloDifficulty) return;

  var SCALE = {
    version: 1,
    WINS_TO_UNLOCK: 3, /* kid progression: wins at the current level to move up (proposed default; Holo can change) */
    kid: [
      { slot: 0, name: 'Duckling',   band: '0–1', lo: 0, hi: 1,  blurb: 'First time playing, learning the buttons.' },
      { slot: 1, name: 'Explorer',   band: '2–3', lo: 2, hi: 3,  blurb: 'Knows the game, wants a bit of a push.' },
      { slot: 2, name: 'Super Star', band: '4–5', lo: 4, hi: 5,  blurb: 'Top kid level — same spot as adult Warm-Up.' }
    ],
    adult: [
      { slot: 0, name: 'Warm-Up',   band: '4–5',  lo: 4, hi: 5,  blurb: 'Gentle start.' },
      { slot: 1, name: 'Showdown',  band: '6–8',  lo: 6, hi: 8,  blurb: 'Real challenge — timing and tactics.' },
      { slot: 2, name: 'Boss Mode', band: '9–10', lo: 9, hi: 10, blurb: 'The hardest the game gets.' }
    ]
  };

  var listeners = [];
  var cachedAudience = null;

  /* Kids' area: pathname /kids/..., or window.HOLO_KIDS_AREA, or ?kids=1.
     Inside it the audience is ALWAYS kid — no override of any kind. */
  function isKidsArea() {
    try {
      if (window.HOLO_KIDS_AREA === true) return true;
      if ((window.location.pathname || '').indexOf('/kids/') === 0) return true;
      var q = new URLSearchParams(window.location.search || '');
      if (q.get('kids') === '1') return true;
    } catch (e) {}
    return false;
  }

  function readQuery() {
    try {
      var q = new URLSearchParams(window.location.search || '');
      var a = (q.get('aud') || '').toLowerCase();
      if (a === 'kid' || a === 'adult') return a;
    } catch (e) {}
    return null;
  }
  function readStored() {
    try {
      var a = (window.localStorage.getItem('holos-arcade-audience') || '').toLowerCase();
      if (a === 'kid' || a === 'adult') return a;
    } catch (e) {}
    return null;
  }
  function readParent() {
    try {
      var p = window.parent;
      if (p && p !== window && p.holoAge18 && typeof p.holoAge18.isAdultByDob === 'function') {
        return p.holoAge18.isAdultByDob() ? 'adult' : 'kid';
      }
    } catch (e) {}
    return null;
  }
  function resolveAudience() {
    if (isKidsArea()) return 'kid';
    return readQuery() || readStored() || readParent() || 'kid';
  }
  function audience() {
    if (!cachedAudience) cachedAudience = resolveAudience();
    return cachedAudience;
  }
  function levels(aud) {
    return SCALE[aud === 'adult' ? 'adult' : 'kid'];
  }
  function level(slot, aud) {
    var lv = levels(aud || audience());
    slot = Math.max(0, Math.min(2, slot | 0));
    return lv[slot];
  }
  function label(slot, aud) { return level(slot, aud).name; }
  function band(slot, aud) { return level(slot, aud).band; }

  function setAudience(a, source) {
    if (a !== 'kid' && a !== 'adult') return false;
    if (isKidsArea() && a === 'adult') return false; /* kids' area never leaves kid */
    if (cachedAudience === a) return false;
    cachedAudience = a;
    try { window.localStorage.setItem('holos-arcade-audience', a); } catch (e) {}
    listeners.forEach(function (cb) { try { cb(a, source || 'set'); } catch (e) {} });
    return true;
  }

  /* ---- Kid progression (Holo 2026-11-25 23:07) ----
     Every kid starts on Duckling (slot 0). WINS_TO_UNLOCK wins at the
     current level moves them up one level. A parent sets the level
     directly with the parent PIN: the caller verifies the PIN through
     the hub's existing parent-PIN flow FIRST, then calls setKidLevel
     with pinVerified=true. The module never sees or stores the PIN. */
  function kidLevelKey(slug) { return 'holos-arcade-kid-level-' + slug; }
  function kidWinsKey(slug) { return 'holos-arcade-kid-wins-' + slug; }
  function readInt(key, fallback) {
    try { var v = parseInt(window.localStorage.getItem(key) || '', 10); return isNaN(v) ? fallback : v; }
    catch (e) { return fallback; }
  }
  function kidState(slug) {
    slug = String(slug || 'game');
    var level = Math.max(0, Math.min(2, readInt(kidLevelKey(slug), 0)));
    var wins = Math.max(0, readInt(kidWinsKey(slug), 0));
    return { slug: slug, level: level, wins: wins,
      unlocked: [true, level >= 1, level >= 2] };
  }
  /* Call when the kid WINS this game (match win, level clear, score
     goal — the game decides what counts). Returns the new state;
     advanced=true when the win moved the kid up a level. */
  function recordWin(slug) {
    var st = kidState(slug);
    if (st.level >= 2) return { slug: st.slug, level: 2, wins: st.wins, advanced: false };
    var wins = st.wins + 1, level = st.level, advanced = false;
    if (wins >= SCALE.WINS_TO_UNLOCK) { level = st.level + 1; wins = 0; advanced = true; }
    try {
      window.localStorage.setItem(kidLevelKey(slug), String(level));
      window.localStorage.setItem(kidWinsKey(slug), String(wins));
    } catch (e) {}
    return { slug: st.slug, level: level, wins: wins, advanced: advanced };
  }
  /* Parent override: set the kid's level directly. pinVerified MUST be
     true — the caller verifies the parent PIN first. Without it the
     call fails closed and nothing changes. */
  function setKidLevel(slug, slot, pinVerified) {
    slot = slot | 0;
    if (!pinVerified) return { ok: false, reason: 'pin' };
    if (slot < 0 || slot > 2) return { ok: false, reason: 'slot' };
    try {
      window.localStorage.setItem(kidLevelKey(slug), String(slot));
      window.localStorage.setItem(kidWinsKey(slug), '0');
    } catch (e) {}
    return { ok: true, level: slot };
  }

  /* Fill every [data-hd-name="slot"] with the level name and every
     [data-hd-band="slot"] with the band, for the current audience. */
  function applyNames(root, aud) {
    root = root || document;
    aud = aud || audience();
    var lv = levels(aud);
    try {
      root.querySelectorAll('[data-hd-name]').forEach(function (el) {
        var s = parseInt(el.getAttribute('data-hd-name'), 10);
        if (!isNaN(s) && lv[s]) el.textContent = lv[s].name;
      });
      root.querySelectorAll('[data-hd-band]').forEach(function (el) {
        var s = parseInt(el.getAttribute('data-hd-band'), 10);
        if (!isNaN(s) && lv[s]) el.textContent = lv[s].band;
      });
    } catch (e) {}
  }

  /* Relabel existing difficulty buttons in place. keys is the game's
     own key list in slot order, e.g. ['easy','normal','hard'] or
     ['easy','medium','hard']. Buttons are found by data-diff / data-level.
     Each button becomes: <span class="hd-name">Name</span>
     <span class="hd-band">0–1</span>. The game's own click handlers
     are untouched — this only changes labels. */
  function relabelButtons(root, keys, aud) {
    root = root || document;
    keys = keys || ['easy', 'normal', 'hard'];
    aud = aud || audience();
    var lv = levels(aud);
    keys.forEach(function (key, slot) {
      var btns = [];
      try {
        btns = Array.prototype.slice.call(root.querySelectorAll(
          '[data-diff="' + key + '"], [data-level="' + key + '"]'));
      } catch (e) {}
      btns.forEach(function (b) {
        b.setAttribute('data-hd-slot', String(slot));
        var nameEl = b.querySelector('.hd-name');
        var bandEl = b.querySelector('.hd-band');
        if (!nameEl) { nameEl = document.createElement('span'); nameEl.className = 'hd-name'; b.appendChild(nameEl); }
        if (!bandEl) { bandEl = document.createElement('span'); bandEl.className = 'hd-band'; b.appendChild(bandEl); }
        /* Drop the game's old plain-text label once, keep nothing else. */
        Array.prototype.slice.call(b.childNodes).forEach(function (n) {
          if (n.nodeType === 3) b.removeChild(n);
        });
        nameEl.textContent = lv[slot].name;
        bandEl.textContent = lv[slot].band;
      });
    });
    applyNames(root, aud);
  }

  /* Relabel a <select> difficulty picker in place: each option becomes
     "Name · band", values untouched, selection untouched. */
  function relabelSelect(sel, keys, aud) {
    if (!sel) return;
    keys = keys || ['easy', 'normal', 'hard'];
    aud = aud || audience();
    var lv = levels(aud);
    try {
      Array.prototype.slice.call(sel.options).forEach(function (opt) {
        var slot = keys.indexOf(opt.value);
        if (slot > -1 && lv[slot]) opt.textContent = lv[slot].name + ' · ' + lv[slot].band;
      });
    } catch (e) {}
  }

  /* Build a fresh 3-button picker. opts: {keys, selected, onPick,
     showBands (default true), label (default 'Difficulty'),
     locked: [slots that are not unlocked yet — rendered disabled
     with a "win N games to unlock" note]}.
     onPick(slot, key) is called on tap; the picker does NOT persist —
     the game saves its own key as it does today. */
  function renderPicker(container, opts) {
    if (!container) return null;
    opts = opts || {};
    var keys = opts.keys || ['easy', 'normal', 'hard'];
    var aud = opts.audience || audience();
    var lv = levels(aud);
    var selected = typeof opts.selected === 'number' ? opts.selected : 0;
    var locked = opts.locked || [];
    container.classList.add('hd-picker');
    container.setAttribute('role', 'group');
    container.setAttribute('aria-label', opts.label || 'Difficulty');
    container.innerHTML = '';
    keys.forEach(function (key, slot) {
      var b = document.createElement('button');
      b.type = 'button';
      var isLocked = locked.indexOf(slot) > -1;
      b.className = 'hd-level' + (slot === selected ? ' hd-selected' : '') + (isLocked ? ' hd-locked' : '');
      b.setAttribute('data-hd-slot', String(slot));
      b.setAttribute('data-diff', key);
      b.setAttribute('aria-pressed', slot === selected ? 'true' : 'false');
      b.disabled = isLocked;
      b.title = isLocked
        ? 'Locked — win ' + SCALE.WINS_TO_UNLOCK + ' games as ' + (slot > 0 ? lv[slot - 1].name : lv[slot].name) + ' to unlock ' + lv[slot].name + '.'
        : lv[slot].blurb;
      var n = document.createElement('span'); n.className = 'hd-name'; n.textContent = lv[slot].name;
      b.appendChild(n);
      if (opts.showBands !== false) {
        var g = document.createElement('span'); g.className = 'hd-band'; g.textContent = lv[slot].band;
        b.appendChild(g);
      }
      b.addEventListener('click', function () {
        if (isLocked) return;
        selected = slot;
        Array.prototype.slice.call(container.querySelectorAll('.hd-level')).forEach(function (x, i) {
          x.classList.toggle('hd-selected', i === slot);
          x.setAttribute('aria-pressed', i === slot ? 'true' : 'false');
        });
        if (typeof opts.onPick === 'function') opts.onPick(slot, key);
      });
      container.appendChild(b);
    });
    applyNames(container, aud);
    return container;
  }

  /* Kid picker: selected = the kid's current level, higher levels
     locked until unlocked by wins. onPick only fires for unlocked
     slots. Use this in the kids' area; the main hub uses renderPicker. */
  function kidPicker(container, slug, keys, opts) {
    opts = opts || {};
    var st = kidState(slug);
    var locked = [];
    st.unlocked.forEach(function (u, i) { if (!u) locked.push(i); });
    return renderPicker(container, {
      keys: keys, selected: st.level, locked: locked,
      audience: 'kid', label: opts.label || 'Difficulty', onPick: opts.onPick
    });
  }

  function onAudienceChange(cb) {
    if (typeof cb === 'function') listeners.push(cb);
  }

  /* Hub broadcast (future): {type:'holo-audience', audience:'kid'|'adult'}.
     Re-labels the page live when the account changes under the game. */
  try {
    window.addEventListener('message', function (ev) {
      var d = ev && ev.data;
      if (d && d.type === 'holo-audience' && (d.audience === 'kid' || d.audience === 'adult')) {
        if (setAudience(d.audience, 'message')) applyNames(document);
      }
    });
  } catch (e) {}

  window.HoloDifficulty = {
    SCALE: SCALE, version: SCALE.version,
    WINS_TO_UNLOCK: SCALE.WINS_TO_UNLOCK,
    audience: audience, levels: levels, level: level,
    label: label, band: band, setAudience: setAudience,
    onAudienceChange: onAudienceChange,
    isKidsArea: isKidsArea,
    kidState: kidState, recordWin: recordWin, setKidLevel: setKidLevel,
    kidPicker: kidPicker,
    applyNames: applyNames, relabelButtons: relabelButtons,
    relabelSelect: relabelSelect, renderPicker: renderPicker
  };
})();
