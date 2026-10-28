/*
 * Mótion Film -- Text Animation (aba Text Animation, client/textanim.js).
 *
 * Letra por letra, como a prévia do painel: cada letra entra com
 * ease-out cúbico, com atraso de (índice x Delay), a partir de:
 *   rise   +Amount em Y        drop   -Amount em Y
 *   left   -Amount em X        fade   só opacidade
 *   scale  escala 0            blur   desfoque forte (Blur x 3.6)
 * Todas começam com opacidade 0 e o Blur escolhido.
 *
 * Na camada: um Text Animator "MF Text" com Expression Selector
 * (letras sem espaço) + 4 Slider Control "MF Text · Amount / Delay /
 * Duration / Blur" -- as propriedades e o seletor leem os sliders por
 * expressão, então dá pra ajustar depois no Effect Controls sem
 * reaplicar. Começa no In point da camada. Aplicar de novo troca (tira
 * também os animators MF de versões antigas: "MF In" / "MF Out").
 *
 * Carregado sob demanda via $.evalFile. Um undo por ação.
 */
(function () {
  var NAME = "MF Text";
  var OLD = { "MF Text": true, "MF In": true, "MF Out": true };
  var KNOBS = ["Amount", "Delay", "Duration", "Blur"];

  function stringify(v) {
    try { return JSON.stringify(v); } catch (e) { return '{"ok":false,"error":"serialize"}'; }
  }
  function activeComp() {
    var a = app.project ? app.project.activeItem : null;
    return a instanceof CompItem ? a : null;
  }
  function textLayers(comp) {
    var out = [];
    var sel = comp.selectedLayers;
    for (var i = 0; i < sel.length; i += 1) { if (sel[i] instanceof TextLayer) { out.push(sel[i]); } }
    return out;
  }
  function knob(name) { return NAME + " · " + name; }
  function read(name) { return "effect(\"" + knob(name) + "\")(1).value"; }

  function removeOld(layer) {
    var n = 0;
    var anims = layer.property("ADBE Text Properties").property("ADBE Text Animators");
    for (var i = anims.numProperties; i >= 1; i -= 1) {
      if (OLD[anims.property(i).name]) { anims.property(i).remove(); n += 1; }
    }
    var fx = layer.property("ADBE Effect Parade");
    for (var j = fx.numProperties; j >= 1; j -= 1) {
      if (String(fx.property(j).name).indexOf(NAME + " · ") === 0) { fx.property(j).remove(); n += 1; }
    }
    return n;
  }

  function setKnobs(layer, o) {
    var values = [o.amount, o.delay, o.duration, o.blur];
    var fx = layer.property("ADBE Effect Parade");
    for (var i = 0; i < KNOBS.length; i += 1) {
      fx.addProperty("ADBE Slider Control").name = knob(KNOBS[i]);
      layer.property("ADBE Effect Parade").property(knob(KNOBS[i])).property(1).setValue(values[i]);
    }
  }

  // o: { style, amount, delay, duration, blur }
  function build(layer, o) {
    setKnobs(layer, o);
    var anims = layer.property("ADBE Text Properties").property("ADBE Text Animators");
    var a = anims.addProperty("ADBE Text Animator");
    a.name = NAME;
    var idx = a.propertyIndex;
    function A() { return layer.property("ADBE Text Properties").property("ADBE Text Animators").property(idx); }
    function prop(match) {
      A().property("ADBE Text Animator Properties").addProperty(match);
      return A().property("ADBE Text Animator Properties").property(match);
    }
    var st = o.style;
    if (st === "rise" || st === "drop" || st === "left") {
      var p = prop("ADBE Text Position 3D");
      p.setValue([0, 0, 0]);
      p.expression = st === "left" ? "[-" + read("Amount") + ", 0, 0]" : (st === "drop" ? "[0, -" + read("Amount") + ", 0]" : "[0, " + read("Amount") + ", 0]");
    }
    if (st === "scale") {
      prop("ADBE Text Scale 3D").setValue([0, 0, 100]);
      // scale each letter from its middle, not its baseline
      try {
        var more = layer.property("ADBE Text Properties").property("ADBE Text More Options");
        more.property("ADBE Text Anchor Point Option").setValue(1);
        more.property("ADBE Text Anchor Point Align").setValue([0, -50]);
      } catch (e) {}
    }
    prop("ADBE Text Opacity").setValue(0);
    var b = prop("ADBE Text Blur");
    b.setValue([0, 0]);
    b.expression = "var b = " + read("Blur") + (st === "blur" ? " * 3.6" : "") + "; [b, b]";

    A().property("ADBE Text Selectors").addProperty("ADBE Text Expressible Selector");
    var sel = A().property("ADBE Text Selectors").property(1);
    try { sel.property("ADBE Text Range Type2").setValue(2); } catch (e2) {} // Characters Excluding Spaces
    sel.property("ADBE Text Expressible Amount").expression = [
      "// Mótion Film -- letter by letter, ease-out (tune in Effect Controls › " + NAME + ")",
      "var gap = " + read("Delay") + ";",
      "var dur = Math.max(0.01, " + read("Duration") + ");",
      "var t = (time - inPoint - (textIndex - 1) * gap) / dur;",
      "t = Math.min(1, Math.max(0, t));",
      "100 * Math.pow(1 - t, 3);"
    ].join("\n");
  }

  $.global.taApply = function (o) {
    var comp = activeComp();
    if (!comp) { return stringify({ ok: false, error: "Open a composition first." }); }
    var layers = textLayers(comp);
    if (!layers.length) { return stringify({ ok: false, error: "Select one or more text layers." }); }
    if (!o || !o.style) { return stringify({ ok: false, error: "Pick a style." }); }
    app.beginUndoGroup("Mótion Film: Text Animation");
    try {
      for (var i = 0; i < layers.length; i += 1) {
        removeOld(layers[i]);
        build(layers[i], o);
      }
      for (var j = 0; j < layers.length; j += 1) { try { layers[j].selected = true; } catch (e) {} }
    } catch (error) {
      app.endUndoGroup();
      return stringify({ ok: false, error: "Couldn't animate: " + String(error.message || error) + (error.line ? " (line " + error.line + ")" : "") });
    }
    app.endUndoGroup();
    return stringify({ ok: true, message: layers.length === 1 ? "Text animated." : layers.length + " text layers animated." });
  };

  $.global.taRemove = function () {
    var comp = activeComp();
    if (!comp) { return stringify({ ok: false, error: "Open a composition first." }); }
    var layers = textLayers(comp);
    if (!layers.length) { return stringify({ ok: false, error: "Select one or more text layers." }); }
    var n = 0;
    app.beginUndoGroup("Mótion Film: Remove Text Animation");
    try {
      for (var i = 0; i < layers.length; i += 1) { n += removeOld(layers[i]); }
      for (var j = 0; j < layers.length; j += 1) { try { layers[j].selected = true; } catch (e) {} }
    } catch (error) {
      app.endUndoGroup();
      return stringify({ ok: false, error: String(error) });
    }
    app.endUndoGroup();
    return stringify({ ok: true, message: n ? "Text animation removed." : "No Mótion Film animation on the selection." });
  };

  // the selected layer's text (for the preview) and how many are selected
  $.global.taState = function () {
    var comp = activeComp();
    if (!comp) { return stringify({ ok: true, comp: false, count: 0 }); }
    var layers = textLayers(comp);
    var text = "";
    if (layers.length) {
      try { text = String(layers[0].property("ADBE Text Properties").property("ADBE Text Document").value.text); } catch (e) {}
    }
    return stringify({ ok: true, comp: true, count: layers.length, text: text.substr(0, 60) });
  };
}());
