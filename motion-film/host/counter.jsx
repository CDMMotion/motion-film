/*
 * Mótion Film -- Counter (aba Text Animation › 02 / COUNTER,
 * client/counter.js).
 *
 * Um número que conta até o valor escolhido, com ease-out cúbico, a
 * partir do In point da camada: Source Text por expressão lendo 3 Slider
 * Control "MF Counter · From / To / Duration" (ajustáveis depois no
 * Effect Controls). Moeda: nenhuma, $ ou € (milhar com vírgula) ou R$
 * (milhar com ponto). Sem camada de texto selecionada, cria uma no meio
 * da comp. Os sliders do AE vão até 1.000.000.
 *
 * Carregado sob demanda via $.evalFile. Um undo por ação.
 */
(function () {
  var NAME = "MF Counter";
  var CURRENCY = {
    none: { prefix: "", sep: "," },
    usd: { prefix: "$", sep: "," },
    eur: { prefix: "€", sep: "," },
    brl: { prefix: "R$ ", sep: "." }
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
  function sourceText(layer) { return layer.property("ADBE Text Properties").property("ADBE Text Document"); }

  function removeOld(layer) {
    var n = 0;
    var st = sourceText(layer);
    if (st.expression.indexOf("Mótion Film Counter") >= 0) { st.expression = ""; n += 1; }
    var fx = layer.property("ADBE Effect Parade");
    for (var j = fx.numProperties; j >= 1; j -= 1) {
      if (String(fx.property(j).name).indexOf(NAME + " · ") === 0) { fx.property(j).remove(); n += 1; }
    }
    return n;
  }

  function expression(cur) {
    var c = CURRENCY[cur] || CURRENCY.none;
    return [
      "// Mótion Film Counter -- tune in Effect Controls › " + NAME,
      "var a = effect(\"" + knob("From") + "\")(1).value, b = effect(\"" + knob("To") + "\")(1).value;",
      "var d = Math.max(0.01, effect(\"" + knob("Duration") + "\")(1).value);",
      "var t = Math.min(1, Math.max(0, (time - inPoint) / d));",
      "var n = Math.round(a + (b - a) * (1 - Math.pow(1 - t, 3)));",
      "var s = String(Math.abs(n)).replace(/\\B(?=(\\d{3})+(?!\\d))/g, \"" + c.sep + "\");",
      "(n < 0 ? \"-\" : \"\") + \"" + c.prefix + "\" + s;"
    ].join("\n");
  }

  // o: { to, currency, duration }
  $.global.ctApply = function (o) {
    var comp = activeComp();
    if (!comp) { return stringify({ ok: false, error: "Open a composition first." }); }
    o = o || {};
    var to = Math.max(-1000000, Math.min(1000000, Number(o.to) || 0));
    var layers = textLayers(comp);
    app.beginUndoGroup("Mótion Film: Counter");
    try {
      var made = false;
      if (!layers.length) {
        var l = comp.layers.addText("0");
        l.name = NAME;
        var doc = sourceText(l).value;
        doc.fontSize = Math.round(comp.height / 8);
        doc.justification = ParagraphJustification.CENTER_JUSTIFY;
        sourceText(l).setValue(doc);
        var r = l.sourceRectAtTime(0, false);
        l.property("ADBE Transform Group").property("ADBE Anchor Point").setValue([r.left + r.width / 2, r.top + r.height / 2]);
        l.property("ADBE Transform Group").property("ADBE Position").setValue([comp.width / 2, comp.height / 2]);
        layers = [l];
        made = true;
      }
      for (var i = 0; i < layers.length; i += 1) {
        var layer = layers[i];
        removeOld(layer);
        var fx = layer.property("ADBE Effect Parade");
        var values = [["From", 0], ["To", to], ["Duration", Math.max(0.1, Number(o.duration) || 2)]];
        for (var k = 0; k < values.length; k += 1) {
          fx.addProperty("ADBE Slider Control").name = knob(values[k][0]);
          layer.property("ADBE Effect Parade").property(knob(values[k][0])).property(1).setValue(values[k][1]);
        }
        sourceText(layer).expression = expression(o.currency);
        layer.selected = true;
      }
      app.endUndoGroup();
      return stringify({ ok: true, message: made ? "Counter made in a new text layer." : (layers.length === 1 ? "Counter applied." : layers.length + " counters applied.") });
    } catch (error) {
      app.endUndoGroup();
      return stringify({ ok: false, error: "Couldn't make the counter: " + String(error.message || error) + (error.line ? " (line " + error.line + ")" : "") });
    }
  };

  $.global.ctRemove = function () {
    var comp = activeComp();
    if (!comp) { return stringify({ ok: false, error: "Open a composition first." }); }
    var layers = textLayers(comp);
    if (!layers.length) { return stringify({ ok: false, error: "Select the counter's text layer." }); }
    var n = 0;
    app.beginUndoGroup("Mótion Film: Remove Counter");
    try {
      for (var i = 0; i < layers.length; i += 1) { n += removeOld(layers[i]); }
    } catch (error) {
      app.endUndoGroup();
      return stringify({ ok: false, error: String(error.message || error) });
    }
    app.endUndoGroup();
    return stringify({ ok: true, message: n ? "Counter removed." : "No Mótion Film counter on the selection." });
  };
}());
