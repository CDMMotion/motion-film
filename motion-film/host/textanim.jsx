/*
 * Mótion Film -- Text Animation (aba Text Animation, client/textanim.js).
 *
 * Letra por letra, palavra por palavra ou linha por linha (o.by), como a
 * prévia do painel: cada unidade entra com ease-out cúbico, com atraso de
 * (índice x Delay), a partir de:
 *   rise    +Amount em Y       drop     -Amount em Y
 *   left    -Amount em X       right    +Amount em X
 *   fade    só opacidade       scale    escala 0
 *   zoomout escala 250%        blur     desfoque forte (Blur x 3.6)
 *   rotate  -90 graus          tracking letras abertas (Amount x 4)
 * Bounce (checkbox "MF Text · Bounce"): balanço elástico (passa ~30%,
 * volta, passa de novo) até assentar.
 * Todas começam com opacidade 0 e o Blur escolhido.
 *
 * Na camada: um Text Animator "MF Text" com Expression Selector
 * (Based On: letras sem espaço / palavras / linhas) + 4 Slider Control "MF Text · Amount / Delay /
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
  // by: the selector's Based On (2 Characters Excluding Spaces, 3 Words,
  // 4 Lines) and the Anchor Point Grouping (1 Character, 2 Word, 3 Line)
  var BY = {
    letter: { based: 2, group: 1, label: "letter by letter" },
    word: { based: 3, group: 2, label: "word by word" },
    line: { based: 4, group: 3, label: "line by line" }
  };

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
    fx.addProperty("ADBE Checkbox Control").name = knob("Bounce");
    layer.property("ADBE Effect Parade").property(knob("Bounce")).property(1).setValue(o.bounce ? 1 : 0);
  }

  // o: { by, style, amount, delay, duration, blur, bounce }
  function build(layer, o) {
    if (!BY[o.by]) { o.by = "letter"; }
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
    var MOVE = { rise: "[0, A, 0]", drop: "[0, -A, 0]", left: "[-A, 0, 0]", right: "[A, 0, 0]" };
    if (MOVE[st]) {
      var p = prop("ADBE Text Position 3D");
      p.setValue([0, 0, 0]);
      p.expression = "var A = " + read("Amount") + "; " + MOVE[st];
    }
    if (st === "scale") { prop("ADBE Text Scale 3D").setValue([0, 0, 100]); }
    if (st === "zoomout") { prop("ADBE Text Scale 3D").setValue([250, 250, 100]); }
    if (st === "rotate") { prop("ADBE Text Rotation").setValue(-90); }
    if (st === "tracking") {
      var tk = prop("ADBE Text Tracking Amount");
      tk.expression = read("Amount") + " * 4";
    }
    if (st === "scale" || st === "zoomout" || st === "rotate") {
      // scale / turn each letter / word / line from its middle, not its baseline
      try {
        var more = layer.property("ADBE Text Properties").property("ADBE Text More Options");
        more.property("ADBE Text Anchor Point Option").setValue(BY[o.by].group);
        more.property("ADBE Text Anchor Point Align").setValue([0, -50]);
      } catch (e) {}
    }
    prop("ADBE Text Opacity").setValue(0);
    var b = prop("ADBE Text Blur");
    b.setValue([0, 0]);
    b.expression = "var b = " + read("Blur") + (st === "blur" ? " * 3.6" : "") + "; [b, b]";

    A().property("ADBE Text Selectors").addProperty("ADBE Text Expressible Selector");
    var sel = A().property("ADBE Text Selectors").property(1);
    try { sel.property("ADBE Text Range Type2").setValue(BY[o.by].based); } catch (e2) {}
    sel.property("ADBE Text Expressible Amount").expression = [
      "// Mótion Film -- " + BY[o.by].label + ", ease-out (tune in Effect Controls › " + NAME + ")",
      "var gap = " + read("Delay") + ";",
      "var dur = Math.max(0.01, " + read("Duration") + ");",
      "var t = (time - inPoint - (textIndex - 1) * gap) / dur;",
      "t = Math.min(1, Math.max(0, t));",
      "// Bounce: an elastic swing (~30% past, back, past again) that settles",
      "var e = effect(\"" + knob("Bounce") + "\")(1).value ? (t >= 1 ? 1 : 1 - Math.exp(-6 * t) * Math.cos(5 * Math.PI * t)) : 1 - Math.pow(1 - t, 3);",
      "100 * (1 - e);"
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
    return stringify({ ok: true, comp: true, count: layers.length, text: text.substr(0, 120) });
  };
}());
