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
 * "Select": a mesma expressão em QUALQUER propriedade selecionada (ou
 * com keyframes selecionados) que tenha 2+ keyframes e valor numérico
 * (1D/2D/3D/cor) -- efeitos, máscaras, shapes, opacidade... Um trio
 * "Elastic · Amplitude / Frequency / Decay" por camada, compartilhado,
 * + checkbox "Elastic · Floor": ligado, em vez de passar do ponto o
 * valor quica de volta (como bater no chão):
 *   desvio(t) = -v * (amp / 100) * |sin(2*pi*f*t)| / (2*pi*f) * e^(-decay*t)
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
    rotation: { label: "Rotation", match: "ADBE Rotate Z" },
    selected: { label: "", any: true }
  };
  var FLOOR = "Elastic · Floor";
  var VALUE_TYPES = [PropertyValueType.OneD, PropertyValueType.TwoD, PropertyValueType.ThreeD,
    PropertyValueType.TwoD_SPATIAL, PropertyValueType.ThreeD_SPATIAL, PropertyValueType.COLOR];

  function stringify(v) {
    try { return JSON.stringify(v); } catch (e) { return '{"ok":false,"error":"serialize"}'; }
  }

  function knobName(target, knob) { return (target.label ? "Elastic " + target.label : "Elastic") + " · " + knob.name; }

  function expressionFor(target) {
    var lines = [TAG + " (" + (target.label || "Select") + ") -- adjust in Effect Controls"];
    for (var i = 0; i < KNOBS.length; i += 1) {
      var k = KNOBS[i];
      lines.push("var " + k.key + " = " + k.value + ";");
      lines.push("try { " + k.key + " = effect(\"" + knobName(target, k) + "\")(1).value; } catch (err) {}");
    }
    return lines.concat([
      "var n = 0;",
      "if (numKeys > 1) { n = nearestKey(time).index; if (key(n).time > time) { n--; } }",
      "var t = n > 1 ? time - key(n).time : 0;",
      "if (t > 0 && freq > 0) {",
      "  var v = velocityAtTime(key(n).time - thisComp.frameDuration / 10);",
      "  var w = 2 * Math.PI * freq;",
      "  var wave = Math.sin(w * t);"
    ]).concat(target.any ? [
      "  var floor = 0;",
      "  try { floor = effect(\"" + FLOOR + "\")(1).value; } catch (err) {}",
      "  if (floor) { wave = -Math.abs(wave); }"
    ] : []).concat([
      "  value + v * (amp / 100) * wave / w * Math.exp(-decay * t);",
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

  function ensureFloor(layer) {
    var fx = layer.property("ADBE Effect Parade");
    for (var i = 1; i <= fx.numProperties; i += 1) {
      if (fx.property(i).name === FLOOR) { return; }
    }
    fx.addProperty("ADBE Checkbox Control").name = FLOOR;
  }

  function isValueType(t) {
    for (var i = 0; i < VALUE_TYPES.length; i += 1) { if (VALUE_TYPES[i] === t) { return true; } }
    return false;
  }

  // A property as layer + indices, found again after effects are added
  // (that can invalidate the objects AE handed out before).
  function pathOf(prop) {
    var idx = [];
    var p = prop;
    while (p && p.propertyDepth > 0) {
      idx.unshift(p.propertyIndex);
      p = p.parentProperty;
    }
    return { layer: p, idx: idx };
  }
  function resolve(path) {
    var p = path.layer;
    for (var i = 0; i < path.idx.length && p; i += 1) { p = p.property(path.idx[i]); }
    return p;
  }

  // "Select": the animated numeric properties selected (or with selected
  // keys), skipping our own sliders. [{ layer, paths: [] }] per layer.
  function selectedJobs(comp) {
    var props = comp.selectedProperties;
    var byLayer = [];
    for (var i = 0; i < props.length; i += 1) {
      var p = props[i];
      if (p.propertyType !== PropertyType.PROPERTY || !p.canSetExpression || p.numKeys < 2 || !isValueType(p.propertyValueType)) { continue; }
      var g = p.parentProperty;
      var ours = false;
      while (g && g.propertyDepth > 0) {
        if ((g.matchName === "ADBE Slider Control" || g.matchName === "ADBE Checkbox Control") && String(g.name).indexOf("Elastic") === 0) { ours = true; }
        g = g.parentProperty;
      }
      if (ours) { continue; }
      var path = pathOf(p);
      var job = null;
      for (var j = 0; j < byLayer.length; j += 1) { if (byLayer[j].layer === path.layer) { job = byLayer[j]; } }
      if (!job) { job = { layer: path.layer, paths: [] }; byLayer.push(job); }
      job.paths.push(path);
    }
    return byLayer;
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
    var picked = target.any ? selectedJobs(comp) : [];
    var i;
    if (target.any) {
      for (i = 0; i < picked.length; i += 1) { jobs.push(picked[i].layer); }
    } else {
      for (i = 0; i < layers.length; i += 1) {
        if (animatedProps(layers[i], target).length) { jobs.push(layers[i]); }
      }
    }
    if (!jobs.length) {
      if (target.any) { return stringify({ ok: false, error: "Select animated properties (2+ keyframes) or their keyframes." }); }
      return stringify({ ok: false, error: layers.length ? "Animate the " + target.label + " with 2 keyframes first." : "Select the animated layers." });
    }
    // remember the selected keyframes: adding effects can drop them
    var keep = [];
    var props = comp.selectedProperties;
    for (i = 0; i < props.length; i += 1) {
      var keys = null;
      try { keys = props[i].propertyType === PropertyType.PROPERTY ? props[i].selectedKeys : null; } catch (e) {}
      if (keys && keys.length) { keep.push({ path: pathOf(props[i]), keys: keys }); }
    }
    var expr = expressionFor(target);
    var count = 0;
    app.beginUndoGroup("Mótion Film: Elastic " + target.label);
    try {
      for (i = 0; i < jobs.length; i += 1) {
        for (var k = 0; k < KNOBS.length; k += 1) { ensureKnob(jobs[i], target, KNOBS[k]); }
        if (target.any) { ensureFloor(jobs[i]); }
        var list = [];
        if (target.any) {
          for (var q = 0; q < picked[i].paths.length; q += 1) { list.push(resolve(picked[i].paths[q])); }
        } else {
          list = animatedProps(jobs[i], target);
        }
        for (var p = 0; p < list.length; p += 1) {
          list[p].expression = expr;
          list[p].expressionEnabled = true;
          count += 1;
        }
      }
      for (i = 0; i < layers.length; i += 1) { try { layers[i].selected = true; } catch (e2) {} }
      for (i = 0; i < keep.length; i += 1) {
        var kp = null;
        try { kp = resolve(keep[i].path); } catch (e4) {}
        for (var s = 0; kp && s < keep[i].keys.length; s += 1) {
          try { kp.setSelectedAtKey(keep[i].keys[s], true); } catch (e3) {}
        }
      }
    } catch (error) {
      app.endUndoGroup();
      return stringify({ ok: false, error: "Couldn't apply: " + String(error.message || error) });
    }
    app.endUndoGroup();
    var what = target.any ? "Elastic on " + count + " propert" + (count === 1 ? "y" : "ies") : "Elastic " + target.label;
    return stringify({ ok: true, count: count, message: what + (jobs.length > 1 ? " (" + jobs.length + " layers)" : "") });
  };
}());
