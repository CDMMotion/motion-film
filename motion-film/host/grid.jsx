/*
 * Mótion Film -- Grid (Tools › 06 / GRID, client/grid.js).
 *
 * Uma grade de colunas x linhas na comp. Cada linha da grade é um Slider
 * no null "MF Grid N" (X 0..X C = verticais, Y 0..Y R = horizontais, em
 * px da comp) -- animar a grade é pôr keyframes nesses sliders (o painel
 * arrasta as linhas e grava no tempo atual).
 *
 * Camadas presas a uma célula (ou a um bloco de células) ganham a máscara
 * "MF Grid Cell", que segue a célula. No modo Cover a camada também é
 * posicionada e escalada para cobrir a célula (Zoom no null); no modo
 * Mask ela fica onde está e a célula só recorta.
 *
 * O desenho da grade mora em dois shape layers: "MF Grid N Lines" (um
 * path por linha + um Stroke, tracejado pelo Dash) e "MF Grid N Points"
 * (uma marca em cada cruzamento: Dot, Square, Plus, Cross, Diamond).
 * Tudo lê o null por expressão, marcada com "// MF Grid: ".
 *
 * Carregado sob demanda via $.evalFile. Um undo por ação.
 */
(function () {
  var MARK = "// MF Grid: ";
  var MASK = "MF Grid Cell";
  var LINES = ["Full", "Grid only", "Off"];
  var POINTS = ["Every cross", "Corners", "Off"];
  var SHAPES = ["Dot", "Square", "Plus", "Cross", "Diamond"];
  var MAXN = 8;

  function stringify(v) {
    try { return JSON.stringify(v); } catch (e) { return '{"ok":false,"error":"serialize"}'; }
  }
  function activeComp() {
    var a = app.project ? app.project.activeItem : null;
    return a instanceof CompItem ? a : null;
  }
  function fx(l) { return l.property("ADBE Effect Parade"); }
  function tr(l) { return l.property("ADBE Transform Group"); }
  function isGrid(l) {
    return l.nullLayer && /^MF Grid/.test(l.name) && !!fx(l).property("X 0");
  }
  function gridOfArt(l) {
    var m = /^(MF Grid \d+) (Lines|Points)$/.exec(l.name);
    return m && l instanceof ShapeLayer ? m[1] : null;
  }
  function usable(l) {
    return !(l instanceof CameraLayer) && !(l instanceof LightLayer) && !isGrid(l) && !gridOfArt(l);
  }
  function byName(comp, name) {
    for (var i = 1; i <= comp.numLayers; i += 1) {
      if (comp.layer(i).name === name && isGrid(comp.layer(i))) { return comp.layer(i); }
    }
    return null;
  }
  function artLayer(comp, name, kind) {
    for (var i = 1; i <= comp.numLayers; i += 1) {
      if (comp.layer(i).name === name + " " + kind && comp.layer(i) instanceof ShapeLayer) { return comp.layer(i); }
    }
    return null;
  }
  function countOf(g, axis) {
    var n = 0;
    while (fx(g).property(axis + " " + n)) { n += 1; }
    return n - 1; // lines - 1 = cells
  }

  // the cell a layer is attached to: { name, c0, r0, c1, r1, mode } or null
  function membership(l) {
    var m = null;
    try { m = l.property("ADBE Mask Parade").property(MASK); } catch (e) {}
    if (!m) { return null; }
    var e = m.property("ADBE Mask Shape").expression;
    var r = /\/\/ MF Grid: (.+?), cells (\d+),(\d+)-(\d+),(\d+) (\w+)/.exec(e);
    return r ? { name: r[1], c0: +r[2], r0: +r[3], c1: +r[4], r1: +r[5], mode: r[6] } : null;
  }

  // ------------------------------------------------------------------ controls

  // [name, matchName, default, panel key]
  var STYLE = [
    ["Lines", "ADBE Dropdown Control", 1, "lines"],
    ["Line Color", "ADBE Color Control", [0.62, 0.62, 0.62], null],
    ["Line Width", "ADBE Slider Control", 2, "width"],
    ["Dash", "ADBE Slider Control", 10, "dash"],
    ["Line Opacity", "ADBE Slider Control", 100, null],
    ["Points", "ADBE Dropdown Control", 1, "points"],
    ["Point Shape", "ADBE Dropdown Control", 1, "shape"],
    ["Point Size", "ADBE Slider Control", 14, "size"],
    ["Point Color", "ADBE Color Control", [0.24, 0.48, 1], null],
    ["Padding", "ADBE Slider Control", 0, "padding"],
    ["Roundness", "ADBE Slider Control", 0, "round"],
    ["Zoom", "ADBE Slider Control", 100, "zoom"]
  ];
  var KEYS = {
    lines: { full: 1, grid: 2, off: 3 },
    points: { every: 1, corners: 2, off: 3 },
    shape: { dot: 1, square: 2, plus: 3, cross: 4, diamond: 5 }
  };

  function addControl(g, name, matchName, def) {
    var p = fx(g).addProperty(matchName);
    var idx = p.propertyIndex;
    if (matchName === "ADBE Dropdown Control") {
      p.property(1).setPropertyParameters(name === "Lines" ? LINES : name === "Points" ? POINTS : SHAPES);
      p = fx(g).property(idx);
    }
    fx(g).property(idx).name = name;
    if (def !== null && def !== undefined) { fx(g).property(idx).property(1).setValue(def); }
  }

  // the value now, or a keyframe at the current time if it's animated
  function put(prop, v, t) {
    if (prop.numKeys > 0) { prop.setValueAtTime(t, v); } else { prop.setValue(v); }
  }

  function setStyle(g, o, t) {
    for (var i = 0; i < STYLE.length; i += 1) {
      var key = STYLE[i][3];
      if (!key || o[key] === undefined || o[key] === null) { continue; }
      var v = o[key];
      if (KEYS[key]) { v = KEYS[key][v] || 1; }
      var p = fx(g).property(STYLE[i][0]);
      if (p) { put(p.property(1), v, t); }
    }
  }

  function readStyle(g) {
    var o = {};
    for (var i = 0; i < STYLE.length; i += 1) {
      var key = STYLE[i][3];
      var p = fx(g).property(STYLE[i][0]);
      if (!key || !p) { continue; }
      var v = p.property(1).value;
      if (KEYS[key]) { for (var k in KEYS[key]) { if (KEYS[key][k] === Math.round(v)) { v = k; } } }
      o[key] = v;
    }
    return o;
  }

  function lineValues(g, axis, t) {
    var out = [];
    for (var i = 0; fx(g).property(axis + " " + i); i += 1) { out.push(fx(g).property(axis + " " + i).property(1).valueAtTime(t, false)); }
    return out;
  }

  // ------------------------------------------------------------------ expressions

  function head(name, what) {
    return [
      MARK + name + ", " + what + " -- settings on that null (Effect Controls)",
      "var g = thisComp.layer(\"" + name + "\");",
      "function f(n) { return g.effect(n)(1).value; }"
    ].join("\n");
  }

  function linePath(name, axis, k, last) {
    var a = axis === "X";
    return [
      head(name, (a ? "vertical" : "horizontal") + " line " + k),
      "var v = f(\"" + axis + " " + k + "\"), grid = f(\"Lines\") == 2;",
      "var s0 = grid ? f(\"" + (a ? "Y" : "X") + " 0\") : 0, s1 = grid ? f(\"" + (a ? "Y" : "X") + " " + last + "\") : thisComp." + (a ? "height" : "width") + ";",
      a ? "createPath([fromComp([v, s0]), fromComp([v, s1])], [], [], false);" : "createPath([fromComp([s0, v]), fromComp([s1, v])], [], [], false);"
    ].join("\n");
  }

  function pointPath(name, i, j) {
    return [
      head(name, "point " + i + "," + j),
      "var c = fromComp([f(\"X " + i + "\"), f(\"Y " + j + "\")]), h = Math.max(0.5, f(\"Point Size\") / 2), t = h * 0.36, sh = Math.round(f(\"Point Shape\"));",
      "var P, I = [], O = [];",
      "if (sh == 1) { var k = h * 0.5523; P = [[0, -h], [h, 0], [0, h], [-h, 0]]; I = [[-k, 0], [0, -k], [k, 0], [0, k]]; O = [[k, 0], [0, k], [-k, 0], [0, -k]]; }",
      "else if (sh == 2) { P = [[-h, -h], [h, -h], [h, h], [-h, h]]; }",
      "else if (sh == 5) { P = [[0, -h], [h, 0], [0, h], [-h, 0]]; }",
      "else { P = [[-t, -h], [t, -h], [t, -t], [h, -t], [h, t], [t, t], [t, h], [-t, h], [-t, t], [-h, t], [-h, -t], [-t, -t]];",
      "  if (sh == 4) { var r = Math.SQRT1_2; for (var n = 0; n < P.length; n++) { P[n] = [(P[n][0] - P[n][1]) * r, (P[n][0] + P[n][1]) * r]; } } }",
      "for (var n = 0; n < P.length; n++) { P[n] = [P[n][0] + c[0], P[n][1] + c[1]]; }",
      "createPath(P, I, O, true);"
    ].join("\n");
  }

  function pointOpacity(name, i, j, C, R) {
    var corner = (i === 0 || i === C) && (j === 0 || j === R);
    return head(name, "point " + i + "," + j) + "\nvar m = Math.round(f(\"Points\"));\n(m == 1 || (m == 2 && " + corner + ")) ? 100 : 0;";
  }

  // the cell rectangle in comp px, padded: L, T, R, B
  function cellRect(c) {
    return [
      "var x0 = f(\"X " + c.c0 + "\"), x1 = f(\"X " + (c.c1 + 1) + "\"), y0 = f(\"Y " + c.r0 + "\"), y1 = f(\"Y " + (c.r1 + 1) + "\");",
      "var L = Math.min(x0, x1), R = Math.max(x0, x1), T = Math.min(y0, y1), B = Math.max(y0, y1);",
      "var pd = Math.min(f(\"Padding\"), (R - L) / 2 - 0.5, (B - T) / 2 - 0.5); if (pd > 0) { L += pd; R -= pd; T += pd; B -= pd; }"
    ].join("\n");
  }
  function cellTag(c, mode) {
    return "cells " + c.c0 + "," + c.r0 + "-" + c.c1 + "," + c.r1 + " " + mode;
  }

  function maskPath(name, c, mode) {
    return [
      head(name, cellTag(c, mode)),
      cellRect(c),
      "var rr = Math.max(0, Math.min(f(\"Roundness\"), (R - L) / 2, (B - T) / 2)), k = rr * 0.5523;",
      "var P, I = [], O = [];",
      "if (rr < 0.5) { P = [[L, T], [R, T], [R, B], [L, B]]; I = [[0, 0], [0, 0], [0, 0], [0, 0]]; O = I; }",
      "else {",
      "  P = [[L + rr, T], [R - rr, T], [R, T + rr], [R, B - rr], [R - rr, B], [L + rr, B], [L, B - rr], [L, T + rr]];",
      "  I = [[-k, 0], [0, 0], [0, -k], [0, 0], [k, 0], [0, 0], [0, k], [0, 0]];",
      "  O = [[0, 0], [k, 0], [0, 0], [0, k], [0, 0], [-k, 0], [0, 0], [0, -k]];",
      "}",
      "// to this layer's space (handles too, so scale and rotation follow)",
      "var lp = [], li = [], lo = [];",
      "for (var n = 0; n < P.length; n++) {",
      "  var q = fromComp(P[n]); lp.push(q);",
      "  li.push(fromComp([P[n][0] + I[n][0], P[n][1] + I[n][1]]) - q);",
      "  lo.push(fromComp([P[n][0] + O[n][0], P[n][1] + O[n][1]]) - q);",
      "}",
      "createPath(lp, li, lo, true);"
    ].join("\n");
  }

  // cover: the layer scaled to fill the cell and centred in it
  function coverBody(name, c, last) {
    return [
      head(name, cellTag(c, "cover")),
      cellRect(c),
      "var r = thisLayer.sourceRectAtTime(time, false);",
      "var s = Math.max((R - L) / Math.max(1, r.width), (B - T) / Math.max(1, r.height)) * f(\"Zoom\") / 100;",
      last
    ].join("\n");
  }
  var COVER = {
    "ADBE Position": "var a = transform.anchorPoint, mid = [r.left + r.width / 2, r.top + r.height / 2];\nvar p = [(L + R) / 2 - (mid[0] - a[0]) * s, (T + B) / 2 - (mid[1] - a[1]) * s];\nhasParent ? parent.fromComp(p) : p;",
    "ADBE Scale": "[s * 100, s * 100];"
  };

  // ------------------------------------------------------------------ building

  function newName(comp) {
    for (var n = 1; n < 1000; n += 1) {
      var name = "MF Grid " + n, used = false;
      for (var i = 1; i <= comp.numLayers; i += 1) {
        var ln = comp.layer(i).name;
        if (ln === name || ln === name + " Lines" || ln === name + " Points") { used = true; break; }
      }
      if (!used) { return name; }
    }
    return "MF Grid";
  }

  function rootOf(s) { return s.property("ADBE Root Vectors Group"); }

  function clearContents(s) {
    var root = rootOf(s);
    while (root.numProperties > 0) { root.property(1).remove(); root = rootOf(s); }
  }

  // one group with one path whose shape is the expression
  function addPathGroup(s, label, expr) {
    var idx = rootOf(s).addProperty("ADBE Vector Group").propertyIndex;
    var grp = rootOf(s).property(idx);
    grp.name = label;
    grp.property("ADBE Vectors Group").addProperty("ADBE Vector Shape - Group");
    rootOf(s).property(idx).property("ADBE Vectors Group").property(1).property("ADBE Vector Shape").expression = expr;
    return idx;
  }

  function buildLines(s, name, C, R) {
    clearContents(s);
    for (var i = 0; i <= C; i += 1) { addPathGroup(s, "X " + i, linePath(name, "X", i, R)); }
    for (var j = 0; j <= R; j += 1) { addPathGroup(s, "Y " + j, linePath(name, "Y", j, C)); }
    var si = rootOf(s).addProperty("ADBE Vector Graphic - Stroke").propertyIndex;
    var st = function () { return rootOf(s).property(si); };
    st().property("ADBE Vector Stroke Color").expression = head(name, "line color") + "\nf(\"Line Color\");";
    st().property("ADBE Vector Stroke Width").expression = head(name, "line width") + "\nf(\"Line Width\");";
    st().property("ADBE Vector Stroke Opacity").expression = head(name, "line opacity") + "\nMath.round(f(\"Lines\")) == 3 ? 0 : f(\"Line Opacity\");";
    st().property("ADBE Vector Stroke Line Cap").setValue(1);
    st().property("ADBE Vector Stroke Dashes").addProperty("ADBE Vector Stroke Dash 1");
    st().property("ADBE Vector Stroke Dashes").addProperty("ADBE Vector Stroke Gap 1");
    st().property("ADBE Vector Stroke Dashes").property("ADBE Vector Stroke Dash 1").expression = head(name, "dash") + "\nMath.max(0.1, f(\"Dash\"));";
    st().property("ADBE Vector Stroke Dashes").property("ADBE Vector Stroke Gap 1").expression = head(name, "gap") + "\nf(\"Dash\") > 0 ? f(\"Dash\") * 0.8 : 0;";
  }

  function buildPoints(s, name, C, R) {
    clearContents(s);
    for (var j = 0; j <= R; j += 1) {
      for (var i = 0; i <= C; i += 1) {
        var idx = addPathGroup(s, "Point " + i + "," + j, pointPath(name, i, j));
        rootOf(s).property(idx).property("ADBE Vector Transform Group").property("ADBE Vector Group Opacity").expression = pointOpacity(name, i, j, C, R);
      }
    }
    var fi = rootOf(s).addProperty("ADBE Vector Graphic - Fill").propertyIndex;
    rootOf(s).property(fi).property("ADBE Vector Fill Color").expression = head(name, "point color") + "\nf(\"Point Color\");";
  }

  function artShape(comp, name, kind, above) {
    var s = artLayer(comp, name, kind);
    if (!s) {
      s = comp.layers.addShape();
      s.name = name + " " + kind;
      s.label = 9;
      s.moveBefore(above);
    }
    return s;
  }

  // even lines between the outer two (or across the bounds given)
  function even(a, b, n) {
    var out = [];
    for (var i = 0; i <= n; i += 1) { out.push(a + (b - a) * i / n); }
    return out;
  }

  // (re)make the line controls of one axis: n cells, positions xs
  function setAxis(g, axis, xs, t) {
    var i = 0;
    for (; i < xs.length; i += 1) {
      var p = fx(g).property(axis + " " + i);
      if (!p) {
        // right after the previous line of the axis (X 0 / X 1 / Y 0 / Y 1 always exist)
        var at = fx(g).property(axis + " " + (i - 1)).propertyIndex + 1;
        var np = fx(g).addProperty("ADBE Slider Control");
        np.moveTo(at);
        fx(g).property(at).name = axis + " " + i;
        p = fx(g).property(at);
        p.property(1).setValue(xs[i]);
      } else {
        put(p.property(1), xs[i], t);
      }
    }
    while (fx(g).property(axis + " " + i)) { fx(g).property(axis + " " + i).remove(); i += 1; }
  }

  function rebuildArt(comp, g) {
    var C = countOf(g, "X"), R = countOf(g, "Y");
    var lines = artShape(comp, g.name, "Lines", g);
    lines.moveAfter(g);
    var points = artShape(comp, g.name, "Points", g);
    points.moveAfter(g);
    buildLines(lines, g.name, C, R);
    buildPoints(points, g.name, C, R);
  }

  // which grid the panel talks about: the one in the selection, else the
  // topmost in the comp
  function pickGrid(comp) {
    var sel = comp.selectedLayers;
    for (var i = 0; i < sel.length; i += 1) {
      if (isGrid(sel[i])) { return sel[i]; }
      var a = gridOfArt(sel[i]);
      if (a && byName(comp, a)) { return byName(comp, a); }
      var m = membership(sel[i]);
      if (m && byName(comp, m.name)) { return byName(comp, m.name); }
    }
    for (var j = 1; j <= comp.numLayers; j += 1) { if (isGrid(comp.layer(j))) { return comp.layer(j); } }
    return null;
  }

  function release(l) {
    var m = membership(l);
    if (!m) { return false; }
    l.property("ADBE Mask Parade").property(MASK).remove();
    for (var k in COVER) {
      var p = tr(l).property(k);
      if (p.expression.indexOf(MARK) >= 0) { p.expression = ""; }
    }
    return true;
  }

  function attach(l, name, c, mode) {
    release(l);
    var masks = l.property("ADBE Mask Parade");
    var others = masks.numProperties;
    var mi = masks.addProperty("ADBE Mask Atom").propertyIndex;
    var m = l.property("ADBE Mask Parade").property(mi);
    m.name = MASK;
    m.maskMode = others ? MaskMode.INTERSECT : MaskMode.ADD;
    m.property("ADBE Mask Shape").expression = maskPath(name, c, mode);
    if (mode === "cover") {
      for (var k in COVER) { tr(l).property(k).expression = coverBody(name, c, COVER[k]); }
    }
  }

  // ------------------------------------------------------------------ actions

  function wrap(label, fn) {
    var comp = activeComp();
    if (!comp) { return stringify({ ok: false, error: "Open a composition first." }); }
    app.beginUndoGroup("Mótion Film: " + label);
    try {
      var res = fn(comp);
      app.endUndoGroup();
      return stringify(res);
    } catch (error) {
      app.endUndoGroup();
      return stringify({ ok: false, error: String(error.message || error) + (error.line ? " (line " + error.line + ")" : "") });
    }
  }

  // o: { cols, rows, xs, ys (0..1 of the comp), style... }
  $.global.gdCreate = function (o) {
    return wrap("Grid", function (comp) {
      o = o || {};
      var C = Math.max(1, Math.min(MAXN, o.cols || 2)), R = Math.max(1, Math.min(MAXN, o.rows || 2));
      var xs = o.xs && o.xs.length === C + 1 ? o.xs : even(0.1, 0.9, C);
      var ys = o.ys && o.ys.length === R + 1 ? o.ys : even(0.12, 0.88, R);
      var g = comp.layers.addNull(comp.duration);
      g.name = newName(comp);
      g.label = 9;
      g.moveToBeginning();
      tr(g).property("ADBE Position").setValue([comp.width / 2, comp.height / 2]);
      for (var i = 0; i <= C; i += 1) { addControl(g, "X " + i, "ADBE Slider Control", xs[i] * comp.width); }
      for (var j = 0; j <= R; j += 1) { addControl(g, "Y " + j, "ADBE Slider Control", ys[j] * comp.height); }
      for (var s = 0; s < STYLE.length; s += 1) { addControl(g, STYLE[s][0], STYLE[s][1], STYLE[s][2]); }
      setStyle(g, o, comp.time);
      rebuildArt(comp, g);
      g.selected = true;
      return { ok: true, name: g.name, message: "Grid made: " + C + " × " + R + " on “" + g.name + "”. Select layers and a cell to attach them." };
    });
  };

  // the lines at the current time: { name, xs, ys } in comp px
  $.global.gdSetLines = function (o) {
    return wrap("Grid lines", function (comp) {
      var g = byName(comp, o.name);
      if (!g) { return { ok: false, error: "“" + o.name + "” isn't in this comp anymore." }; }
      var t = comp.time;
      for (var i = 0; i < o.xs.length; i += 1) { var px = fx(g).property("X " + i); if (px) { put(px.property(1), o.xs[i], t); } }
      for (var j = 0; j < o.ys.length; j += 1) { var py = fx(g).property("Y " + j); if (py) { put(py.property(1), o.ys[j], t); } }
      return { ok: true };
    });
  };

  // a keyframe on every line at the current time (start of an animation)
  $.global.gdKey = function (o) {
    return wrap("Grid keyframes", function (comp) {
      var g = byName(comp, o.name);
      if (!g) { return { ok: false, error: "No grid." }; }
      var t = comp.time, n = 0;
      var axes = ["X", "Y"];
      for (var a = 0; a < 2; a += 1) {
        for (var i = 0; fx(g).property(axes[a] + " " + i); i += 1) {
          var p = fx(g).property(axes[a] + " " + i).property(1);
          p.setValueAtTime(t, p.valueAtTime(t, false));
          n += 1;
        }
      }
      return { ok: true, message: "Keyframed " + n + " grid lines at " + timeToCurrentFormat(t, comp.frameRate) + ". Move the time and drag the lines." };
    });
  };

  $.global.gdStyle = function (o) {
    return wrap("Grid style", function (comp) {
      var g = byName(comp, o.name);
      if (!g) { return { ok: false, error: "No grid." }; }
      setStyle(g, o, comp.time);
      return { ok: true };
    });
  };

  // new column / row counts: lines re-spaced evenly inside the outer ones
  $.global.gdResize = function (o) {
    return wrap("Grid size", function (comp) {
      var g = byName(comp, o.name);
      if (!g) { return { ok: false, error: "No grid." }; }
      var t = comp.time;
      var C = Math.max(1, Math.min(MAXN, o.cols)), R = Math.max(1, Math.min(MAXN, o.rows));
      var xs = lineValues(g, "X", t), ys = lineValues(g, "Y", t);
      if (xs.length !== C + 1) { setAxis(g, "X", even(xs[0], xs[xs.length - 1], C), t); }
      if (ys.length !== R + 1) { setAxis(g, "Y", even(ys[0], ys[ys.length - 1], R), t); }
      // cards on cells that don't exist anymore let go
      var freed = 0;
      for (var i = 1; i <= comp.numLayers; i += 1) {
        var m = membership(comp.layer(i));
        if (m && m.name === g.name && (m.c1 >= C || m.r1 >= R)) { release(comp.layer(i)); freed += 1; }
      }
      rebuildArt(comp, g);
      return { ok: true, message: "Grid is " + C + " × " + R + "." + (freed ? " " + freed + " layer" + (freed === 1 ? "" : "s") + " left cells that are gone." : "") };
    });
  };

  // the selected layers into cells c0,r0..c1,r1
  $.global.gdAttach = function (o) {
    return wrap("Grid attach", function (comp) {
      var g = byName(comp, o.name);
      if (!g) { return { ok: false, error: "Make a grid first." }; }
      var C = countOf(g, "X"), R = countOf(g, "Y");
      var c = { c0: Math.min(o.c0, o.c1), c1: Math.max(o.c0, o.c1), r0: Math.min(o.r0, o.r1), r1: Math.max(o.r0, o.r1) };
      if (c.c1 >= C || c.r1 >= R) { return { ok: false, error: "That cell isn't in the grid." }; }
      var sel = comp.selectedLayers, n = 0;
      for (var i = 0; i < sel.length; i += 1) {
        if (!usable(sel[i])) { continue; }
        if (sel[i].threeDLayer) { sel[i].threeDLayer = false; }
        attach(sel[i], g.name, c, o.mode === "mask" ? "mask" : "cover");
        n += 1;
      }
      if (!n) { return { ok: false, error: "Select the layers to put in the cell." }; }
      var cell = (c.r0 + 1) + "-" + (c.c0 + 1) + (c.c1 > c.c0 || c.r1 > c.r0 ? " to " + (c.r1 + 1) + "-" + (c.c1 + 1) : "");
      return { ok: true, message: n + " layer" + (n === 1 ? "" : "s") + " in cell " + cell + "." };
    });
  };

  // selected layers out of their cells; a selected grid (its null or its
  // lines / points) takes the whole grid away
  $.global.gdRelease = function () {
    return wrap("Remove grid", function (comp) {
      var sel = comp.selectedLayers, grids = {}, n = 0, i;
      for (i = 0; i < sel.length; i += 1) {
        if (isGrid(sel[i])) { grids[sel[i].name] = true; }
        var a = gridOfArt(sel[i]);
        if (a) { grids[a] = true; }
      }
      for (i = 1; i <= comp.numLayers; i += 1) {
        var l = comp.layer(i), m = membership(l);
        if (m && (grids[m.name] || l.selected)) { if (release(l)) { n += 1; } }
      }
      var gone = 0;
      for (var name in grids) {
        var kinds = ["Lines", "Points"];
        for (var k = 0; k < 2; k += 1) { var s = artLayer(comp, name, kinds[k]); if (s) { s.remove(); } }
        var g = byName(comp, name);
        if (g) { g.remove(); gone += 1; }
      }
      if (!n && !gone) { return { ok: true, message: "Nothing of a grid in the selection." }; }
      return { ok: true, message: (gone ? "Grid removed" : "Released") + (n ? ": " + n + " layer" + (n === 1 ? "" : "s") + " out of their cells." : ".") };
    });
  };

  // what the panel shows
  $.global.gdState = function () {
    var comp = activeComp();
    if (!comp) { return stringify({ ok: true, comp: null }); }
    var sel = comp.selectedLayers, count = 0;
    for (var i = 0; i < sel.length; i += 1) { if (usable(sel[i])) { count += 1; } }
    var g = pickGrid(comp), grid = null;
    if (g) {
      var t = comp.time, keyed = false;
      for (var k = 1; k <= fx(g).numProperties; k += 1) {
        if (/^[XY] \d+$/.test(fx(g).property(k).name) && fx(g).property(k).property(1).numKeys > 0) { keyed = true; }
      }
      var cells = [];
      for (var j = 1; j <= comp.numLayers; j += 1) {
        var m = membership(comp.layer(j));
        if (m && m.name === g.name) { m.layer = comp.layer(j).name; m.selected = comp.layer(j).selected; cells.push(m); }
      }
      grid = { name: g.name, xs: lineValues(g, "X", t), ys: lineValues(g, "Y", t), keyed: keyed, style: readStyle(g), cells: cells };
    }
    return stringify({ ok: true, comp: { w: comp.width, h: comp.height }, count: count, grid: grid });
  };
}());
