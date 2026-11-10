/*
 * Mótion Film -- Typewriter (aba Text Animation › 03 / TYPEWRITER,
 * client/typewriter.js). Nossa versão: a ideia de "digitar" o texto com um
 * cursor piscando, código nosso.
 *
 * Na camada de texto:
 *   - Source Text por expressão: mostra só a parte do texto até o
 *     Progress (por letra, palavra ou linha) e, com cursor, um caractere
 *     de cursor no fim ( | █ _ ).
 *   - Slider "MF Type · Progress" (0-100 %) com keyframes do In point até
 *     um tempo que sai do tamanho do texto (autoDuration; Linear ou Ease);
 *     com Erase, segura e volta a 0.
 *     Mover os keyframes muda o tempo.
 *   - Cursor: Text Animator "MF Type Cursor" (Opacity 0) com Expression
 *     Selector que só pega o último caractere (o cursor) e o esconde nas
 *     piscadas -- o cursor ocupa o lugar dele sempre, então o texto não
 *     pula quando pisca. Sólido enquanto digita, pisca parado ("MF Type ·
 *     Blink", piscadas por segundo); "MF Type · Cursor" liga/desliga;
 *     "MF Type · Hide At End" some com ele quando termina.
 *
 * Carregado sob demanda via $.evalFile. Um undo por ação.
 */
(function () {
  var NAME = "MF Type";
  var MARK = "// Mótion Film Typewriter";
  var CURSORS = { bar: "|", block: "█", line: "_" };

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
  function animators(layer) { return layer.property("ADBE Text Properties").property("ADBE Text Animators"); }

  function removeOld(layer) {
    var n = 0;
    var st = sourceText(layer);
    if (st.expression.indexOf(MARK) >= 0) { st.expression = ""; n += 1; }
    var anims = animators(layer);
    for (var i = anims.numProperties; i >= 1; i -= 1) {
      if (anims.property(i).name === NAME + " Cursor") { anims.property(i).remove(); n += 1; }
    }
    var fx = layer.property("ADBE Effect Parade");
    for (var j = fx.numProperties; j >= 1; j -= 1) {
      if (String(fx.property(j).name).indexOf(NAME + " · ") === 0) { fx.property(j).remove(); n += 1; }
    }
    return n;
  }

  // the text up to Progress, by letter / word / line, plus the cursor
  function textExpression(by, cursorChar) {
    var cut = {
      letter: [
        "var shown = full.substr(0, Math.floor(full.length * p + 1e-6));"
      ],
      word: [
        "// a word keeps the spaces / line breaks that follow it",
        "var parts = full.match(/\\s+|\\S+\\s*/g) || [];",
        "var words = 0; for (var i = 0; i < parts.length; i++) { if (/\\S/.test(parts[i])) { words++; } }",
        "var want = Math.floor(words * p + 1e-6), shown = '', got = 0;",
        "for (var j = 0; j < parts.length && got < want; j++) { shown += parts[j]; if (/\\S/.test(parts[j])) { got++; } }"
      ],
      line: [
        "var lines = full.split(/\\r\\n|\\r|\\n|\\u0003/);",
        "var shown = lines.slice(0, Math.floor(lines.length * p + 1e-6)).join('\\r');"
      ]
    }[by] || [];
    return [MARK + " (" + by + ") -- tune in Effect Controls › " + NAME + ", retime with the Progress keyframes",
      "var full = '' + value;",
      "var p = Math.min(100, Math.max(0, effect(\"" + knob("Progress") + "\")(1).value)) / 100;"
    ].concat(cut).concat([
      cursorChar ? "shown + " + JSON.stringify(cursorChar) + ";" : "shown;"
    ]).join("\n");
  }

  // the cursor is the last character; hidden between blinks and when off
  function cursorExpression() {
    return [MARK + " cursor",
      "var pr = effect(\"" + knob("Progress") + "\")(1);",
      "var typing = Math.abs(pr.value - pr.valueAtTime(time - thisComp.frameDuration)) > 0.0001;",
      "var rate = Math.max(0.1, effect(\"" + knob("Blink") + "\")(1).value);",
      "var show = effect(\"" + knob("Cursor") + "\")(1).value == 1 && (typing || Math.floor((time - inPoint) * rate * 2) % 2 == 0);",
      "if (show && effect(\"" + knob("Hide At End") + "\")(1).value == 1 && pr.numKeys > 0 && time > pr.key(pr.numKeys).time + 0.4) { show = false; }",
      "(textIndex == textTotal && !show) ? 100 : 0;"
    ].join("\n");
  }

  function addSlider(layer, name, value) {
    layer.property("ADBE Effect Parade").addProperty("ADBE Slider Control").name = knob(name);
    var p = layer.property("ADBE Effect Parade").property(knob(name)).property(1);
    p.setValue(value);
    return p;
  }
  function addCheckbox(layer, name, on) {
    layer.property("ADBE Effect Parade").addProperty("ADBE Checkbox Control").name = knob(name);
    layer.property("ADBE Effect Parade").property(knob(name)).property(1).setValue(on ? 1 : 0);
  }

  // How long the typing takes, from the amount of text (the panel has no
  // Duration: it's retimed by moving the Progress keyframes). Same rule as
  // client/typewriter.js.
  function autoDuration(text, by) {
    text = String(text);
    var n, step;
    if (by === "word") { n = (text.match(/\S+/g) || []).length; step = 0.3; }
    else if (by === "line") { n = text.split(/\r\n|\r|\n|\u0003/).length; step = 0.6; }
    else { n = text.length; step = 0.06; }
    return Math.min(4, Math.max(0.4, n * step));
  }

  // o: { by, ease, cursor (none|bar|block|line), blink, hideAtEnd, erase, hold }
  function build(layer, o) {
    var by = o.by === "word" || o.by === "line" ? o.by : "letter";
    var cursorChar = CURSORS[o.cursor] || "";
    var d = autoDuration(sourceText(layer).value.text, by);
    var t0 = layer.inPoint;

    var pr = addSlider(layer, "Progress", 0);
    var times = [t0, t0 + d];
    var values = [0, 100];
    if (o.erase) {
      var hold = Math.max(0, Number(o.hold) || 0);
      times.push(t0 + d + hold, t0 + d + hold + d * 0.6);
      values.push(100, 0);
    }
    pr.setValuesAtTimes(times, values);
    for (var k = 1; k <= pr.numKeys; k += 1) {
      if (o.ease) {
        var e = [new KeyframeEase(0, 60)];
        pr.setInterpolationTypeAtKey(k, KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);
        pr.setTemporalEaseAtKey(k, e, e);
      } else {
        pr.setInterpolationTypeAtKey(k, KeyframeInterpolationType.LINEAR, KeyframeInterpolationType.LINEAR);
      }
    }
    if (cursorChar) {
      addSlider(layer, "Blink", Math.max(0.1, Number(o.blink) || 2));
      addCheckbox(layer, "Cursor", true);
      addCheckbox(layer, "Hide At End", !!o.hideAtEnd);
    }
    sourceText(layer).expression = textExpression(by, cursorChar);

    if (cursorChar) {
      var a = animators(layer).addProperty("ADBE Text Animator");
      a.name = NAME + " Cursor";
      var idx = a.propertyIndex;
      var A = function () { return animators(layer).property(idx); };
      A().property("ADBE Text Animator Properties").addProperty("ADBE Text Opacity");
      A().property("ADBE Text Animator Properties").property("ADBE Text Opacity").setValue(0);
      A().property("ADBE Text Selectors").addProperty("ADBE Text Expressible Selector");
      var sel = A().property("ADBE Text Selectors").property(1);
      try { sel.property("ADBE Text Range Type2").setValue(1); } catch (e2) {} // Characters (spaces count)
      sel.property("ADBE Text Expressible Amount").expression = cursorExpression();
    }
  }

  $.global.twApply = function (o) {
    var comp = activeComp();
    if (!comp) { return stringify({ ok: false, error: "Open a composition first." }); }
    var layers = textLayers(comp);
    if (!layers.length) { return stringify({ ok: false, error: "Select one or more text layers." }); }
    app.beginUndoGroup("Mótion Film: Typewriter");
    try {
      for (var i = 0; i < layers.length; i += 1) {
        removeOld(layers[i]);
        build(layers[i], o || {});
      }
      for (var j = 0; j < layers.length; j += 1) { try { layers[j].selected = true; } catch (e) {} }
    } catch (error) {
      app.endUndoGroup();
      return stringify({ ok: false, error: "Couldn't apply the typewriter: " + String(error.message || error) + (error.line ? " (line " + error.line + ")" : "") });
    }
    app.endUndoGroup();
    return stringify({ ok: true, message: layers.length === 1 ? "Typewriter applied." : layers.length + " text layers typing." });
  };

  $.global.twRemove = function () {
    var comp = activeComp();
    if (!comp) { return stringify({ ok: false, error: "Open a composition first." }); }
    var layers = textLayers(comp);
    if (!layers.length) { return stringify({ ok: false, error: "Select the typewriter's text layers." }); }
    var n = 0;
    app.beginUndoGroup("Mótion Film: Remove Typewriter");
    try {
      for (var i = 0; i < layers.length; i += 1) { n += removeOld(layers[i]); }
    } catch (error) {
      app.endUndoGroup();
      return stringify({ ok: false, error: String(error.message || error) });
    }
    app.endUndoGroup();
    return stringify({ ok: true, message: n ? "Typewriter removed." : "No Mótion Film typewriter on the selection." });
  };
}());
