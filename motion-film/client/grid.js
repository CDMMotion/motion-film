/*
 * Mótion Film -- Tools › 06 / GRID.
 *
 * A grid of columns × rows on the comp (host/grid.jsx). Every grid line
 * is a slider on an "MF Grid N" null; layers attached to a cell (or a
 * block of cells) get a mask that follows the cell, and in Cover mode
 * they are also moved and scaled to fill it. Animating the grid =
 * keyframes on those sliders: "Key lines" keys them all at the current
 * time, then dragging a line here (on a later frame) keys it there.
 *
 * The preview is the grid in a frame with the comp's proportions: drag a
 * line (or a cross, both lines at once), click a cell to pick it, Shift
 * + click to span a block. When the comp has a grid (the one in the
 * selection, else its topmost) the section is linked to it: the preview
 * shows its lines at the current time and every change goes live.
 * Settings live under "motionfilm-grid" (mirrored to settings.json).
 */
(function () {
  "use strict";

  if (!document.getElementById("gd-stage")) { return; }

  var KEY = "motionfilm-grid";
  var DEFAULTS = {
    cols: 2, rows: 2, mode: "cover",
    lines: "full", dash: 10, width: 2, points: "every", shape: "dot", size: 14, padding: 0, round: 0, zoom: 100
  };
  var NUMS = ["dash", "size", "padding", "round", "zoom"];
  var STYLE_KEYS = ["lines", "dash", "width", "points", "shape", "size", "padding", "round", "zoom"];
  var state = {};
  var k;
  for (k in DEFAULTS) { state[k] = DEFAULTS[k]; }
  try {
    var saved = JSON.parse(window.localStorage.getItem(KEY) || "{}");
    for (k in DEFAULTS) { if (typeof saved[k] === typeof DEFAULTS[k]) { state[k] = saved[k]; } }
  } catch (e) {}
  function save() {
    try { window.localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }

  function even(a, b, n) {
    var out = [];
    for (var i = 0; i <= n; i += 1) { out.push(a + (b - a) * i / n); }
    return out;
  }
  // the lines as 0..1 of the comp (local until a grid is linked)
  var xs = even(0.1, 0.9, state.cols);
  var ys = even(0.12, 0.88, state.rows);
  var pick = { c0: 0, r0: 0, c1: 0, r1: 0 };

  function $(id) { return document.getElementById(id); }
  function status(message, type) {
    if (window.MF && typeof window.MF.setStatus === "function") { window.MF.setStatus(message, type); }
  }

  var comp = null;      // { w, h }
  var selected = 0;     // usable layers in the selection
  var link = null;      // the grid of the comp (gdState)

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
    callback = callback || function () {};
    if (!window.__adobe_cep__) { callback({ ok: false, error: "This panel must run inside After Effects." }); return; }
    function run() {
      window.__adobe_cep__.evalScript(name + "(" + (arg === undefined ? "" : JSON.stringify(arg)) + ")", function (raw) {
        var res;
        try { res = JSON.parse(raw); } catch (e) { res = { ok: false, error: raw || "No answer from After Effects." }; }
        callback(res);
      });
    }
    if (hostLoaded) { run(); return; }
    window.__adobe_cep__.evalScript("$.evalFile(" + JSON.stringify(extensionDir() + "/host/grid.jsx") + "); typeof gdCreate", function (res) {
      hostLoaded = res === "function";
      if (hostLoaded) { run(); } else { callback({ ok: false, error: "Couldn't load the Grid script in After Effects." }); }
    });
  }
  function report(res) {
    if (res && res.message) { status(res.message, res.ok ? "success" : "error"); }
    else if (res && !res.ok) { status(res.error, "error"); }
  }

  // ------------------------------------------------------------------ preview

  var frame = { w: 300, h: 169 };
  var NS = "http://www.w3.org/2000/svg";

  function layout() {
    var stage = $("gd-stage");
    var aspect = comp ? comp.w / comp.h : 16 / 9;
    var maxH = 230;
    var w = stage.clientWidth - 20;
    var h = w / aspect;
    if (h > maxH) { h = maxH; w = h * aspect; }
    frame = { w: w, h: h };
    $("gd-frame").style.width = w + "px";
    $("gd-frame").style.height = h + "px";
    $("gd-svg").setAttribute("viewBox", "0 0 " + w.toFixed(1) + " " + h.toFixed(1));
  }

  function svg(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    for (var a in attrs) { e.setAttribute(a, attrs[a]); }
    if (parent) { parent.appendChild(e); }
    return e;
  }
  function X(i) { return xs[i] * frame.w; }
  function Y(j) { return ys[j] * frame.h; }
  function inPick(c, r) { return c >= Math.min(pick.c0, pick.c1) && c <= Math.max(pick.c0, pick.c1) && r >= Math.min(pick.r0, pick.r1) && r <= Math.max(pick.r0, pick.r1); }

  function draw() {
    var root = $("gd-svg");
    root.innerHTML = "";
    var C = xs.length - 1, R = ys.length - 1, c, r, i, j;
    var cells = svg("g", { "class": "gd-cells" }, root);
    for (r = 0; r < R; r += 1) {
      for (c = 0; c < C; c += 1) {
        svg("rect", {
          "class": "gd-cell" + (inPick(c, r) ? " is-pick" : ""), "data-c": c, "data-r": r,
          x: Math.min(X(c), X(c + 1)), y: Math.min(Y(r), Y(r + 1)), width: Math.abs(X(c + 1) - X(c)), height: Math.abs(Y(r + 1) - Y(r))
        }, cells);
      }
    }
    // layers already in cells
    var used = svg("g", { "class": "gd-used" }, root);
    ((link && link.cells) || []).forEach(function (m) {
      if (m.c1 >= C || m.r1 >= R) { return; }
      var x0 = Math.min(X(m.c0), X(m.c1 + 1)), y0 = Math.min(Y(m.r0), Y(m.r1 + 1));
      var w = Math.abs(X(m.c1 + 1) - X(m.c0)), h = Math.abs(Y(m.r1 + 1) - Y(m.r0));
      svg("rect", { "class": "gd-occupied" + (m.selected ? " is-sel" : ""), x: x0 + 2, y: y0 + 2, width: Math.max(0, w - 4), height: Math.max(0, h - 4), rx: 3 }, used);
      var t = svg("text", { x: x0 + 6, y: y0 + 13 }, used);
      t.textContent = m.layer.length > 18 ? m.layer.slice(0, 17) + "…" : m.layer;
    });
    // lines: what's drawn + a wide invisible strip to grab
    var lines = svg("g", { "class": "gd-lines" + (state.lines === "off" ? " is-off" : "") }, root);
    var grid = state.lines === "grid";
    for (i = 0; i <= C; i += 1) {
      svg("line", { x1: X(i), x2: X(i), y1: grid ? Y(0) : 0, y2: grid ? Y(R) : frame.h, "class": "gd-line" + (state.dash > 0 ? " is-dash" : "") }, lines);
      svg("line", { x1: X(i), x2: X(i), y1: 0, y2: frame.h, "class": "gd-grab is-v", "data-axis": "x", "data-i": i }, lines);
    }
    for (j = 0; j <= R; j += 1) {
      svg("line", { y1: Y(j), y2: Y(j), x1: grid ? X(0) : 0, x2: grid ? X(C) : frame.w, "class": "gd-line" + (state.dash > 0 ? " is-dash" : "") }, lines);
      svg("line", { y1: Y(j), y2: Y(j), x1: 0, x2: frame.w, "class": "gd-grab is-h", "data-axis": "y", "data-j": j }, lines);
    }
    var dots = svg("g", { "class": "gd-dots" }, root);
    for (j = 0; j <= R; j += 1) {
      for (i = 0; i <= C; i += 1) {
        var corner = (i === 0 || i === C) && (j === 0 || j === R);
        var show = state.points === "every" || (state.points === "corners" && corner);
        svg("circle", { cx: X(i), cy: Y(j), r: 4.2, "class": "gd-dot" + (show ? "" : " is-faint"), "data-i": i, "data-j": j }, dots);
      }
    }
  }

  // ------------------------------------------------------------------ controls

  var FORMAT = {
    dash: function (v) { return v > 0 ? Math.round(v) + " px" : "Solid"; },
    size: function (v) { return Math.round(v) + " px"; },
    padding: function (v) { return Math.round(v) + " px"; },
    round: function (v) { return Math.round(v) + " px"; },
    zoom: function (v) { return Math.round(v) + "%"; }
  };

  function pickLabel() {
    var a = (Math.min(pick.r0, pick.r1) + 1) + "-" + (Math.min(pick.c0, pick.c1) + 1);
    var b = (Math.max(pick.r0, pick.r1) + 1) + "-" + (Math.max(pick.c0, pick.c1) + 1);
    return a === b ? "cell " + a : "cells " + a + " to " + b;
  }

  function render() {
    $("gd-cols").textContent = xs.length - 1;
    $("gd-rows").textContent = ys.length - 1;
    NUMS.forEach(function (n) {
      $("gd-" + n).value = state[n];
      $("gd-out-" + n).textContent = FORMAT[n](state[n]);
    });
    [["gd-lines", "lines"], ["gd-points", "points"], ["gd-mode", "mode"], ["gd-shapes", "shape"]].forEach(function (pair) {
      Array.prototype.forEach.call(document.querySelectorAll("#" + pair[0] + " button"), function (b) {
        b.classList.toggle("is-active", b.getAttribute("data-value") === state[pair[1]]);
      });
    });
    $("gd-zoom-row").hidden = state.mode !== "cover";
    $("gd-create").hidden = !!link;
    $("gd-live").hidden = !link;
    var linkBox = $("gd-link");
    linkBox.hidden = !link;
    if (link) {
      linkBox.textContent = "Linked to “" + link.name + "”" + (link.keyed ? " — animated: dragging a line keys it at the current time." : " — changes here go live. Key lines to animate.");
    }
    var attach = $("gd-attach");
    attach.disabled = !link || !selected;
    $("gd-attach-label").textContent = !link ? "Make the grid first" : selected ? "Put " + selected + " layer" + (selected === 1 ? "" : "s") + " in " + pickLabel() : "Select layers for " + pickLabel();
  }

  // ------------------------------------------------------------------ live link

  function px() {
    var w = comp ? comp.w : 1920, h = comp ? comp.h : 1080;
    return { xs: xs.map(function (v) { return Math.round(v * w * 10) / 10; }), ys: ys.map(function (v) { return Math.round(v * h * 10) / 10; }) };
  }

  var lineTimer = null;
  var lineBusy = false;
  function pushLines(now) {
    if (!link) { save(); return; }
    clearTimeout(lineTimer);
    lineTimer = setTimeout(function () {
      if (lineBusy) { pushLines(true); return; }
      lineBusy = true;
      var o = px();
      o.name = link.name;
      call("gdSetLines", o, function (res) {
        lineBusy = false;
        if (!res.ok) { status(res.error, "error"); }
      });
    }, now ? 0 : 120);
  }

  var styleTimer = null;
  function pushStyle() {
    save();
    if (!link) { return; }
    clearTimeout(styleTimer);
    var name = link.name;
    styleTimer = setTimeout(function () {
      var o = { name: name };
      STYLE_KEYS.forEach(function (n) { o[n] = state[n]; });
      call("gdStyle", o, function (res) { if (!res.ok) { status(res.error, "error"); } });
    }, 120);
  }

  function resize(dc, dr) {
    var C = Math.max(1, Math.min(8, xs.length - 1 + dc)), R = Math.max(1, Math.min(8, ys.length - 1 + dr));
    if (C === xs.length - 1 && R === ys.length - 1) { return; }
    state.cols = C;
    state.rows = R;
    save();
    xs = even(xs[0], xs[xs.length - 1], C);
    ys = even(ys[0], ys[ys.length - 1], R);
    pick = { c0: Math.min(pick.c0, C - 1), r0: Math.min(pick.r0, R - 1), c1: Math.min(pick.c1, C - 1), r1: Math.min(pick.r1, R - 1) };
    render();
    draw();
    if (link) {
      call("gdResize", { name: link.name, cols: C, rows: R }, function (res) { report(res); poll(true); });
    }
  }

  // ------------------------------------------------------------------ dragging

  var drag = null;
  var GAP = 0.01;
  function clampLine(arr, i, v) {
    var lo = i > 0 ? arr[i - 1] + GAP : 0, hi = i < arr.length - 1 ? arr[i + 1] - GAP : 1;
    return Math.min(hi, Math.max(lo, v));
  }

  function bindStage() {
    var root = $("gd-svg");
    root.addEventListener("pointerdown", function (e) {
      var t = e.target;
      var r = $("gd-frame").getBoundingClientRect();
      if (t.classList.contains("gd-dot")) {
        drag = { i: +t.getAttribute("data-i"), j: +t.getAttribute("data-j"), rect: r };
      } else if (t.classList.contains("gd-grab")) {
        drag = t.getAttribute("data-axis") === "x" ? { i: +t.getAttribute("data-i"), rect: r } : { j: +t.getAttribute("data-j"), rect: r };
      } else if (t.classList.contains("gd-cell")) {
        var c = +t.getAttribute("data-c"), rr = +t.getAttribute("data-r");
        if (e.shiftKey) { pick.c1 = c; pick.r1 = rr; } else { pick = { c0: c, r0: rr, c1: c, r1: rr }; }
        render();
        draw();
        return;
      } else {
        return;
      }
      root.classList.add("is-drag");
      try { root.setPointerCapture(e.pointerId); } catch (x) {}
      e.preventDefault();
    });
    root.addEventListener("pointermove", function (e) {
      if (!drag) { return; }
      var x = (e.clientX - drag.rect.left) / drag.rect.width;
      var y = (e.clientY - drag.rect.top) / drag.rect.height;
      if (drag.i !== undefined) { xs[drag.i] = Math.round(clampLine(xs, drag.i, x) * 1000) / 1000; }
      if (drag.j !== undefined) { ys[drag.j] = Math.round(clampLine(ys, drag.j, y) * 1000) / 1000; }
      draw();
      pushLines(false);
    });
    function end() {
      if (!drag) { return; }
      drag = null;
      root.classList.remove("is-drag");
      pushLines(true);
      save();
    }
    root.addEventListener("pointerup", end);
    root.addEventListener("pointercancel", end);
  }

  function bind() {
    bindStage();
    $("gd-cols-minus").addEventListener("click", function () { resize(-1, 0); });
    $("gd-cols-plus").addEventListener("click", function () { resize(1, 0); });
    $("gd-rows-minus").addEventListener("click", function () { resize(0, -1); });
    $("gd-rows-plus").addEventListener("click", function () { resize(0, 1); });

    [["gd-lines", "lines"], ["gd-points", "points"], ["gd-shapes", "shape"], ["gd-mode", "mode"]].forEach(function (pair) {
      Array.prototype.forEach.call(document.querySelectorAll("#" + pair[0] + " button"), function (b) {
        b.addEventListener("click", function () {
          state[pair[1]] = b.getAttribute("data-value");
          render();
          draw();
          if (pair[1] === "mode") { save(); } else { pushStyle(); }
        });
      });
    });
    NUMS.forEach(function (n) {
      var input = $("gd-" + n);
      input.addEventListener("input", function () {
        state[n] = parseFloat(input.value);
        $("gd-out-" + n).textContent = FORMAT[n](state[n]);
        if (n === "dash") { draw(); }
      });
      input.addEventListener("change", pushStyle);
    });

    $("gd-create").addEventListener("click", function () {
      var o = { cols: xs.length - 1, rows: ys.length - 1, xs: xs.slice(), ys: ys.slice() };
      STYLE_KEYS.forEach(function (n) { o[n] = state[n]; });
      call("gdCreate", o, function (res) { report(res); if (res.ok) { poll(true); } });
    });
    $("gd-key").addEventListener("click", function () {
      if (!link) { return; }
      call("gdKey", { name: link.name }, function (res) { report(res); poll(true); });
    });
    $("gd-even").addEventListener("click", function () {
      xs = even(xs[0], xs[xs.length - 1], xs.length - 1);
      ys = even(ys[0], ys[ys.length - 1], ys.length - 1);
      draw();
      pushLines(true);
    });
    $("gd-attach").addEventListener("click", function () {
      if (!link) { return; }
      var o = { name: link.name, c0: pick.c0, r0: pick.r0, c1: pick.c1, r1: pick.r1, mode: state.mode };
      call("gdAttach", o, function (res) { report(res); poll(true); });
    });
    $("gd-release").addEventListener("click", function () {
      call("gdRelease", undefined, function (res) { report(res); poll(true); });
    });
    window.addEventListener("resize", function () { layout(); draw(); });
    var tab = $("page-tab-effects");
    if (tab) { tab.addEventListener("click", function () { setTimeout(function () { layout(); draw(); poll(true); }, 30); }); }
  }

  // ------------------------------------------------------------------ selection

  var polling = false;
  function poll(force) {
    if (polling || drag || $("page-effects").hidden || !window.__adobe_cep__) { return; }
    if (!force && window.MF && window.MF.panelActive && !window.MF.panelActive()) { return; } // see MF.panelActive (panel.js)
    polling = true;
    call("gdState", undefined, function (res) {
      polling = false;
      if (!res || !res.ok || drag) { return; }
      var before = JSON.stringify([comp, selected, link]);
      var sizeChanged = JSON.stringify(comp) !== JSON.stringify(res.comp);
      comp = res.comp;
      selected = res.count || 0;
      var was = link ? link.name : null;
      link = res.grid;
      if (link && comp) {
        xs = link.xs.map(function (v) { return v / comp.w; });
        ys = link.ys.map(function (v) { return v / comp.h; });
        // a newly linked grid shows its own style
        if (link.name !== was) {
          STYLE_KEYS.forEach(function (n) { if (link.style[n] !== undefined) { state[n] = link.style[n]; } });
        }
        var C = xs.length - 1, R = ys.length - 1;
        if (pick.c0 >= C || pick.c1 >= C || pick.r0 >= R || pick.r1 >= R) { pick = { c0: 0, r0: 0, c1: 0, r1: 0 }; }
      } else if (was) {
        // no grid here: back to an even one for "Make grid"
        xs = even(0.1, 0.9, state.cols);
        ys = even(0.12, 0.88, state.rows);
        pick = { c0: 0, r0: 0, c1: 0, r1: 0 };
      }
      if (sizeChanged) { layout(); }
      if (before !== JSON.stringify([comp, selected, link])) { render(); draw(); }
    });
  }

  bind();
  render();
  layout();
  draw();
  setInterval(function () { poll(false); }, 1000);
  if (window.MF && window.MF.onPanelBack) { window.MF.onPanelBack(function () { poll(true); }); }
}());
