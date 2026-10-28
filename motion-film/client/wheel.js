/*
 * Mótion Film -- "MF - Wheel" settings window (com.motionfilm.wheel).
 *
 * Edits Documents/Mótion Film Packs/wheel.json (wheel-core.js): the 2..8
 * slices, the groups and their 2..8 slices, what each one does and the
 * shortcut. Every change is saved at once; the main panel
 * (wheel-runner.js) notices the new file and sends it to the helper, so
 * the Wheel works whether this window is open or not.
 *
 * While the shortcut field is capturing, wheel-pause.json tells the main
 * panel to let go of the current shortcut (or pressing it here would open
 * the Wheel instead of reaching the field).
 */
(function () {
  "use strict";

  var W = window.MFWheel;
  var NS = "http://www.w3.org/2000/svg";

  var cfg = W.load();
  var sel = 0;          // selected slice
  var savedTime = 0;    // mtime of our last save (an outside change reloads)
  var saveTimer = null;
  var effects = null;   // [{ match, name, cat }] once loaded
  var hostLoaded = false;

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) { e.className = cls; }
    if (text != null) { e.textContent = text; }
    return e;
  }
  function req(name) { return ((window.cep_node && window.cep_node.require) || window.require)(name); }
  function extensionDir() {
    var raw = "";
    try { raw = window.__adobe_cep__.getSystemPath("extension"); } catch (e) {}
    var p = decodeURIComponent(String(raw).replace(/^file:\/+/, ""));
    if (!/^[A-Za-z]:/.test(p)) { p = "/" + p; }
    return p;
  }
  function sideFile(name) {
    var path = req("path");
    return path.join(path.dirname(W.file()), name);
  }

  // ------------------------------------------------------------------ host

  function evalHost(expression, callback) {
    if (window.__adobe_cep__ && typeof window.__adobe_cep__.evalScript === "function") {
      window.__adobe_cep__.evalScript(expression, callback || function () {});
    } else if (callback) {
      callback(JSON.stringify({ ok: false, error: "This window needs After Effects." }));
    }
  }
  function hostCall(name, args, callback) {
    evalHost(name + "(" + args.map(function (a) { return JSON.stringify(a); }).join(",") + ")", function (raw) {
      var res;
      try { res = JSON.parse(raw); } catch (e) { res = { ok: false, error: raw || "No answer from After Effects." }; }
      callback(res);
    });
  }
  function wheelHost(fn, arg, callback) {
    if (hostLoaded) { hostCall(fn, [arg], callback); return; }
    evalHost("$.evalFile(" + JSON.stringify(extensionDir() + "/host/wheel.jsx") + "); typeof " + fn, function (res) {
      hostLoaded = res === "function";
      if (hostLoaded) { hostCall(fn, [arg], callback); } else { callback({ ok: false, error: "Couldn't load wheel.jsx." }); }
    });
  }

  // ------------------------------------------------------------------ status toast (as layers.js)

  var statusTimer = null;
  function setStatus(message, type) {
    var s = $("status");
    s.style.top = "10px";
    s.hidden = false;
    s.textContent = message;
    s.className = "status" + (type ? " is-" + type : "");
    void s.offsetHeight;
    s.classList.add("is-visible");
    clearTimeout(statusTimer);
    statusTimer = setTimeout(function () {
      s.classList.remove("is-visible");
      setTimeout(function () { if (!s.classList.contains("is-visible")) { s.hidden = true; } }, 200);
    }, 2400);
  }

  function startPaintKeepAlive() {
    var canvas = $("paint-keepalive");
    var ctx = canvas && canvas.getContext ? canvas.getContext("2d") : null;
    if (!ctx) { return; }
    var tick = 0;
    function paint() {
      tick = (tick + 1) % 256;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "rgba(" + tick + "," + ((tick * 2) % 256) + ",0,0.02)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    setInterval(paint, 120);
    (function raf() { paint(); window.requestAnimationFrame(raf); }());
  }

  // ------------------------------------------------------------------ save

  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      saveTimer = null;
      try {
        W.save(cfg);
        savedTime = W.mtime();
      } catch (e) {
        setStatus("Couldn't save the Wheel: " + e.message, "error");
      }
    }, 250);
  }

  // ------------------------------------------------------------------ action choices

  var CUSTOM = [
    { key: "x:command", label: "Another AE menu command…", make: function () { return { type: "command", name: "" }; } },
    { key: "x:effect", label: "Add an effect…", make: function () { return { type: "effect", match: "", name: "" }; } },
    { key: "x:script", label: "Run a script (.jsx)…", make: function () { return { type: "script", path: "" }; } },
    { key: "x:preset", label: "Apply a preset (.ffx)…", make: function () { return { type: "preset", path: "" }; } }
  ];

  function keyOf(a) {
    if (!a) { return ""; }
    switch (a.type) {
      case "elastic": case "layer": return "a:" + a.type + ":" + a.kind;
      case "curve": return "a:curve:" + a.n;
      case "textfav": return "a:textfav:" + a.n;
      case "textanim": return "a:textanim";
      case "transition": return "a:transition:" + a.id;
      case "command":
        for (var i = 0; i < W.COMMANDS.length; i += 1) { if (W.COMMANDS[i].id === a.id) { return "a:command:" + a.id; } }
        return "x:command";
      default: return "x:" + a.type;
    }
  }

  // [{ group, items: [{ key, label, action }] }]
  var CHOICES = (function () {
    var out = W.CATALOG.map(function (g) {
      return { group: g.group, items: g.items.map(function (it) { return { key: keyOf(it.action), label: it.label, action: it.action }; }) };
    });
    var T = window.MFTransitionsCatalog;
    if (T) {
      T.groups.forEach(function (g) {
        out.push({ group: "Transitions · " + g.name, items: T.list.filter(function (t) { return t.group === g.id; }).map(function (t) {
          var a = { type: "transition", id: t.id };
          return { key: keyOf(a), label: t.name, action: a };
        }) });
      });
    }
    out.push({ group: "Other", items: CUSTOM });
    return out;
  }());
  var BY_KEY = {};
  CHOICES.forEach(function (g) { g.items.forEach(function (it) { BY_KEY[it.key] = it; }); });

  // the label a slice would get from its action (to know if the user renamed it)
  function autoLabel(a) {
    if (!a) { return ""; }
    var c = BY_KEY[keyOf(a)];
    if (c && c.action) { return c.label; }
    if (a.type === "command") { return a.name || "Command"; }
    if (a.type === "effect") { return a.name || "Effect"; }
    if (a.type === "script" || a.type === "preset") {
      return String(a.path || "").split(/[\\/]/).pop().replace(/\.(jsx|jsxbin|ffx)$/i, "") || (a.type === "script" ? "Script" : "Preset");
    }
    return "";
  }

  function fileName(p) { return String(p || "").split(/[\\/]/).pop(); }

  function loadEffects(then) {
    if (effects) { then(); return; }
    wheelHost("mfWheelEffects", null, function (res) {
      if (!res.ok) { return; }
      effects = res.effects.sort(function (a, b) { return a.name.localeCompare(b.name); });
      var list = $("wh-effect-list");
      list.innerHTML = "";
      effects.forEach(function (e) { var o = el("option"); o.value = e.name; o.label = e.cat; list.appendChild(o); });
      then();
    });
  }

  function browse(title, exts) {
    try {
      var r = window.cep.fs.showOpenDialogEx(false, false, title, "", exts);
      return r && r.data && r.data[0] ? r.data[0] : "";
    } catch (e) { return ""; }
  }

  // The action picker of one item (a slice or a group's slice).
  //   item      { label, action }
  //   onLabel   called when the label was filled in from the action
  function actionEditor(item, onLabel) {
    var box = el("div", "wh-action");
    var select = el("select", "wh-select");
    CHOICES.forEach(function (g) {
      var og = el("optgroup");
      og.label = g.group;
      g.items.forEach(function (it) {
        var o = el("option", null, it.label);
        o.value = it.key;
        og.appendChild(o);
      });
      select.appendChild(og);
    });
    var extra = el("div", "wh-extra");
    var note = el("p", "wh-hint");
    box.appendChild(select);
    box.appendChild(extra);
    box.appendChild(note);

    function relabel(prevAction) {
      var prev = autoLabel(prevAction);
      if (!item.label || item.label === prev) {
        var next = autoLabel(item.action);
        if (next) { item.label = next.slice(0, 28); onLabel(); }
      }
    }

    function drawExtra() {
      var a = item.action;
      extra.innerHTML = "";
      note.textContent = "";
      note.classList.remove("is-warn");
      if (!a) { return; }
      if (a.type === "command" && keyOf(a) === "x:command") {
        var cmd = el("input", "wh-input");
        cmd.placeholder = "Menu name, as in your AE menus";
        cmd.value = a.name || "";
        cmd.addEventListener("change", function () {
          var prev = JSON.parse(JSON.stringify(a));
          a.name = cmd.value.trim();
          delete a.id;
          relabel(prev);
          save();
          render();
        });
        extra.appendChild(cmd);
        note.textContent = "Any menu command, by its name (e.g. Reverse Layer).";
      } else if (a.type === "effect") {
        var fx = el("input", "wh-input");
        fx.placeholder = "Effect name";
        fx.setAttribute("list", "wh-effect-list");
        fx.value = a.name || a.match || "";
        fx.addEventListener("focus", function () { loadEffects(function () {}); });
        fx.addEventListener("change", function () {
          var v = fx.value.trim();
          var prev = JSON.parse(JSON.stringify(a));
          var found = null;
          (effects || []).forEach(function (e) { if (e.name.toLowerCase() === v.toLowerCase() || e.match === v) { found = e; } });
          a.name = found ? found.name : v;
          a.match = found ? found.match : v;
          relabel(prev);
          save();
          render();
        });
        extra.appendChild(fx);
        if (a.match && effects && !effects.some(function (e) { return e.match === a.match; })) {
          note.textContent = "There's no effect with this name in your After Effects.";
          note.classList.add("is-warn");
        } else {
          note.textContent = "Added to the selected layers.";
        }
      } else if (a.type === "script" || a.type === "preset") {
        var path = el("input", "wh-input");
        path.readOnly = true;
        path.placeholder = a.type === "script" ? "No script chosen" : "No preset chosen";
        path.value = fileName(a.path);
        path.title = a.path || "";
        var pick = el("button", "lf-tool", "Browse");
        pick.type = "button";
        pick.addEventListener("click", function () {
          var p = a.type === "script" ? browse("Script for the Wheel", ["jsx", "jsxbin"]) : browse("Preset for the Wheel", ["ffx"]);
          if (!p) { return; }
          var prev = JSON.parse(JSON.stringify(a));
          a.path = p;
          relabel(prev);
          save();
          render();
        });
        extra.appendChild(path);
        extra.appendChild(pick);
        note.textContent = a.type === "script" ? "Runs the script, like File › Scripts › Run Script File." : "Applied to the selected layer.";
      } else {
        note.textContent = W.describe(a) + ".";
      }
    }

    select.value = keyOf(item.action);
    if (!select.value) { select.selectedIndex = -1; }
    select.addEventListener("change", function () {
      var prev = item.action;
      var c = BY_KEY[select.value];
      item.action = c.make ? c.make() : JSON.parse(JSON.stringify(c.action));
      relabel(prev);
      save();
      render();
    });
    drawExtra();
    return box;
  }

  // ------------------------------------------------------------------ preview (same layout as the helper's wheel)

  var R0 = 44, R1 = 52, R2 = 132, R3 = 140, R4 = 194, C = 200;

  function span() { return 360 / cfg.slices.length; }
  function centerAngle(i) { return -90 + i * span(); }
  function childSpan(g) { return Math.min(46, 320 / Math.max(1, g.children.length)); }
  function childCenter(i, j) { var g = cfg.slices[i]; return centerAngle(i) + (j - (g.children.length - 1) / 2) * childSpan(g); }

  function pt(r, deg) {
    var a = deg * Math.PI / 180;
    return (C + r * Math.cos(a)).toFixed(2) + " " + (C + r * Math.sin(a)).toFixed(2);
  }
  // A ring sector with a constant gap of `gap` units between neighbours and
  // its four corners rounded by `round` (same construction as Sector() in
  // MFHelper.cs: each corner is a circle touching the arc and the gap's
  // edge; `round` shrinks until it fits).
  function corners(r0, r1, a0, a1, h, rc) {
    var out = [];
    var spec = [[r1 - rc, a0, 1], [r1 - rc, a1, -1], [r0 + rc, a1, -1], [r0 + rc, a0, 1]];
    for (var k = 0; k < 4; k += 1) {
      var d = spec[k][0], y = h + rc;
      if (d <= y) { return null; }
      var ang = spec[k][1] + spec[k][2] * Math.atan2(y, Math.sqrt(d * d - y * y)) * 180 / Math.PI;
      out.push({ d: d, ang: ang, edge: spec[k][1] });
    }
    if (out[1].ang - out[0].ang < 0.5 || out[2].ang - out[3].ang < 0.5) { return null; }
    return out;
  }
  function xy(r, deg) {
    var a = deg * Math.PI / 180;
    return [C + r * Math.cos(a), C + r * Math.sin(a)];
  }
  function sector(r0, r1, mid, sp, gap, round) {
    var h = gap / 2, a0 = mid - sp / 2, a1 = mid + sp / 2;
    var rc = Math.min(round || 0, (r1 - r0) / 2 - 0.5);
    var c = null;
    for (var t = 0; t < 12 && rc > 0.4 && !c; t += 1) { c = corners(r0, r1, a0, a1, h, rc); if (!c) { rc *= 0.75; } }
    function P(p) { return p[0].toFixed(2) + " " + p[1].toFixed(2); }
    if (!c) {
      var g0 = h / r0 * 180 / Math.PI, g1 = h / r1 * 180 / Math.PI;
      var large = sp - 2 * g1 > 180 ? 1 : 0;
      return "M" + pt(r1, a0 + g1) + " A" + r1 + " " + r1 + " 0 " + large + " 1 " + pt(r1, a1 - g1) +
        " L" + pt(r0, a1 - g0) + " A" + r0 + " " + r0 + " 0 " + large + " 0 " + pt(r0, a0 + g0) + " Z";
    }
    // touch points of corner k: on the gap's edge, and on the ring
    function onEdge(k) {
      var f = xy(c[k].d, c[k].ang), e = c[k].edge * Math.PI / 180;
      var ux = Math.cos(e), uy = Math.sin(e);
      var along = (f[0] - C) * ux + (f[1] - C) * uy;
      var sg = Math.sign((f[0] - C) * -uy + (f[1] - C) * ux);
      return [C + ux * along - uy * sg * h, C + uy * along + ux * sg * h];
    }
    function onRing(k, r) { return xy(r, c[k].ang); }
    function fillet(k, from, to) {
      var f = xy(c[k].d, c[k].ang);
      var s0 = Math.atan2(from[1] - f[1], from[0] - f[0]), s1 = Math.atan2(to[1] - f[1], to[0] - f[0]);
      var sw = s1 - s0;
      while (sw > Math.PI) { sw -= 2 * Math.PI; }
      while (sw <= -Math.PI) { sw += 2 * Math.PI; }
      return " A" + rc.toFixed(2) + " " + rc.toFixed(2) + " 0 0 " + (sw > 0 ? 1 : 0) + " " + P(to);
    }
    var outerLarge = c[1].ang - c[0].ang > 180 ? 1 : 0;
    var innerLarge = c[2].ang - c[3].ang > 180 ? 1 : 0;
    return "M" + P(onEdge(0)) + fillet(0, onEdge(0), onRing(0, r1)) +
      " A" + r1 + " " + r1 + " 0 " + outerLarge + " 1 " + P(onRing(1, r1)) +
      fillet(1, onRing(1, r1), onEdge(1)) +
      " L" + P(onEdge(2)) + fillet(2, onEdge(2), onRing(2, r0)) +
      " A" + r0 + " " + r0 + " 0 " + innerLarge + " 0 " + P(onRing(3, r0)) +
      fillet(3, onRing(3, r0), onEdge(3)) + " Z";
  }
  function svg(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (parent) { parent.appendChild(e); }
    return e;
  }
  function label(parent, text, r, deg, maxW, size) {
    var a = deg * Math.PI / 180;
    var max = Math.max(3, Math.floor(maxW / (size * 0.52)));
    var t = String(text || "");
    if (t.length > max) { t = t.slice(0, max - 1) + "…"; }
    var e = svg("text", { x: (C + r * Math.cos(a)).toFixed(1), y: (C + r * Math.sin(a)).toFixed(1), "text-anchor": "middle", "dominant-baseline": "central" }, parent);
    e.textContent = t || "–";
  }

  function drawPreview() {
    var root = $("wh-svg");
    root.innerHTML = "";
    var n = cfg.slices.length;
    var sp = span();
    var mid = (R1 + R2) / 2;
    var chord = 2 * mid * Math.sin(Math.min(sp, 150) / 2 * Math.PI / 180) * 0.86;
    svg("circle", { "class": "back", cx: C, cy: C, r: R2 + 7 }, root);
    cfg.slices.forEach(function (s, i) {
      var g = svg("g", { "class": "sl" + (i === sel ? " is-on" : "") }, root);
      svg("path", { d: sector(R1, R2, centerAngle(i), sp, 7, 13) }, g);
      label(g, s.label, mid, centerAngle(i), chord, 12);
      // a group: an accent line along its outer edge, clear of the corners
      if (s.group) {
        var a = centerAngle(i), r = R2 - 6.5;
        var len = sp - 2 * (22 / r * 180 / Math.PI);
        if (len > 4) {
          svg("path", { "class": "mark", d: "M" + pt(r, a - len / 2) + " A" + r + " " + r + " 0 " + (len > 180 ? 1 : 0) + " 1 " + pt(r, a + len / 2) }, g);
        }
      }
      g.addEventListener("click", function () { select(i); });
    });
    var open = cfg.slices[sel];
    if (open && open.group) {
      var cs = childSpan(open);
      var kmid = (R3 + R4) / 2;
      var kchord = Math.max(2 * kmid * Math.sin(cs / 2 * Math.PI / 180) * 0.9, 40);
      var pad = 7 / R3 * 180 / Math.PI;
      svg("path", { "class": "back", d: sector(R3 - 7, R4 + 4, centerAngle(sel), cs * open.children.length + 2 * pad, 0, 18) }, root);
      open.children.forEach(function (k, j) {
        var g = svg("g", { "class": "kid" }, root);
        svg("path", { d: sector(R3, R4, childCenter(sel, j), cs, 6, 10) }, g);
        label(g, k.label, kmid, childCenter(sel, j), kchord, 10.5);
      });
    }
    svg("circle", { "class": "hub", cx: C, cy: C, r: R0 }, root);
    var hub = svg("text", { "class": "hub-text", x: C, y: C, "text-anchor": "middle", "dominant-baseline": "central" }, root);
    hub.textContent = "Mótion";
    $("wh-n").textContent = n;
    $("wh-less").disabled = n <= W.MIN;
    $("wh-more").disabled = n >= W.MAX;
  }

  // ------------------------------------------------------------------ editor

  function newItem() {
    return { id: W.uid(), label: "Easy Ease", action: { type: "command", id: 2509, name: "Easy Ease" } };
  }

  function drawEditor() {
    var s = cfg.slices[sel];
    var lab = $("wh-label");
    if (document.activeElement !== lab) { lab.value = s.label; }
    $("wh-left").disabled = cfg.slices.length < 2;
    $("wh-right").disabled = cfg.slices.length < 2;
    Array.prototype.forEach.call($("wh-kind").children, function (b) {
      b.classList.toggle("is-active", (b.getAttribute("data-kind") === "group") === !!s.group);
    });
    var abox = $("wh-action-box");
    abox.innerHTML = "";
    $("wh-group-box").hidden = !s.group;
    if (!s.group) {
      abox.appendChild(actionEditor(s, function () { lab.value = s.label; drawPreview(); }));
      return;
    }
    $("wh-kid-n").textContent = s.children.length;
    $("wh-kid-less").disabled = s.children.length <= W.MIN;
    $("wh-kid-more").disabled = s.children.length >= W.MAX;
    var kids = $("wh-kids");
    kids.innerHTML = "";
    s.children.forEach(function (k, j) {
      var row = el("div", "wh-kid");
      row.appendChild(el("i", null, String(j + 1)));
      var body = el("div");
      var top = el("div", "wh-row");
      var name = el("input", "wh-input wh-grow");
      name.maxLength = 28;
      name.spellcheck = false;
      name.value = k.label;
      name.addEventListener("input", function () { k.label = name.value; drawPreview(); save(); });
      var move = el("div", "wh-move");
      [["↑", -1, "Move up"], ["↓", 1, "Move down"], ["×", 0, "Remove"]].forEach(function (m) {
        var b = el("button", null, m[0]);
        b.type = "button";
        b.title = m[2];
        if (m[1] === 0) {
          b.disabled = s.children.length <= W.MIN;
          b.addEventListener("click", function () { s.children.splice(j, 1); save(); render(); });
        } else {
          var t = j + m[1];
          b.disabled = t < 0 || t >= s.children.length;
          b.addEventListener("click", function () {
            var tmp = s.children[t]; s.children[t] = k; s.children[j] = tmp;
            save(); render();
          });
        }
        move.appendChild(b);
      });
      top.appendChild(name);
      top.appendChild(move);
      body.appendChild(top);
      body.appendChild(actionEditor(k, function () { name.value = k.label; drawPreview(); }));
      row.appendChild(body);
      kids.appendChild(row);
    });
  }

  function render() {
    if (sel >= cfg.slices.length) { sel = cfg.slices.length - 1; }
    drawPreview();
    drawEditor();
    drawShortcut();
  }

  function select(i) {
    sel = i;
    render();
  }

  function bindEditor() {
    $("wh-label").addEventListener("input", function () {
      cfg.slices[sel].label = $("wh-label").value;
      drawPreview();
      save();
    });
    $("wh-more").addEventListener("click", function () {
      if (cfg.slices.length >= W.MAX) { return; }
      cfg.slices.splice(sel + 1, 0, newItem());
      sel += 1;
      save(); render();
    });
    $("wh-less").addEventListener("click", function () {
      if (cfg.slices.length <= W.MIN) { return; }
      cfg.slices.splice(sel, 1);
      sel = Math.max(0, sel - 1);
      save(); render();
    });
    function move(d) {
      var n = cfg.slices.length;
      var t = (sel + d + n) % n;
      var tmp = cfg.slices[t]; cfg.slices[t] = cfg.slices[sel]; cfg.slices[sel] = tmp;
      sel = t;
      save(); render();
    }
    $("wh-left").addEventListener("click", function () { move(-1); });
    $("wh-right").addEventListener("click", function () { move(1); });
    Array.prototype.forEach.call($("wh-kind").children, function (b) {
      b.addEventListener("click", function () {
        var s = cfg.slices[sel];
        var toGroup = b.getAttribute("data-kind") === "group";
        if (toGroup === !!s.group) { return; }
        if (toGroup) {
          var first = s.action ? { id: W.uid(), label: s.label, action: s.action } : newItem();
          s.group = true;
          s.children = [first, newItem()];
          delete s.action;
        } else {
          s.action = s.children.length ? s.children[0].action : null;
          delete s.group;
          delete s.children;
        }
        save(); render();
      });
    });
    $("wh-kid-more").addEventListener("click", function () {
      var s = cfg.slices[sel];
      if (s.children.length < W.MAX) { s.children.push(newItem()); save(); render(); }
    });
    $("wh-kid-less").addEventListener("click", function () {
      var s = cfg.slices[sel];
      if (s.children.length > W.MIN) { s.children.pop(); save(); render(); }
    });
    var resetArmed = null;
    $("wh-reset").addEventListener("click", function () {
      var b = $("wh-reset");
      if (!resetArmed) {
        b.textContent = "Click again to reset the whole wheel";
        resetArmed = setTimeout(function () { resetArmed = null; b.textContent = "Back to the default wheel"; }, 3000);
        return;
      }
      clearTimeout(resetArmed);
      resetArmed = null;
      b.textContent = "Back to the default wheel";
      var keep = { enabled: cfg.enabled, hotkey: cfg.hotkey };
      cfg = W.defaults();
      cfg.enabled = keep.enabled;
      cfg.hotkey = keep.hotkey;
      sel = 0;
      save(); render();
      setStatus("Default wheel back.", "success");
    });
  }

  // ------------------------------------------------------------------ shortcut

  var MOD_KEYS = { 16: 1, 17: 1, 18: 1, 91: 1, 92: 1 };
  var KEY_NAMES = {
    8: "Backspace", 9: "Tab", 13: "Enter", 32: "Space", 33: "Page Up", 34: "Page Down", 35: "End", 36: "Home",
    37: "Left", 38: "Up", 39: "Right", 40: "Down", 45: "Insert", 46: "Delete",
    186: ";", 187: "=", 188: ",", 189: "-", 190: ".", 191: "/", 192: "`", 219: "[", 220: "\\", 221: "]", 222: "'"
  };
  var capturing = false;

  function keyName(e) {
    var k = e.keyCode;
    if (KEY_NAMES[k]) { return KEY_NAMES[k]; }
    if (k >= 112 && k <= 123) { return "F" + (k - 111); }
    if ((k >= 65 && k <= 90) || (k >= 48 && k <= 57)) { return String.fromCharCode(k); }
    if (k >= 96 && k <= 105) { return "Num " + (k - 96); }
    return e.key && e.key.length === 1 ? e.key.toUpperCase() : "";
  }

  function pause(on) {
    try {
      var fs = req("fs");
      var f = sideFile("wheel-pause.json");
      if (on) { fs.writeFileSync(f, JSON.stringify({ at: Date.now() }), "utf8"); } else if (fs.existsSync(f)) { fs.unlinkSync(f); }
    } catch (e) {}
  }

  function drawShortcut() {
    var field = $("wh-hotkey");
    if (!capturing) { field.value = cfg.hotkey.label; }
    $("wh-enabled").setAttribute("aria-checked", cfg.enabled ? "true" : "false");
    field.disabled = !cfg.enabled;
  }

  function bindShortcut() {
    var field = $("wh-hotkey");
    $("wh-enabled").addEventListener("click", function () {
      cfg.enabled = !cfg.enabled;
      save(); drawShortcut(); readState();
    });
    field.addEventListener("focus", function () {
      capturing = true;
      pause(true);
      field.classList.add("is-capturing");
      field.value = "Press the keys…";
    });
    field.addEventListener("blur", function () {
      capturing = false;
      pause(false);
      field.classList.remove("is-capturing");
      drawShortcut();
    });
    field.addEventListener("keydown", function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (e.keyCode === 27 && !e.ctrlKey && !e.altKey && !e.shiftKey) { field.blur(); return; }
      if (MOD_KEYS[e.keyCode]) { return; }
      var mods = (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.shiftKey ? 4 : 0);
      var isF = e.keyCode >= 112 && e.keyCode <= 123;
      var name = keyName(e);
      if (!name) { return; }
      if (!mods && !isF) { field.value = "Ctrl, Alt or Shift + a key"; return; }
      var names = [];
      if (e.ctrlKey) { names.push("Ctrl"); }
      if (e.altKey) { names.push("Alt"); }
      if (e.shiftKey) { names.push("Shift"); }
      names.push(name);
      cfg.hotkey = { mods: mods, vk: e.keyCode, label: names.join(" + ") };
      save();
      field.blur();
      capturing = false;
      drawShortcut();
      readState();
    });
  }

  // wheel-status.json, written by the main panel
  function readState() {
    var p = $("wh-state");
    var st = null;
    try { st = JSON.parse(req("fs").readFileSync(sideFile("wheel-status.json"), "utf8")); } catch (e) {}
    var text;
    var warn = false;
    if (!cfg.enabled) {
      text = "The shortcut is off. The Wheel only opens again when you turn it on.";
    } else if (!/^Win/i.test(navigator.platform)) {
      text = "The Wheel shortcut is Windows-only for now.";
      warn = true;
    } else if (!st || Date.now() - st.at > 30000) {
      text = "The main Mótion Film panel runs the Wheel -- keep it open (it can stay docked out of the way).";
      warn = true;
    } else if (st.helper === "busy") {
      text = cfg.hotkey.label + " is taken by another program. Pick another shortcut.";
      warn = true;
    } else if (st.helper === "missing" || st.helper === "error") {
      text = st.helper === "missing" ? "The shortcut program is missing -- reinstall Mótion Film." : "The shortcut program keeps stopping -- reopen the main panel.";
      warn = true;
    } else {
      text = "Press " + cfg.hotkey.label + " with After Effects in front. Hover a slice and click, or press 1–" + cfg.slices.length + ". Esc closes it.";
    }
    p.textContent = text;
    p.classList.toggle("is-warn", warn);
  }

  // ------------------------------------------------------------------ theme + outside changes

  var active = true;
  try { active = document.hasFocus(); } catch (e) {}
  var lastTheme = "";

  function applyTheme(accent, panel) {
    var root = document.documentElement.style;
    if (accent) { window.MF.color.applyAccent(root, accent); }
    if (panel) { window.MF.color.applyPanelShades(root, panel); }
  }
  function pull() {
    hostCall("getSharedTheme", [], function (res) {
      if (!res || !res.ok) { return; }
      var key = (res.accent || "") + "|" + (res.panel || "");
      if (key === lastTheme) { return; }
      lastTheme = key;
      applyTheme(res.accent, res.panel);
      try {
        if (res.accent) { window.localStorage.setItem("motionfilm-accent", res.accent); }
        if (res.panel) { window.localStorage.setItem("motionfilm-panel", res.panel); }
      } catch (e) {}
    });
  }
  function reloadIfChanged() {
    var t = W.mtime();
    if (!t || t === savedTime || saveTimer) { return; }
    savedTime = t;
    cfg = W.load();
    render();
  }

  function init() {
    startPaintKeepAlive();
    try { applyTheme(window.localStorage.getItem("motionfilm-accent"), window.localStorage.getItem("motionfilm-panel")); } catch (e) {}
    var list = el("datalist");
    list.id = "wh-effect-list";
    document.body.appendChild(list);
    savedTime = W.mtime();
    if (!savedTime) { save(); } // first run: the main panel and this window share the same ids
    bindEditor();
    bindShortcut();
    render();
    readState();
    pull();
    setTimeout(pull, 1500);
    setTimeout(pull, 4000);
    setInterval(function () {
      readState();
      if (active) { pull(); reloadIfChanged(); }
    }, 1500);
    window.addEventListener("focus", function () { active = true; pull(); reloadIfChanged(); });
    window.addEventListener("blur", function () { active = false; });
    window.addEventListener("unload", function () { if (capturing) { pause(false); } });
  }

  document.addEventListener("DOMContentLoaded", init);
}());
