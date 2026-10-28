/*
 * Mótion Film -- Carousel (Tools › 05 / CAROUSEL, client/carousel.js).
 *
 * As camadas selecionadas viram cartões de um carrossel que anda sozinho,
 * em 4 estilos (Style):
 *   1 Spherical    cartões espalhados numa esfera que gira
 *   2 Radial       um anel (Spread < 360 = um arco aberto)
 *   3 Rectangular  uma parede em grade que rola de lado
 *   4 Curved Line  uma curva pelos pinos Start / Middle / End; no Middle
 *                  os cartões crescem (Middle Size / Width / Softness),
 *                  nas pontas ficam no Side Size e somem
 * Rotation X / Y inclinam e viram o conjunto; Facing: Forward (de frente
 * pra tela), Screen (virados pra câmera), Center (de costas pro centro,
 * como um carrossel de verdade). A profundidade fica com a câmera do AE.
 *
 * Tudo mora num null "MF Carousel N" (Effect Controls). Speed e Offset em
 * % do percurso (Offset dá pra animar para parar e andar). Gap 0 = Auto
 * (cartões espalhados no percurso todo). Cada camada ganha expressões em
 * Position, Scale, Opacity, Orientation e Z Rotation que leem o null e
 * vira 3D (Remove devolve 2D a quem era 2D).
 *
 * Carregado sob demanda via $.evalFile. Um undo por ação.
 */
(function () {
  var MARK = "// MF Carousel: ";
  var WAS2D = " (was 2D)";
  var STYLES = ["Spherical", "Radial", "Rectangular", "Curved Line"];
  var STYLE_KEY = { spherical: 1, radial: 2, rectangular: 3, curved: 4 };
  var FACINGS = ["Forward", "Screen", "Center"];
  var FACING_KEY = { forward: 1, screen: 2, center: 3 };

  function stringify(v) {
    try { return JSON.stringify(v); } catch (e) { return '{"ok":false,"error":"serialize"}'; }
  }
  function activeComp() {
    var a = app.project ? app.project.activeItem : null;
    return a instanceof CompItem ? a : null;
  }
  function isController(l) {
    return l.nullLayer && /^MF Carousel/.test(l.name) && !!l.property("ADBE Effect Parade").property("Style");
  }
  function usable(l) {
    return !(l instanceof CameraLayer) && !(l instanceof LightLayer) && !isController(l);
  }
  function tr(l) { return l.property("ADBE Transform Group"); }
  // the carousel a layer belongs to: { name, was2d } or null
  function membership(l) {
    var e = "";
    try { e = tr(l).property("ADBE Position").expression; } catch (x) {}
    if (e.indexOf(MARK) < 0) { return null; }
    var m = /thisComp\.layer\("([^"]+)"\)/.exec(e);
    return m ? { name: m[1], was2d: e.indexOf(WAS2D) >= 0 } : null;
  }
  function byName(comp, name) {
    for (var i = 1; i <= comp.numLayers; i += 1) {
      if (comp.layer(i).name === name && isController(comp.layer(i))) { return comp.layer(i); }
    }
    return null;
  }

  // ------------------------------------------------------------------ controls

  // [name, matchName, default, panel key]
  var CONTROLS = [
    ["Style", "ADBE Dropdown Control", 2, "style"],
    ["Speed", "ADBE Slider Control", 10, "speed"],
    ["Offset", "ADBE Slider Control", 0, null],
    ["Size", "ADBE Slider Control", 100, "size"],
    ["Spread", "ADBE Angle Control", 360, "spread"],
    ["Rotation X", "ADBE Angle Control", 22, "rotX"],
    ["Rotation Y", "ADBE Angle Control", 0, "rotY"],
    ["Facing", "ADBE Dropdown Control", 1, "facing"],
    ["Start", "ADBE Point Control", null, null],
    ["Middle", "ADBE Point Control", null, null],
    ["End", "ADBE Point Control", null, null],
    ["Gap", "ADBE Slider Control", 0, "gap"],
    ["Side Size", "ADBE Slider Control", 70, "side"],
    ["Middle Size", "ADBE Slider Control", 200, "middle"],
    ["Middle Width", "ADBE Slider Control", 5, "width"],
    ["Softness", "ADBE Slider Control", 15, "soft"],
    ["Follow Curve", "ADBE Checkbox Control", 0, "follow"]
  ];

  function ctl(nullLayer, name) { return nullLayer.property("ADBE Effect Parade").property(name).property(1); }

  function addControls(nullLayer) {
    var fx = nullLayer.property("ADBE Effect Parade");
    for (var i = 0; i < CONTROLS.length; i += 1) {
      var c = CONTROLS[i];
      if (fx.property(c[0])) { continue; }
      var p = fx.addProperty(c[1]);
      var idx = p.propertyIndex;
      if (c[1] === "ADBE Dropdown Control") {
        p.property(1).setPropertyParameters(c[0] === "Style" ? STYLES : FACINGS);
      }
      fx.property(idx).name = c[0];
      if (c[2] !== null) { fx.property(idx).property(1).setValue(c[2]); }
    }
  }

  // o: panel settings; pins in 0..1 of the comp
  function setControls(nullLayer, comp, o) {
    for (var i = 0; i < CONTROLS.length; i += 1) {
      var key = CONTROLS[i][3];
      if (!key || o[key] === undefined || o[key] === null) { continue; }
      var v = o[key];
      if (key === "style") { v = STYLE_KEY[v] || 2; }
      if (key === "facing") { v = FACING_KEY[v] || 1; }
      if (key === "follow") { v = v ? 1 : 0; }
      ctl(nullLayer, CONTROLS[i][0]).setValue(v);
    }
    if (o.pins) {
      var names = { s: "Start", m: "Middle", e: "End" };
      for (var k in names) {
        if (o.pins[k]) { ctl(nullLayer, names[k]).setValue([o.pins[k][0] * comp.width, o.pins[k][1] * comp.height]); }
      }
    }
  }

  function readControls(nullLayer, comp) {
    var o = {};
    for (var i = 0; i < CONTROLS.length; i += 1) {
      var key = CONTROLS[i][3];
      if (!key) { continue; }
      var v = ctl(nullLayer, CONTROLS[i][0]).value;
      if (key === "style") { v = ["spherical", "radial", "rectangular", "curved"][Math.max(0, Math.min(3, v - 1))]; }
      if (key === "facing") { v = ["forward", "screen", "center"][Math.max(0, Math.min(2, v - 1))]; }
      if (key === "follow") { v = !!v; }
      o[key] = v;
    }
    var pin = function (n) { var p = ctl(nullLayer, n).value; return [p[0] / comp.width, p[1] / comp.height]; };
    o.pins = { s: pin("Start"), m: pin("Middle"), e: pin("End") };
    return o;
  }

  // ------------------------------------------------------------------ expressions

  // One body for every property: it works out the card's place R = {p, k,
  // o, ori, rz} and each property returns its own part.
  function body(name, i, n, was2d, last) {
    return [
      MARK + name + ", card " + (i + 1) + " of " + n + (was2d ? WAS2D : "") + " -- settings on that null (Effect Controls)",
      "var c = thisComp.layer(\"" + name + "\");",
      "var N = " + n + ", i = " + i + ";",
      "function f(n) { return c.effect(n)(1).value; }",
      "function frac(x) { return x - Math.floor(x); }",
      "var st = Math.round(f(\"Style\"));",
      "var ph = (f(\"Offset\") + (time - c.inPoint) * f(\"Speed\")) / 100;",
      "var o0 = c.transform.position, ctr = [o0[0], o0[1], 0];",
      "var R = thisComp.width * 0.32 * f(\"Size\") / 100;",
      "var rx = degreesToRadians(f(\"Rotation X\")), ry = degreesToRadians(f(\"Rotation Y\"));",
      "function turn(v) {",
      "  var y1 = v[1] * Math.cos(rx) - v[2] * Math.sin(rx), z1 = v[1] * Math.sin(rx) + v[2] * Math.cos(rx);",
      "  return [ctr[0] + v[0] * Math.cos(ry) + z1 * Math.sin(ry), ctr[1] + y1, -v[0] * Math.sin(ry) + z1 * Math.cos(ry)];",
      "}",
      "var P, k = 1, op = 1, rz = 0, out = null;",
      "if (st == 1) {",
      "  // spherical: even points on a sphere, spinning around its axis",
      "  var y = 1 - 2 * (i + 0.5) / N, r = Math.sqrt(Math.max(0, 1 - y * y)), a = i * 2.39996 + ph * 2 * Math.PI;",
      "  var Rs = Math.min(thisComp.width, thisComp.height) * 0.36 * f(\"Size\") / 100;",
      "  P = turn([Rs * r * Math.sin(a), Rs * y, -Rs * r * Math.cos(a)]);",
      "} else if (st == 2) {",
      "  // radial: a ring; a Spread under 360 is an open arc the cards run through",
      "  var sp = f(\"Spread\"), u = frac(i / N + ph), a;",
      "  if (sp >= 359.5) { a = u * 2 * Math.PI; } else { a = degreesToRadians((u - 0.5) * sp); op = Math.min(1, Math.min(u, 1 - u) / 0.06); }",
      "  P = turn([R * Math.sin(a), 0, -R * Math.cos(a)]);",
      "} else if (st == 3) {",
      "  // rectangular: a grid wall rolling sideways",
      "  var cols = Math.ceil(Math.sqrt(N * 1.6)), rows = Math.ceil(N / cols), cell = R * 0.62;",
      "  var x = frac(((i % cols) + 0.5) / cols + ph) * cols, row = Math.floor(i / cols);",
      "  op = Math.min(1, Math.min(x, cols - x) / 0.5);",
      "  P = turn([(x - cols / 2) * cell, (row - (rows - 1) / 2) * cell * 1.15, 0]);",
      "} else {",
      "  // curved line through the pins; the Middle pin is u = 0.5",
      "  var S = f(\"Start\"), M = f(\"Middle\"), E = f(\"End\");",
      "  var C = [2 * M[0] - (S[0] + E[0]) / 2, 2 * M[1] - (S[1] + E[1]) / 2];",
      "  function B(t) { var a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, d = t * t; return [a * S[0] + b * C[0] + d * E[0], a * S[1] + b * C[1] + d * E[1]]; }",
      "  var K = 24, L1 = 0, L2 = 0, q0 = B(0), q;",
      "  for (var j = 1; j <= 2 * K; j++) { q = B(j / (2 * K)); if (j <= K) { L1 += length(q0, q); } else { L2 += length(q0, q); } q0 = q; }",
      "  var gap = f(\"Gap\") > 0 ? f(\"Gap\") / Math.max(1, L1 + L2) : 1 / N;",
      "  var loop = Math.max(1, N * gap), u = frac((i * gap + ph) / loop) * loop;",
      "  var on = u <= 1;",
      "  u = Math.min(u, 1);",
      "  var t0 = u < 0.5 ? 0 : 0.5, s = u < 0.5 ? u * 2 : (u - 0.5) * 2, Ls = [0], p0 = B(t0);",
      "  for (var j = 1; j <= K; j++) { q = B(t0 + 0.5 * j / K); Ls.push(Ls[j - 1] + length(p0, q)); p0 = q; }",
      "  var goal = s * Ls[K], t = t0 + 0.5;",
      "  for (var j = 1; j <= K; j++) { if (Ls[j] >= goal) { t = t0 + 0.5 * (j - 1 + (goal - Ls[j - 1]) / Math.max(0.0001, Ls[j] - Ls[j - 1])) / K; break; } }",
      "  var Q = B(t), d = Math.abs(u - 0.5), hw = f(\"Middle Width\") / 200, so = Math.max(0.001, f(\"Softness\") / 100);",
      "  var m = d <= hw ? 1 : Math.max(0, 1 - (d - hw) / so); m = m * m * (3 - 2 * m);",
      "  k = (f(\"Side Size\") + (f(\"Middle Size\") - f(\"Side Size\")) * m) / 100;",
      "  op = on ? Math.min(1, Math.min(u, 1 - u) / 0.06) : 0;",
      "  if (f(\"Follow Curve\")) { var tg = [2 * (1 - t) * (C[0] - S[0]) + 2 * t * (E[0] - C[0]), 2 * (1 - t) * (C[1] - S[1]) + 2 * t * (E[1] - C[1])]; rz = radiansToDegrees(Math.atan2(tg[1], tg[0])); }",
      "  P = [Q[0], Q[1], -m * 20]; // nearer the Middle = in front",
      "}",
      last
    ].join("\n");
  }

  var PARTS = {
    "ADBE Position": "P;",
    "ADBE Scale": "[value[0] * k, value[1] * k, value[2]];",
    "ADBE Opacity": "value * op;",
    "ADBE Orientation": [
      "var fc = Math.round(f(\"Facing\"));",
      "if (st == 4 || fc == 1) { value; } else if (fc == 2) {",
      "  var cam; try { cam = thisComp.activeCamera.toWorld([0, 0, 0]); } catch (e) { cam = [thisComp.width / 2, thisComp.height / 2, -thisComp.width * 1.3889]; }",
      "  lookAt(cam, P);",
      "} else { lookAt(P, st == 3 ? turn([0, 0, R]) : ctr); }"
    ].join("\n"),
    "ADBE Rotate Z": "value + rz;"
  };

  function drive(layer, name, i, n, was2d) {
    var t = tr(layer);
    for (var m in PARTS) { t.property(m).expression = body(name, i, n, was2d, PARTS[m]); }
  }

  function release(layer) {
    var mm = membership(layer);
    if (!mm) { return null; }
    var t = tr(layer);
    for (var m in PARTS) {
      if (t.property(m).expression.indexOf(MARK) >= 0) { t.property(m).expression = ""; }
    }
    if (mm.was2d) { layer.threeDLayer = false; }
    return mm.name;
  }

  function stillUsed(comp, name) {
    for (var i = 1; i <= comp.numLayers; i += 1) {
      var m = membership(comp.layer(i));
      if (m && m.name === name) { return true; }
    }
    return false;
  }

  function newName(comp) {
    for (var n = 1; n < 1000; n += 1) {
      var name = "MF Carousel " + n, used = false;
      for (var i = 1; i <= comp.numLayers; i += 1) { if (comp.layer(i).name === name) { used = true; break; } }
      if (!used) { return name; }
    }
    return "MF Carousel";
  }

  // ------------------------------------------------------------------ actions

  $.global.cxApply = function (o) {
    var comp = activeComp();
    if (!comp) { return stringify({ ok: false, error: "Open a composition first." }); }
    var sel = comp.selectedLayers;
    var layers = [];
    for (var i = 0; i < sel.length; i += 1) { if (usable(sel[i])) { layers.push(sel[i]); } }
    if (layers.length < 2) { return stringify({ ok: false, error: "Select 2 or more layers for the carousel." }); }
    layers.sort(function (a, b) { return a.index - b.index; });

    // the same carousel again: reuse its null
    var reuse = null;
    var first = membership(layers[0]);
    if (first) {
      reuse = byName(comp, first.name);
      for (var r = 1; r < layers.length && reuse; r += 1) {
        var m = membership(layers[r]);
        if (!m || m.name !== first.name) { reuse = null; }
      }
    }

    app.beginUndoGroup("Mótion Film: Carousel");
    var made = null;
    try {
      var ctrl = reuse;
      var olds = {};
      if (!ctrl) {
        made = comp.layers.addNull(comp.duration);
        ctrl = made;
        ctrl.name = newName(comp);
        ctrl.label = 9;
        tr(ctrl).property("ADBE Position").setValue([comp.width / 2, comp.height / 2]);
        ctrl.moveBefore(layers[0]);
        addControls(ctrl);
      }
      setControls(ctrl, comp, o || {});
      for (var j = 0; j < layers.length; j += 1) {
        var was = membership(layers[j]);
        var was2d = was ? was.was2d : !layers[j].threeDLayer;
        if (was && was.name !== ctrl.name) { olds[was.name] = true; }
        if (!layers[j].threeDLayer) { layers[j].threeDLayer = true; }
        drive(layers[j], ctrl.name, j, layers.length, was2d);
      }
      // a carousel left with no cards loses its null
      for (var name in olds) {
        if (!stillUsed(comp, name)) { var dead = byName(comp, name); if (dead) { dead.remove(); } }
      }
      ctrl.selected = true;
      for (var s = 0; s < layers.length; s += 1) { layers[s].selected = true; }
      app.endUndoGroup();
      return stringify({ ok: true, name: ctrl.name, message: (reuse ? "Carousel updated: " : "Carousel made: ") + layers.length + " cards on “" + ctrl.name + "”." });
    } catch (error) {
      try { if (made) { made.remove(); } } catch (e2) {}
      app.endUndoGroup();
      return stringify({ ok: false, error: "Couldn't build the carousel: " + String(error.message || error) + (error.line ? " (line " + error.line + ")" : "") });
    }
  };

  // live changes from the panel to an existing carousel
  $.global.cxUpdate = function (o) {
    var comp = activeComp();
    if (!comp || !o || !o.name) { return stringify({ ok: false, error: "No carousel." }); }
    var ctrl = byName(comp, o.name);
    if (!ctrl) { return stringify({ ok: false, error: "“" + o.name + "” isn't in this comp anymore." }); }
    app.beginUndoGroup("Mótion Film: Carousel");
    try { setControls(ctrl, comp, o); } catch (e) {
      app.endUndoGroup();
      return stringify({ ok: false, error: String(e.message || e) });
    }
    app.endUndoGroup();
    return stringify({ ok: true });
  };

  // selected layers out of their carousel; a selected null takes all its cards
  $.global.cxRemove = function () {
    var comp = activeComp();
    if (!comp) { return stringify({ ok: false, error: "Open a composition first." }); }
    var sel = comp.selectedLayers;
    var names = {};
    var n = 0;
    app.beginUndoGroup("Mótion Film: Remove Carousel");
    try {
      for (var i = 0; i < sel.length; i += 1) { if (isController(sel[i])) { names[sel[i].name] = true; } }
      for (var j = 1; j <= comp.numLayers; j += 1) {
        var l = comp.layer(j);
        var m = membership(l);
        if (m && (names[m.name] || l.selected)) { names[release(l)] = true; n += 1; }
      }
      for (var name in names) {
        if (!stillUsed(comp, name)) { var c = byName(comp, name); if (c) { c.remove(); } }
      }
    } catch (error) {
      app.endUndoGroup();
      return stringify({ ok: false, error: String(error.message || error) });
    }
    app.endUndoGroup();
    return stringify({ ok: true, message: n ? "Carousel removed from " + n + " layer" + (n === 1 ? "" : "s") + "." : "No carousel on the selection." });
  };

  // what the panel needs: comp size, how many cards, the carousel in the selection
  $.global.cxState = function () {
    var comp = activeComp();
    if (!comp) { return stringify({ ok: true, comp: null, count: 0, carousel: null }); }
    var sel = comp.selectedLayers;
    var count = 0, name = null;
    for (var i = 0; i < sel.length; i += 1) {
      if (usable(sel[i])) { count += 1; }
      if (!name) {
        if (isController(sel[i])) { name = sel[i].name; } else { var m = membership(sel[i]); if (m) { name = m.name; } }
      }
    }
    var car = null;
    var ctrl = name ? byName(comp, name) : null;
    if (ctrl) {
      var cards = 0;
      for (var j = 1; j <= comp.numLayers; j += 1) { var mm = membership(comp.layer(j)); if (mm && mm.name === name) { cards += 1; } }
      car = readControls(ctrl, comp);
      car.name = name;
      car.cards = cards;
    }
    return stringify({ ok: true, comp: { w: comp.width, h: comp.height }, count: count, carousel: car });
  };
}());
