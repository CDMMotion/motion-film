/*
 * Mótion Film -- Tools › 05 / CAROUSEL.
 *
 * Four styles: Spherical (a spinning sphere of cards), Radial (a ring, or
 * an open arc when Spread < 360), Rectangular (a grid wall rolling
 * sideways) and Curved Line (cards along a curve through 3 pins you drag,
 * bigger at the Middle pin: Side / Middle size, Middle width, Softness,
 * Gap, Follow curve). Size, Rotation X / Y and Facing (Forward, Screen,
 * Center) shape the first three; Speed (% of the path per second) all.
 * The preview runs the same math as the expressions host/carousel.jsx
 * writes, in a frame with the active comp's proportions, so the pins land
 * on the same spots of the comp.
 *
 * Apply makes the selected layers the cards of an "MF Carousel" null.
 * When the selection holds a carousel (its null or a card) this section
 * is linked to it: changes here go straight to that null.
 * Settings live under "motionfilm-carousel" (mirrored to settings.json).
 */
(function () {
  "use strict";

  if (!document.getElementById("cx-stage")) { return; }

  var KEY = "motionfilm-carousel";
  var PINS = { s: [0.12, 0.25], m: [0.5, 0.72], e: [0.88, 0.25] };
  var DEFAULTS = {
    style: "radial", size: 100, spread: 360, rotX: 22, rotY: 0, facing: "forward",
    gap: 0, side: 70, middle: 200, width: 5, soft: 15, follow: false, speed: 10
  };
  var NUMS = ["size", "spread", "rotX", "rotY", "gap", "side", "middle", "width", "soft", "speed"];
  var STYLES = { spherical: 1, radial: 1, rectangular: 1, curved: 1 };
  var FACINGS = { forward: 1, screen: 1, center: 1 };
  var state = { pins: clonePins(PINS) };
  var k;
  for (k in DEFAULTS) { state[k] = DEFAULTS[k]; }
  try {
    var saved = JSON.parse(window.localStorage.getItem(KEY) || "{}");
    if (STYLES[saved.style]) { state.style = saved.style; }
    if (FACINGS[saved.facing]) { state.facing = saved.facing; }
    if (typeof saved.follow === "boolean") { state.follow = saved.follow; }
    NUMS.forEach(function (n) { if (typeof saved[n] === "number") { state[n] = saved[n]; } });
    if (saved.pins && saved.pins.s && saved.pins.m && saved.pins.e) { state.pins = clonePins(saved.pins); }
    if (saved.mode && !saved.style) { state.style = saved.mode === "curved" ? "curved" : "radial"; } // first version
    if (state.speed < 5 && !saved.style) { state.speed = DEFAULTS.speed; }
  } catch (e) {}
  function save() {
    try { window.localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }
  function clonePins(p) { return { s: p.s.slice(0, 2), m: p.m.slice(0, 2), e: p.e.slice(0, 2) }; }
  function settings() {
    var o = { pins: clonePins(state.pins) };
    for (var n in DEFAULTS) { o[n] = state[n]; }
    return o;
  }

  function $(id) { return document.getElementById(id); }
  function status(message, type) {
    if (window.MF && typeof window.MF.setStatus === "function") { window.MF.setStatus(message, type); }
  }

  var comp = null;      // { w, h } of the active comp
  var selected = 0;     // usable layers in the selection
  var link = null;      // the carousel in the selection (cxState)
  var paused = false;

  // ------------------------------------------------------------------ host

  function extensionDir() {
    var raw = "";
    try { raw = window.__adobe_cep__.getSystemPath("extension"); } catch (e) {}
    var p = decodeURIComponent(String(raw).replace(/^file:\/+/, ""));
    if (!/^[A-Za-z]:/.test(p)) { p = "/" + p; }
    return p;
  }
  var hostLoaded = false;
  function call(name, arg, callback) {
    if (!window.__adobe_cep__) { callback({ ok: false, error: "This panel must run inside After Effects." }); return; }
    function run() {
      window.__adobe_cep__.evalScript(name + "(" + (arg === undefined ? "" : JSON.stringify(arg)) + ")", function (raw) {
        var res;
        try { res = JSON.parse(raw); } catch (e) { res = { ok: false, error: raw || "No answer from After Effects." }; }
        callback(res);
      });
    }
    if (hostLoaded) { run(); return; }
    window.__adobe_cep__.evalScript("$.evalFile(" + JSON.stringify(extensionDir() + "/host/carousel.jsx") + "); typeof cxApply", function (res) {
      hostLoaded = res === "function";
      if (hostLoaded) { run(); } else { callback({ ok: false, error: "Couldn't load the Carousel script in After Effects." }); }
    });
  }

  // ------------------------------------------------------------------ geometry (same as the expressions)

  var frame = { w: 300, h: 169 };

  function cardCount() {
    var n = link ? link.cards : selected;
    return Math.max(3, Math.min(16, n >= 2 ? n : 8));
  }
  function frac(x) { return x - Math.floor(x); }
  function px(p) { return [p[0] * frame.w, p[1] * frame.h]; }

  function curve() {
    var S = px(state.pins.s), M = px(state.pins.m), E = px(state.pins.e);
    var C = [2 * M[0] - (S[0] + E[0]) / 2, 2 * M[1] - (S[1] + E[1]) / 2];
    return {
      at: function (t) {
        var a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, d = t * t;
        return [a * S[0] + b * C[0] + d * E[0], a * S[1] + b * C[1] + d * E[1]];
      },
      tangent: function (t) {
        return [2 * (1 - t) * (C[0] - S[0]) + 2 * t * (E[0] - C[0]), 2 * (1 - t) * (C[1] - S[1]) + 2 * t * (E[1] - C[1])];
      }
    };
  }
  function dist(a, b) { return Math.hypot(b[0] - a[0], b[1] - a[1]); }

  // where card i is at phase ph: { x, y, z, s, o, rz, ry, rx }
  function place(i, n, ph) {
    var cx = frame.w / 2, cy = frame.h / 2;
    var zoom = frame.w * 1.3889; // AE's default camera
    var rx = state.rotX * Math.PI / 180, ry = state.rotY * Math.PI / 180;
    function turn(v) {
      var y1 = v[1] * Math.cos(rx) - v[2] * Math.sin(rx), z1 = v[1] * Math.sin(rx) + v[2] * Math.cos(rx);
      return [v[0] * Math.cos(ry) + z1 * Math.sin(ry), y1, -v[0] * Math.sin(ry) + z1 * Math.cos(ry)];
    }
    var R = frame.w * 0.32 * state.size / 100;
    var P, back = [0, 0, 0], op = 1, a;
    if (state.style === "curved") { return placeOnCurve(i, n, ph); }
    if (state.style === "spherical") {
      var Rs = Math.min(frame.w, frame.h) * 0.36 * state.size / 100;
      var y = 1 - 2 * (i + 0.5) / n, r = Math.sqrt(Math.max(0, 1 - y * y));
      a = i * 2.39996 + ph * 2 * Math.PI;
      P = turn([Rs * r * Math.sin(a), Rs * y, -Rs * r * Math.cos(a)]);
    } else if (state.style === "radial") {
      var u = frac(i / n + ph);
      if (state.spread >= 359.5) { a = u * 2 * Math.PI; } else { a = (u - 0.5) * state.spread * Math.PI / 180; op = Math.min(1, Math.min(u, 1 - u) / 0.06); }
      P = turn([R * Math.sin(a), 0, -R * Math.cos(a)]);
    } else {
      var cols = Math.ceil(Math.sqrt(n * 1.6)), rows = Math.ceil(n / cols), cell = R * 0.62;
      var x = frac(((i % cols) + 0.5) / cols + ph) * cols, row = Math.floor(i / cols);
      op = Math.min(1, Math.min(x, cols - x) / 0.5);
      P = turn([(x - cols / 2) * cell, (row - (rows - 1) / 2) * cell * 1.15, 0]);
      back = turn([0, 0, R]);
    }
    var kp = zoom / (zoom + P[2]);
    var q = { x: cx + P[0] * kp, y: cy + P[1] * kp, z: P[2], s: kp, o: op, rz: 0, ry: 0, rx: 0 };
    if (state.facing === "center") {
      var d = [P[0] - back[0], P[1] - back[1], P[2] - back[2]];
      q.ry = Math.atan2(d[0], -d[2]) * 180 / Math.PI;
      q.rx = Math.atan2(d[1], Math.hypot(d[0], d[2])) * 180 / Math.PI;
    }
    return q;
  }

  function placeOnCurve(i, n, ph) {
    var B = curve();
    var K = 24, L1 = 0, L2 = 0, p0 = B.at(0), q, j;
    for (j = 1; j <= 2 * K; j += 1) {
      q = B.at(j / (2 * K));
      if (j <= K) { L1 += dist(p0, q); } else { L2 += dist(p0, q); }
      p0 = q;
    }
    var scale = frame.w / (comp ? comp.w : 1920);
    var gap = state.gap > 0 ? state.gap * scale / Math.max(1, L1 + L2) : 1 / n;
    var loop = Math.max(1, n * gap), u = frac((i * gap + ph) / loop) * loop;
    var on = u <= 1;
    u = Math.min(u, 1);
    var t0 = u < 0.5 ? 0 : 0.5, s = u < 0.5 ? u * 2 : (u - 0.5) * 2, Ls = [0];
    p0 = B.at(t0);
    for (j = 1; j <= K; j += 1) { q = B.at(t0 + 0.5 * j / K); Ls.push(Ls[j - 1] + dist(p0, q)); p0 = q; }
    var goal = s * Ls[K], t = t0 + 0.5;
    for (j = 1; j <= K; j += 1) {
      if (Ls[j] >= goal) { t = t0 + 0.5 * (j - 1 + (goal - Ls[j - 1]) / Math.max(0.0001, Ls[j] - Ls[j - 1])) / K; break; }
    }
    var Q = B.at(t), d = Math.abs(u - 0.5), hw = state.width / 200, so = Math.max(0.001, state.soft / 100);
    var m = d <= hw ? 1 : Math.max(0, 1 - (d - hw) / so);
    m = m * m * (3 - 2 * m);
    var tg = B.tangent(t);
    return {
      x: Q[0], y: Q[1], z: -m * 20,
      s: (state.side + (state.middle - state.side) * m) / 100,
      o: on ? Math.min(1, Math.min(u, 1 - u) / 0.06) : 0,
      rz: state.follow ? Math.atan2(tg[1], tg[0]) * 180 / Math.PI : 0, ry: 0, rx: 0
    };
  }

  // ------------------------------------------------------------------ preview

  var HUES = [[205, 255], [150, 205], [25, 55], [270, 320], [330, 15], [175, 120], [45, 90], [235, 285], [0, 35], [190, 160], [300, 250], [60, 30], [215, 180], [100, 150], [20, 340], [260, 210]];
  var cards = [];

  function layout() {
    var stage = $("cx-stage");
    var aspect = comp ? comp.w / comp.h : 16 / 9;
    var maxH = 230;
    var w = stage.clientWidth - 2;
    var h = w / aspect;
    if (h > maxH) { h = maxH; w = h * aspect; }
    frame = { w: w, h: h };
    stage.style.height = Math.max(150, Math.min(maxH, (stage.clientWidth - 2) / aspect)) + "px";
    $("cx-frame").style.width = w + "px";
    $("cx-frame").style.height = h + "px";
  }

  function buildCards() {
    var host = $("cx-cards");
    var n = cardCount();
    if (cards.length === n) { return; }
    host.innerHTML = "";
    cards = [];
    for (var i = 0; i < n; i += 1) {
      var c = document.createElement("div");
      c.className = "cx-card";
      var h = HUES[i % HUES.length];
      c.style.background = "linear-gradient(135deg, hsl(" + h[0] + " 85% 62%), hsl(" + h[1] + " 80% 52%))";
      host.appendChild(c);
      cards.push(c);
    }
  }

  function drawCards(ph) {
    var n = cards.length;
    var base = frame.w * (state.style === "curved" ? 0.06 : 0.085);
    for (var i = 0; i < n; i += 1) {
      var q = place(i, n, ph);
      var c = cards[i];
      c.style.width = base + "px";
      c.style.height = base * 1.3 + "px";
      c.style.transform = "translate(" + (q.x - base / 2).toFixed(1) + "px, " + (q.y - base * 0.65).toFixed(1) + "px) rotate(" + q.rz.toFixed(1) + "deg) rotateY(" + q.ry.toFixed(1) + "deg) rotateX(" + q.rx.toFixed(1) + "deg) scale(" + q.s.toFixed(3) + ")";
      c.style.opacity = q.o.toFixed(3);
      c.style.zIndex = Math.round(2000 - q.z);
    }
  }

  var NS = "http://www.w3.org/2000/svg";
  function drawLine() {
    var svg = $("cx-line");
    svg.innerHTML = "";
    if (state.style !== "curved") { return; }
    var B = curve(), d = "";
    for (var j = 0; j <= 40; j += 1) {
      var q = B.at(j / 40);
      d += (j ? " L" : "M") + q[0].toFixed(1) + " " + q[1].toFixed(1);
    }
    var path = document.createElementNS(NS, "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
    ["s", "m", "e"].forEach(function (key) {
      var c = document.createElementNS(NS, "circle");
      var P = px(state.pins[key]);
      c.setAttribute("cx", P[0].toFixed(1));
      c.setAttribute("cy", P[1].toFixed(1));
      c.setAttribute("r", key === "m" ? 7 : 6);
      c.setAttribute("class", "cx-pin" + (key === "m" ? " is-mid" : ""));
      c.setAttribute("data-pin", key);
      svg.appendChild(c);
    });
  }

  var phase = 0;
  var last = 0;
  function frameLoop(now) {
    var dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    var shown = !$("page-effects").hidden;
    if (!paused && shown) { phase += dt * state.speed / 100; }
    if (shown) { drawCards(phase); }
    window.requestAnimationFrame(frameLoop);
  }

  function refresh() {
    layout();
    buildCards();
    drawLine();
    drawCards(phase);
  }

  // ------------------------------------------------------------------ controls

  var FORMAT = {
    size: function (v) { return Math.round(v) + "%"; },
    spread: function (v) { return Math.round(v) + "°"; },
    rotX: function (v) { return Math.round(v) + "°"; },
    rotY: function (v) { return Math.round(v) + "°"; },
    gap: function (v) { return v > 0 ? Math.round(v) + " px" : "Auto"; },
    side: function (v) { return Math.round(v) + "%"; },
    middle: function (v) { return Math.round(v) + "%"; },
    width: function (v) { return Math.round(v) + "%"; },
    soft: function (v) { return Math.round(v) + "%"; },
    speed: function (v) { return (Math.round(v * 10) / 10) + " %/s"; }
  };

  function render() {
    Array.prototype.forEach.call(document.querySelectorAll("#cx-styles button"), function (b) {
      var on = b.getAttribute("data-style") === state.style;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-section-id=carousel] [data-for]"), function (el) {
      el.hidden = el.getAttribute("data-for").split(" ").indexOf(state.style) < 0;
    });
    NUMS.forEach(function (n) {
      $("cx-" + n).value = state[n];
      $("cx-out-" + n).textContent = FORMAT[n](state[n]);
    });
    Array.prototype.forEach.call(document.querySelectorAll("#cx-facing button"), function (b) {
      b.classList.toggle("is-active", b.getAttribute("data-facing") === state.facing);
    });
    Array.prototype.forEach.call(document.querySelectorAll("#cx-follow button"), function (b) {
      b.classList.toggle("is-active", (b.getAttribute("data-follow") === "on") === state.follow);
    });
    var play = $("cx-play");
    play.classList.toggle("is-paused", paused);
    play.title = paused ? "Play the preview" : "Pause the preview";
    play.setAttribute("aria-label", play.title);
    var linkBox = $("cx-link");
    linkBox.hidden = !link;
    if (link) { linkBox.textContent = "Linked to “" + link.name + "” (" + link.cards + " cards) — changes here go live in After Effects."; }
    $("cx-apply-label").textContent = selected >= 2 ? "Apply to " + selected + " layers" : "Apply carousel";
  }

  // linked: send the change to the carousel in AE
  var pushTimer = null;
  function push() {
    save();
    if (!link) { return; }
    clearTimeout(pushTimer);
    var name = link.name;
    pushTimer = setTimeout(function () {
      var o = settings();
      o.name = name;
      call("cxUpdate", o, function (res) {
        if (!res.ok) { status(res.error, "error"); }
      });
    }, 150);
  }

  function bind() {
    Array.prototype.forEach.call(document.querySelectorAll("#cx-styles button"), function (b) {
      b.addEventListener("click", function () {
        state.style = b.getAttribute("data-style");
        render();
        refresh();
        push();
      });
    });
    NUMS.forEach(function (n) {
      var input = $("cx-" + n);
      input.addEventListener("input", function () {
        state[n] = parseFloat(input.value);
        $("cx-out-" + n).textContent = FORMAT[n](state[n]);
        drawCards(phase);
      });
      input.addEventListener("change", push);
    });
    Array.prototype.forEach.call(document.querySelectorAll("#cx-facing button"), function (b) {
      b.addEventListener("click", function () {
        state.facing = b.getAttribute("data-facing");
        render();
        drawCards(phase);
        push();
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll("#cx-follow button"), function (b) {
      b.addEventListener("click", function () {
        state.follow = b.getAttribute("data-follow") === "on";
        render();
        drawCards(phase);
        push();
      });
    });
    $("cx-reset").addEventListener("click", function () {
      state.pins = clonePins(PINS);
      refresh();
      push();
    });
    $("cx-play").addEventListener("click", function () {
      paused = !paused;
      render();
    });

    // dragging the pins
    var svg = $("cx-line");
    var drag = null;
    svg.addEventListener("pointerdown", function (e) {
      var key = e.target && e.target.getAttribute && e.target.getAttribute("data-pin");
      if (!key) { return; }
      drag = { pin: key };
      e.target.classList.add("is-drag");
      try { svg.setPointerCapture(e.pointerId); } catch (x) {}
      e.preventDefault();
    });
    svg.addEventListener("pointermove", function (e) {
      if (!drag) { return; }
      var r = $("cx-frame").getBoundingClientRect();
      var x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      var y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
      state.pins[drag.pin] = [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000];
      drawLine();
      drawCards(phase);
    });
    function end() {
      if (!drag) { return; }
      drag = null;
      push();
    }
    svg.addEventListener("pointerup", end);
    svg.addEventListener("pointercancel", end);

    $("cx-apply").addEventListener("click", function () {
      var button = $("cx-apply");
      if (button.disabled) { return; }
      button.disabled = true;
      save();
      call("cxApply", settings(), function (res) {
        button.disabled = false;
        status(res.ok ? res.message : res.error, res.ok ? "success" : "error");
        if (res.ok) { poll(); }
      });
    });
    $("cx-remove").addEventListener("click", function () {
      call("cxRemove", undefined, function (res) {
        status(res.ok ? res.message : res.error, res.ok ? "success" : "error");
        if (res.ok) { poll(); }
      });
    });
    window.addEventListener("resize", refresh);
    var tab = $("page-tab-effects");
    if (tab) { tab.addEventListener("click", function () { setTimeout(function () { refresh(); poll(); }, 30); }); }
  }

  // ------------------------------------------------------------------ selection

  var polling = false;
  function poll() {
    if (polling || $("page-effects").hidden || !window.__adobe_cep__) { return; }
    polling = true;
    call("cxState", undefined, function (res) {
      polling = false;
      if (!res || !res.ok) { return; }
      var before = JSON.stringify([comp, selected, link && link.name, link && link.cards]);
      comp = res.comp;
      selected = res.count;
      var was = link ? link.name : null;
      link = res.carousel;
      // a newly linked carousel shows its own settings
      if (link && link.name !== was) {
        for (var n in DEFAULTS) { if (link[n] !== undefined) { state[n] = link[n]; } }
        state.pins = clonePins(link.pins);
      }
      render();
      if (before !== JSON.stringify([comp, selected, link && link.name, link && link.cards]) || (link && link.name !== was)) { refresh(); }
    });
  }

  bind();
  render();
  refresh();
  window.requestAnimationFrame(frameLoop);
  setInterval(poll, 1500);
}());
