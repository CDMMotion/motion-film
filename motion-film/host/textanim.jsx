/*
 * Mótion Film -- Text Animation (aba Text Animation).
 *
 * Aplica um preset da biblioteca (client/textanim-library.js) nas camadas
 * de texto SELECIONADAS: um Text Animator "MF In" (entrada) e/ou "MF Out"
 * (saída). As propriedades do animator guardam o visual ESCONDIDO de cada
 * letra / palavra / linha e um Range Selector varre o texto com dois
 * keyframes de Offset:
 *
 *   In   Ramp Up,   Start 0, End = spread, Offset -spread -> 100
 *   Out  Ramp Down, Start 0, End = spread, Offset -spread -> 100
 *   (shape "square": End 100, Offset In 0 -> 100, Out -100 -> 0)
 *
 * Os dois revelam/escondem da esquerda pra direita (conferido no AE). A
 * entrada começa no In point da camada; a saída termina no último quadro.
 * Distâncias do preset são para fonte de 100 px e são escaladas pelo
 * tamanho real da fonte. Aplicar de novo troca os animators MF.
 *
 * Carregado sob demanda pelo painel (client/textanim.js) via $.evalFile.
 * ExtendScript: nada de Array.indexOf/forEach; um undo group por ação.
 */
(function () {
  var NAME_IN = "MF In";
  var NAME_OUT = "MF Out";
  var BASED_ON = { c: 2, w: 3, l: 4 }; // Characters Excluding Spaces, Words, Lines

  function stringify(v) {
    try { return JSON.stringify(v); } catch (e) { return '{"ok":false,"error":"serialize"}'; }
  }

  function textLayersOf(comp) {
    var out = [];
    var sel = comp.selectedLayers;
    for (var i = 0; i < sel.length; i += 1) {
      if (sel[i] instanceof TextLayer) { out.push(sel[i]); }
    }
    return out;
  }

  function activeComp() {
    var item = app.project ? app.project.activeItem : null;
    return item instanceof CompItem ? item : null;
  }

  function animatorsOf(layer) {
    return layer.property("ADBE Text Properties").property("ADBE Text Animators");
  }

  function removeMF(layer) {
    var group = animatorsOf(layer);
    var removed = 0;
    for (var i = group.numProperties; i >= 1; i -= 1) {
      var n = group.property(i).name;
      if (n === NAME_IN || n === NAME_OUT) {
        group.property(i).remove();
        removed += 1;
      }
    }
    return removed;
  }

  // Adding animators selects them and drops the layer selection; put it
  // back so Apply / Remove can be clicked again right away.
  function reselect(layers) {
    for (var i = 0; i < layers.length; i += 1) {
      try { layers[i].selected = true; } catch (e) {}
    }
  }

  function fontSizeOf(layer) {
    try {
      var size = layer.property("ADBE Text Properties").property("ADBE Text Document").value.fontSize;
      if (size > 0) { return size; }
    } catch (e) {}
    return 100;
  }

  function setEase(prop, kind, mode) {
    if (kind === "linear") {
      prop.setInterpolationTypeAtKey(1, KeyframeInterpolationType.LINEAR, KeyframeInterpolationType.LINEAR);
      prop.setInterpolationTypeAtKey(2, KeyframeInterpolationType.LINEAR, KeyframeInterpolationType.LINEAR);
      return;
    }
    // Same curves as EASES in client/textanim.js.
    var a = kind === "strong" ? 80 : 50; // influence leaving the first key
    var b = kind === "strong" ? 85 : 60; // influence arriving at the last key
    if (mode === "out") { var t = a; a = b; b = t; } // exits speed up instead of settling
    prop.setTemporalEaseAtKey(1, [new KeyframeEase(0, 33.33)], [new KeyframeEase(0, a)]);
    prop.setTemporalEaseAtKey(2, [new KeyframeEase(0, b)], [new KeyframeEase(0, 33.33)]);
  }

  // One animator for one preset. Properties are fetched again by index
  // after every addProperty (AE can invalidate older references).
  function build(layer, preset, mode, t0, t1, ease) {
    var k = fontSizeOf(layer) / 100;
    var v = preset.v || {};
    var animator = animatorsOf(layer).addProperty("ADBE Text Animator");
    animator.name = mode === "in" ? NAME_IN : NAME_OUT;
    var index = animator.propertyIndex;
    function anim() { return animatorsOf(layer).property(index); }
    function set(matchName, value) {
      anim().property("ADBE Text Animator Properties").addProperty(matchName);
      anim().property("ADBE Text Animator Properties").property(matchName).setValue(value);
    }
    function num(x) { return typeof x === "number" ? x : 0; }

    if (v.ap) { set("ADBE Text Anchor Point 3D", [num(v.ap[0]) * k, num(v.ap[1]) * k, num(v.ap[2]) * k]); }
    if (v.p) { set("ADBE Text Position 3D", [num(v.p[0]) * k, num(v.p[1]) * k, num(v.p[2]) * k]); }
    if (v.s) { set("ADBE Text Scale 3D", [num(v.s[0]), num(v.s[1]), 100]); }
    if (typeof v.sk === "number") {
      set("ADBE Text Skew", v.sk);
      set("ADBE Text Skew Axis", num(v.ska));
    }
    if (typeof v.rx === "number") { set("ADBE Text Rotation X", v.rx); }
    if (typeof v.ry === "number") { set("ADBE Text Rotation Y", v.ry); }
    if (typeof v.r === "number") { set("ADBE Text Rotation", v.r); }
    if (typeof v.o === "number") { set("ADBE Text Opacity", v.o); }
    if (typeof v.tr === "number") {
      set("ADBE Text Track Type", 1);
      set("ADBE Text Tracking Amount", v.tr);
    }
    if (v.b) { set("ADBE Text Blur", [num(v.b[0]) * k, num(v.b[1]) * k]); }

    anim().property("ADBE Text Selectors").addProperty("ADBE Text Selector");
    var sel = anim().property("ADBE Text Selectors").property(1);
    var adv = sel.property("ADBE Text Range Advanced");
    var square = preset.shape === "square";
    var spread = square ? 100 : Math.max(5, Math.min(100, num(preset.spread) || 60));
    adv.property("ADBE Text Range Units").setValue(1);
    adv.property("ADBE Text Range Type2").setValue(BASED_ON[preset.unit] || 2);
    adv.property("ADBE Text Range Shape").setValue(square ? 1 : (mode === "in" ? 2 : 3));
    if (square) { adv.property("ADBE Text Selector Smoothness").setValue(0); }
    adv.property("ADBE Text Levels Max Ease").setValue(num(preset.eh));
    adv.property("ADBE Text Levels Min Ease").setValue(num(preset.el));
    if (preset.rnd) {
      adv.property("ADBE Text Randomize Order").setValue(1);
      adv.property("ADBE Text Random Seed").setValue(preset.rnd);
    }
    sel.property("ADBE Text Percent Start").setValue(0);
    sel.property("ADBE Text Percent End").setValue(spread);

    var from = -spread;
    var to = 100;
    if (square) {
      from = mode === "in" ? 0 : -100;
      to = mode === "in" ? 100 : 0;
    }
    var offset = sel.property("ADBE Text Percent Offset");
    offset.setValueAtTime(t0, from);
    offset.setValueAtTime(t1, to);
    setEase(offset, ease, mode);
  }

  // opts: { inPreset, outPreset, durIn, durOut, ease }
  $.global.taApply = function (opts) {
    var comp = activeComp();
    if (!comp) { return stringify({ ok: false, error: "Open a composition first." }); }
    var layers = textLayersOf(comp);
    if (!layers.length) { return stringify({ ok: false, error: "Select one or more text layers." }); }
    if (!opts || (!opts.inPreset && !opts.outPreset)) { return stringify({ ok: false, error: "Turn on In or Out." }); }
    var fd = comp.frameDuration;
    app.beginUndoGroup("Mótion Film: Text Animation");
    try {
      for (var i = 0; i < layers.length; i += 1) {
        var layer = layers[i];
        removeMF(layer);
        var start = layer.inPoint;
        var end = layer.outPoint - fd;
        var durIn = opts.inPreset ? Math.max(fd, opts.durIn || 1) : 0;
        var durOut = opts.outPreset ? Math.max(fd, opts.durOut || 1) : 0;
        var room = end - start;
        if (durIn + durOut > room && room > 0) {
          var f = room / (durIn + durOut);
          durIn *= f;
          durOut *= f;
        }
        var needs3D = (opts.inPreset && opts.inPreset.d3) || (opts.outPreset && opts.outPreset.d3);
        if (needs3D && !layer.threeDPerChar) { layer.threeDPerChar = true; }
        if (opts.inPreset) { build(layer, opts.inPreset, "in", start, start + durIn, opts.ease); }
        if (opts.outPreset) { build(layer, opts.outPreset, "out", end - durOut, end, opts.ease); }
      }
      reselect(layers);
    } catch (e) {
      app.endUndoGroup();
      return stringify({ ok: false, error: "Couldn't animate: " + e.toString() + (e.line ? " (line " + e.line + ")" : "") });
    }
    app.endUndoGroup();
    return stringify({ ok: true, count: layers.length, message: layers.length === 1 ? "Text animated." : layers.length + " text layers animated." });
  };

  $.global.taRemove = function () {
    var comp = activeComp();
    if (!comp) { return stringify({ ok: false, error: "Open a composition first." }); }
    var layers = textLayersOf(comp);
    if (!layers.length) { return stringify({ ok: false, error: "Select one or more text layers." }); }
    var removed = 0;
    app.beginUndoGroup("Mótion Film: Remove Text Animation");
    try {
      for (var i = 0; i < layers.length; i += 1) { removed += removeMF(layers[i]); }
      reselect(layers);
    } catch (e) {
      app.endUndoGroup();
      return stringify({ ok: false, error: e.toString() });
    }
    app.endUndoGroup();
    if (!removed) { return stringify({ ok: true, message: "No Mótion Film animation on the selection." }); }
    return stringify({ ok: true, message: "Text animation removed." });
  };

  // What the panel's status pill / preview needs: is there a comp, how
  // many text layers are selected, the first one's text.
  $.global.taState = function () {
    var comp = activeComp();
    if (!comp) { return stringify({ ok: true, comp: false, count: 0 }); }
    var layers = textLayersOf(comp);
    var text = "";
    if (layers.length) {
      try { text = String(layers[0].property("ADBE Text Properties").property("ADBE Text Document").value.text); } catch (e) {}
    }
    return stringify({ ok: true, comp: true, compName: comp.name, count: layers.length, text: text.substr(0, 80) });
  };
}());
