/*
 * Mótion Film -- Transitions (Kit › Transitions, client/transitions.js).
 *
 * Nossa versão da ideia do Afterflix Transitions, com código e valores
 * nossos. Cada efeito é uma camada de ajuste (e, nos Film Burn, uma
 * camada de luz por cima) só com efeitos nativos do AE -- as cenas do
 * usuário nunca são mexidas:
 *
 *   onde   2 camadas selecionadas que se encostam -> o corte entre elas;
 *          senão, o indicador de tempo
 *   slot   "cut"  transições, Blur e Shake: centradas no ponto
 *          "in"   Camera In: começa no ponto (a cena que entra)
 *          "out"  Camera Out: termina no ponto (a cena que sai)
 *   troca  aplicar de novo no mesmo ponto e slot troca o anterior
 *
 * As camadas levam o comment "MFT|<uid>|<slot>|<tempo>|<id>" e o nome
 * "MF Transition · <nome>". A camada de ajuste reaproveita um único
 * sólido "Mótion Film — Transitions ADJ" do tamanho da comp.
 *
 * Movimento em corte (cutMove): a cena A acelera até o corte, a B sai
 * do corte já em movimento e assenta -- o salto vai de meio quadro antes
 * do corte (HOLD) até o próprio corte, que já é o 1º quadro da cena B.
 *
 * Carregado sob demanda via $.evalFile. ExtendScript: um undo por ação;
 * depois de addProperty as referências antigas podem ficar inválidas,
 * então os efeitos são sempre buscados de novo pelo índice.
 */
(function () {
  var TAG = "MFT|";
  var ADJ_NAME = "Mótion Film — Transitions ADJ";
  var LABEL = 10; // purple
  var CA = "Mettle SkyBox Chromatic Aberrat"; // VR Chromatic Aberrations (built in)

  function stringify(v) {
    try { return JSON.stringify(v); } catch (e) { return '{"ok":false,"error":"serialize"}'; }
  }
  function activeComp() {
    var a = app.project ? app.project.activeItem : null;
    return a instanceof CompItem ? a : null;
  }
  function uid() {
    var s = "";
    for (var i = 0; i < 6; i += 1) { s += "abcdefghijklmnopqrstuvwxyz0123456789".charAt(Math.floor(Math.random() * 36)); }
    return s;
  }

  // ------------------------------------------------------------------ where

  // The cut between 2 selected layers that touch (end of one = start of
  // the other, within a frame), or null.
  function cutOf(comp) {
    var sel = comp.selectedLayers;
    if (sel.length !== 2) { return null; }
    var a = sel[0].inPoint <= sel[1].inPoint ? sel[0] : sel[1];
    var b = a === sel[0] ? sel[1] : sel[0];
    var fd = comp.frameDuration;
    if (Math.abs(a.outPoint - b.inPoint) <= fd * 1.01) { return { time: b.inPoint, top: a.index < b.index ? a : b }; }
    // overlapping scenes: the cut is where B starts
    if (b.inPoint > a.inPoint && b.inPoint < a.outPoint) { return { time: b.inPoint, top: a.index < b.index ? a : b }; }
    return null;
  }

  function snap(comp, t) {
    var fd = comp.frameDuration;
    return Math.round(t / fd) * fd;
  }

  // ------------------------------------------------------------------ layers

  function adjSource(comp) {
    for (var i = 1; i <= app.project.numItems; i += 1) {
      var it = app.project.item(i);
      if (it instanceof FootageItem && it.name === ADJ_NAME && it.width === comp.width && it.height === comp.height) { return it; }
    }
    return null;
  }

  function newAdjustment(comp, name) {
    var src = adjSource(comp);
    var L = src ? comp.layers.add(src) : comp.layers.addSolid([1, 1, 1], ADJ_NAME, comp.width, comp.height, comp.pixelAspect);
    L.adjustmentLayer = true;
    L.name = name;
    return L;
  }

  var LIGHT_NAME = "Mótion Film — Transitions Light";
  // the light layers (Film Burn) share one black solid of the comp size
  function newSolid(comp, name) {
    var src = null;
    for (var i = 1; i <= app.project.numItems; i += 1) {
      var it = app.project.item(i);
      if (it instanceof FootageItem && it.name === LIGHT_NAME && it.width === comp.width && it.height === comp.height) { src = it; break; }
    }
    var L = src ? comp.layers.add(src) : comp.layers.addSolid([0, 0, 0], LIGHT_NAME, comp.width, comp.height, comp.pixelAspect);
    L.name = name;
    return L;
  }

  // ------------------------------------------------------------------ effects

  function parade(L) { return L.property("ADBE Effect Parade"); }
  // adds an effect, returns its index (re-fetch with fx(L, i))
  function addFx(L, match, name) {
    var e = parade(L).addProperty(match);
    var i = e.propertyIndex;
    if (name) { parade(L).property(i).name = name; }
    return i;
  }
  function P(L, fxIndex, k) { return parade(L).property(fxIndex).property(k); }
  function set(L, fxIndex, k, v) { P(L, fxIndex, k).setValue(v); }

  function dims(prop) {
    var t = prop.propertyValueType;
    if (t === PropertyValueType.TwoD_SPATIAL || t === PropertyValueType.ThreeD_SPATIAL) { return 1; }
    var v = prop.value;
    return v instanceof Array ? v.length : 1;
  }
  function ease(prop, k, inInf, outInf) {
    var n = dims(prop);
    var a = [];
    var b = [];
    for (var i = 0; i < n; i += 1) {
      a.push(new KeyframeEase(0, inInf));
      b.push(new KeyframeEase(0, outInf));
    }
    prop.setTemporalEaseAtKey(k, a, b);
  }
  function straight(prop) {
    var t = prop.propertyValueType;
    if (t !== PropertyValueType.TwoD_SPATIAL && t !== PropertyValueType.ThreeD_SPATIAL) { return; }
    for (var k = 1; k <= prop.numKeys; k += 1) {
      try {
        prop.setSpatialAutoBezierAtKey(k, false);
        prop.setSpatialContinuousAtKey(k, false);
        var z = t === PropertyValueType.ThreeD_SPATIAL ? [0, 0, 0] : [0, 0];
        prop.setSpatialTangentsAtKey(k, z, z);
      } catch (e) {}
    }
  }

  // ------------------------------------------------------------------ curves
  // ctx: t0, t1, mid, fd (see build())

  // A -> peakA at the cut, jump, peakB -> rest (B settles)
  function cutMove(ctx, prop, rest, peakA, peakB, strength) {
    var s = strength || 85;
    var h = ctx.fd / 2;
    prop.setValueAtTime(ctx.t0, rest);
    prop.setValueAtTime(ctx.mid - h, peakA);
    prop.setValueAtTime(ctx.mid, peakB); // the first frame of scene B
    prop.setValueAtTime(ctx.t1, rest);
    // rest keys ease (speed 0), the cut keys stay linear: accelerate into
    // the cut, leave it fast and settle
    ease(prop, 1, 33, s);
    ease(prop, 4, s, 33);
    prop.setInterpolationTypeAtKey(2, KeyframeInterpolationType.LINEAR, KeyframeInterpolationType.HOLD);
    prop.setInterpolationTypeAtKey(3, KeyframeInterpolationType.LINEAR, KeyframeInterpolationType.LINEAR);
    straight(prop);
  }

  // rest -> peak (at `at`, 0..1 of the span, default the middle) -> rest
  function pulse(ctx, prop, rest, peak, at, sharp) {
    var tp = ctx.t0 + (ctx.t1 - ctx.t0) * (at === undefined ? 0.5 : at);
    prop.setValueAtTime(ctx.t0, rest);
    prop.setValueAtTime(tp, peak);
    prop.setValueAtTime(ctx.t1, rest);
    ease(prop, 1, 33, sharp ? 75 : 50);
    if (sharp) {
      prop.setInterpolationTypeAtKey(2, KeyframeInterpolationType.LINEAR, KeyframeInterpolationType.LINEAR);
    } else {
      ease(prop, 2, 45, 45);
    }
    ease(prop, 3, sharp ? 80 : 60, 33);
    straight(prop);
  }

  // a list of [u (0..1 of the span), value] held until the next one
  function steps(ctx, prop, list) {
    for (var i = 0; i < list.length; i += 1) {
      prop.setValueAtTime(ctx.t0 + (ctx.t1 - ctx.t0) * list[i][0], list[i][1]);
    }
    for (var k = 1; k <= prop.numKeys; k += 1) {
      prop.setInterpolationTypeAtKey(k, KeyframeInterpolationType.HOLD, KeyframeInterpolationType.HOLD);
    }
  }

  // camera In: from -> to, fast start, settles (decelerates)
  function arrive(ctx, prop, from, to, strength) {
    prop.setValueAtTime(ctx.t0, from);
    prop.setValueAtTime(ctx.t1, to);
    ease(prop, 2, strength || 88, 33);
    prop.setInterpolationTypeAtKey(1, KeyframeInterpolationType.LINEAR, KeyframeInterpolationType.LINEAR);
    straight(prop);
  }

  // camera Out: from -> to, slow start, speeds up into the cut
  function leave(ctx, prop, from, to, strength) {
    prop.setValueAtTime(ctx.t0, from);
    prop.setValueAtTime(ctx.t1, to);
    ease(prop, 1, 33, strength || 88);
    prop.setInterpolationTypeAtKey(2, KeyframeInterpolationType.LINEAR, KeyframeInterpolationType.LINEAR);
    straight(prop);
  }

  // ------------------------------------------------------------------ building blocks

  // Motion Tile with mirrored edges, so moving / scaling never shows black
  function tile(L, w, h) {
    var i = addFx(L, "ADBE Tile", "Edges");
    set(L, i, 4, w || 300);
    set(L, i, 5, h || 300);
    set(L, i, 6, 1);
    return i;
  }

  // Transform effect with its own motion blur (works without the layer switch)
  function transform(L, name, shutter) {
    var i = addFx(L, "ADBE Geometry2", name || "Move");
    set(L, i, 10, 0);
    set(L, i, 11, shutter || 270);
    return i;
  }
  // with Uniform Scale on, "Scale Height" (4) is the one scale
  var T_POS = 2, T_UNIFORM = 3, T_SCALE = 4, T_SCALE_W = 5, T_SKEW = 6, T_ROT = 8;

  function dirBlur(L, angle) {
    var i = addFx(L, "ADBE Motion Blur", "Streak");
    set(L, i, 1, angle);
    return i;
  }
  function gauss(L, name) {
    var i = addFx(L, "ADBE Gaussian Blur 2", name || "Blur");
    set(L, i, 3, 1); // repeat edge pixels
    return i;
  }
  function zoomBlur(L, ctx) {
    var i = addFx(L, "CC Radial Fast Blur", "Zoom blur");
    set(L, i, 1, ctx.center);
    try { set(L, i, 3, 1); } catch (e) {} // Zoom: Brightest? keep default when not available
    return i;
  }
  function exposure(L, name) { return addFx(L, "ADBE Exposure2", name || "Light"); }
  function rgb(L, ctx, peak, at) {
    var i;
    try { i = addFx(L, CA, "RGB split"); } catch (e) { return; }
    set(L, i, 9, 0);
    pulse(ctx, P(L, i, 6), 0, peak, at, true);
    pulse(ctx, P(L, i, 8), 0, -peak, at, true);
  }
  // lens warp that stretches outward (Reverse Lens Distortion): fills the
  // frame instead of shrinking it into a ball with black corners
  function opticsPulse(ctx, L, fov) {
    var i = addFx(L, "ADBE Optics Compensation", "Lens");
    set(L, i, 2, 1);
    pulse(ctx, P(L, i, 1), 0, fov, 0.5, true);
    return i;
  }

  // Film Burn: a light layer made of Fractal Noise tinted to fire colors,
  // added on top (blend mode Add). Returns the layer.
  function burnLayer(ctx, name, opts) {
    var comp = ctx.comp;
    var B = newSolid(comp, name);
    var fn = addFx(B, "ADBE Fractal Noise", "Fire");
    set(B, fn, 4, opts.contrast || 160);
    set(B, fn, 5, (opts.brightness || 0) - 28);
    try { set(B, fn, 9, 0); } catch (e) {}
    try { set(B, fn, 11, opts.scaleW || 400); set(B, fn, 12, opts.scaleH || 400); } catch (e2) {}
    set(B, fn, 16, opts.complexity || 3);
    P(B, fn, 24).setValueAtTime(ctx.t0, 0);
    P(B, fn, 24).setValueAtTime(ctx.t1, opts.evolution || 260);
    if (opts.drift) {
      P(B, fn, 13).setValueAtTime(ctx.t0, [ctx.W / 2 - opts.drift[0], ctx.H / 2 - opts.drift[1]]);
      P(B, fn, 13).setValueAtTime(ctx.t1, [ctx.W / 2 + opts.drift[0], ctx.H / 2 + opts.drift[1]]);
    }
    var tn = addFx(B, "ADBE Tint", "Color");
    set(B, tn, 1, [0, 0, 0, 1]);
    set(B, tn, 2, opts.color || [0.92, 0.3, 0.04, 1]);
    var gl = addFx(B, "ADBE Glo2", "Glow");
    set(B, gl, 2, 50);
    set(B, gl, 3, 50 * ctx.u);
    set(B, gl, 4, 1);
    B.blendingMode = BlendingMode.ADD;
    return B;
  }

  // ------------------------------------------------------------------ presets
  // build(ctx, L) -- L is the adjustment layer; ctx.extra(layer) adds a
  // layer of the same transition (tagged and placed with it).

  var PRESETS = {};
  function def(id, slot, build) { PRESETS[id] = { slot: slot, build: build }; }

  // ---------- Principal
  def("whip", "cut", function (ctx, L) {
    var d = ctx.dir;
    var S = (d[0] ? ctx.W : ctx.H) * 0.55;
    tile(L, d[0] ? 400 : 140, d[0] ? 140 : 400);
    var t = transform(L, "Whip", 300);
    var c = ctx.center;
    cutMove(ctx, P(L, t, T_POS), c, [c[0] + d[0] * S, c[1] + d[1] * S], [c[0] - d[0] * S, c[1] - d[1] * S]);
    var b = dirBlur(L, d[0] ? 90 : 0);
    pulse(ctx, P(L, b, 2), 0, 60 * ctx.u, 0.5, true);
    rgb(L, ctx, 8 * ctx.u);
  });
  def("zoomin", "cut", function (ctx, L) {
    tile(L, 300, 300);
    var t = transform(L, "Zoom", 270);
    cutMove(ctx, P(L, t, T_SCALE), 100, 340, 45);
    var z = zoomBlur(L, ctx);
    pulse(ctx, P(L, z, 2), 0, 45, 0.5, true);
  });
  def("zoomout", "cut", function (ctx, L) {
    tile(L, 300, 300);
    var t = transform(L, "Zoom", 270);
    cutMove(ctx, P(L, t, T_SCALE), 100, 40, 300);
    var z = zoomBlur(L, ctx);
    pulse(ctx, P(L, z, 2), 0, 40, 0.5, true);
  });
  def("slide", "cut", function (ctx, L) {
    var d = ctx.dir;
    var S = d[0] ? ctx.W : ctx.H;
    var i = addFx(L, "ADBE Tile", "Edges");
    set(L, i, 4, d[0] ? 300 : 100);
    set(L, i, 5, d[0] ? 100 : 300);
    var t = transform(L, "Slide", 220);
    var c = ctx.center;
    cutMove(ctx, P(L, t, T_POS), c, [c[0] - d[0] * S * 0.5, c[1] - d[1] * S * 0.5], [c[0] + d[0] * S * 0.5, c[1] + d[1] * S * 0.5], 80);
  });
  def("spin", "cut", function (ctx, L) {
    var s = ctx.dir[0] < 0 ? -1 : 1;
    tile(L, 400, 400);
    var t = transform(L, "Spin", 300);
    cutMove(ctx, P(L, t, T_ROT), 0, 100 * s, -100 * s);
    cutMove(ctx, P(L, t, T_SCALE), 100, 125, 125);
  });
  def("spinzoom", "cut", function (ctx, L) {
    var s = ctx.dir[0] < 0 ? -1 : 1;
    tile(L, 400, 400);
    var t = transform(L, "Spin", 300);
    cutMove(ctx, P(L, t, T_ROT), 0, 160 * s, -160 * s);
    cutMove(ctx, P(L, t, T_SCALE), 100, 260, 60);
    var z = zoomBlur(L, ctx);
    pulse(ctx, P(L, z, 2), 0, 30, 0.5, true);
  });
  def("warpspin", "cut", function (ctx, L) {
    var s = ctx.dir[0] < 0 ? -1 : 1;
    tile(L, 400, 400);
    var t = transform(L, "Spin", 300);
    cutMove(ctx, P(L, t, T_ROT), 0, 120 * s, -120 * s);
    opticsPulse(ctx, L, 70);
    rgb(L, ctx, 10 * ctx.u);
  });
  def("blur", "cut", function (ctx, L) {
    var g = gauss(L, "Blur");
    pulse(ctx, P(L, g, 1), 0, 90 * ctx.u, 0.5, false);
    var e = exposure(L);
    pulse(ctx, P(L, e, 3), 0, 0.6, 0.5, false);
  });
  def("flash", "cut", function (ctx, L) {
    var e = exposure(L, "Flash");
    pulse(ctx, P(L, e, 3), 0, 4.5, 0.5, true);
    var g = gauss(L, "Bloom");
    pulse(ctx, P(L, g, 1), 0, 25 * ctx.u, 0.5, true);
  });
  def("stretch", "cut", function (ctx, L) {
    var d = ctx.dir;
    tile(L, 200, 200);
    var t = transform(L, "Stretch", 270);
    set(L, t, T_UNIFORM, 0);
    var prop = P(L, t, d[0] ? T_SCALE_W : T_SCALE);
    cutMove(ctx, prop, 100, 420, 420);
    var b = dirBlur(L, d[0] ? 90 : 0);
    pulse(ctx, P(L, b, 2), 0, 80 * ctx.u, 0.5, true);
  });

  // ---------- Glitch
  function jitterSteps(ctx, n, amp, seed) {
    var out = [];
    var r = seed || 1;
    for (var i = 0; i < n; i += 1) {
      r = (r * 9301 + 49297) % 233280;
      var v = (r / 233280 - 0.5) * 2 * amp;
      out.push(v);
    }
    return out;
  }
  // frames around the cut (u values) for held glitch steps
  function frameSteps(ctx, values, zeroOutside) {
    var list = [];
    var n = values.length;
    var span = ctx.t1 - ctx.t0;
    var start = 0.5 - (n / 2) * (ctx.fd / span);
    if (zeroOutside !== false) { list.push([0, zeroOutside === undefined ? 0 : zeroOutside]); }
    for (var i = 0; i < n; i += 1) { list.push([Math.max(0, start + i * ctx.fd / span), values[i]]); }
    list.push([Math.min(1, start + n * ctx.fd / span), zeroOutside === undefined ? 0 : zeroOutside]);
    return list;
  }

  def("glitch", "cut", function (ctx, L) {
    tile(L, 140, 140);
    var td = addFx(L, "ADBE Turbulent Displace", "Glitch");
    set(L, td, 1, 8); // Horizontal Displacement
    set(L, td, 3, 30 * ctx.u);
    var amt = [60, 0, 120, 30, 180, 90, 20, 140, 0, 60];
    steps(ctx, P(L, td, 2), frameSteps(ctx, amt));
    var t = transform(L, "Shift", 0);
    var xs = jitterSteps(ctx, 10, ctx.W * 0.06, 7);
    var c = ctx.center;
    var pos = [];
    for (var i = 0; i < xs.length; i += 1) { pos.push([c[0] + xs[i], c[1]]); }
    steps(ctx, P(L, t, T_POS), frameSteps(ctx, pos, c));
    rgb(L, ctx, 14 * ctx.u);
  });
  def("flicker", "cut", function (ctx, L) {
    var e = exposure(L, "Flicker");
    steps(ctx, P(L, e, 3), frameSteps(ctx, [1.5, -1.5, 0, 2.5, -3, 1, 3, 0, -2, 1]));
  });
  def("smear", "cut", function (ctx, L) {
    tile(L, 300, 140);
    var t = transform(L, "Smear", 300);
    set(L, t, T_UNIFORM, 0);
    cutMove(ctx, P(L, t, T_SCALE_W), 100, 300, 300);
    var b = dirBlur(L, 90);
    pulse(ctx, P(L, b, 2), 0, 120 * ctx.u, 0.5, true);
    var w = addFx(L, "ADBE Wave Warp", "Wave");
    pulse(ctx, P(L, w, 2), 0, 25 * ctx.u, 0.5, true);
  });
  def("prism", "cut", function (ctx, L) {
    rgb(L, ctx, 40 * ctx.u);
    var b = dirBlur(L, 90);
    pulse(ctx, P(L, b, 2), 0, 50 * ctx.u, 0.5, true);
    // Color Balance (HLS): Hue/Saturation's master values can't be keyframed by script
    var h = addFx(L, "ADBE Color Balance (HLS)", "Hue");
    pulse(ctx, P(L, h, 1), 0, 160, 0.5, true);
  });
  def("rgbburn", "cut", function (ctx, L) {
    var e = exposure(L, "Burn");
    pulse(ctx, P(L, e, 3), 0, 3, 0.5, true);
    rgb(L, ctx, 30 * ctx.u);
    var g = gauss(L, "Bloom");
    pulse(ctx, P(L, g, 1), 0, 20 * ctx.u, 0.5, true);
  });
  def("blocks", "cut", function (ctx, L) {
    var m = addFx(L, "ADBE Mosaic", "Blocks");
    set(L, m, 3, 1);
    var hs = [60, 24, 12, 40, 8, 16, 30, 6, 20, 48];
    var list = frameSteps(ctx, hs, 4000);
    steps(ctx, P(L, m, 1), list);
    var vs = [];
    for (var i = 0; i < hs.length; i += 1) { vs.push(Math.max(2, Math.round(hs[i] * ctx.H / ctx.W))); }
    steps(ctx, P(L, m, 2), frameSteps(ctx, vs, 4000));
    var t = transform(L, "Shift", 0);
    tile(L, 120, 120);
    var c = ctx.center;
    var xs = jitterSteps(ctx, 10, ctx.W * 0.05, 3);
    var pos = [];
    for (var j = 0; j < xs.length; j += 1) { pos.push([c[0] + xs[j], c[1]]); }
    steps(ctx, P(L, t, T_POS), frameSteps(ctx, pos, c));
  });
  def("vhs", "cut", function (ctx, L) {
    tile(L, 100, 200);
    var w = addFx(L, "ADBE Wave Warp", "Tape");
    set(L, w, 3, 18 * ctx.u);
    set(L, w, 5, 6);
    pulse(ctx, P(L, w, 2), 0, 12 * ctx.u, 0.5, true);
    var t = transform(L, "Roll", 120);
    var c = ctx.center;
    cutMove(ctx, P(L, t, T_POS), c, [c[0], c[1] - ctx.H * 0.2], [c[0], c[1] + ctx.H * 0.2], 70);
    var n = addFx(L, "ADBE Noise2", "Noise");
    set(L, n, 2, 0);
    pulse(ctx, P(L, n, 1), 0, 35, 0.5, true);
    rgb(L, ctx, 12 * ctx.u);
    var h = addFx(L, "ADBE Color Balance (HLS)", "Tape color");
    pulse(ctx, P(L, h, 3), 0, -45, 0.5, false);
  });
  def("diagonal", "cut", function (ctx, L) {
    var s = ctx.dir[0] < 0 ? -1 : 1;
    tile(L, 500, 500);
    // blur on the tiled frame, before the move: after it the blur would
    // pull in the transparent edge (dark corner)
    var b = dirBlur(L, s > 0 ? 45 : -45);
    pulse(ctx, P(L, b, 2), 0, 70 * ctx.u, 0.5, true);
    var t = transform(L, "Diagonal", 300);
    var c = ctx.center;
    var dx = ctx.W * 0.4 * s;
    var dy = ctx.H * 0.4;
    cutMove(ctx, P(L, t, T_POS), c, [c[0] + dx, c[1] - dy], [c[0] - dx, c[1] + dy]);
    cutMove(ctx, P(L, t, T_SKEW), 0, 25 * s, -25 * s);
  });
  def("jitter", "cut", function (ctx, L) {
    tile(L, 160, 160);
    var t = transform(L, "Jitter", 180);
    var c = ctx.center;
    var xs = jitterSteps(ctx, 12, ctx.W * 0.035, 11);
    var ys = jitterSteps(ctx, 12, ctx.H * 0.035, 5);
    var pos = [];
    for (var i = 0; i < xs.length; i += 1) { pos.push([c[0] + xs[i], c[1] + ys[i]]); }
    steps(ctx, P(L, t, T_POS), frameSteps(ctx, pos, c));
    var rs = jitterSteps(ctx, 12, 4, 9);
    steps(ctx, P(L, t, T_ROT), frameSteps(ctx, rs, 0));
  });

  // ---------- Film Burn (adjustment = exposure lift at the cut; light layer on top)
  function burnBase(ctx, L, peakExposure) {
    var e = exposure(L, "Burn light");
    pulse(ctx, P(L, e, 3), 0, (peakExposure || 1.6) * 0.45, 0.5, false);
  }
  function burnOpacity(ctx, B, peak, at) {
    pulse(ctx, B.property("ADBE Transform Group").property("ADBE Opacity"), 0, peak === undefined ? 100 : peak, at, false);
  }
  // a feathered mask that moves across the light layer
  function movingMask(ctx, B, fromCenter, toCenter, size, feather) {
    var m = B.property("ADBE Mask Parade").addProperty("ADBE Mask Atom");
    m.maskMode = MaskMode.ADD;
    function ellipse(c) {
      var s = new Shape();
      var rx = size[0] / 2, ry = size[1] / 2, k = 0.5523;
      s.vertices = [[c[0], c[1] - ry], [c[0] + rx, c[1]], [c[0], c[1] + ry], [c[0] - rx, c[1]]];
      s.inTangents = [[-rx * k, 0], [0, -ry * k], [rx * k, 0], [0, ry * k]];
      s.outTangents = [[rx * k, 0], [0, ry * k], [-rx * k, 0], [0, -ry * k]];
      s.closed = true;
      return s;
    }
    var path = B.property("ADBE Mask Parade").property(1).property("ADBE Mask Shape");
    path.setValueAtTime(ctx.t0, ellipse(fromCenter));
    path.setValueAtTime(ctx.t1, ellipse(toCenter));
    B.property("ADBE Mask Parade").property(1).property("ADBE Mask Feather").setValue([feather, feather]);
  }

  def("burnsweep", "cut", function (ctx, L) {
    burnBase(ctx, L, 1.2);
    var d = ctx.dir;
    var B = ctx.extra(burnLayer(ctx, "Burn", { contrast: 180, drift: [d[0] * ctx.W * 0.3, d[1] * ctx.H * 0.3] }));
    var c = ctx.center;
    var big = [ctx.W * 1.3, ctx.H * 1.6];
    movingMask(ctx, B, [c[0] - d[0] * ctx.W, c[1] - d[1] * ctx.H], [c[0] + d[0] * ctx.W, c[1] + d[1] * ctx.H], big, ctx.W * 0.35);
    burnOpacity(ctx, B, 100);
  });
  def("edgeburn", "cut", function (ctx, L) {
    burnBase(ctx, L, 1.4);
    var B = ctx.extra(burnLayer(ctx, "Edge burn", { contrast: 140 }));
    var m = B.property("ADBE Mask Parade").addProperty("ADBE Mask Atom");
    m.maskMode = MaskMode.SUBTRACT;
    var s = new Shape();
    var c = ctx.center, rx = ctx.W * 0.36, ry = ctx.H * 0.34, k = 0.5523;
    s.vertices = [[c[0], c[1] - ry], [c[0] + rx, c[1]], [c[0], c[1] + ry], [c[0] - rx, c[1]]];
    s.inTangents = [[-rx * k, 0], [0, -ry * k], [rx * k, 0], [0, ry * k]];
    s.outTangents = [[rx * k, 0], [0, ry * k], [-rx * k, 0], [0, -ry * k]];
    s.closed = true;
    B.property("ADBE Mask Parade").property(1).property("ADBE Mask Shape").setValue(s);
    B.property("ADBE Mask Parade").property(1).property("ADBE Mask Feather").setValue([ctx.W * 0.25, ctx.W * 0.25]);
    pulse(ctx, B.property("ADBE Mask Parade").property(1).property("ADBE Mask Offset"), 0, -ctx.W * 0.08, 0.5, false);
    burnOpacity(ctx, B, 100);
  });
  def("lightleak", "cut", function (ctx, L) {
    burnBase(ctx, L, 1);
    var s = ctx.dir[0] < 0 ? -1 : 1;
    var B = ctx.extra(burnLayer(ctx, "Light leak", { contrast: 90, brightness: 10, scaleW: 900, scaleH: 300, color: [0.95, 0.45, 0.12, 1], drift: [s * ctx.W * 0.4, 0] }));
    var c = ctx.center;
    movingMask(ctx, B, [c[0] - s * ctx.W * 0.8, c[1] + ctx.H * 0.3], [c[0] + s * ctx.W * 0.8, c[1] - ctx.H * 0.3], [ctx.W * 0.9, ctx.H * 2.2], ctx.W * 0.3);
    burnOpacity(ctx, B, 100);
  });
  def("hotcore", "cut", function (ctx, L) {
    burnBase(ctx, L, 2);
    var B = ctx.extra(burnLayer(ctx, "Hot core", { contrast: 150, color: [0.95, 0.6, 0.25, 1] }));
    var m = B.property("ADBE Mask Parade").addProperty("ADBE Mask Atom");
    var s = new Shape();
    var c = ctx.center, r = ctx.W * 0.25, k = 0.5523;
    s.vertices = [[c[0], c[1] - r], [c[0] + r, c[1]], [c[0], c[1] + r], [c[0] - r, c[1]]];
    s.inTangents = [[-r * k, 0], [0, -r * k], [r * k, 0], [0, r * k]];
    s.outTangents = [[r * k, 0], [0, r * k], [-r * k, 0], [0, -r * k]];
    s.closed = true;
    B.property("ADBE Mask Parade").property(1).property("ADBE Mask Shape").setValue(s);
    B.property("ADBE Mask Parade").property(1).property("ADBE Mask Feather").setValue([ctx.W * 0.2, ctx.W * 0.2]);
    pulse(ctx, B.property("ADBE Mask Parade").property(1).property("ADBE Mask Offset"), -ctx.W * 0.2, ctx.W * 0.6, 0.5, false);
    burnOpacity(ctx, B, 100);
  });
  def("flickerburn", "cut", function (ctx, L) {
    var e = exposure(L, "Projector");
    steps(ctx, P(L, e, 3), frameSteps(ctx, [0.8, -0.6, 1.6, 0.2, 2.4, -0.4, 1.2, 0.4, 2, -0.2, 0.8, 0.3]));
    var B = ctx.extra(burnLayer(ctx, "Flicker burn", { contrast: 130, color: [0.95, 0.45, 0.15, 1] }));
    steps(ctx, B.property("ADBE Transform Group").property("ADBE Opacity"), frameSteps(ctx, [30, 70, 10, 90, 50, 100, 20, 80, 60, 40, 90, 20]));
  });
  def("redleak", "cut", function (ctx, L) {
    burnBase(ctx, L, 0.8);
    var s = ctx.dir[0] < 0 ? -1 : 1;
    var B = ctx.extra(burnLayer(ctx, "Red leak", { contrast: 110, color: [0.9, 0.08, 0.04, 1], scaleW: 700, scaleH: 700, drift: [s * ctx.W * 0.3, ctx.H * 0.1] }));
    var c = ctx.center;
    movingMask(ctx, B, [c[0] - s * ctx.W * 0.9, c[1]], [c[0] + s * ctx.W * 0.9, c[1]], [ctx.W * 1.2, ctx.H * 1.8], ctx.W * 0.35);
    burnOpacity(ctx, B, 100);
  });
  def("rollburn", "cut", function (ctx, L) {
    burnBase(ctx, L, 1);
    var s = ctx.dir[1] < 0 ? -1 : 1;
    var B = ctx.extra(burnLayer(ctx, "Rolling burn", { contrast: 220, scaleW: 3000, scaleH: 120, drift: [0, s * ctx.H * 1.2], color: [0.92, 0.38, 0.08, 1] }));
    burnOpacity(ctx, B, 100);
  });
  def("burnspots", "cut", function (ctx, L) {
    burnBase(ctx, L, 1.3);
    var B = ctx.extra(burnLayer(ctx, "Burn spots", { contrast: 320, brightness: -60, scaleW: 220, scaleH: 220, complexity: 2, evolution: 720, color: [0.95, 0.55, 0.2, 1] }));
    burnOpacity(ctx, B, 100);
  });
  def("lightstreak", "cut", function (ctx, L) {
    burnBase(ctx, L, 0.9);
    var s = ctx.dir[0] < 0 ? -1 : 1;
    var B = ctx.extra(burnLayer(ctx, "Light streak", { contrast: 200, brightness: 30, scaleW: 2000, scaleH: 60, color: [0.95, 0.75, 0.5, 1], drift: [s * ctx.W * 0.6, 0] }));
    var c = ctx.center;
    movingMask(ctx, B, [c[0] - s * ctx.W * 0.9, c[1]], [c[0] + s * ctx.W * 0.9, c[1]], [ctx.W * 1.3, ctx.H * 0.14], ctx.H * 0.1);
    burnOpacity(ctx, B, 100);
  });
  def("filmgate", "cut", function (ctx, L) {
    tile(L, 100, 300);
    var t = transform(L, "Gate", 200);
    var c = ctx.center;
    cutMove(ctx, P(L, t, T_POS), c, [c[0], c[1] + ctx.H * 0.25], [c[0], c[1] - ctx.H * 0.25], 75);
    var td = addFx(L, "ADBE Turbulent Displace", "Melt");
    set(L, td, 3, 80 * ctx.u);
    pulse(ctx, P(L, td, 2), 0, 120, 0.5, false);
    burnBase(ctx, L, 1.4);
    var B = ctx.extra(burnLayer(ctx, "Film gate", { contrast: 170, color: [0.92, 0.35, 0.06, 1] }));
    burnOpacity(ctx, B, 90);
  });

  // ---------- Camera (In: starts at the point; Out: ends at it)
  function cam(L, ctx) {
    tile(L, 300, 300);
    return transform(L, "Camera", 250);
  }
  def("cam_dive_in", "in", function (ctx, L) {
    var t = cam(L, ctx);
    arrive(ctx, P(L, t, T_SCALE), 260, 100);
    var z = zoomBlur(L, ctx);
    arrive(ctx, P(L, z, 2), 25, 0);
  });
  def("cam_pull_in", "in", function (ctx, L) {
    var t = cam(L, ctx);
    arrive(ctx, P(L, t, T_SCALE), 55, 100);
  });
  def("cam_corner_in", "in", function (ctx, L) {
    var t = cam(L, ctx);
    var c = ctx.center;
    arrive(ctx, P(L, t, T_POS), [c[0] - ctx.W * 0.35, c[1] - ctx.H * 0.35], c);
    arrive(ctx, P(L, t, T_SCALE), 180, 100);
  });
  def("cam_top_in", "in", function (ctx, L) {
    var t = cam(L, ctx);
    var c = ctx.center;
    arrive(ctx, P(L, t, T_POS), [c[0], c[1] - ctx.H * 0.9], c);
  });
  def("cam_spin_in", "in", function (ctx, L) {
    var t = cam(L, ctx);
    arrive(ctx, P(L, t, T_ROT), ctx.dir[0] < 0 ? 120 : -120, 0);
    arrive(ctx, P(L, t, T_SCALE), 220, 100);
  });
  def("cam_dive_out", "out", function (ctx, L) {
    var t = cam(L, ctx);
    leave(ctx, P(L, t, T_SCALE), 100, 300);
    var z = zoomBlur(L, ctx);
    leave(ctx, P(L, z, 2), 0, 30);
  });
  def("cam_corner_out", "out", function (ctx, L) {
    var t = cam(L, ctx);
    var c = ctx.center;
    leave(ctx, P(L, t, T_POS), c, [c[0] + ctx.W * 0.4, c[1] + ctx.H * 0.4]);
    leave(ctx, P(L, t, T_SCALE), 100, 220);
  });
  def("cam_pull_out", "out", function (ctx, L) {
    var t = cam(L, ctx);
    leave(ctx, P(L, t, T_SCALE), 100, 50);
  });
  def("cam_sink_out", "out", function (ctx, L) {
    var t = cam(L, ctx);
    var c = ctx.center;
    leave(ctx, P(L, t, T_POS), c, [c[0], c[1] + ctx.H * 0.9]);
  });
  def("cam_spin_out", "out", function (ctx, L) {
    var t = cam(L, ctx);
    leave(ctx, P(L, t, T_ROT), 0, ctx.dir[0] < 0 ? -140 : 140);
    leave(ctx, P(L, t, T_SCALE), 100, 260);
  });

  // ---------- Blur accents (peak at the point)
  function blurAccent(ctx, L, peak, at, sharp, horizontal) {
    var i;
    if (horizontal) {
      tile(L, 160, 100); // mirrored edges: the blur doesn't pull in black
      i = dirBlur(L, 90);
      pulse(ctx, P(L, i, 2), 0, peak * 1.6, at, sharp);
    } else {
      i = gauss(L, "Blur");
      pulse(ctx, P(L, i, 1), 0, peak, at, sharp);
    }
    return i;
  }
  def("blur_quick", "cut", function (ctx, L) { blurAccent(ctx, L, 70 * ctx.u, 0.5, true); });
  def("blur_long", "cut", function (ctx, L) { blurAccent(ctx, L, 70 * ctx.u, 0.25, false); });
  def("blur_bounce", "cut", function (ctx, L) {
    var g = gauss(L, "Blur");
    var p = P(L, g, 1);
    var span = ctx.t1 - ctx.t0;
    p.setValueAtTime(ctx.t0, 0);
    p.setValueAtTime(ctx.t0 + span * 0.35, 40 * ctx.u);
    p.setValueAtTime(ctx.t0 + span * 0.5, 15 * ctx.u);
    p.setValueAtTime(ctx.t0 + span * 0.62, 80 * ctx.u);
    p.setValueAtTime(ctx.t1, 0);
    for (var k = 1; k <= p.numKeys; k += 1) { ease(p, k, 50, 50); }
  });
  def("blur_soft", "cut", function (ctx, L) { blurAccent(ctx, L, 30 * ctx.u, 0.5, false); });
  def("blur_horizontal", "cut", function (ctx, L) { blurAccent(ctx, L, 70 * ctx.u, 0.5, true, true); });
  def("blur_punch", "cut", function (ctx, L) {
    blurAccent(ctx, L, 90 * ctx.u, 0.5, true);
    tile(L, 200, 200);
    var t = transform(L, "Punch", 0);
    pulse(ctx, P(L, t, T_SCALE), 100, 118, 0.5, true);
  });

  // ---------- Shake accents: random jumps a few times a second under an
  // envelope that builds up to the point and dies out after it
  // (expressions on the Transform effect, seeded so renders repeat)
  function envelope(peak, decay) {
    return "var t = time - inPoint, d = outPoint - inPoint, m = d * " + peak + ";\n" +
      "var env = t < m ? Math.pow(t / m, 2) : Math.exp(-(t - m) * " + decay + " / Math.max(0.001, d - m));";
  }
  function shakeExpr(kind, amp, freq, peak, decay) {
    var seed = Math.round(Math.random() * 9000) + 1;
    return [
      "// Mótion Film shake",
      envelope(peak, decay),
      "seedRandom(" + seed + " + Math.floor(time * " + freq + "), true);",
      kind === "pos"
        ? "value + [random(-1, 1) * " + amp[0] + ", random(-1, 1) * " + amp[1] + "] * env;"
        : "value + random(-1, 1) * " + amp + " * env;"
    ].join("\n");
  }
  function shake(ctx, L, opts) {
    tile(L, 200, 200);
    var t = transform(L, "Shake", opts.blur === false ? 0 : 200);
    var peak = opts.peak || 0.45;
    var decay = opts.decay || 4;
    var freq = opts.freq || 16;
    if (opts.pos) {
      P(L, t, T_POS).expression = shakeExpr("pos", [ctx.W * opts.pos[0], ctx.H * opts.pos[1]], freq, peak, decay);
    }
    if (opts.rot) { P(L, t, T_ROT).expression = shakeExpr("one", opts.rot, freq, peak, decay); }
    if (opts.scale) {
      P(L, t, T_SCALE).expression = [
        envelope(peak, decay),
        "value + " + opts.scale + " * env * " + (opts.pulse ? "Math.abs(Math.sin(t * " + opts.pulse + "))" : "1") + ";"
      ].join("\n");
    }
    return t;
  }
  def("shake_classic", "cut", function (ctx, L) { shake(ctx, L, { pos: [0.05, 0.05], rot: 3 }); });
  def("shake_zoom", "cut", function (ctx, L) { shake(ctx, L, { pos: [0.035, 0.035], scale: 14 }); });
  def("shake_rgb", "cut", function (ctx, L) { shake(ctx, L, { pos: [0.05, 0.04] }); rgb(L, ctx, 16 * ctx.u, 0.45); });
  def("shake_medium", "cut", function (ctx, L) { shake(ctx, L, { pos: [0.055, 0.055], rot: 3.5, decay: 2.2 }); });
  def("shake_impact", "cut", function (ctx, L) { shake(ctx, L, { pos: [0.09, 0.09], rot: 6, scale: 12, peak: 0.3, decay: 6, freq: 22 }); });
  def("shake_horizontal", "cut", function (ctx, L) { shake(ctx, L, { pos: [0.07, 0] }); });
  def("shake_vertical", "cut", function (ctx, L) { shake(ctx, L, { pos: [0, 0.07] }); });
  def("shake_tremor", "cut", function (ctx, L) { shake(ctx, L, { pos: [0.015, 0.015], freq: 30, decay: 1.5, blur: false }); });
  def("shake_pulse", "cut", function (ctx, L) { shake(ctx, L, { scale: 16, pulse: 22, decay: 3, blur: false }); });
  def("shake_slow", "cut", function (ctx, L) { shake(ctx, L, { pos: [0.05, 0.05], rot: 2.5, freq: 7, decay: 2 }); });

  // ------------------------------------------------------------------ apply

  function tagOf(L) {
    var c = String(L.comment || "");
    if (c.indexOf(TAG) !== 0) { return null; }
    var p = c.split("|");
    return { uid: p[1], slot: p[2], time: parseFloat(p[3]), id: p[4] };
  }

  // remove the transition already in this slot at this time (all its layers)
  function removeAt(comp, slot, time) {
    var gone = {};
    for (var i = comp.numLayers; i >= 1; i -= 1) {
      var L = comp.layer(i);
      var t = tagOf(L);
      if (t && t.slot === slot && Math.abs(t.time - time) < comp.frameDuration * 0.6) { gone[t.uid] = true; }
    }
    var n = 0;
    for (var j = comp.numLayers; j >= 1; j -= 1) {
      var tg = tagOf(comp.layer(j));
      if (tg && gone[tg.uid]) {
        if (comp.layer(j).locked) { comp.layer(j).locked = false; }
        comp.layer(j).remove();
        n += 1;
      }
    }
    return n;
  }

  // opts: { id, name, frames, dir: "left"|"right"|"up"|"down" }
  $.global.mftApply = function (opts) {
    var comp = activeComp();
    if (!comp) { return stringify({ ok: false, error: "Open a composition first." }); }
    var preset = opts && PRESETS[opts.id];
    if (!preset) { return stringify({ ok: false, error: "Unknown transition." }); }
    var fd = comp.frameDuration;
    var cut = cutOf(comp);
    var at = snap(comp, cut ? cut.time : comp.time);
    var frames = Math.max(2, Math.min(240, Math.round(opts.frames || 14)));
    var D = frames * fd;
    var t0 = preset.slot === "in" ? at : (preset.slot === "out" ? at - D : at - Math.round(frames / 2) * fd);
    var t1 = t0 + D;
    if (t0 < 0) { t0 = 0; }
    if (t1 > comp.duration) { t1 = comp.duration; }
    if (t1 - t0 < 2 * fd) { return stringify({ ok: false, error: "There's no room for the effect here -- move the time indicator." }); }
    var dirs = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };
    var sel = comp.selectedLayers;
    var keepSel = [];
    for (var s = 0; s < sel.length; s += 1) { keepSel.push(sel[s]); }
    var id = uid();
    var tag = TAG + id + "|" + preset.slot + "|" + at.toFixed(4) + "|" + opts.id;
    var name = "MF Transition · " + (opts.name || opts.id);
    var made = [];

    app.beginUndoGroup("Mótion Film: Transition " + (opts.name || opts.id));
    try {
      var replaced = removeAt(comp, preset.slot, at);
      var anchor = cut ? cut.top : null;
      var L = newAdjustment(comp, name);
      made.push(L);
      var ctx = {
        comp: comp, t0: t0, t1: t1, mid: at, fd: fd, D: t1 - t0,
        W: comp.width, H: comp.height, center: [comp.width / 2, comp.height / 2],
        u: Math.min(comp.width, comp.height) / 1080,
        dir: dirs[opts.dir] || dirs.right,
        extra: function (layer) { made.push(layer); return layer; }
      };
      preset.build(ctx, L);
      for (var m = 0; m < made.length; m += 1) {
        var X = made[m];
        X.comment = tag;
        X.label = LABEL;
        X.startTime = 0;
        X.inPoint = t0;
        X.outPoint = t1;
        if (X !== L) { X.name = name + " · " + X.name; }
      }
      // light layers above the adjustment, the group above the scenes
      try {
        if (anchor) { L.moveBefore(anchor); } else { L.moveToBeginning(); }
        for (var e = 1; e < made.length; e += 1) { made[e].moveBefore(L); }
      } catch (moveError) {}
      for (var q = 1; q <= comp.numLayers; q += 1) { comp.layer(q).selected = false; }
      for (var r = 0; r < keepSel.length; r += 1) { try { keepSel[r].selected = true; } catch (selError) {} }
    } catch (error) {
      // nothing half-built stays in the comp
      for (var x = made.length - 1; x >= 0; x -= 1) { try { made[x].remove(); } catch (removeError) {} }
      app.endUndoGroup();
      return stringify({ ok: false, error: "Couldn't create the transition: " + String(error.message || error) + (error.line ? " (line " + error.line + ")" : "") });
    }
    app.endUndoGroup();
    return stringify({ ok: true, replaced: replaced > 0, where: cut ? "cut" : "playhead", at: at, message: (opts.name || opts.id) + (replaced ? " replaced" : " applied") + (cut ? " at the cut." : " at the time indicator.") });
  };

  // For the panel: where the next effect would go.
  $.global.mftInfo = function () {
    var comp = activeComp();
    if (!comp) { return stringify({ ok: true, comp: false }); }
    var cut = cutOf(comp);
    return stringify({ ok: true, comp: true, fps: 1 / comp.frameDuration, cut: !!cut, at: snap(comp, cut ? cut.time : comp.time) });
  };

  $.global.MFT_PRESET_IDS = (function () { var a = []; for (var k in PRESETS) { if (PRESETS.hasOwnProperty(k)) { a.push(k); } } return a; }());
}());
