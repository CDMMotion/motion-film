/*
 * Mótion Film -- Counter (aba Text Animation › 02 / COUNTER,
 * client/counter.js).
 *
 * Um número que conta de "From" até "To" a partir do In point da camada:
 * um Slider Control "MF Counter · Value" com 2 keyframes (In point e In
 * point + duração) e o Source Text por expressão mostrando esse valor
 * arredondado e formatado. Por serem keyframes, a subida se ajusta com
 * as curvas de velocidade do Graph Editor; o padrão é ease-out cúbico
 * (saída rápida, chegada suave), o mesmo do preview. Moeda: nenhuma, $,
 * € ou R$ (prefixo). Formato 1.000,00 (pontos primeiro) ou 1,000.00
 * (vírgulas primeiro) e 0..4 casas decimais. Moeda, formato e casas
 * ficam na camada como controles (MF Counter · Symbol / Format /
 * Decimals), para trocar depois no Effect Controls. Sem camada de texto
 * selecionada, cria uma no meio da comp. O slider do AE vai até
 * 1.000.000. Aplicar de novo troca o contador (inclui o antigo, de
 * expressão com From / To / Duration).
 *
 * Carregado sob demanda via $.evalFile. Um undo por ação.
 */
(function () {
  var NAME = "MF Counter";
  var SYMBOLS = ["None", "$", "€", "R$"];
  var SYMBOL_KEY = { none: 1, usd: 2, eur: 3, brl: 4 };
  var FORMATS = ["1.000,00", "1,000.00"];

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

  // reads the layer's MF Counter controls
  function expression() {
    function fx(n) { return "effect(\"" + knob(n) + "\")(1).value"; }
    return [
      "// Mótion Film Counter -- the number is the keyframed Effect Controls › " + knob("Value") + " (shape it with speed curves); " + knob("Decimals") + " / Format / Symbol shape the text",
      "var n = " + fx("Value") + ";",
      "var d = Math.max(0, Math.min(6, Math.round(" + fx("Decimals") + ")));",
      "var comma = Math.round(" + fx("Format") + ") == 2, th = comma ? \",\" : \".\", dec = comma ? \".\" : \",\";",
      "var sym = [\"\", \"$\", \"€\", \"R$ \"][Math.max(0, Math.min(3, Math.round(" + fx("Symbol") + ") - 1))];",
      "var parts = Math.abs(n).toFixed(d).split(\".\");",
      "var s = parts[0].replace(/\\B(?=(\\d{3})+(?!\\d))/g, th) + (d > 0 ? dec + parts[1] : \"\");",
      "(n < 0 && Number(Math.abs(n).toFixed(d)) != 0 ? \"-\" : \"\") + sym + s;"
    ].join("\n");
  }

  // a control on the layer: [name, matchName, value, dropdown items]
  function addKnob(layer, name, matchName, value, items) {
    var fx = layer.property("ADBE Effect Parade");
    var idx = fx.addProperty(matchName).propertyIndex;
    if (items) { fx.property(idx).property(1).setPropertyParameters(items); }
    fx = layer.property("ADBE Effect Parade");
    fx.property(idx).name = knob(name);
    fx.property(idx).property(1).setValue(value);
  }

  // Two keys from -> to over d seconds, eased like 1 - (1 - t)^3: leaves
  // at 3x the average speed, lands at 0 (bezier handles at 1/3 and 2/3).
  function keyframe(prop, t0, from, to, d) {
    prop.setValueAtTime(t0, from);
    prop.setValueAtTime(t0 + d, to);
    for (var k = 1; k <= 2; k += 1) { prop.setInterpolationTypeAtKey(k, KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER); }
    var flat = new KeyframeEase(0, 33.333);
    prop.setTemporalEaseAtKey(1, [flat], [new KeyframeEase(3 * (to - from) / d, 33.333)]);
    prop.setTemporalEaseAtKey(2, [flat], [flat]);
  }

  // o: { from, to, currency, duration }
  $.global.ctApply = function (o) {
    var comp = activeComp();
    if (!comp) { return stringify({ ok: false, error: "Open a composition first." }); }
    o = o || {};
    var from = Math.max(-1000000, Math.min(1000000, Number(o.from) || 0));
    var to = Math.max(-1000000, Math.min(1000000, Number(o.to) || 0));
    var duration = Math.max(0.1, Number(o.duration) || 2);
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
        layer.property("ADBE Effect Parade").addProperty("ADBE Slider Control").name = knob("Value");
        addKnob(layer, "Decimals", "ADBE Slider Control", Math.max(0, Math.min(4, Math.round(Number(o.decimals) || 0))));
        addKnob(layer, "Format", "ADBE Dropdown Control", o.format === "comma" ? 2 : 1, FORMATS);
        addKnob(layer, "Symbol", "ADBE Dropdown Control", SYMBOL_KEY[o.currency] || 1, SYMBOLS);
        var value = layer.property("ADBE Effect Parade").property(knob("Value")).property(1);
        keyframe(value, layer.inPoint, from, to, duration);
        sourceText(layer).expression = expression();
        layer.selected = true;
        // the two keys selected: the Graph Editor shows them right away
        try { value.setSelectedAtKey(1, true); value.setSelectedAtKey(2, true); } catch (selectError) {}
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
