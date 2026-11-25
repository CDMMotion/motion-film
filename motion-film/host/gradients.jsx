/*
 * Mótion Film -- Gradients (Packs › Gradients, client/gradients.js).
 *
 * After Effects' own gradients take any number of stops, but a script
 * can't write them: the colors of a Gradient Overlay (and of a shape's
 * Gradient Fill) are CUSTOM_VALUE. What a script CAN do is apply an
 * animation preset, and inside an .ffx the gradient is plain XML
 * ("Gradient Color Data": each stop = position, midpoint, R, G, B, A).
 * So the panel writes a copy of assets/gradients/gradient-overlay.ffx
 * (a preset holding only Layer Styles › Gradient Overlay) with the chosen
 * stops, and this file applies it with layer.applyPreset -- the result
 * is a normal Gradient Overlay, editable in AE's gradient editor.
 *
 *   mfgInfo()      what Apply would act on
 *   mfgApply(o)    o = { ffx, name, style 1..5, angle, scale, reverse,
 *                  handles } on the selected layers of the active comp;
 *                  nothing selected -> a new comp-sized layer
 *                  "Gradient · <name>"
 *   mfgStyle(o)    Style / Angle / Scale / Reverse (o.what = the one that
 *                  changed) on the selected layers that already have a
 *                  Gradient Overlay on
 *
 * Handles (o.handles): two Point Controls, "Gradient Start" and
 * "Gradient End", that show as crosshairs in the comp viewer; dragging
 * them moves the gradient. Expressions on the overlay's Angle, Scale,
 * Offset and Align with Layer turn the two points into those values.
 * Measured in AE 26.5 (renders of a black→white ramp):
 *   - Align with Layer on: the reference box is the layer's
 *     sourceRectAtTime; Align off: the comp (0,0 - width,height), in comp
 *     space (the layer's own position doesn't move it);
 *   - Offset = % of the box's width / height, from its center;
 *   - at Scale 100 a Linear (and Reflected's full span) is as long as the
 *     line through the box's center at that angle (min(w/|cos|, h/|sin|));
 *     Radial / Reflected / Diamond reach half of it from the center;
 *   - Angle 0 = first stop on the left, 90 = first stop at the bottom;
 *   - Scale only goes 10..150 % (more throws, and setValue(300) even
 *     aborts the script without a catch).
 * So the expression works in the comp (Align off): exact with the layer
 * moved, rotated, scaled or parented, since the points go through toComp.
 * On a layer that isn't rotated or scaled, Align on measures from the
 * layer box -- but on a rotated one AE takes the length from the rotated
 * layer's comp-space bounds, so the layer box is only used for gradients
 * too short for the comp (under 10 % of it), where it gets closer. Reading the
 * overlay's Offset .value from a script aborts it too -- never read it.
 *
 * Only the Gradient Overlay group is in the preset, so the layer's other
 * styles (a Drop Shadow, a Stroke...) stay as they were. Loaded on demand
 * via $.evalFile.
 */
(function () {
  var START = "Gradient Start";
  var END = "Gradient End";

  function stringify(v) {
    try { return JSON.stringify(v); } catch (e) { return '{"ok":false,"error":"serialize"}'; }
  }
  function activeComp() {
    var a = app.project ? app.project.activeItem : null;
    return a instanceof CompItem ? a : null;
  }
  // layers a preset can go on (AE refuses cameras and lights)
  function usable(layer) {
    return !(layer instanceof CameraLayer) && !(layer instanceof LightLayer);
  }
  function selected(comp) {
    var out = [];
    var sel = comp.selectedLayers;
    for (var i = 0; i < sel.length; i += 1) { if (usable(sel[i])) { out.push(sel[i]); } }
    return out;
  }
  function overlay(layer) {
    try { return layer.property("ADBE Layer Styles").property("gradientFill/enabled"); } catch (e) { return null; }
  }
  function put(layer, g, match, v) {
    try {
      var p = g.property(match);
      if (p && v !== undefined && v !== null) {
        if (p.numKeys > 0) { p.setValueAtTime(layer.containingComp.time, v); } else { p.setValue(v); }
      }
    } catch (e) {}
  }

  // ------------------------------------------------------------------ handles

  function effects(layer) {
    try { return layer.property("ADBE Effect Parade"); } catch (e) { return null; }
  }
  function pointCtl(layer, name) {
    var fx = effects(layer);
    if (!fx) { return null; }
    for (var i = 1; i <= fx.numProperties; i += 1) {
      var e = fx.property(i);
      if (e.matchName === "ADBE Point Control" && e.name === name) { return e; }
    }
    return null;
  }
  function rigged(layer) { return !!(pointCtl(layer, START) && pointCtl(layer, END)); }

  function box(layer) {
    var r = null;
    try { r = layer.sourceRectAtTime(layer.containingComp.time, false); } catch (e) {}
    if (!r || !(r.width > 0) || !(r.height > 0)) {
      var w = 100, h = 100;
      try { w = layer.width; h = layer.height; } catch (e2) {}
      r = { left: 0, top: 0, width: w, height: h };
    }
    return r;
  }
  function chord(w, h, a) {
    var c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
    return Math.min(c > 1e-6 ? w / c : 1e9, s > 1e-6 ? h / s : 1e9);
  }
  // the two points that give style / angle / scale on this layer's box,
  // around `center` (the box's center when not given)
  function pointsFor(layer, o, center) {
    var b = box(layer);
    var c = center || [b.left + b.width / 2, b.top + b.height / 2];
    var a = (o.angle || 0) * Math.PI / 180;
    var dir = [Math.cos(a), -Math.sin(a)];
    var base = chord(b.width, b.height, a);
    var scale = (o.scale || 100) / 100;
    if (o.style === 1) {
      var half = base * scale / 2;
      return { s: [c[0] - dir[0] * half, c[1] - dir[1] * half], e: [c[0] + dir[0] * half, c[1] + dir[1] * half] };
    }
    var r = o.style === 3 ? Math.min(b.width, b.height) / 2 : base / 2 * scale;
    return { s: [c[0], c[1]], e: [c[0] + dir[0] * r, c[1] + dir[1] * r] };
  }

  // one expression per overlay property; `pick` = a | s | o | al
  function rigExpression(pick) {
    return [
      "// Mótion Film: the gradient follows the \"" + START + "\" and \"" + END + "\" points (drag them in the viewer)",
      "try {",
      "var S = effect(\"" + START + "\")(1), E = effect(\"" + END + "\")(1);",
      "var type = Math.round(thisProperty.propertyGroup(1)(\"gradientFill/type\").value);",
      "function chord(w, h, a) { var c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a)); return Math.min(c > 1e-6 ? w / c : 1e9, s > 1e-6 ? h / s : 1e9); }",
      "function solve(p, q, L, T, W, H) {",
      "  var dx = q[0] - p[0], dy = q[1] - p[1], len = Math.sqrt(dx * dx + dy * dy);",
      "  var a = len > 1e-6 ? Math.atan2(-dy, dx) : 0;",
      "  var c = type == 1 ? [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2] : [p[0], p[1]];",
      "  var base = chord(W, H, a); if (type != 1) { base = base / 2; }",
      "  return { a: a * 180 / Math.PI, s: type == 3 ? 100 : len / Math.max(1e-6, base) * 100, o: [(c[0] - (L + W / 2)) / W * 100, (c[1] - (T + H / 2)) / H * 100], al: 1 };",
      "}",
      "var cs = toComp(S), ce = toComp(E);",
      "var r = solve([cs[0], cs[1]], [ce[0], ce[1]], 0, 0, thisComp.width, thisComp.height); r.al = 0;",
      "if (r.s < 10) { var b = sourceRectAtTime(time, false); r = solve(S, E, b.left, b.top, Math.max(1, b.width), Math.max(1, b.height)); r.al = 1; }",
      "r.s = Math.max(10, Math.min(150, r.s));",
      "r." + pick + ";",
      "} catch (err) { value; }"
    ].join("\n");
  }

  // adds (or keeps) the two points and links the overlay to them; a layer
  // that already had them keeps where they are (a new gradient, same place)
  function rig(layer, o) {
    var had = rigged(layer);
    if (!had) {
      var pts = pointsFor(layer, o);
      var fx = effects(layer);
      if (!pointCtl(layer, START)) { fx.addProperty("ADBE Point Control").name = START; }
      fx = effects(layer); // references go stale after addProperty
      if (!pointCtl(layer, END)) { fx.addProperty("ADBE Point Control").name = END; }
      pointCtl(layer, START).property(1).setValue(pts.s);
      pointCtl(layer, END).property(1).setValue(pts.e);
    }
    var g = overlay(layer);
    if (!g) { return; }
    var map = { "gradientFill/angle": "a", "gradientFill/scale": "s", "gradientFill/offset": "o", "gradientFill/align": "al" };
    for (var m in map) {
      if (map.hasOwnProperty(m)) {
        try { g.property(m).expression = rigExpression(map[m]); } catch (exprError) {}
      }
    }
    // the crosshairs show while the two effects are selected
    try {
      pointCtl(layer, START).selected = true;
      pointCtl(layer, END).selected = true;
    } catch (selError) {}
  }

  // the panel's Angle / Scale / Style on a layer with points: the points
  // move (Style keeps the gradient where it was: Linear's middle <-> the
  // other styles' center)
  function restyleRig(layer, o) {
    var g = overlay(layer);
    var ps = pointCtl(layer, START).property(1), pe = pointCtl(layer, END).property(1);
    var t = layer.containingComp.time;
    var S = ps.valueAtTime(t, false), E = pe.valueAtTime(t, false);
    var oldType = 1;
    try { oldType = g.property("gradientFill/type").value; } catch (e) {}
    var center = oldType === 1 ? [(S[0] + E[0]) / 2, (S[1] + E[1]) / 2] : [S[0], S[1]];
    var dx = E[0] - S[0], dy = E[1] - S[1];
    var angle = Math.atan2(-dy, dx) * 180 / Math.PI;
    var len = Math.sqrt(dx * dx + dy * dy);
    var nS, nE;
    if (o.what === "style") {
      put(layer, g, "gradientFill/type", o.style);
      var a = angle * Math.PI / 180, dir = [Math.cos(a), -Math.sin(a)];
      if (o.style === 1 && oldType !== 1) { // radius -> full length around the center
        nS = [center[0] - dir[0] * len, center[1] - dir[1] * len]; nE = [center[0] + dir[0] * len, center[1] + dir[1] * len];
      } else if (o.style !== 1 && oldType === 1) { // full length -> radius from the middle
        nS = center; nE = [center[0] + dir[0] * len / 2, center[1] + dir[1] * len / 2];
      } else { return; }
    } else if (o.what === "angle" || o.what === "scale") {
      var p = pointsFor(layer, { style: oldType, angle: o.what === "angle" ? o.angle : angle, scale: o.scale }, center);
      if (o.what === "angle") { // keep the length, turn around the center
        var a2 = o.angle * Math.PI / 180, d2 = [Math.cos(a2), -Math.sin(a2)];
        if (oldType === 1) { p = { s: [center[0] - d2[0] * len / 2, center[1] - d2[1] * len / 2], e: [center[0] + d2[0] * len / 2, center[1] + d2[1] * len / 2] }; }
        else { p = { s: center, e: [center[0] + d2[0] * len, center[1] + d2[1] * len] }; }
      }
      nS = p.s; nE = p.e;
    } else {
      return;
    }
    function setPt(prop, v) { if (prop.numKeys > 0) { prop.setValueAtTime(t, v); } else { prop.setValue(v); } }
    setPt(ps, nS);
    setPt(pointCtl(layer, END).property(1), nE);
  }

  function setStyle(layer, o) {
    var g = overlay(layer);
    if (!g) { return false; }
    if (rigged(layer)) {
      if (o.what === "reverse" || !o.what) { put(layer, g, "gradientFill/reverse", o.reverse ? 1 : 0); }
      if (!o.what) { put(layer, g, "gradientFill/type", o.style); }
      else if (o.what !== "reverse") { restyleRig(layer, o); }
      return true;
    }
    if (!o.what || o.what === "style") { put(layer, g, "gradientFill/type", o.style); }
    if (!o.what || o.what === "angle") { put(layer, g, "gradientFill/angle", o.angle); }
    if (!o.what || o.what === "scale") { put(layer, g, "gradientFill/scale", o.scale); }
    if (!o.what || o.what === "reverse") { put(layer, g, "gradientFill/reverse", o.reverse ? 1 : 0); }
    return true;
  }

  // ------------------------------------------------------------------ calls

  function mfgInfo() {
    var comp = activeComp();
    if (!comp) { return stringify({ ok: true, comp: false }); }
    var sel = selected(comp);
    var withGrad = 0;
    for (var i = 0; i < sel.length; i += 1) {
      var g = overlay(sel[i]);
      if (g && g.enabled) { withGrad += 1; }
    }
    return stringify({ ok: true, comp: true, name: comp.name, selected: sel.length, withGradient: withGrad });
  }

  function mfgApply(o) {
    var comp = activeComp();
    if (!comp) { return stringify({ ok: false, error: "Open a composition first." }); }
    var file = new File(o.ffx);
    if (!file.exists) { return stringify({ ok: false, error: "The gradient preset wasn't written." }); }
    var layers = selected(comp);
    var created = null;
    app.beginUndoGroup("Mótion Film: Gradient " + (o.name || ""));
    try {
      if (!layers.length) {
        created = comp.layers.addSolid([1, 1, 1], "Gradient · " + (o.name || "Mótion Film"), comp.width, comp.height, comp.pixelAspect, comp.duration);
        layers = [created];
      }
      var done = 0;
      var failed = [];
      for (var i = 0; i < layers.length; i += 1) {
        try {
          var keep = rigged(layers[i]);
          layers[i].applyPreset(file);
          var g = overlay(layers[i]);
          if (g) {
            try { g.enabled = true; } catch (enableError) {}
            if (o.handles || keep) {
              put(layers[i], g, "gradientFill/type", o.style);
              put(layers[i], g, "gradientFill/reverse", o.reverse ? 1 : 0);
              rig(layers[i], o);
            } else {
              setStyle(layers[i], o);
            }
          }
          done += 1;
        } catch (applyError) {
          failed.push(layers[i].name);
        }
      }
      // applyPreset leaves the selection alone in most cases; put it back
      // anyway so a second click lands on the same layers
      try {
        for (var s = 1; s <= comp.numLayers; s += 1) { comp.layer(s).selected = false; }
        for (var k = 0; k < layers.length; k += 1) { layers[k].selected = true; }
      } catch (selError) {}
      app.endUndoGroup();
      if (!done) { return stringify({ ok: false, error: "After Effects didn't take the gradient on " + failed.join(", ") + "." }); }
      var msg = created
        ? "New layer “" + created.name + "”."
        : "“" + o.name + "” on " + (done === 1 ? "“" + layers[0].name + "”" : done + " layers") + ".";
      if (o.handles) { msg += " Drag the Gradient Start / End points in the viewer."; }
      if (failed.length) { msg += " Skipped: " + failed.join(", ") + "."; }
      return stringify({ ok: true, message: msg, created: !!created });
    } catch (error) {
      app.endUndoGroup();
      return stringify({ ok: false, error: String(error) });
    }
  }

  function mfgStyle(o) {
    var comp = activeComp();
    if (!comp) { return stringify({ ok: true, changed: 0 }); }
    var layers = [];
    var sel = selected(comp);
    for (var i = 0; i < sel.length; i += 1) {
      var g = overlay(sel[i]);
      if (g && g.enabled) { layers.push(sel[i]); }
    }
    if (!layers.length) { return stringify({ ok: true, changed: 0 }); } // no empty undo step
    app.beginUndoGroup("Mótion Film: Gradient style");
    for (var k = 0; k < layers.length; k += 1) {
      try { setStyle(layers[k], o); } catch (styleError) {}
    }
    app.endUndoGroup();
    return stringify({ ok: true, changed: layers.length });
  }

  $.global.mfgInfo = mfgInfo;
  $.global.mfgApply = mfgApply;
  $.global.mfgStyle = mfgStyle;
}());
