/*
 * Mótion Film -- Elastic (painel do atalho, client/elastic.js).
 *
 * "Position" / "Scale" / "Rotation": nas camadas selecionadas com essa
 * propriedade animada (2+ keyframes), põe uma expressão que, ao chegar
 * em cada keyframe (do 2º em diante), deixa o valor passar do ponto com
 * a velocidade com que chegou e voltar numa oscilação amortecida.
 *
 *   desvio(t) = v * (amp / 100) * sin(2*pi*f*t) / (2*pi*f) * e^(-decay*t)
 *
 * Com amp = 100 a velocidade continua igual à da chegada (sem tranco).
 * Chegada com ease (velocidade ~0) não balança -- o elástico pede
 * chegada rápida / linear.
 *
 * Ajustes na própria camada: 3 Slider Control "Elastic <alvo> ·
 * Amplitude / Frequency / Decay" (Effect Controls), um trio por camada
 * e alvo, compartilhado por X/Y/Z. Aplicar de novo mantém os valores.
 * Posição com dimensões separadas: a expressão vai em cada dimensão
 * animada.
 *
 * Carregado sob demanda via $.evalFile. ExtendScript: um undo por ação.
 */
(function () {
  var TAG = "// Mótion Film Elastic";
  var KNOBS = [
    { key: "amp", name: "Amplitude", value: 70 },
    { key: "freq", name: "Frequency", value: 2.5 },
    { key: "decay", name: "Decay", value: 5 }
  ];
  var TARGETS = {
    position: { label: "Position", match: "ADBE Position", parts: ["ADBE Position_0", "ADBE Position_1", "ADBE Position_2"] },
    scale: { label: "Scale", match: "ADBE Scale" },
    rotation: { label: "Rotation", match: "ADBE Rotate Z" }
  };

  function stringify(v) {
    try { return JSON.stringify(v); } catch (e) { return '{"ok":false,"error":"serialize"}'; }
  }

  function knobName(target, knob) { return "Elastic " + target.label + " · " + knob.name; }

  function expressionFor(target) {
    var lines = [TAG + " (" + target.label + ") -- adjust in Effect Controls"];
    for (var i = 0; i < KNOBS.length; i += 1) {
      var k = KNOBS[i];
      lines.push("var " + k.key + " = " + k.value + ";");
      lines.push("try { " + k.key + " = effect(\"" + knobName(target, k) + "\")(1); } catch (err) {}");
    }
    return lines.concat([
      "var n = 0;",
      "if (numKeys > 1) { n = nearestKey(time).index; if (key(n).time > time) { n--; } }",
      "var t = n > 1 ? time - key(n).time : 0;",
      "if (t > 0 && freq > 0) {",
      "  var v = velocityAtTime(key(n).time - thisComp.frameDuration / 10);",
      "  var w = 2 * Math.PI * freq;",
      "  value + v * (amp / 100) * Math.sin(w * t) / w * Math.exp(-decay * t);",
      "} else {",
      "  value;",
      "}"
    ]).join("\n");
  }

  // The layer's slider for a knob, created with the default when missing.
  function ensureKnob(layer, target, knob) {
    var fx = layer.property("ADBE Effect Parade");
    var name = knobName(target, knob);
    for (var i = 1; i <= fx.numProperties; i += 1) {
      if (fx.property(i).name === name) { return; }
    }
    var slider = fx.addProperty("ADBE Slider Control");
    slider.name = name;
    layer.property("ADBE Effect Parade").property(name).property(1).setValue(knob.value);
  }

  // Animated (2+ keys) properties of the target on a layer.
  function animatedProps(layer, target) {
    var tg = layer.property("ADBE Transform Group");
    if (!tg) { return []; }
    var prop = tg.property(target.match);
    var out = [];
    if (target.parts && prop && prop.dimensionsSeparated) {
      for (var j = 0; j < target.parts.length; j += 1) {
        var p = tg.property(target.parts[j]);
        if (p && p.numKeys >= 2) { out.push(p); }
      }
    } else if (prop && prop.numKeys >= 2) {
      out.push(prop);
    }
    return out;
  }

  $.global.mfElastic = function (kind) {
    var target = TARGETS[kind];
    if (!target) { return stringify({ ok: false, error: "Unknown option." }); }
    var comp = app.project ? app.project.activeItem : null;
    if (!(comp instanceof CompItem)) { return stringify({ ok: false, error: "Open a composition first." }); }
    var layers = comp.selectedLayers;
    var jobs = [];
    var i;
    for (i = 0; i < layers.length; i += 1) {
      if (animatedProps(layers[i], target).length) { jobs.push(layers[i]); }
    }
    if (!jobs.length) {
      return stringify({ ok: false, error: layers.length ? "Animate the " + target.label + " with 2 keyframes first." : "Select the animated layers." });
    }
    // remember the selected keyframes: adding effects can drop them
    var keep = [];
    var props = comp.selectedProperties;
    for (i = 0; i < props.length; i += 1) {
      var keys = null;
      try { keys = props[i].propertyType === PropertyType.PROPERTY ? props[i].selectedKeys : null; } catch (e) {}
      if (keys && keys.length) { keep.push({ prop: props[i], keys: keys }); }
    }
    var expr = expressionFor(target);
    var count = 0;
    app.beginUndoGroup("Mótion Film: Elastic " + target.label);
    try {
      for (i = 0; i < jobs.length; i += 1) {
        for (var k = 0; k < KNOBS.length; k += 1) { ensureKnob(jobs[i], target, KNOBS[k]); }
        var list = animatedProps(jobs[i], target);
        for (var p = 0; p < list.length; p += 1) {
          list[p].expression = expr;
          list[p].expressionEnabled = true;
          count += 1;
        }
      }
      for (i = 0; i < layers.length; i += 1) { try { layers[i].selected = true; } catch (e2) {} }
      for (i = 0; i < keep.length; i += 1) {
        for (var s = 0; s < keep[i].keys.length; s += 1) {
          try { keep[i].prop.setSelectedAtKey(keep[i].keys[s], true); } catch (e3) {}
        }
      }
    } catch (error) {
      app.endUndoGroup();
      return stringify({ ok: false, error: "Couldn't apply: " + String(error.message || error) });
    }
    app.endUndoGroup();
    return stringify({ ok: true, count: count, message: "Elastic " + target.label + (jobs.length > 1 ? " on " + jobs.length + " layers" : "") });
  };
}());
