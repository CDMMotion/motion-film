/*
 * Mótion Film -- Text Animation tab: a library of text entrances / exits
 * (client/textanim-library.js) applied as Text Animators to the selected
 * text layers (host/textanim.jsx, loaded here with $.evalFile).
 *
 *   - Two slots, In and Out, each holding one preset; ‹ › step through
 *     the library, the dice picks one at random, the toggle turns the
 *     slot off. A card click fills the highlighted slot, right-click
 *     fills Out. Combos fill both.
 *   - Every preview (the stage and the cards) is drawn here with the
 *     same selector math the host writes into AE -- per-unit selection
 *     from the Range Selector ramp, then that unit's hidden look scaled
 *     by it -- so a card shows what the layer gets.
 *   - Layout = Home's collapsible sections: 01 PREVIEW (stage, slots,
 *     timing, Apply) and 02 LIBRARY (filters, categories, grid).
 *   - The stage plays In -> hold -> Out with the durations and ease set
 *     under it, on the selected layer's own text when there is one.
 *   - Settings and favorites live under "motionfilm-textanim" (mirrored
 *     by shared-core.js to Documents/Mótion Film Packs/settings.json).
 */
(function () {
  "use strict";

  var LIB = window.MFTextAnimLib;
  if (!LIB || !document.getElementById("page-textanim")) { return; }

  var KEY = "motionfilm-textanim";
  var DEFAULT_TEXT = "Your text\nin motion";
  var CARD_TEXT = "Text\nMotion";
  var PAGE = 72;

  function $(id) { return document.getElementById(id); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function status(message, type) {
    if (window.MF && typeof window.MF.setStatus === "function") { window.MF.setStatus(message, type); }
  }

  // ------------------------------------------------------------------ settings

  var state = {
    inId: "fade-rise-w", outId: "fade-fall-w", inOn: true, outOn: true,
    slot: "in", durIn: 1, durOut: 0.8, ease: "smooth",
    cat: "all", unit: "all", favs: []
  };
  (function load() {
    try {
      var saved = JSON.parse(window.localStorage.getItem(KEY) || "{}");
      for (var k in saved) { if (Object.prototype.hasOwnProperty.call(state, k)) { state[k] = saved[k]; } }
    } catch (e) {}
    if (!LIB.byId[state.inId]) { state.inId = LIB.presets[0].id; }
    if (!LIB.byId[state.outId]) { state.outId = LIB.presets[0].id; }
    if (!Array.isArray(state.favs)) { state.favs = []; }
  }());
  function save() {
    try { window.localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }
  function isFav(id) { return state.favs.indexOf(id) >= 0; }

  // ------------------------------------------------------------------ host

  function extensionDir() {
    var raw = "";
    try { raw = window.__adobe_cep__.getSystemPath("extension"); } catch (e) {}
    var p = decodeURIComponent(String(raw).replace(/^file:\/+/, ""));
    if (!/^[A-Za-z]:/.test(p)) { p = "/" + p; }
    return p;
  }

  var hostLoaded = false;
  function ensureHost(callback) {
    if (hostLoaded) { callback(true); return; }
    if (!window.__adobe_cep__) { callback(false); return; }
    var path = extensionDir() + "/host/textanim.jsx";
    window.__adobe_cep__.evalScript("$.evalFile(" + JSON.stringify(path) + "); typeof taApply", function (res) {
      hostLoaded = res === "function";
      callback(hostLoaded);
    });
  }

  function call(name, args, callback) {
    ensureHost(function (ok) {
      if (!ok) {
        callback({ ok: false, error: window.__adobe_cep__ ? "Couldn't load the Text Animation script in After Effects." : "This panel must run inside After Effects." });
        return;
      }
      var parts = [];
      for (var i = 0; i < args.length; i += 1) { parts.push(JSON.stringify(args[i])); }
      window.__adobe_cep__.evalScript(name + "(" + parts.join(",") + ")", function (raw) {
        var res;
        try { res = JSON.parse(raw); } catch (e) { res = { ok: false, error: raw || "No answer from After Effects." }; }
        callback(res);
      });
    });
  }

  // ------------------------------------------------------------------ preview math
  // Mirrors textanim.jsx: Range Selector with Start 0, End = spread, the
  // Offset swept by two eased keyframes; Ramp Up for In, Ramp Down for
  // Out; "square" = a hard window (End 100).

  function bezier(x1, y1, x2, y2) {
    return function (x) {
      if (x <= 0) { return 0; }
      if (x >= 1) { return 1; }
      var lo = 0, hi = 1, t = x;
      for (var i = 0; i < 18; i += 1) {
        t = (lo + hi) / 2;
        var cx = 3 * x1 * t * (1 - t) * (1 - t) + 3 * x2 * t * t * (1 - t) + t * t * t;
        if (cx < x) { lo = t; } else { hi = t; }
      }
      return 3 * y1 * t * (1 - t) * (1 - t) + 3 * y2 * t * t * (1 - t) + t * t * t;
    };
  }
  // Offset keyframe influences from textanim.jsx setEase: In leaves the
  // first key with a and arrives with b; Out swaps them.
  var EASES = {
    linear: { "in": function (x) { return x; }, out: function (x) { return x; } },
    smooth: { "in": bezier(0.5, 0, 0.4, 1), out: bezier(0.6, 0, 0.5, 1) },
    strong: { "in": bezier(0.8, 0, 0.15, 1), out: bezier(0.85, 0, 0.2, 1) }
  };

  // The selector's own Ease High / Ease Low, approximated.
  function shapeCurve(t, eh, el) {
    var y = t;
    if (el) { y = el > 0 ? y + (y * y - y) * (el / 100) : y + (Math.sqrt(y) - y) * (-el / 100); }
    if (eh) { y = eh > 0 ? y + ((1 - (1 - y) * (1 - y)) - y) * (eh / 100) : y + (y * y * y - y) * (-eh / 100); }
    return clamp(y, 0, 1);
  }

  // How much of the hidden look unit `pos` (0..100) has at progress p.
  function amountAt(preset, mode, pos, p) {
    if (preset.shape === "square") {
      var o = mode === "in" ? p * 100 : -100 + p * 100;
      return pos >= o && pos <= o + 100 ? 1 : 0;
    }
    var w = clamp(preset.spread || 60, 5, 100);
    var off = -w + p * (100 + w);
    var t = clamp((pos - off) / w, 0, 1);
    var c = shapeCurve(t, preset.eh || 0, preset.el || 0);
    return mode === "in" ? c : 1 - c;
  }

  function seeded(seed) {
    var s = seed | 0;
    return function () {
      s = (s + 0x6D2B79F5) | 0;
      var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffled(n, seed) {
    var order = [];
    var i;
    for (i = 0; i < n; i += 1) { order.push(i); }
    var r = seeded(seed * 7919 + n);
    for (i = n - 1; i > 0; i -= 1) {
      var j = Math.floor(r() * (i + 1));
      var t = order[i]; order[i] = order[j]; order[j] = t;
    }
    return order;
  }

  // A sample: one span per character, grouped in lines, with each
  // character's char / word / line index.
  function buildSample(host, text) {
    host.innerHTML = "";
    var chars = [];
    var counts = { c: 0, w: 0, l: 0 };
    var lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
    for (var li = 0; li < lines.length; li += 1) {
      var line = document.createElement("div");
      line.className = "ta-line";
      var inWord = false;
      var str = lines[li] || " ";
      for (var ci = 0; ci < str.length; ci += 1) {
        var ch = str.charAt(ci);
        var span = document.createElement("span");
        span.className = "ta-c";
        span.textContent = ch;
        line.appendChild(span);
        if (/\s/.test(ch)) { inWord = false; continue; }
        if (!inWord) { counts.w += 1; inWord = true; }
        chars.push({ el: span, c: counts.c, w: counts.w - 1, l: li });
        counts.c += 1;
      }
      host.appendChild(line);
    }
    counts.l = lines.length;
    return { host: host, chars: chars, counts: counts, orders: {} };
  }

  function unitPos(sample, preset, ch) {
    var unit = preset.unit || "c";
    var n = Math.max(1, sample.counts[unit]);
    var idx = ch[unit];
    if (preset.rnd) {
      var key = unit + preset.rnd;
      if (!sample.orders[key]) { sample.orders[key] = shuffled(n, preset.rnd); }
      idx = sample.orders[key][idx];
    }
    return (idx + 0.5) / n * 100;
  }

  // Draws one moment: `mode` "in" | "out" | "still", p = 0..1 progress
  // of the selector (already eased), fs = font size in px.
  function paint(sample, preset, mode, p, fs) {
    var k = fs / 100;
    var v = preset ? preset.v : {};
    for (var i = 0; i < sample.chars.length; i += 1) {
      var ch = sample.chars[i];
      var a = preset && mode !== "still" ? amountAt(preset, mode, unitPos(sample, preset, ch), p) : 0;
      var st = ch.el.style;
      if (a <= 0.0005) {
        st.transform = ""; st.opacity = ""; st.filter = ""; st.margin = ""; st.transformOrigin = "";
        continue;
      }
      var opacity = typeof v.o === "number" ? 1 + a * (v.o / 100 - 1) : 1;
      var sx = v.s ? 1 + a * (v.s[0] / 100 - 1) : 1;
      var sy = v.s ? 1 + a * (v.s[1] / 100 - 1) : 1;
      var ap = v.ap || [0, 0, 0];
      var apx = ap[0] * k * a, apy = ap[1] * k * a;
      var px = v.p ? v.p[0] * k * a : 0;
      var py = v.p ? v.p[1] * k * a : 0;
      var pz = v.p ? (v.p[2] || 0) * k * a : 0;
      var t = "translate3d(" + (px - apx).toFixed(2) + "px," + (py - apy).toFixed(2) + "px," + (-pz).toFixed(2) + "px)";
      if (v.r) { t += " rotate(" + (v.r * a).toFixed(2) + "deg)"; }
      if (v.ry) { t += " rotateY(" + (v.ry * a).toFixed(2) + "deg)"; }
      if (v.rx) { t += " rotateX(" + (-v.rx * a).toFixed(2) + "deg)"; }
      if (v.sk) {
        var axis = v.ska || 0;
        t += " rotate(" + axis + "deg) skewX(" + (-v.sk * a).toFixed(2) + "deg) rotate(" + (-axis) + "deg)";
      }
      if (sx !== 1 || sy !== 1) { t += " scale(" + Math.max(0.001, sx).toFixed(3) + "," + Math.max(0.001, sy).toFixed(3) + ")"; }
      st.transformOrigin = "calc(50% + " + apx.toFixed(1) + "px) calc(78% + " + apy.toFixed(1) + "px)";
      st.transform = t;
      st.opacity = clamp(opacity, 0, 1).toFixed(3);
      if (v.b) {
        var blur = Math.max(v.b[0], v.b[1]) * k * a * 0.5;
        st.filter = blur > 0.05 ? "blur(" + blur.toFixed(2) + "px)" : "";
      } else {
        st.filter = "";
      }
      if (v.tr) {
        var m = v.tr / 1000 * fs * a / 2;
        st.margin = "0 " + m.toFixed(2) + "px";
      } else {
        st.margin = "";
      }
    }
  }

  // ------------------------------------------------------------------ stage

  var stage = { sample: null, text: "", fs: 30, t0: 0, hover: null };
  var layerText = "";

  function stageText() { return layerText || DEFAULT_TEXT; }

  function fitStage() {
    var box = $("ta-stage");
    var host = $("ta-sample");
    host.style.fontSize = "40px";
    var w = host.scrollWidth || 1;
    var h = host.scrollHeight || 1;
    var fs = 40 * Math.min((box.clientWidth * 0.82) / w, (box.clientHeight * 0.7) / h);
    stage.fs = clamp(fs, 9, 46);
    host.style.fontSize = stage.fs.toFixed(1) + "px";
  }

  function rebuildStage() {
    var text = stageText();
    stage.text = text;
    stage.sample = buildSample($("ta-sample"), text);
    fitStage();
  }

  function activePair() {
    if (stage.hover) {
      if (stage.hover.combo) { return { inP: LIB.byId[stage.hover.combo.inId], outP: LIB.byId[stage.hover.combo.outId] }; }
      var p = stage.hover.preset;
      return state.slot === "out" ? { inP: state.inOn ? LIB.byId[state.inId] : null, outP: p } : { inP: p, outP: state.outOn ? LIB.byId[state.outId] : null };
    }
    return { inP: state.inOn ? LIB.byId[state.inId] : null, outP: state.outOn ? LIB.byId[state.outId] : null };
  }

  // In -> hold -> Out -> gap, in seconds.
  function stageFrame(now) {
    var pair = activePair();
    var durIn = pair.inP ? state.durIn : 0;
    var durOut = pair.outP ? state.durOut : 0;
    var hold = 0.9, gap = 0.35;
    var total = durIn + hold + durOut + gap;
    var t = ((now - stage.t0) / 1000) % total;
    var ease = EASES[state.ease] || EASES.smooth;
    var tag = $("ta-stage-tag");
    if (pair.inP && t < durIn) {
      paint(stage.sample, pair.inP, "in", ease["in"](t / durIn), stage.fs);
      tag.textContent = "IN";
    } else if (t < durIn + hold || !pair.outP) {
      paint(stage.sample, null, "still", 0, stage.fs);
      tag.textContent = "";
    } else if (t < durIn + hold + durOut) {
      paint(stage.sample, pair.outP, "out", ease.out((t - durIn - hold) / durOut), stage.fs);
      tag.textContent = "OUT";
    } else {
      paint(stage.sample, pair.outP, "out", 1, stage.fs);
      tag.textContent = "";
    }
  }

  // ------------------------------------------------------------------ cards

  var cards = { list: [], shown: 0, live: null };

  function filtered() {
    var q = String($("ta-search").value || "").trim().toLowerCase();
    if (state.cat === "combos" && !/^#?\d+$/.test(q)) { return LIB.combos.map(function (c) { return { combo: c }; }); }
    var num = /^#?\d+$/.test(q) ? parseInt(q.replace("#", ""), 10) : 0;
    if (num) { return LIB.presets[num - 1] ? [{ preset: LIB.presets[num - 1] }] : []; }
    var out = [];
    for (var i = 0; i < LIB.presets.length; i += 1) {
      var p = LIB.presets[i];
      if (state.cat === "favs" ? !isFav(p.id) : (state.cat !== "all" && p.cat !== state.cat)) { continue; }
      if (state.unit !== "all" && p.unit !== state.unit) { continue; }
      if (q && (p.name + " " + p.tags).toLowerCase().indexOf(q) < 0) { continue; }
      out.push({ preset: p });
    }
    return out;
  }

  var STAR = '<svg viewBox="0 0 16 16" width="11" height="11"><path d="M8 1.9l1.8 3.8 4.1.5-3 2.8.8 4.1L8 11.1 4.3 13.1l.8-4.1-3-2.8 4.1-.5z"/></svg>';

  function cardFor(item) {
    var el = document.createElement("button");
    el.type = "button";
    el.className = "ta-card";
    var p = item.preset;
    var head = item.combo ? item.combo.name : p.name;
    var sub = item.combo ? "#" + LIB.byId[item.combo.inId].n + " + #" + LIB.byId[item.combo.outId].n : p.tags;
    el.innerHTML = '<span class="ta-card-screen"><span class="ta-card-sample"></span>' +
      (p ? '<span class="ta-card-num">#' + p.n + "</span>" : "") +
      (p && p.d3 ? '<span class="ta-card-3d">3D</span>' : "") +
      "</span>" +
      '<span class="ta-card-name"></span><span class="ta-card-sub"></span>' +
      (p ? '<span class="ta-fav' + (isFav(p.id) ? " is-on" : "") + '" role="button" title="Favorite">' + STAR + "</span>" : "");
    el.querySelector(".ta-card-name").textContent = head;
    el.querySelector(".ta-card-sub").textContent = sub;
    el.title = item.combo ? "Click: use as In + Out" : "Click: use in the highlighted slot · Right-click: use as Out";
    if (p && (p.id === state.inId || p.id === state.outId)) {
      el.classList.add(p.id === state.inId ? "is-in" : "is-out");
    }
    var sampleHost = el.querySelector(".ta-card-sample");
    var sample = buildSample(sampleHost, CARD_TEXT);
    var cardItem = { el: el, item: item, sample: sample, fs: 15 };
    sampleHost.style.fontSize = cardItem.fs + "px";
    stillFrame(cardItem);

    el.addEventListener("mouseenter", function () {
      cards.live = cardItem;
      cardItem.t0 = performance.now();
      stage.hover = item;
      stage.t0 = performance.now();
    });
    el.addEventListener("mouseleave", function () {
      if (cards.live === cardItem) { cards.live = null; stillFrame(cardItem); }
      if (stage.hover === item) { stage.hover = null; stage.t0 = performance.now(); }
    });
    el.addEventListener("click", function (e) {
      if (e.target.closest && e.target.closest(".ta-fav")) {
        toggleFav(p.id, e.target.closest(".ta-fav"));
        return;
      }
      if (item.combo) {
        state.inId = item.combo.inId; state.outId = item.combo.outId; state.inOn = true; state.outOn = true;
      } else {
        state[state.slot === "out" ? "outId" : "inId"] = p.id;
        state[state.slot === "out" ? "outOn" : "inOn"] = true;
      }
      save();
      renderSlots();
      markCards();
    });
    el.addEventListener("contextmenu", function (e) {
      e.preventDefault();
      if (!p) { return; }
      state.outId = p.id;
      state.outOn = true;
      save();
      renderSlots();
      markCards();
    });
    return cardItem;
  }

  // A card at rest shows its preset mid-entrance, so the look reads.
  function stillFrame(c) {
    if (c.item.combo) {
      paint(c.sample, LIB.byId[c.item.combo.inId], "in", 0.42, c.fs);
    } else {
      paint(c.sample, c.item.preset, "in", 0.42, c.fs);
    }
  }

  function liveFrame(now) {
    var c = cards.live;
    if (!c) { return; }
    var t = ((now - c.t0) / 1000) % 2.6;
    var inP = c.item.combo ? LIB.byId[c.item.combo.inId] : c.item.preset;
    var outP = c.item.combo ? LIB.byId[c.item.combo.outId] : c.item.preset;
    var ease = EASES[state.ease] || EASES.smooth;
    if (t < 1) { paint(c.sample, inP, "in", ease["in"](t), c.fs); } else if (t < 1.6) { paint(c.sample, null, "still", 0, c.fs); } else if (t < 2.4) { paint(c.sample, outP, "out", ease.out((t - 1.6) / 0.8), c.fs); } else { paint(c.sample, outP, "out", 1, c.fs); }
  }

  function renderCards() {
    var grid = $("ta-grid");
    grid.innerHTML = "";
    cards.list = filtered();
    cards.shown = 0;
    cards.live = null;
    $("ta-empty").hidden = cards.list.length > 0;
    $("ta-empty").textContent = state.cat === "favs" ? "No favorites yet -- star a card to keep it here." : "Nothing matches.";
    var n = cards.list.length;
    $("ta-count").textContent = n + (cards.list[0] && cards.list[0].combo ? " combos" : n === 1 ? " preset" : " presets");
    moreCards();
  }

  function moreCards() {
    var grid = $("ta-grid");
    var end = Math.min(cards.list.length, cards.shown + PAGE);
    var frag = document.createDocumentFragment();
    for (var i = cards.shown; i < end; i += 1) { frag.appendChild(cardFor(cards.list[i]).el); }
    grid.appendChild(frag);
    cards.shown = end;
  }

  function markCards() {
    var els = $("ta-grid").children;
    for (var i = 0; i < els.length; i += 1) {
      var item = cards.list[i];
      var p = item && item.preset;
      els[i].classList.toggle("is-in", !!p && p.id === state.inId && state.inOn);
      els[i].classList.toggle("is-out", !!p && p.id === state.outId && state.outOn && p.id !== state.inId);
    }
  }

  function toggleFav(id, el) {
    var i = state.favs.indexOf(id);
    if (i >= 0) { state.favs.splice(i, 1); } else { state.favs.push(id); }
    save();
    if (el) { el.classList.toggle("is-on", i < 0); }
    if (state.cat === "favs") { renderCards(); }
    renderSlots();
  }

  // ------------------------------------------------------------------ slots

  function renderSlots() {
    ["in", "out"].forEach(function (slot) {
      var row = document.querySelector('.ta-slot[data-slot="' + slot + '"]');
      var p = LIB.byId[slot === "in" ? state.inId : state.outId];
      var on = slot === "in" ? state.inOn : state.outOn;
      row.classList.toggle("is-active", state.slot === slot);
      row.classList.toggle("is-off", !on);
      row.querySelector(".ta-slot-toggle").setAttribute("aria-pressed", on ? "true" : "false");
      row.querySelector(".ta-slot-num").textContent = "#" + p.n;
      row.querySelector(".ta-slot-title").textContent = p.name;
      row.querySelector(".ta-slot-tags").textContent = p.tags;
      row.querySelector(".ta-slot-fav").classList.toggle("is-on", isFav(p.id));
    });
    $("ta-apply").disabled = !state.inOn && !state.outOn;
    stage.t0 = performance.now();
  }

  // ‹ › and the dice walk the list on screen (all presets when it is a
  // combo list or a single search hit).
  function browseList() {
    return cards.list.length > 1 && !cards.list[0].combo ? cards.list.map(function (c) { return c.preset; }) : LIB.presets;
  }

  function step(slot, delta) {
    var key = slot === "in" ? "inId" : "outId";
    var list = browseList();
    var at = -1;
    for (var i = 0; i < list.length; i += 1) { if (list[i].id === state[key]) { at = i; break; } }
    var next = list[(at + delta + list.length) % list.length] || LIB.presets[0];
    state[key] = next.id;
    state[slot === "in" ? "inOn" : "outOn"] = true;
    state.slot = slot;
    save();
    renderSlots();
    markCards();
  }

  function randomize(slot) {
    var list = browseList();
    var p = list[Math.floor(Math.random() * list.length)];
    state[slot === "in" ? "inId" : "outId"] = p.id;
    state[slot === "in" ? "inOn" : "outOn"] = true;
    state.slot = slot;
    save();
    renderSlots();
    markCards();
  }

  function bindSlots() {
    Array.prototype.forEach.call(document.querySelectorAll(".ta-slot"), function (row) {
      var slot = row.getAttribute("data-slot");
      row.addEventListener("mousedown", function () {
        if (state.slot !== slot) { state.slot = slot; save(); renderSlots(); }
      });
      row.querySelector(".ta-slot-toggle").addEventListener("click", function () {
        var k = slot === "in" ? "inOn" : "outOn";
        state[k] = !state[k];
        save();
        renderSlots();
        markCards();
      });
      Array.prototype.forEach.call(row.querySelectorAll(".ta-step"), function (b) {
        b.addEventListener("click", function () { step(slot, parseInt(b.getAttribute("data-step"), 10)); });
      });
      row.querySelector(".ta-dice").addEventListener("click", function () { randomize(slot); });
      row.querySelector(".ta-slot-fav").addEventListener("click", function () {
        toggleFav(slot === "in" ? state.inId : state.outId, null);
        markFavs();
      });
      row.querySelector(".ta-slot-name").addEventListener("wheel", function (e) {
        e.preventDefault();
        step(slot, e.deltaY > 0 ? 1 : -1);
      }, { passive: false });
    });
  }

  function markFavs() {
    var els = $("ta-grid").children;
    for (var i = 0; i < els.length; i += 1) {
      var p = cards.list[i] && cards.list[i].preset;
      var star = els[i].querySelector(".ta-fav");
      if (p && star) { star.classList.toggle("is-on", isFav(p.id)); }
    }
  }

  // ------------------------------------------------------------------ filters

  function renderCats() {
    var bar = $("ta-cats");
    bar.innerHTML = "";
    var items = [{ id: "all", name: "All" }, { id: "favs", name: "★ Favorites" }, { id: "combos", name: "Combos" }].concat(LIB.cats);
    items.forEach(function (c) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = c.name;
      b.className = state.cat === c.id ? "is-on" : "";
      b.addEventListener("click", function () {
        state.cat = c.id;
        save();
        renderCats();
        renderCards();
      });
      bar.appendChild(b);
    });
    var on = bar.querySelector(".is-on");
    if (on && (on.offsetLeft < bar.scrollLeft || on.offsetLeft + on.offsetWidth > bar.scrollLeft + bar.clientWidth)) {
      bar.scrollLeft = on.offsetLeft - 12;
    }
  }

  function bindCats() {
    var bar = $("ta-cats");
    bar.addEventListener("wheel", function (e) {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { bar.scrollLeft += e.deltaY; e.preventDefault(); }
    }, { passive: false });
  }

  function bindFilters() {
    Array.prototype.forEach.call(document.querySelectorAll("#ta-unit .segmented-option"), function (b) {
      b.classList.toggle("is-active", b.getAttribute("data-unit") === state.unit);
      b.addEventListener("click", function () {
        state.unit = b.getAttribute("data-unit");
        save();
        Array.prototype.forEach.call(document.querySelectorAll("#ta-unit .segmented-option"), function (o) {
          o.classList.toggle("is-active", o === b);
        });
        renderCards();
      });
    });
    var timer = null;
    $("ta-search").addEventListener("input", function () {
      clearTimeout(timer);
      timer = setTimeout(renderCards, 160);
    });
    // The whole page scrolls (like Home); more cards near the bottom.
    $("ta-main").addEventListener("scroll", function () {
      var main = $("ta-main");
      if (main.scrollTop + main.clientHeight > main.scrollHeight - 240 && cards.shown < cards.list.length) { moreCards(); }
    });
  }

  // ------------------------------------------------------------------ timing + apply

  function bindApply() {
    function num(id, key) {
      var input = $(id);
      input.value = state[key];
      input.addEventListener("change", function () {
        var v = clamp(parseFloat(input.value) || state[key], 0.1, 10);
        state[key] = Math.round(v * 100) / 100;
        input.value = state[key];
        save();
        stage.t0 = performance.now();
      });
    }
    num("ta-dur-in", "durIn");
    num("ta-dur-out", "durOut");
    var ease = $("ta-ease");
    ease.value = state.ease;
    ease.addEventListener("change", function () { state.ease = ease.value; save(); stage.t0 = performance.now(); });

    $("ta-apply").addEventListener("click", function () {
      var button = $("ta-apply");
      if (button.disabled) { return; }
      button.disabled = true;
      call("taApply", [{
        inPreset: state.inOn ? LIB.byId[state.inId] : null,
        outPreset: state.outOn ? LIB.byId[state.outId] : null,
        durIn: state.durIn, durOut: state.durOut, ease: state.ease
      }], function (res) {
        button.disabled = !state.inOn && !state.outOn;
        status(res.ok ? res.message : res.error, res.ok ? "success" : "error");
        poll();
      });
    });
    $("ta-remove").addEventListener("click", function () {
      call("taRemove", [], function (res) {
        status(res.ok ? res.message : res.error, res.ok ? "success" : "error");
      });
    });
  }

  // ------------------------------------------------------------------ selection
  // Only to show the selected layer's own text on the stage.

  var pollBusy = false;
  function poll() {
    var page = $("page-textanim");
    if (pollBusy || page.hidden || !window.__adobe_cep__) { return; }
    pollBusy = true;
    call("taState", [], function (res) {
      pollBusy = false;
      if (!res || !res.ok) { return; }
      var t = res.count > 0 ? String(res.text || "").replace(/\r/g, "\n") : "";
      if (t !== layerText) { layerText = t; rebuildStage(); }
    });
  }

  // ------------------------------------------------------------------ loop

  function frame(now) {
    if (!$("page-textanim").hidden && stage.sample) {
      stageFrame(now);
      liveFrame(now);
    }
    window.requestAnimationFrame(frame);
  }

  function init() {
    renderCats();
    bindCats();
    bindFilters();
    bindSlots();
    bindApply();
    renderSlots();
    rebuildStage();
    renderCards();
    stage.t0 = performance.now();
    window.requestAnimationFrame(frame);
    window.addEventListener("resize", fitStage);
    setInterval(poll, 1500);
    var tab = $("page-tab-textanim");
    if (tab) {
      tab.addEventListener("click", function () {
        setTimeout(function () { fitStage(); poll(); }, 0);
      });
    }
  }

  init();
}());
