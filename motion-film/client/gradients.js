/*
 * Mótion Film -- Packs › Gradients: the built-in category under
 * Transitions (panel.js hands its area to MF.gradients.render).
 *
 * Gradients with as many stops as you want, as After Effects' own
 * Gradient Overlay (Layer Styles):
 *   - groups (All, Mine, Sunset, Gold, ...) and a list of bars; a click on
 *     a bar applies it to the selected layers of the open comp, or, with
 *     nothing selected, to a new comp-sized layer;
 *   - Style / Angle / Scale / Reverse: used by the next Apply, and also
 *     change, live, the selected layers that already have a gradient on;
 *   - the editor (pencil on a bar, or "New"): click the bar to add a stop,
 *     drag a stop to move it (drag it off downwards to remove it), the
 *     swatch opens After Effects' color picker. Saved gradients go to
 *     "Mine".
 *
 * How it reaches AE (host/gradients.jsx): scripts can't write a gradient's
 * colors, but an animation preset carries them as XML. This file copies
 * assets/gradients/gradient-overlay.ffx with the stops written in (RIFX
 * chunks re-sized) to a temp file and the host applies it.
 *
 * Saved in "motionfilm-gradients" ({ mine: [...] }) and
 * "motionfilm-gradients-ui" (group, style...), both mirrored to
 * Documents/Mótion Film Packs/settings.json, so updates keep them.
 */
(function () {
  "use strict";

  var CAT = window.MFGradientsCatalog;
  if (!CAT) { return; }

  var KEY = "motionfilm-gradients";
  var UI_KEY = "motionfilm-gradients-ui";
  var STYLES = [
    { v: 1, name: "Linear" },
    { v: 2, name: "Radial" },
    { v: 3, name: "Angle" },
    { v: 4, name: "Reflected" },
    { v: 5, name: "Diamond" }
  ];

  var mine = [];
  var ui = { group: "all", style: 1, angle: 0, scale: 100, reverse: false, handles: true };
  try {
    var savedMine = JSON.parse(window.localStorage.getItem(KEY) || "{}");
    if (Array.isArray(savedMine.mine)) { mine = savedMine.mine.filter(validGradient); }
  } catch (e) {}
  try {
    var savedUi = JSON.parse(window.localStorage.getItem(UI_KEY) || "{}");
    ["group", "style", "angle", "scale", "reverse", "handles"].forEach(function (k) { if (savedUi[k] !== undefined) { ui[k] = savedUi[k]; } });
  } catch (e2) {}

  function validGradient(g) {
    return g && typeof g.name === "string" && Array.isArray(g.stops) && g.stops.length >= 2;
  }
  function saveMine() { try { window.localStorage.setItem(KEY, JSON.stringify({ mine: mine })); } catch (e) {} }
  function saveUi() { try { window.localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch (e) {} }

  var root = null;
  var info = null;
  var busy = false;
  var edit = null; // { name, stops: [{p, c}], sel, mineIndex (-1 = new) }

  function status(message, type) {
    if (window.MF && typeof window.MF.setStatus === "function") { window.MF.setStatus(message, type); }
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) { e.className = cls; }
    if (text !== undefined) { e.textContent = text; }
    return e;
  }

  // ------------------------------------------------------------------ colors

  function sorted(stops) {
    return stops.slice().sort(function (a, b) { return a.p - b.p; });
  }
  function cssGradient(stops, angle) {
    var s = sorted(stops).map(function (st) { return st.c + " " + (Math.round(st.p * 1000) / 10) + "%"; });
    if (s.length === 1) { s.push(s[0]); }
    return "linear-gradient(" + (angle === undefined ? 90 : angle) + "deg, " + s.join(", ") + ")";
  }
  function hexToRgb(hex) {
    var h = String(hex).replace("#", "");
    return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)];
  }
  function rgbToHex(rgb) {
    return "#" + rgb.map(function (v) { var s = Math.max(0, Math.min(255, Math.round(v))).toString(16); return s.length < 2 ? "0" + s : s; }).join("");
  }
  // the color the gradient shows at position p (for a new stop)
  function colorAt(stops, p) {
    var s = sorted(stops);
    if (p <= s[0].p) { return s[0].c; }
    for (var i = 1; i < s.length; i += 1) {
      if (p <= s[i].p) {
        var t = (p - s[i - 1].p) / Math.max(1e-6, s[i].p - s[i - 1].p);
        var a = hexToRgb(s[i - 1].c), b = hexToRgb(s[i].c);
        return rgbToHex([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
      }
    }
    return s[s.length - 1].c;
  }

  // ------------------------------------------------------------------ preset (.ffx)

  function nodeRequire(name) {
    var req = (window.cep_node && window.cep_node.require) || window.require || null;
    if (!req) { throw new Error("no node"); }
    return req(name);
  }
  function extensionDir() {
    var raw = "";
    try { raw = window.__adobe_cep__.getSystemPath("extension"); } catch (e) {}
    var p = decodeURIComponent(String(raw).replace(/^file:\/+/, ""));
    if (!/^[A-Za-z]:/.test(p)) { p = "/" + p; }
    return p;
  }

  // RIFX: 4-char id, 4-byte big-endian size, data, padded to even.
  // "RIFX" and "LIST" hold a 4-char type and more chunks.
  function parseChunks(buf, off, end) {
    var out = [];
    while (off + 8 <= end) {
      var id = buf.toString("latin1", off, off + 4);
      var size = buf.readUInt32BE(off + 4);
      var data = buf.slice(off + 8, off + 8 + size);
      if (id === "RIFX" || id === "LIST") {
        out.push({ id: id, type: data.slice(0, 4), kids: parseChunks(data, 4, data.length) });
      } else {
        out.push({ id: id, data: data });
      }
      off += 8 + size + (size & 1);
    }
    return out;
  }
  function buildChunks(nodes) {
    var Buffer = nodeRequire("buffer").Buffer;
    var parts = [];
    nodes.forEach(function (n) {
      var data = n.kids ? Buffer.concat([n.type, buildChunks(n.kids)]) : n.data;
      var head = Buffer.alloc(8);
      head.write(n.id, 0, 4, "latin1");
      head.writeUInt32BE(data.length, 4);
      parts.push(head, data);
      if (data.length & 1) { parts.push(Buffer.alloc(1)); }
    });
    return Buffer.concat(parts);
  }
  function num(v) {
    var s = String(Math.round(v * 1e6) / 1e6);
    return s.indexOf(".") < 0 && s.indexOf("e") < 0 ? s : s;
  }
  function gradientXml(stops) {
    var s = sorted(stops);
    function list(kind, rows) {
      var body = rows.map(function (vals, i) {
        return "<prop.pair>\n<key>Stop-" + i + "</key>\n<prop.list>\n<prop.pair>\n<key>Stops " + kind + "</key>\n<array>\n" +
          "<array.type><float/></array.type>\n" + vals.map(function (v) { return "<float>" + num(v) + "</float>\n"; }).join("") +
          "</array>\n</prop.pair>\n</prop.list>\n</prop.pair>\n";
      }).join("");
      return "<prop.pair>\n<key>Stops List</key>\n<prop.list>\n" + body + "</prop.list>\n</prop.pair>\n" +
        "<prop.pair>\n<key>Stops Size</key>\n<int type='unsigned' size='32'>" + rows.length + "</int>\n</prop.pair>\n";
    }
    var alpha = [[0, 0.5, 1], [1, 0.5, 1]];
    var color = s.map(function (st) {
      var rgb = hexToRgb(st.c);
      return [Math.max(0, Math.min(1, st.p)), 0.5, rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, 1];
    });
    return "<?xml version='1.0'?>\n<prop.map version='4'>\n<prop.list>\n<prop.pair>\n<key>Gradient Color Data</key>\n<prop.list>\n" +
      "<prop.pair>\n<key>Alpha Stops</key>\n<prop.list>\n" + list("Alpha", alpha) + "</prop.list>\n</prop.pair>\n" +
      "<prop.pair>\n<key>Color Stops</key>\n<prop.list>\n" + list("Color", color) + "</prop.list>\n</prop.pair>\n" +
      "</prop.list>\n</prop.pair>\n</prop.list>\n</prop.map>\n";
  }
  // the template with these stops, written to a temp .ffx; returns its path
  function writePreset(stops) {
    var fs = nodeRequire("fs");
    var path = nodeRequire("path");
    var os = nodeRequire("os");
    var Buffer = nodeRequire("buffer").Buffer;
    var buf = fs.readFileSync(path.join(extensionDir(), "client", "assets", "gradients", "gradient-overlay.ffx"));
    var size = buf.readUInt32BE(4);
    var end = 8 + size + (size & 1);
    var tree = parseChunks(buf, 0, end);
    var hits = 0;
    (function walk(nodes) {
      nodes.forEach(function (n) {
        if (n.kids) { walk(n.kids); return; }
        if (n.id === "Utf8" && n.data.indexOf("Gradient Color Data") >= 0) {
          var zero = n.data.length && n.data[n.data.length - 1] === 0;
          n.data = Buffer.concat([Buffer.from(gradientXml(stops), "utf8"), zero ? Buffer.alloc(1) : Buffer.alloc(0)]);
          hits += 1;
        }
      });
    }(tree));
    if (!hits) { throw new Error("gradient template without gradient data"); }
    var out = path.join(os.tmpdir(), "mf-gradient-" + Date.now() + ".ffx");
    fs.writeFileSync(out, Buffer.concat([buildChunks(tree), buf.slice(end)]));
    return out;
  }

  // ------------------------------------------------------------------ host

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
    var p = extensionDir() + "/host/gradients.jsx";
    window.__adobe_cep__.evalScript("$.evalFile(" + JSON.stringify(p) + "); typeof mfgApply", function (res) {
      hostLoaded = res === "function";
      if (hostLoaded) { run(); } else { callback({ ok: false, error: "Couldn't load the Gradients script in After Effects." }); }
    });
  }

  function apply(g, bar) {
    if (busy) { return; }
    var file;
    try { file = writePreset(g.stops); } catch (e) { status("Couldn't write the gradient: " + e.message, "error"); return; }
    busy = true;
    if (bar) { bar.classList.add("is-applying"); }
    call("mfgApply", { ffx: file.replace(/\\/g, "/"), name: g.name, style: ui.style, angle: ui.angle, scale: ui.scale, reverse: ui.reverse, handles: !!ui.handles }, function (res) {
      busy = false;
      if (bar) { bar.classList.remove("is-applying"); }
      try { nodeRequire("fs").unlinkSync(file); } catch (e) {}
      status(res.ok ? res.message : res.error, res.ok ? "success" : "error");
      refreshInfo();
    });
  }

  var styleTimer = null;
  function pushStyle(what) {
    clearTimeout(styleTimer);
    styleTimer = setTimeout(function () {
      // always asked: the host only touches selected layers that already
      // have a gradient on (info can be stale while the panel is blurred)
      call("mfgStyle", { what: what, style: ui.style, angle: ui.angle, scale: ui.scale, reverse: ui.reverse }, function () {});
    }, 120);
  }

  function refreshInfo() {
    if (!root || !root.isConnected || !window.__adobe_cep__) { return; }
    call("mfgInfo", undefined, function (res) {
      if (!res || !res.ok) { return; }
      info = res;
      var w = root.querySelector(".gr-where");
      if (w) { w.textContent = whereText(); }
    });
  }
  function whereText() {
    if (!info) { return ""; }
    if (!info.comp) { return "Open a composition."; }
    if (!info.selected) { return "Nothing selected: a click makes a gradient layer."; }
    return "Applies to " + (info.selected === 1 ? "the selected layer" : info.selected + " selected layers") + ".";
  }

  // ------------------------------------------------------------------ views

  var PENCIL = '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10.5 2.5l3 3L6 13H3v-3z"/></svg>';
  var PLUS = '<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M8 3v10M3 8h10"/></svg>';

  function itemsOf(group) {
    if (group === "mine") { return mine.map(function (g, i) { return { name: g.name, stops: g.stops, mineIndex: i }; }); }
    if (group === "all") { return CAT.list; }
    for (var i = 0; i < CAT.groups.length; i += 1) { if (CAT.groups[i].id === group) { return CAT.groups[i].items; } }
    return CAT.list;
  }

  function renderHead() {
    var head = el("div", "gr-head");
    head.appendChild(el("span", "gr-title", "Gradients"));
    head.appendChild(el("span", "gr-where", whereText()));
    return head;
  }

  function renderGroups() {
    var row = el("div", "gr-groups");
    var groups = [{ id: "all", name: "All" }, { id: "mine", name: "Mine" }].concat(CAT.groups);
    groups.forEach(function (g) {
      var b = el("button", "gr-chip" + (ui.group === g.id ? " is-on" : ""), g.name);
      b.type = "button";
      if (g.id === "mine") { b.textContent = "Mine" + (mine.length ? " · " + mine.length : ""); }
      b.addEventListener("click", function () { ui.group = g.id; saveUi(); draw(); });
      row.appendChild(b);
    });
    var add = el("button", "gr-chip gr-new");
    add.type = "button";
    add.innerHTML = PLUS + "<span>New</span>";
    add.title = "Make your own gradient";
    add.addEventListener("click", function () { openEditor({ name: "My gradient", stops: [{ p: 0, c: "#ff3b6b" }, { p: 0.5, c: "#ffd166" }, { p: 1, c: "#3a86ff" }] }, -1); });
    row.appendChild(add);
    return row;
  }

  function renderControls() {
    var box = el("div", "gr-controls");
    var seg = el("div", "gr-styles");
    STYLES.forEach(function (s) {
      var b = el("button", ui.style === s.v ? "is-on" : "", s.name);
      b.type = "button";
      b.addEventListener("click", function () {
        ui.style = s.v; saveUi();
        Array.prototype.forEach.call(seg.children, function (x) { x.classList.toggle("is-on", x === b); });
        pushStyle("style");
      });
      seg.appendChild(b);
    });
    box.appendChild(seg);

    function slider(label, min, max, key, unit) {
      var row = el("label", "gr-slider");
      row.appendChild(el("span", "", label));
      var input = document.createElement("input");
      input.type = "range"; input.min = min; input.max = max; input.step = 1;
      input.value = ui[key];
      var out = el("b", "", ui[key] + unit);
      input.addEventListener("input", function () {
        ui[key] = parseInt(input.value, 10);
        out.textContent = ui[key] + unit;
        pushStyle(key);
      });
      input.addEventListener("change", saveUi);
      row.appendChild(input);
      row.appendChild(out);
      return row;
    }
    box.appendChild(slider("Angle", -180, 180, "angle", "°"));
    box.appendChild(slider("Scale", 10, 150, "scale", "%"));

    var toggles = el("div", "gr-toggles");
    var rev = el("button", "gr-reverse" + (ui.reverse ? " is-on" : ""), "Reverse");
    rev.type = "button";
    rev.addEventListener("click", function () {
      ui.reverse = !ui.reverse; saveUi();
      rev.classList.toggle("is-on", ui.reverse);
      pushStyle("reverse");
    });
    toggles.appendChild(rev);
    // two Point Controls ("Gradient Start" / "Gradient End") that drag the
    // gradient right in the comp viewer (host/gradients.jsx rig)
    var pts = el("button", "gr-reverse" + (ui.handles ? " is-on" : ""), "Points");
    pts.type = "button";
    pts.title = "Add Gradient Start / End points to the layer: drag them in the comp viewer to move the gradient";
    pts.addEventListener("click", function () {
      ui.handles = !ui.handles; saveUi();
      pts.classList.toggle("is-on", ui.handles);
    });
    toggles.appendChild(pts);
    box.appendChild(toggles);
    return box;
  }

  function renderList() {
    var listEl = el("div", "gr-list");
    var items = itemsOf(ui.group);
    if (!items.length) {
      listEl.appendChild(el("div", "gr-empty", ui.group === "mine" ? "No gradients of your own yet -- click New, or the pencil on any gradient to start from it." : "Nothing here."));
      return listEl;
    }
    items.forEach(function (g) {
      var row = el("div", "gr-row");
      var bar = el("button", "gr-bar");
      bar.type = "button";
      bar.style.background = cssGradient(g.stops);
      bar.title = g.name + " (" + g.stops.length + " colors) -- click to apply";
      bar.appendChild(el("span", "gr-name", g.name));
      bar.addEventListener("click", function () { apply(g, bar); });
      row.appendChild(bar);
      var pen = el("button", "gr-edit");
      pen.type = "button";
      pen.innerHTML = PENCIL;
      pen.title = g.mineIndex === undefined ? "Edit a copy" : "Edit";
      pen.addEventListener("click", function () {
        openEditor({ name: g.mineIndex === undefined ? g.name + " copy" : g.name, stops: g.stops }, g.mineIndex === undefined ? -1 : g.mineIndex);
      });
      row.appendChild(pen);
      listEl.appendChild(row);
    });
    return listEl;
  }

  // ------------------------------------------------------------------ editor

  function openEditor(g, mineIndex) {
    edit = { name: g.name, stops: g.stops.map(function (s) { return { p: s.p, c: s.c }; }), sel: 0, mineIndex: mineIndex };
    draw();
  }

  function renderEditor() {
    var box = el("div", "gr-editor");
    var top = el("div", "gr-ed-top");
    var name = document.createElement("input");
    name.className = "gr-ed-name";
    name.value = edit.name;
    name.maxLength = 40;
    name.spellcheck = false;
    name.addEventListener("input", function () { edit.name = name.value; });
    top.appendChild(name);
    var close = el("button", "gr-ed-close", "×");
    close.type = "button";
    close.title = "Close the editor";
    close.addEventListener("click", function () { edit = null; draw(); });
    top.appendChild(close);
    box.appendChild(top);

    var strip = el("div", "gr-ed-strip");
    var bar = el("div", "gr-ed-bar");
    var handles = el("div", "gr-ed-handles");
    strip.appendChild(bar);
    strip.appendChild(handles);
    box.appendChild(strip);

    var detail = el("div", "gr-ed-detail");
    box.appendChild(detail);

    function paint() {
      bar.style.background = cssGradient(edit.stops);
      handles.innerHTML = "";
      edit.stops.forEach(function (s, i) {
        var h = el("button", "gr-ed-stop" + (i === edit.sel ? " is-sel" : ""));
        h.type = "button";
        h.style.left = (s.p * 100) + "%";
        h.style.setProperty("--c", s.c);
        h.title = s.c + " at " + Math.round(s.p * 100) + "% -- drag to move, drag down to remove, double-click for the color";
        bindDrag(h, i);
        h.addEventListener("dblclick", function () { pick(i); });
        handles.appendChild(h);
      });
      drawDetail();
    }

    function drawDetail() {
      detail.innerHTML = "";
      var s = edit.stops[edit.sel];
      if (!s) { return; }
      var sw = el("button", "gr-ed-swatch");
      sw.type = "button";
      sw.style.background = s.c;
      sw.title = "Choose the color (After Effects' color picker)";
      sw.addEventListener("click", function () { pick(edit.sel); });
      detail.appendChild(sw);
      var hex = document.createElement("input");
      hex.className = "gr-ed-hex";
      hex.value = s.c.toUpperCase();
      hex.spellcheck = false;
      hex.addEventListener("change", function () {
        var v = String(hex.value).trim().replace(/^#?/, "#");
        if (/^#[0-9a-fA-F]{3}$/.test(v)) { v = "#" + v[1] + v[1] + v[2] + v[2] + v[3] + v[3]; }
        if (/^#[0-9a-fA-F]{6}$/.test(v)) { s.c = v.toLowerCase(); paint(); } else { hex.value = s.c.toUpperCase(); }
      });
      detail.appendChild(hex);
      var pos = document.createElement("input");
      pos.className = "gr-ed-pos";
      pos.type = "number"; pos.min = 0; pos.max = 100; pos.step = 1;
      pos.value = Math.round(s.p * 100);
      pos.title = "Position (%)";
      pos.addEventListener("change", function () {
        var v = Math.max(0, Math.min(100, parseFloat(pos.value) || 0));
        s.p = v / 100; paint();
      });
      detail.appendChild(pos);
      detail.appendChild(el("span", "gr-ed-pct", "%"));
      var del = el("button", "gr-ed-del", "Remove");
      del.type = "button";
      del.disabled = edit.stops.length <= 2;
      del.addEventListener("click", function () { removeStop(edit.sel); });
      detail.appendChild(del);
    }

    function removeStop(i) {
      if (edit.stops.length <= 2) { return; }
      edit.stops.splice(i, 1);
      edit.sel = Math.max(0, Math.min(edit.sel, edit.stops.length - 1));
      paint();
    }

    function pick(i) {
      var s = edit.stops[i];
      if (!s) { return; }
      window.__adobe_cep__.evalScript("pickColorNative(" + JSON.stringify(s.c) + ")", function (raw) {
        var r;
        try { r = JSON.parse(raw); } catch (e) { return; }
        if (r && r.ok && !r.cancelled && /^#?[0-9a-fA-F]{6}$/.test(r.hex || "")) {
          s.c = ("#" + String(r.hex).replace("#", "")).toLowerCase();
          paint();
        }
      });
    }

    // click on the bar: a new stop there, in the color the bar shows
    bar.addEventListener("mousedown", function (e) {
      var r = bar.getBoundingClientRect();
      var p = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      edit.stops.push({ p: p, c: colorAt(edit.stops, p) });
      edit.sel = edit.stops.length - 1;
      paint();
    });

    function bindDrag(h, i) {
      h.addEventListener("mousedown", function (e) {
        e.preventDefault();
        edit.sel = i;
        var r = handles.getBoundingClientRect();
        var startY = e.clientY;
        var gone = false;
        Array.prototype.forEach.call(handles.children, function (x, k) { x.classList.toggle("is-sel", k === i); });
        drawDetail();
        function move(ev) {
          var s = edit.stops[i];
          s.p = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
          gone = edit.stops.length > 2 && ev.clientY - startY > 34;
          h.style.left = (s.p * 100) + "%";
          h.classList.toggle("is-leaving", gone);
          bar.style.background = cssGradient(gone ? edit.stops.filter(function (x, k) { return k !== i; }) : edit.stops);
        }
        function up() {
          document.removeEventListener("mousemove", move);
          document.removeEventListener("mouseup", up);
          if (gone) { removeStop(i); } else { paint(); }
        }
        document.addEventListener("mousemove", move);
        document.addEventListener("mouseup", up);
      });
    }

    var tools = el("div", "gr-ed-tools");
    function tool(label, title, fn) {
      var b = el("button", "gr-ed-tool", label);
      b.type = "button";
      b.title = title;
      b.addEventListener("click", fn);
      tools.appendChild(b);
      return b;
    }
    tool("Reverse", "Flip the stops", function () {
      edit.stops.forEach(function (s) { s.p = 1 - s.p; });
      paint();
    });
    tool("Even", "Space the stops evenly", function () {
      var s = sorted(edit.stops);
      s.forEach(function (st, k) { st.p = s.length > 1 ? k / (s.length - 1) : 0; });
      edit.stops = s;
      edit.sel = 0;
      paint();
    });
    if (edit.mineIndex >= 0) {
      var armed = null;
      var delBtn = tool("Delete", "Delete this gradient from Mine", function () {
        if (!armed) {
          delBtn.textContent = "Click again";
          armed = setTimeout(function () { armed = null; delBtn.textContent = "Delete"; }, 2500);
          return;
        }
        clearTimeout(armed);
        mine.splice(edit.mineIndex, 1);
        saveMine();
        edit = null;
        draw();
        status("Gradient deleted.", "success");
      });
      delBtn.classList.add("is-danger");
    }
    box.appendChild(tools);

    var actions = el("div", "gr-ed-actions");
    var applyBtn = el("button", "gr-ed-apply", "Apply");
    applyBtn.type = "button";
    applyBtn.addEventListener("click", function () { apply({ name: edit.name || "Gradient", stops: sorted(edit.stops) }, null); });
    var saveBtn = el("button", "gr-ed-save", edit.mineIndex >= 0 ? "Save" : "Save to Mine");
    saveBtn.type = "button";
    saveBtn.addEventListener("click", function () {
      var g = { name: String(edit.name || "").trim() || "My gradient", stops: sorted(edit.stops).map(function (s) { return { p: Math.round(s.p * 1000) / 1000, c: s.c }; }) };
      if (edit.mineIndex >= 0 && mine[edit.mineIndex]) { mine[edit.mineIndex] = g; } else { mine.push(g); edit.mineIndex = mine.length - 1; }
      saveMine();
      ui.group = "mine";
      saveUi();
      edit = null;
      draw();
      status("Saved “" + g.name + "” in Mine.", "success");
    });
    actions.appendChild(applyBtn);
    actions.appendChild(saveBtn);
    box.appendChild(actions);

    paint();
    return box;
  }

  function draw() {
    if (!root) { return; }
    var scroll = root.scrollTop;
    root.innerHTML = "";
    var wrap = el("div", "gr-home");
    wrap.appendChild(renderHead());
    if (edit) { wrap.appendChild(renderEditor()); }
    wrap.appendChild(renderGroups());
    wrap.appendChild(renderControls());
    wrap.appendChild(renderList());
    root.appendChild(wrap);
    root.scrollTop = edit ? 0 : scroll;
  }

  // ------------------------------------------------------------------ entry

  window.MF = window.MF || {};
  window.MF.gradients = {
    render: function (container) {
      root = container;
      draw();
      refreshInfo();
      // the panel doesn't poll while blurred: bring "applies to..." up to
      // date as soon as the mouse comes back over it
      if (!container.__mfgHover) {
        container.__mfgHover = true;
        container.addEventListener("mouseenter", function () { if (container.classList.contains("is-gradients")) { refreshInfo(); } });
      }
    },
    // dev / tests: the .ffx for some stops
    writePreset: writePreset
  };

  // panel.js may draw the Packs tab before this file loads
  (function () {
    var area = document.getElementById("kit-presets");
    var active = document.querySelector(".kit-category.is-active.is-builtin");
    if (area && active && active.textContent === "Gradients") {
      area.classList.add("is-gradients");
      window.MF.gradients.render(area);
    }
  }());

  function refreshIfShown() {
    if (root && root.isConnected && root.offsetParent !== null && !busy) { refreshInfo(); }
  }
  setInterval(function () { if (!(window.MF && window.MF.panelActive && !window.MF.panelActive())) { refreshIfShown(); } }, 1500);
  if (window.MF && window.MF.onPanelBack) { window.MF.onPanelBack(refreshIfShown); }
}());
